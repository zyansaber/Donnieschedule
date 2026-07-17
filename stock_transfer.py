# -*- coding: utf-8 -*-
"""
Regent RV - Firebase stock_transfer -> SAP validation report

流程：
1. 读取 Firebase Realtime Database /stock_transfer。
2. 提取 chassis、currentLocation、targetLocation、transferType、savedAt。
3. 根据 chassis 反查 MANDT=800、VKORG=3110 的 Sales Order item 0010。
4. 查询 Sales Order 最后有效 PGI：
   - 优先按 601 未被 602 反冲的方式判断；
   - 如果系统字段不支持，回退到 601 - 602 净数量逻辑。
5. 对已 PGI 的 Sales Order 查询最后有效发票，并获取 Invoice-to BP 和名称。
6. 查询最后 Invoice-to BP 的客户主数据最后变更人员（CDHDR，OBJECTCLAS='DEBI'）。
7. 查询公司仓库库存位置：
   - 3211: Perth 0001/0002, Traralgon 0003/0004,
           Launceston 0005/0006, Geelong 0007/0008
   - 3411: Frankston 0002
8. 输出 Excel。

依赖：
    pip install firebase-admin pandas pyodbc openpyxl
"""

import logging
import os
import argparse
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Tuple

import firebase_admin
import pandas as pd
import pyodbc
from firebase_admin import credentials, db
from openpyxl.styles import Alignment, Font, PatternFill


# ============================================================
# Firebase
# ============================================================
FIREBASE_CRED_PATH = "firebase-adminsdk.json"
FIREBASE_DB_URL = (
    "https://scheduling-dd672-default-rtdb.asia-southeast1.firebasedatabase.app"
)
FIREBASE_NODE = "stock_transfer"
FIREBASE_ABNORMAL_NODE = "stock_transfer_abnormal"
FIREBASE_SYNC_LOCK_NODE = "sap_sync_locks/stock_transfer_worker"


# ============================================================
# SAP HANA
# ============================================================
DSN = (
    "DRIVER={HDBODBC};"
    "SERVERNODE=10.11.2.25:30241;"
    "UID=BAOJIANFENG;"
    "PWD=Xja@2025ABC;"
)

MANDT = "800"
SALES_ORG = "3110"
SALES_ORDER_ITEM = "000010"


# ============================================================
# Worker mode
# ============================================================
WORKER_INTERVAL_SECONDS = 60
WORKER_BATCH_LIMIT = 50
WORKER_LOCK_TTL_SECONDS = 10 * 60
PROCESSING_STALE_SECONDS = 10 * 60
ERROR_RETRY_SECONDS = 10 * 60


# ============================================================
# Warehouse mapping
# ============================================================
WAREHOUSE_MAP: Dict[Tuple[str, str], str] = {
    ("3211", "0001"): "Perth",
    ("3211", "0002"): "Perth",
    ("3211", "0003"): "Traralgon",
    ("3211", "0004"): "Traralgon",
    ("3211", "0005"): "Launceston",
    ("3211", "0006"): "Launceston",
    ("3211", "0007"): "Geelong",
    ("3211", "0008"): "Geelong",
    ("3411", "0002"): "Frankston",
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(
    SCRIPT_DIR,
    "stock_transfer_sap_pgi_invoice_stock_report.xlsx",
)
LOG_FILE = os.path.join(
    SCRIPT_DIR,
    "stock_transfer_sap_pgi_invoice_stock_report.log",
)


# ============================================================
# Logging
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("StockTransferSAPReport")


# ============================================================
# Helpers
# ============================================================
def normalize_chassis(value) -> str:
    if value is None:
        return ""
    return (
        str(value)
        .strip()
        .upper()
        .replace(" ", "")
        .replace("-", "")
        .replace("_", "")
    )


def clean_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def sql_quote_list(values: Iterable[str]) -> str:
    clean_values = []
    for value in values:
        text = clean_text(value).replace("'", "''")
        if text:
            clean_values.append(f"'{text}'")
    return ",".join(clean_values) if clean_values else "''"


def chunk_list(values: List[str], size: int = 300):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def hana_query(sql: str) -> pd.DataFrame:
    with pyodbc.connect(DSN) as connection:
        return pd.read_sql(sql, connection)


def ensure_columns(df: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
    result = df.copy()
    for column in columns:
        if column not in result.columns:
            result[column] = ""
    return result


def normalize_sap_text_columns(df: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
    result = df.copy()
    for column in columns:
        if column in result.columns:
            result[column] = result[column].fillna("").astype(str).str.strip()
    return result


def format_sap_date_series(series: pd.Series) -> pd.Series:
    converted = pd.to_datetime(series, errors="coerce")
    return converted.dt.strftime("%Y-%m-%d").fillna("")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso_datetime(value) -> datetime:
    text = clean_text(value)
    if not text:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def get_worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def is_transfer_active(record: dict) -> bool:
    workflow = record.get("workflow") if isinstance(record.get("workflow"), dict) else {}
    return not (
        record.get("deletedAt")
        or record.get("cancelledAt")
        or workflow.get("purchaseDoneAt")
    )


def is_retry_due(record: dict, now_dt: datetime) -> bool:
    retry_after = parse_iso_datetime(record.get("sapSyncRetryAfter"))
    return retry_after <= now_dt


def is_processing_stale(record: dict, now_dt: datetime) -> bool:
    started_at = parse_iso_datetime(record.get("sapSyncStartedAt"))
    return started_at + timedelta(seconds=PROCESSING_STALE_SECONDS) <= now_dt


# ============================================================
# Firebase stock_transfer
# ============================================================
def initialize_firebase() -> None:
    if not firebase_admin._apps:
        cred_path = os.environ.get("FIREBASE_CRED_PATH", FIREBASE_CRED_PATH)
        if not os.path.isabs(cred_path):
            script_relative_path = os.path.join(SCRIPT_DIR, cred_path)
            cred_path = (
                script_relative_path
                if os.path.exists(script_relative_path)
                else os.path.abspath(cred_path)
            )
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(
            cred,
            {"databaseURL": FIREBASE_DB_URL},
        )


def stock_transfer_records_to_df(raw_data: dict) -> pd.DataFrame:
    rows = []
    iterable = raw_data.items() if isinstance(raw_data, dict) else []

    for firebase_key, record in iterable:
        if not isinstance(record, dict):
            continue

        chassis = normalize_chassis(record.get("chassis"))
        if not chassis:
            continue

        rows.append(
            {
                "Firebase Key": str(firebase_key),
                "Chassis": chassis,
                "Transfer Current Location": clean_text(
                    record.get("currentLocation")
                ),
                "Transfer Target Location": clean_text(
                    record.get("targetLocation")
                ),
                "Transfer Type": clean_text(record.get("transferType")),
                "Transfer Saved At": clean_text(record.get("savedAt")),
            }
        )

    columns = [
        "Firebase Key",
        "Chassis",
        "Transfer Current Location",
        "Transfer Target Location",
        "Transfer Type",
        "Transfer Saved At",
    ]
    if not rows:
        return pd.DataFrame(columns=columns)

    result = pd.DataFrame(rows)
    result["Duplicate Chassis in Firebase"] = result.duplicated(
        subset=["Chassis"], keep=False
    ).map({True: "Yes", False: "No"})
    return result


def fetch_stock_transfer() -> pd.DataFrame:
    initialize_firebase()
    raw_data = db.reference(f"/{FIREBASE_NODE}").get() or {}
    return stock_transfer_records_to_df(raw_data)


def should_sync_stock_transfer(record: dict, now_dt: datetime) -> bool:
    if not isinstance(record, dict) or not is_transfer_active(record):
        return False

    chassis = normalize_chassis(record.get("chassis"))
    if not chassis:
        return False

    status = clean_text(record.get("sapSyncStatus")).lower()
    if status == "pending":
        return True
    if status == "error" and is_retry_due(record, now_dt):
        return True
    if status == "processing" and is_processing_stale(record, now_dt):
        return True

    # Bootstrap older active rows that were created before sapSyncStatus
    # existed and still have no SAP sales order enrichment.
    if not status and not clean_text(record.get("Sales Order Display")):
        return True

    return False


def fetch_pending_stock_transfer_records(limit: int) -> dict:
    initialize_firebase()
    raw_data = db.reference(f"/{FIREBASE_NODE}").get() or {}
    now_dt = utc_now()
    pending_items = [
        (firebase_key, record)
        for firebase_key, record in raw_data.items()
        if should_sync_stock_transfer(record, now_dt)
    ]
    pending_items.sort(
        key=lambda item: (
            clean_text(item[1].get("sapSyncRequestedAt"))
            or clean_text(item[1].get("createdAt"))
            or clean_text(item[1].get("savedAt"))
        )
    )
    return dict(pending_items[:limit])


def acquire_worker_lock(worker_id: str) -> bool:
    initialize_firebase()
    lock_ref = db.reference(f"/{FIREBASE_SYNC_LOCK_NODE}")
    lock_token = str(uuid.uuid4())
    now = utc_now()
    expires_at = now + timedelta(seconds=WORKER_LOCK_TTL_SECONDS)

    def update_lock(current):
        current = current if isinstance(current, dict) else {}
        current_expires_at = parse_iso_datetime(current.get("expiresAt"))
        if current.get("lockedBy") and current_expires_at > now:
            return current
        return {
            "lockedBy": worker_id,
            "lockToken": lock_token,
            "lockedAt": utc_now_iso(),
            "expiresAt": expires_at.replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        }

    locked = lock_ref.transaction(update_lock)
    return (
        isinstance(locked, dict)
        and locked.get("lockedBy") == worker_id
        and locked.get("lockToken") == lock_token
    )


def release_worker_lock(worker_id: str) -> None:
    lock_ref = db.reference(f"/{FIREBASE_SYNC_LOCK_NODE}")
    current = lock_ref.get() or {}
    if isinstance(current, dict) and current.get("lockedBy") == worker_id:
        lock_ref.delete()


def claim_stock_transfer_record(firebase_key: str, worker_id: str) -> bool:
    record_ref = db.reference(f"/{FIREBASE_NODE}/{firebase_key}")
    claim_id = str(uuid.uuid4())
    now_dt = utc_now()

    def update_record(current):
        current = current if isinstance(current, dict) else {}
        if not should_sync_stock_transfer(current, now_dt):
            return current

        return {
            **current,
            "sapSyncStatus": "processing",
            "sapSyncStartedAt": utc_now_iso(),
            "sapSyncWorker": worker_id,
            "sapSyncClaimId": claim_id,
            "sapSyncAttempt": int(current.get("sapSyncAttempt") or 0) + 1,
            "sapSyncError": "",
        }

    claimed = record_ref.transaction(update_record)
    return (
        isinstance(claimed, dict)
        and claimed.get("sapSyncStatus") == "processing"
        and claimed.get("sapSyncWorker") == worker_id
        and claimed.get("sapSyncClaimId") == claim_id
    )


# ============================================================
# Chassis -> 3110 Sales Order
# ============================================================
def fetch_sales_orders_by_chassis(chassis_list: List[str]) -> pd.DataFrame:
    columns = [
        "Chassis",
        "Sales Order SAP",
        "Sales Order Display",
        "Sales Order Item",
        "SO Material",
        "SO Material Name",
    ]
    frames = []

    for batch in chunk_list(chassis_list):
        chassis_sql = sql_quote_list(batch)
        sql = f"""
        SELECT DISTINCT
            objk."SERNR" AS "Chassis",
            vbak."VBELN" AS "Sales Order SAP",
            ser02."POSNR" AS "Sales Order Item",
            vbap."MATNR" AS "SO Material",
            COALESCE(NULLIF(vbap."ARKTX", ''), makt."MAKTX", '')
                AS "SO Material Name"
        FROM "SAPHANADB"."SER02" ser02
        INNER JOIN "SAPHANADB"."OBJK" objk
            ON objk."MANDT" = ser02."MANDT"
           AND objk."OBKNR" = ser02."OBKNR"
        INNER JOIN "SAPHANADB"."VBAK" vbak
            ON vbak."MANDT" = ser02."MANDT"
           AND vbak."VBELN" = ser02."SDAUFNR"
        INNER JOIN "SAPHANADB"."VBAP" vbap
            ON vbap."MANDT" = ser02."MANDT"
           AND vbap."VBELN" = ser02."SDAUFNR"
           AND vbap."POSNR" = ser02."POSNR"
        LEFT JOIN "SAPHANADB"."MAKT" makt
            ON makt."MANDT" = vbap."MANDT"
           AND makt."MATNR" = vbap."MATNR"
           AND makt."SPRAS" = 'E'
        WHERE ser02."MANDT" = '{MANDT}'
          AND objk."SERNR" IN ({chassis_sql})
          AND vbak."VKORG" = '{SALES_ORG}'
          AND ser02."POSNR" = '{SALES_ORDER_ITEM}'
        """
        frame = hana_query(sql)
        if not frame.empty:
            frames.append(frame)

    if not frames:
        return pd.DataFrame(columns=columns)

    result = pd.concat(frames, ignore_index=True).drop_duplicates()
    result = normalize_sap_text_columns(
        result,
        [
            "Chassis",
            "Sales Order SAP",
            "Sales Order Item",
            "SO Material",
            "SO Material Name",
        ],
    )
    result["Sales Order Display"] = result["Sales Order SAP"].apply(
        lambda value: value.lstrip("0") or value
    )
    return result[columns]


# ============================================================
# Last valid PGI
# ============================================================
def fetch_last_valid_pgi_unreversed(sales_orders: List[str]) -> pd.DataFrame:
    """
    优先逻辑：找 601，并排除被 602 通过 SMBLN/SJAHR/SMBLP 指向的原始行。
    """
    columns = [
        "Sales Order SAP",
        "SO Is PGI",
        "SO PGI Post Date",
        "SO PGI Month",
        "SO PGI Material Document",
    ]
    frames = []

    for batch in chunk_list(sales_orders):
        so_sql = sql_quote_list(batch)
        sql = f"""
        WITH valid_601 AS (
            SELECT
                pgi."KDAUF" AS "Sales Order SAP",
                pgi."BUDAT_MKPF" AS "PGI Post Date",
                pgi."MBLNR" AS "Material Document",
                pgi."MJAHR" AS "Material Document Year",
                pgi."ZEILE" AS "Material Document Item",
                ROW_NUMBER() OVER (
                    PARTITION BY pgi."KDAUF"
                    ORDER BY
                        pgi."BUDAT_MKPF" DESC,
                        pgi."MJAHR" DESC,
                        pgi."MBLNR" DESC,
                        pgi."ZEILE" DESC
                ) AS rn
            FROM "SAPHANADB"."NSDM_V_MSEG" pgi
            LEFT JOIN "SAPHANADB"."NSDM_V_MSEG" reversal
                ON reversal."MANDT" = pgi."MANDT"
               AND reversal."BWART" = '602'
               AND reversal."SMBLN" = pgi."MBLNR"
               AND reversal."SJAHR" = pgi."MJAHR"
               AND reversal."SMBLP" = pgi."ZEILE"
            WHERE pgi."MANDT" = '{MANDT}'
              AND pgi."BWART" = '601'
              AND pgi."KDAUF" IN ({so_sql})
              AND reversal."MBLNR" IS NULL
        )
        SELECT
            "Sales Order SAP",
            'Yes' AS "SO Is PGI",
            "PGI Post Date" AS "SO PGI Post Date",
            "Material Document" AS "SO PGI Material Document"
        FROM valid_601
        WHERE rn = 1
        """
        frame = hana_query(sql)
        if not frame.empty:
            frames.append(frame)

    if not frames:
        return pd.DataFrame(columns=columns)

    result = pd.concat(frames, ignore_index=True).drop_duplicates(
        subset=["Sales Order SAP"], keep="first"
    )
    result["SO PGI Post Date"] = format_sap_date_series(
        result["SO PGI Post Date"]
    )
    result["SO PGI Month"] = result["SO PGI Post Date"].str.slice(0, 7)
    return ensure_columns(result, columns)[columns]


def fetch_last_valid_pgi_net_fallback(sales_orders: List[str]) -> pd.DataFrame:
    """
    回退逻辑：601数量 - 602数量 > 0，则认为仍有有效PGI；日期取最后601日期。
    """
    columns = [
        "Sales Order SAP",
        "SO Is PGI",
        "SO PGI Post Date",
        "SO PGI Month",
        "SO PGI Material Document",
    ]
    frames = []

    for batch in chunk_list(sales_orders):
        so_sql = sql_quote_list(batch)
        sql = f"""
        WITH movement_summary AS (
            SELECT
                mseg."KDAUF" AS "Sales Order SAP",
                SUM(
                    CASE
                        WHEN mseg."BWART" = '601' THEN COALESCE(mseg."MENGE", 0)
                        WHEN mseg."BWART" = '602' THEN -1 * COALESCE(mseg."MENGE", 0)
                        ELSE 0
                    END
                ) AS "Net PGI Qty",
                MAX(
                    CASE WHEN mseg."BWART" = '601'
                         THEN mseg."BUDAT_MKPF" END
                ) AS "SO PGI Post Date"
            FROM "SAPHANADB"."NSDM_V_MSEG" mseg
            WHERE mseg."MANDT" = '{MANDT}'
              AND mseg."KDAUF" IN ({so_sql})
              AND mseg."BWART" IN ('601', '602')
            GROUP BY mseg."KDAUF"
        )
        SELECT
            "Sales Order SAP",
            CASE WHEN "Net PGI Qty" > 0 THEN 'Yes' ELSE 'No' END AS "SO Is PGI",
            CASE WHEN "Net PGI Qty" > 0 THEN "SO PGI Post Date" ELSE NULL END
                AS "SO PGI Post Date",
            '' AS "SO PGI Material Document"
        FROM movement_summary
        """
        frame = hana_query(sql)
        if not frame.empty:
            frames.append(frame)

    if not frames:
        return pd.DataFrame(columns=columns)

    result = pd.concat(frames, ignore_index=True).drop_duplicates(
        subset=["Sales Order SAP"], keep="first"
    )
    result["SO PGI Post Date"] = format_sap_date_series(
        result["SO PGI Post Date"]
    )
    result["SO PGI Month"] = result["SO PGI Post Date"].str.slice(0, 7)
    return ensure_columns(result, columns)[columns]


def fetch_last_valid_pgi(sales_orders: List[str]) -> pd.DataFrame:
    try:
        result = fetch_last_valid_pgi_unreversed(sales_orders)
        logger.info("PGI query used unreversed 601/602 reference logic.")
        return result
    except Exception as error:
        logger.warning(
            "Unreversed PGI query failed; fallback to net 601-602 logic: %s",
            error,
        )
        return fetch_last_valid_pgi_net_fallback(sales_orders)


# ============================================================
# Last valid invoice + Invoice-to BP
# ============================================================
def fetch_last_valid_invoice(sales_orders: List[str]) -> pd.DataFrame:
    columns = [
        "Sales Order SAP",
        "Last Invoice Number",
        "Last Invoice Date",
        "Invoice-to BP",
        "Invoice-to Name",
    ]
    frames = []

    for batch in chunk_list(sales_orders):
        so_sql = sql_quote_list(batch)
        sql = f"""
        WITH invoice_source AS (
            SELECT DISTINCT
                vbrp."AUBEL" AS "Sales Order SAP",
                vbrk."VBELN" AS "Invoice Number",
                vbrk."FKDAT" AS "Invoice Date",
                COALESCE(
                    NULLIF(vbpa_re."KUNNR", ''),
                    NULLIF(vbpa_rg."KUNNR", ''),
                    NULLIF(vbrk."KUNRG", '')
                ) AS "Invoice-to BP",
                ROW_NUMBER() OVER (
                    PARTITION BY vbrp."AUBEL"
                    ORDER BY
                        vbrk."FKDAT" DESC,
                        vbrk."ERDAT" DESC,
                        vbrk."ERZET" DESC,
                        vbrk."VBELN" DESC
                ) AS rn
            FROM "SAPHANADB"."VBRP" vbrp
            INNER JOIN "SAPHANADB"."VBRK" vbrk
                ON vbrk."MANDT" = vbrp."MANDT"
               AND vbrk."VBELN" = vbrp."VBELN"
            LEFT JOIN "SAPHANADB"."VBPA" vbpa_re
                ON vbpa_re."MANDT" = vbrk."MANDT"
               AND vbpa_re."VBELN" = vbrk."VBELN"
               AND vbpa_re."POSNR" = '000000'
               AND vbpa_re."PARVW" = 'RE'
            LEFT JOIN "SAPHANADB"."VBPA" vbpa_rg
                ON vbpa_rg."MANDT" = vbrk."MANDT"
               AND vbpa_rg."VBELN" = vbrk."VBELN"
               AND vbpa_rg."POSNR" = '000000'
               AND vbpa_rg."PARVW" = 'RG'
            WHERE vbrp."MANDT" = '{MANDT}'
              AND vbrp."AUBEL" IN ({so_sql})
              AND COALESCE(vbrp."AUPOS", '{SALES_ORDER_ITEM}') = '{SALES_ORDER_ITEM}'
              AND COALESCE(vbrk."FKSTO", '') <> 'X'
        )
        SELECT
            source."Sales Order SAP",
            source."Invoice Number" AS "Last Invoice Number",
            source."Invoice Date" AS "Last Invoice Date",
            source."Invoice-to BP",
            COALESCE(kna1."NAME1", '') AS "Invoice-to Name"
        FROM invoice_source source
        LEFT JOIN "SAPHANADB"."KNA1" kna1
            ON kna1."MANDT" = '{MANDT}'
           AND kna1."KUNNR" = source."Invoice-to BP"
        WHERE source.rn = 1
        """
        frame = hana_query(sql)
        if not frame.empty:
            frames.append(frame)

    if not frames:
        return pd.DataFrame(columns=columns)

    result = pd.concat(frames, ignore_index=True).drop_duplicates(
        subset=["Sales Order SAP"], keep="first"
    )
    result = normalize_sap_text_columns(
        result,
        [
            "Sales Order SAP",
            "Last Invoice Number",
            "Invoice-to BP",
            "Invoice-to Name",
        ],
    )
    result["Last Invoice Date"] = format_sap_date_series(
        result["Last Invoice Date"]
    )
    return ensure_columns(result, columns)[columns]


# ============================================================
# Last customer master change user for Invoice-to BP
# ============================================================
def fetch_invoice_bp_last_change(invoice_bps: List[str]) -> pd.DataFrame:
    columns = [
        "Invoice-to BP",
        "Invoice BP Last Changed By",
        "Invoice BP Last Change Date",
        "Invoice BP Last Change Time",
        "Invoice BP Last Change TCode",
    ]
    if not invoice_bps:
        return pd.DataFrame(columns=columns)

    frames = []
    for batch in chunk_list(invoice_bps):
        padded = [clean_text(value).zfill(10) for value in batch]
        bp_sql = sql_quote_list(padded)
        sql = f"""
        WITH ranked_change AS (
            SELECT
                cdhdr."OBJECTID" AS "Invoice-to BP",
                cdhdr."USERNAME" AS "Invoice BP Last Changed By",
                cdhdr."UDATE" AS "Invoice BP Last Change Date",
                cdhdr."UTIME" AS "Invoice BP Last Change Time",
                cdhdr."TCODE" AS "Invoice BP Last Change TCode",
                ROW_NUMBER() OVER (
                    PARTITION BY cdhdr."OBJECTID"
                    ORDER BY
                        cdhdr."UDATE" DESC,
                        cdhdr."UTIME" DESC,
                        cdhdr."CHANGENR" DESC
                ) AS rn
            FROM "SAPHANADB"."CDHDR" cdhdr
            WHERE cdhdr."MANDANT" = '{MANDT}'
              AND cdhdr."OBJECTCLAS" = 'DEBI'
              AND cdhdr."OBJECTID" IN ({bp_sql})
        )
        SELECT
            "Invoice-to BP",
            "Invoice BP Last Changed By",
            "Invoice BP Last Change Date",
            "Invoice BP Last Change Time",
            "Invoice BP Last Change TCode"
        FROM ranked_change
        WHERE rn = 1
        """
        frame = hana_query(sql)
        if not frame.empty:
            frames.append(frame)

    if not frames:
        return pd.DataFrame(columns=columns)

    result = pd.concat(frames, ignore_index=True).drop_duplicates(
        subset=["Invoice-to BP"], keep="first"
    )
    result = normalize_sap_text_columns(
        result,
        [
            "Invoice-to BP",
            "Invoice BP Last Changed By",
            "Invoice BP Last Change Time",
            "Invoice BP Last Change TCode",
        ],
    )
    result["Invoice BP Last Change Date"] = format_sap_date_series(
        result["Invoice BP Last Change Date"]
    )
    return ensure_columns(result, columns)[columns]


# ============================================================
# Current company warehouse stock
# ============================================================
def fetch_company_stock_locations(chassis_list: List[str]) -> pd.DataFrame:
    columns = [
        "Chassis",
        "Company Stock Current Location",
        "Stock Plant",
        "Stock Storage Location",
        "Stock Qty",
        "Stock Sales Order",
        "Stock Material",
    ]
    frames = []

    for batch in chunk_list(chassis_list):
        chassis_sql = sql_quote_list(batch)
        sql = f"""
        SELECT DISTINCT
            objk."SERNR" AS "Chassis",
            nsmka."WERKS" AS "Stock Plant",
            nsmka."LGORT" AS "Stock Storage Location",
            nsmka."KALAB" AS "Stock Qty",
            nsmka."VBELN" AS "Stock Sales Order",
            nsmka."MATNR" AS "Stock Material"
        FROM "SAPHANADB"."NSDM_V_MSKA" nsmka
        INNER JOIN "SAPHANADB"."SER02" ser02
            ON ser02."MANDT" = nsmka."MANDT"
           AND ser02."SDAUFNR" = nsmka."VBELN"
           AND ser02."POSNR" = '{SALES_ORDER_ITEM}'
        INNER JOIN "SAPHANADB"."OBJK" objk
            ON objk."MANDT" = ser02."MANDT"
           AND objk."OBKNR" = ser02."OBKNR"
        WHERE nsmka."MANDT" = '{MANDT}'
          AND objk."SERNR" IN ({chassis_sql})
          AND nsmka."KALAB" > 0
          AND (
                (nsmka."WERKS" = '3211'
                 AND nsmka."LGORT" IN (
                    '0001','0002','0003','0004',
                    '0005','0006','0007','0008'
                 ))
             OR (nsmka."WERKS" = '3411' AND nsmka."LGORT" = '0002')
          )
          AND (
                nsmka."MATNR" LIKE 'Z12%'
             OR nsmka."MATNR" LIKE 'Z19%'
          )
        """
        frame = hana_query(sql)
        if not frame.empty:
            frames.append(frame)

    if not frames:
        return pd.DataFrame(columns=columns)

    detail = pd.concat(frames, ignore_index=True).drop_duplicates()
    detail = normalize_sap_text_columns(
        detail,
        [
            "Chassis",
            "Stock Plant",
            "Stock Storage Location",
            "Stock Sales Order",
            "Stock Material",
        ],
    )
    detail["Warehouse Name"] = detail.apply(
        lambda row: WAREHOUSE_MAP.get(
            (row["Stock Plant"], row["Stock Storage Location"]),
            "Unknown Company Warehouse",
        ),
        axis=1,
    )

    detail["Plant/LGORT"] = (
        detail["Stock Plant"] + "/" + detail["Stock Storage Location"]
    )

    summary = (
        detail.sort_values(
            ["Chassis", "Warehouse Name", "Stock Plant", "Stock Storage Location"]
        )
        .groupby("Chassis", as_index=False)
        .agg(
            **{
                "Company Stock Current Location": (
                    "Warehouse Name",
                    lambda values: "; ".join(dict.fromkeys(values)),
                ),
                "Stock Plant": (
                    "Stock Plant",
                    lambda values: "; ".join(dict.fromkeys(values)),
                ),
                "Stock Storage Location": (
                    "Stock Storage Location",
                    lambda values: "; ".join(dict.fromkeys(values)),
                ),
                "Stock Qty": (
                    "Stock Qty",
                    lambda values: pd.to_numeric(values, errors="coerce").fillna(0).sum(),
                ),
                "Stock Sales Order": (
                    "Stock Sales Order",
                    lambda values: "; ".join(dict.fromkeys(values)),
                ),
                "Stock Material": (
                    "Stock Material",
                    lambda values: "; ".join(dict.fromkeys(values)),
                ),
            }
        )
    )
    return summary[columns]


# ============================================================
# SAP enrichment pipeline
# ============================================================
def build_sap_enrichment(firebase_df: pd.DataFrame):
    chassis_list = firebase_df["Chassis"].drop_duplicates().tolist()
    logger.info(
        "Firebase rows=%s, unique chassis=%s",
        len(firebase_df),
        len(chassis_list),
    )

    so_df = fetch_sales_orders_by_chassis(chassis_list)
    logger.info("Found chassis/SO rows: %s", len(so_df))

    sales_orders = (
        so_df["Sales Order SAP"]
        .replace("", pd.NA)
        .dropna()
        .drop_duplicates()
        .tolist()
    )

    pgi_df = fetch_last_valid_pgi(sales_orders)
    logger.info("Found PGI rows: %s", len(pgi_df))

    invoice_df = fetch_last_valid_invoice(sales_orders)
    logger.info("Found last valid invoice rows: %s", len(invoice_df))

    invoice_bps = (
        invoice_df["Invoice-to BP"]
        .replace("", pd.NA)
        .dropna()
        .drop_duplicates()
        .tolist()
        if not invoice_df.empty
        else []
    )

    try:
        bp_change_df = fetch_invoice_bp_last_change(invoice_bps)
        logger.info("Found Invoice-to BP change log rows: %s", len(bp_change_df))
    except Exception as error:
        logger.warning(
            "Invoice-to BP change log query failed; related columns will be blank: %s",
            error,
        )
        bp_change_df = pd.DataFrame(
            columns=[
                "Invoice-to BP",
                "Invoice BP Last Changed By",
                "Invoice BP Last Change Date",
                "Invoice BP Last Change Time",
                "Invoice BP Last Change TCode",
            ]
        )

    stock_summary_df = fetch_company_stock_locations(chassis_list)
    logger.info("Found company warehouse stock summary rows: %s", len(stock_summary_df))

    stock_detail_df = stock_summary_df.copy()

    result = firebase_df.merge(
        so_df,
        how="left",
        on="Chassis",
    )
    result = result.merge(
        pgi_df,
        how="left",
        on="Sales Order SAP",
    )
    result = result.merge(
        invoice_df,
        how="left",
        on="Sales Order SAP",
    )
    result = result.merge(
        bp_change_df,
        how="left",
        on="Invoice-to BP",
    )
    result = result.merge(
        stock_summary_df,
        how="left",
        on="Chassis",
    )

    text_columns = [
        "Sales Order SAP",
        "Sales Order Display",
        "Sales Order Item",
        "SO Material",
        "SO Material Name",
        "SO Is PGI",
        "SO PGI Post Date",
        "SO PGI Month",
        "SO PGI Material Document",
        "Last Invoice Number",
        "Last Invoice Date",
        "Invoice-to BP",
        "Invoice-to Name",
        "Invoice BP Last Changed By",
        "Invoice BP Last Change Date",
        "Invoice BP Last Change Time",
        "Invoice BP Last Change TCode",
        "Company Stock Current Location",
        "Stock Plant",
        "Stock Storage Location",
        "Stock Sales Order",
        "Stock Material",
    ]
    result = ensure_columns(result, text_columns)
    for column in text_columns:
        result[column] = result[column].fillna("").astype(str).str.strip()

    result["SO Is PGI"] = result["SO Is PGI"].replace("", "No_PGI")
    result.loc[result["SO Is PGI"] != "Yes", [
        "Last Invoice Number",
        "Last Invoice Date",
        "Invoice-to BP",
        "Invoice-to Name",
        "Invoice BP Last Changed By",
        "Invoice BP Last Change Date",
        "Invoice BP Last Change Time",
        "Invoice BP Last Change TCode",
    ]] = ""

    result["Company Stock Current Location"] = result[
        "Company Stock Current Location"
    ].replace("", "Not in company warehouse")

    if "Stock Qty" not in result.columns:
        result["Stock Qty"] = 0
    result["Stock Qty"] = pd.to_numeric(
        result["Stock Qty"], errors="coerce"
    ).fillna(0)

    final_columns = [
        "Firebase Key",
        "Chassis",
        "Duplicate Chassis in Firebase",
        "Transfer Current Location",
        "Transfer Target Location",
        "Transfer Type",
        "Transfer Saved At",
        "Sales Order SAP",
        "Sales Order Display",
        "Sales Order Item",
        "SO Material",
        "SO Material Name",
        "SO Is PGI",
        "SO PGI Post Date",
        "SO PGI Month",
        "SO PGI Material Document",
        "Last Invoice Number",
        "Last Invoice Date",
        "Invoice-to BP",
        "Invoice-to Name",
        "Invoice BP Last Changed By",
        "Invoice BP Last Change Date",
        "Invoice BP Last Change Time",
        "Invoice BP Last Change TCode",
        "Company Stock Current Location",
        "Stock Plant",
        "Stock Storage Location",
        "Stock Qty",
        "Stock Sales Order",
        "Stock Material",
    ]
    result = ensure_columns(result, final_columns)[final_columns]
    result = result.sort_values(
        ["Transfer Saved At", "Chassis", "Sales Order SAP"],
        na_position="last",
    )
    return result, stock_detail_df


# ============================================================
# Excel
# ============================================================
def write_excel(
    result_df: pd.DataFrame,
    firebase_df: pd.DataFrame,
    stock_detail_df: pd.DataFrame,
) -> None:
    report_summary = pd.DataFrame(
        {
            "Metric": [
                "Firebase Transfer Rows",
                "Unique Chassis",
                "Chassis with 3110 Sales Order",
                "Chassis PGI Yes",
                "Chassis No PGI",
                "Chassis in Company Warehouse",
                "Chassis Not in Company Warehouse",
                "Generated At",
            ],
            "Value": [
                len(firebase_df),
                firebase_df["Chassis"].nunique(),
                result_df.loc[
                    result_df["Sales Order SAP"].ne(""), "Chassis"
                ].nunique(),
                result_df.loc[
                    result_df["SO Is PGI"].eq("Yes"), "Chassis"
                ].nunique(),
                result_df.loc[
                    result_df["SO Is PGI"].eq("No_PGI"), "Chassis"
                ].nunique(),
                result_df.loc[
                    result_df["Company Stock Current Location"].ne(
                        "Not in company warehouse"
                    ),
                    "Chassis",
                ].nunique(),
                result_df.loc[
                    result_df["Company Stock Current Location"].eq(
                        "Not in company warehouse"
                    ),
                    "Chassis",
                ].nunique(),
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ],
        }
    )

    with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl") as writer:
        result_df.to_excel(writer, sheet_name="Result", index=False)
        firebase_df.to_excel(writer, sheet_name="Firebase Raw", index=False)
        stock_detail_df.to_excel(writer, sheet_name="Warehouse Stock Detail", index=False)
        report_summary.to_excel(writer, sheet_name="Summary", index=False)

        header_fill = PatternFill(fill_type="solid", fgColor="1F4E78")
        header_font = Font(color="FFFFFF", bold=True)
        no_pgi_fill = PatternFill(fill_type="solid", fgColor="FFF2CC")
        outside_fill = PatternFill(fill_type="solid", fgColor="F4CCCC")

        for sheet_name, worksheet in writer.sheets.items():
            worksheet.freeze_panes = "A2"
            worksheet.auto_filter.ref = worksheet.dimensions

            for cell in worksheet[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center")

            for column_cells in worksheet.columns:
                column_letter = column_cells[0].column_letter
                max_length = 0
                for cell in column_cells:
                    value = "" if cell.value is None else str(cell.value)
                    max_length = max(max_length, min(len(value), 60))
                    cell.alignment = Alignment(vertical="top", wrap_text=True)
                worksheet.column_dimensions[column_letter].width = max(
                    12,
                    min(max_length + 2, 45),
                )

        result_ws = writer.sheets["Result"]
        header_map = {cell.value: cell.column for cell in result_ws[1]}
        pgi_col = header_map.get("SO Is PGI")
        location_col = header_map.get("Company Stock Current Location")

        for row_number in range(2, result_ws.max_row + 1):
            if pgi_col and result_ws.cell(row_number, pgi_col).value == "No_PGI":
                result_ws.cell(row_number, pgi_col).fill = no_pgi_fill
            if (
                location_col
                and result_ws.cell(row_number, location_col).value
                == "Not in company warehouse"
            ):
                result_ws.cell(row_number, location_col).fill = outside_fill



# ============================================================
# Write SAP enrichment back to Firebase stock_transfer
# ============================================================
def update_stock_transfer_with_sap(result_df: pd.DataFrame) -> None:
    """
    Write selected SAP result fields back to each original Firebase record:

        /stock_transfer/{Firebase Key}/<field>

    The Firebase Key captured during the initial read is used, so records are
    updated in place even when the same chassis appears more than once.
    """
    if result_df.empty:
        logger.info("No result rows available for Firebase update.")
        return

    fields_to_write = [
        "Sales Order Display",
        "SO Is PGI",
        "SO PGI Post Date",
        "Last Invoice Number",
        "Last Invoice Date",
        "Invoice-to Name",
        "Invoice BP Last Changed By",
        "Invoice BP Last Change Date",
        "Company Stock Current Location",
    ]

    working = result_df.copy()
    for column in ["Firebase Key", "Sales Order SAP"] + fields_to_write:
        if column not in working.columns:
            working[column] = ""
        working[column] = working[column].fillna("").astype(str).str.strip()

    # A chassis can occasionally resolve to multiple 3110 sales orders. For a
    # single Firebase record, keep the numerically/latest-looking SAP SO row.
    working = working.sort_values(
        ["Firebase Key", "Sales Order SAP"],
        ascending=[True, False],
    ).drop_duplicates(subset=["Firebase Key"], keep="first")

    updates = {}
    for _, row in working.iterrows():
        firebase_key = row["Firebase Key"]
        if not firebase_key:
            continue

        for field in fields_to_write:
            value = row[field]
            # Write an empty string when no value exists so stale prior values
            # are cleared rather than silently retained.
            updates[f"{firebase_key}/{field}"] = value

    if not updates:
        logger.info("No Firebase SAP enrichment fields to update.")
        return

    initialize_firebase()
    node_ref = db.reference(f"/{FIREBASE_NODE}")

    batch_size = 500
    update_items = list(updates.items())
    for start in range(0, len(update_items), batch_size):
        batch = dict(update_items[start:start + batch_size])
        node_ref.update(batch)
        logger.info(
            "Firebase SAP enrichment batch updated: %s fields",
            len(batch),
        )

    logger.info(
        "Firebase /%s updated for %s records with %s fields each.",
        FIREBASE_NODE,
        len(working),
        len(fields_to_write),
    )


def get_multiple_sales_order_abnormal_rows(result_df: pd.DataFrame) -> pd.DataFrame:
    if result_df.empty:
        return pd.DataFrame()
    working = result_df.copy()
    for column in ["Firebase Key", "Sales Order SAP"]:
        if column not in working.columns:
            working[column] = ""
        working[column] = working[column].fillna("").astype(str).str.strip()

    so_counts = (
        working.loc[working["Sales Order SAP"].ne("")]
        .groupby("Firebase Key")["Sales Order SAP"]
        .nunique()
    )
    abnormal_keys = so_counts[so_counts > 1].index.tolist()
    if not abnormal_keys:
        return pd.DataFrame()
    return working[working["Firebase Key"].isin(abnormal_keys)].copy()


def write_abnormal_chassis(result_df: pd.DataFrame) -> None:
    abnormal_df = get_multiple_sales_order_abnormal_rows(result_df)
    initialize_firebase()
    abnormal_ref = db.reference(f"/{FIREBASE_ABNORMAL_NODE}")

    if abnormal_df.empty:
        for firebase_key in result_df.get("Firebase Key", pd.Series(dtype=str)).dropna().unique():
            if clean_text(firebase_key):
                abnormal_ref.child(clean_text(firebase_key)).delete()
        return

    detail_columns = [
        "Sales Order SAP",
        "Sales Order Display",
        "Sales Order Item",
        "SO Material",
        "SO Material Name",
        "SO Is PGI",
        "SO PGI Post Date",
        "Last Invoice Number",
        "Last Invoice Date",
        "Invoice-to BP",
        "Invoice-to Name",
        "Company Stock Current Location",
        "Stock Plant",
        "Stock Storage Location",
        "Stock Qty",
        "Stock Sales Order",
        "Stock Material",
    ]

    for firebase_key, group in abnormal_df.groupby("Firebase Key"):
        candidates = []
        for _, row in group.iterrows():
            candidate = {}
            for column in detail_columns:
                value = row[column] if column in row.index else ""
                candidate[column] = "" if pd.isna(value) else str(value)
            candidates.append(candidate)

        first_row = group.iloc[0]
        abnormal_ref.child(clean_text(firebase_key)).set(
            {
                "reason": "MULTIPLE_SALES_ORDERS",
                "firebaseKey": clean_text(firebase_key),
                "chassis": clean_text(first_row.get("Chassis")),
                "currentLocation": clean_text(
                    first_row.get("Transfer Current Location")
                ),
                "targetLocation": clean_text(
                    first_row.get("Transfer Target Location")
                ),
                "detectedAt": utc_now_iso(),
                "candidateSalesOrders": candidates,
                "recommendedAction": "Review manually before relying on the selected sales order.",
            }
        )

    logger.info("Abnormal chassis records written: %s", abnormal_df["Firebase Key"].nunique())


def mark_sync_done(firebase_keys: List[str]) -> None:
    if not firebase_keys:
        return
    node_ref = db.reference(f"/{FIREBASE_NODE}")
    updates = {}
    synced_at = utc_now_iso()
    for firebase_key in firebase_keys:
        updates[f"{firebase_key}/sapSyncStatus"] = "done"
        updates[f"{firebase_key}/sapSyncedAt"] = synced_at
        updates[f"{firebase_key}/sapSyncError"] = ""
        updates[f"{firebase_key}/sapSyncRetryAfter"] = ""
        updates[f"{firebase_key}/sapSyncClaimId"] = ""
    node_ref.update(updates)


def mark_sync_error(firebase_keys: List[str], error: Exception) -> None:
    if not firebase_keys:
        return
    node_ref = db.reference(f"/{FIREBASE_NODE}")
    retry_after = (utc_now() + timedelta(seconds=ERROR_RETRY_SECONDS)).replace(
        microsecond=0
    ).isoformat().replace("+00:00", "Z")
    message = str(error)[:1000]
    updates = {}
    for firebase_key in firebase_keys:
        updates[f"{firebase_key}/sapSyncStatus"] = "error"
        updates[f"{firebase_key}/sapSyncError"] = message
        updates[f"{firebase_key}/sapSyncRetryAfter"] = retry_after
        updates[f"{firebase_key}/sapSyncClaimId"] = ""
    node_ref.update(updates)


def process_pending_stock_transfer_once(limit: int = WORKER_BATCH_LIMIT) -> int:
    worker_id = get_worker_id()
    if not acquire_worker_lock(worker_id):
        logger.info("Another SAP sync worker is active; skipping this cycle.")
        return 0

    claimed_keys = []
    try:
        pending_records = fetch_pending_stock_transfer_records(limit)
        if not pending_records:
            logger.info("No pending stock transfer SAP sync records.")
            return 0

        for firebase_key in pending_records:
            if claim_stock_transfer_record(firebase_key, worker_id):
                claimed_keys.append(firebase_key)

        if not claimed_keys:
            logger.info("No stock transfer records claimed for SAP sync.")
            return 0

        claimed_records = {
            firebase_key: pending_records[firebase_key]
            for firebase_key in claimed_keys
            if firebase_key in pending_records
        }
        firebase_df = stock_transfer_records_to_df(claimed_records)
        if firebase_df.empty:
            mark_sync_done(claimed_keys)
            return 0

        result, _stock_detail_df = build_sap_enrichment(firebase_df)
        write_abnormal_chassis(result)
        update_stock_transfer_with_sap(result)
        mark_sync_done(claimed_keys)
        logger.info("SAP sync worker processed records: %s", len(claimed_keys))
        return len(claimed_keys)
    except Exception as error:
        logger.exception("SAP sync worker cycle failed: %s", error)
        mark_sync_error(claimed_keys, error)
        return 0
    finally:
        release_worker_lock(worker_id)


def run_worker(interval_seconds: int, limit: int) -> None:
    logger.info(
        "Starting stock transfer SAP sync worker: interval=%ss limit=%s",
        interval_seconds,
        limit,
    )
    while True:
        process_pending_stock_transfer_once(limit=limit)
        time.sleep(interval_seconds)

# ============================================================
# Main
# ============================================================
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regent RV stock_transfer SAP enrichment"
    )
    parser.add_argument(
        "--worker",
        action="store_true",
        help="Run forever as a Firebase pending queue worker.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process one pending worker batch and exit.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=WORKER_INTERVAL_SECONDS,
        help="Worker polling interval in seconds.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=WORKER_BATCH_LIMIT,
        help="Maximum pending stock transfer records per worker cycle.",
    )
    args = parser.parse_args()

    if args.worker:
        run_worker(interval_seconds=args.interval, limit=args.limit)
        return

    if args.once:
        processed = process_pending_stock_transfer_once(limit=args.limit)
        print(f"Done. Pending SAP sync records processed: {processed}")
        return

    logger.info("Starting Firebase stock_transfer -> SAP report")

    firebase_df = fetch_stock_transfer()
    if firebase_df.empty:
        raise RuntimeError("Firebase /stock_transfer has no chassis records.")

    result, stock_detail_df = build_sap_enrichment(firebase_df)
    write_abnormal_chassis(result)
    write_excel(result, firebase_df, stock_detail_df)
    update_stock_transfer_with_sap(result)

    logger.info("Excel generated: %s", OUTPUT_FILE)
    print(f"Done. Excel generated: {OUTPUT_FILE}")
    print(f"Firebase /{FIREBASE_NODE} records updated with SAP fields.")


if __name__ == "__main__":
    main()
