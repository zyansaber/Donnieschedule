const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp({
  databaseURL: "https://scheduling-dd672-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const EMAILJS_SECRETS = [
  "EMAILJS_SERVICE_ID",
  "EMAILJS_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY",
  "EMAILJS_PRIVATE_KEY",
];

const EMAILJS_SEND_URL = "https://api.emailjs.com/api/v1.0/email/send";
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000];
const STUCK_JOB_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_EMAIL_JOB_STATUSES = ["pending", "sending", "retrying", "sent"];
const DEFAULT_APP_BASE_URL = "https://schedule-final-tyn6.onrender.com";
const TRANSFERS_PATH = "stock_transfer";
const CONFIG_PATH = "stockTransferWorkflowConfig";

const roleLabels = {
  ceo: "NSM Approval",
  location: "Location DMS Work",
  planning: "Planning Work",
  finance: "Finance Work",
  financeFloorplan: "Finance Acctg/AP - Floorplan Check",
  financeAr: "Finance AR - Reverse Invoice and PGI",
  transport: "Transport Work",
  purchase: "Purchase Work",
};

const workflowPaths = {
  ceo: "#/stock-transfer-workflow/ceo",
  location: "#/stock-transfer-workflow/location",
  planning: "#/stock-transfer-workflow/planning",
  finance: "#/stock-transfer-workflow/finance",
  transport: "#/stock-transfer-workflow/transport",
  purchase: "#/stock-transfer-workflow/purchase",
};

const reminderStages = [
  {key: "day1", delayMs: ONE_DAY_MS, titlePrefix: "Reminder"},
  {key: "day7", delayMs: 7 * ONE_DAY_MS, titlePrefix: "Final Reminder"},
];

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const getSafeFirebaseKey = (value) => String(value || "").replace(/[.#$\[\]\/]/g, "_");

const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeWorkflowLocation = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("perth") || normalized.includes("st james")) return "st_james";
  if (normalized.includes("frankston")) return "frankston";
  if (normalized.includes("geelong")) return "geelong";
  if (normalized.includes("traralgon") || normalized.includes("trarlagon")) return "traralgon";
  if (normalized.includes("launceston")) return "launceston";
  return normalized.replace(/\s+/g, "_");
};

const getConfiguredBaseUrl = (config = {}) => (
  String(config.appBaseUrl || DEFAULT_APP_BASE_URL).trim().replace(/\/+$/, "")
);

const getWorkflow = (transfer) => transfer?.workflow || {};
const isExternalTransfer = (transfer) => (
  String(transfer?.["Stock Transfer Category"] || "").trim().toLowerCase() === "external stock transfer"
);
const hasSalesOrder = (transfer) => Boolean(String(transfer?.["Sales Order Display"] || "").trim());
const isFinanceFloorplanStep = (transfer) => !getWorkflow(transfer).redoInvoiceDoneAt;
const isWorkflowComplete = (transfer) => {
  const workflow = getWorkflow(transfer);
  return isExternalTransfer(transfer) ? Boolean(workflow.planningBpDoneAt) : Boolean(workflow.purchaseDoneAt);
};
const getFinanceTaskLabel = (transfer) => (
  isFinanceFloorplanStep(transfer)
    ? "Finance Acctg/AP - Floorplan Check"
    : "Finance AR - Reverse Invoice and PGI"
);
const getTaskLabel = (role, transfer) => (
  role === "finance" ? getFinanceTaskLabel(transfer) : roleLabels[role] || "Stock Transfer Task"
);

const getFinanceRecipientKey = (transfer) => (
  isFinanceFloorplanStep(transfer) ? "financeFloorplan" : "financeAr"
);

const getTaskSubtasks = (role, transfer) => {
  if (role === "ceo") {
    return [
      "Review the stock transfer request.",
      "Confirm NSM approval can proceed.",
    ];
  }
  if (role === "location") {
    return isExternalTransfer(transfer)
      ? [
        "Confirm the unit is ready for Location DMS work.",
        "Complete DMS reverse goods receiving.",
        "Confirm when Location DMS work is done.",
      ]
      : [
        "Confirm the unit is ready for Location DMS work.",
        "Complete the DMS stock transfer.",
        "Confirm when Location DMS transfer is done.",
      ];
  }
  if (role === "planning") {
    return [
      "Change the Sales Order BP as required.",
      "Confirm the Planning update is complete.",
    ];
  }
  if (role === "finance") {
    return isFinanceFloorplanStep(transfer)
      ? [
        "Check floorplan status.",
        "Confirm Accounting/AP requirements.",
        "Confirm finance clearance before Location DMS work.",
      ]
      : [
        "Confirm Location DMS reverse goods receiving is done.",
        "Reverse invoice as required.",
        "Confirm PGI reversal / finance clearance before Planning work.",
      ];
  }
  if (role === "transport") {
    return [
      "Book transport for this stock transfer.",
      "Enter the transport vendor.",
      "Enter the pickup / booking time before confirming.",
    ];
  }
  if (role === "purchase") {
    return [
      "Raise the Transport PO.",
      "Enter the PO number before confirming.",
    ];
  }
  return [];
};

const getEmailStep = (role, transfer = {}) => {
  if (role === "ceo") return "nsm_approval";
  if (role === "location") return "location_dms";
  if (role === "planning") return "planning_change_so_bp";
  if (role === "transport") return "transport_booking";
  if (role === "purchase") return "purchase_po";
  if (role === "finance") {
    return !getWorkflow(transfer).redoInvoiceDoneAt
      ? "finance_acctg_ap_floorplan_check"
      : "finance_ar_reverse_invoice_pgi";
  }
  return role || "unknown";
};

const getRecipient = (config, role, transfer) => {
  if (role === "location") {
    return config?.locationRecipients?.[normalizeWorkflowLocation(transfer?.currentLocation)] || "";
  }
  if (role === "finance") {
    return config?.recipients?.[getFinanceRecipientKey(transfer)] || config?.recipients?.finance || "";
  }
  return config?.recipients?.[role] || "";
};

const getCcRecipient = (config, role, transfer = {}) => {
  if (role === "finance") {
    return config?.ccRecipients?.[getFinanceRecipientKey(transfer)] || config?.ccRecipients?.finance || "";
  }
  return config?.ccRecipients?.[role] || "";
};

const getWorkflowUrl = (config, role, transfer = {}) => {
  const basePath = workflowPaths[role] || workflowPaths.ceo;
  const params = new URLSearchParams();
  if (transfer.id) params.set("taskTransfer", transfer.id);
  if (role === "location") {
    params.set("location", normalizeWorkflowLocation(transfer.currentLocation));
  }
  const query = params.toString();
  return `${getConfiguredBaseUrl(config)}/${basePath}${query ? `?${query}` : ""}`;
};

const buildStockTransferTaskEmailHtml = (role, transfer, title, workflowUrl, reminderText = "") => {
  const subtasks = getTaskSubtasks(role, transfer);
  const subtasksBlock = subtasks.length ? `
    <div style="margin-top:16px;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;background:#eff6ff;">
      <div style="font-weight:700;color:#1d4ed8;margin-bottom:8px;">${escapeHtml(role === "finance" ? "Finance subtasks" : "Subtasks")}</div>
      <ul style="margin:0;padding-left:20px;color:#1e3a8a;line-height:1.55;">
        ${subtasks.map((subtask) => `<li>${escapeHtml(subtask)}</li>`).join("")}
      </ul>
    </div>
  ` : "";
  const reminderBlock = reminderText ? `
    <div style="margin-top:12px;color:#1e40af;font-size:13px;">${escapeHtml(reminderText)}</div>
  ` : "";

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#172554;">
      <div style="border-left:4px solid #2563eb;background:#eff6ff;padding:14px 16px;border-radius:10px;">
        <div style="font-weight:700;color:#1d4ed8;margin-bottom:4px;">Please confirm this stock transfer task.</div>
        <div style="color:#1e40af;font-size:13px;">Open the link and confirm once your part is done.</div>
        ${reminderBlock}
      </div>
      <div style="margin-top:16px;border:1px solid #bfdbfe;border-radius:12px;overflow:hidden;">
        <div style="padding:10px 14px;border-bottom:1px solid #dbeafe;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">Chassis</span><span style="color:#172554;">${escapeHtml(transfer.chassis || "-")}</span></div>
        <div style="padding:10px 14px;border-bottom:1px solid #dbeafe;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">From</span><span style="color:#172554;">${escapeHtml(transfer.currentLocation || "-")}</span></div>
        <div style="padding:10px 14px;border-bottom:1px solid #dbeafe;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">To</span><span style="color:#172554;">${escapeHtml(transfer.targetLocation || "-")}</span></div>
        <div style="padding:10px 14px;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">Current task</span><span style="color:#172554;">${escapeHtml(getTaskLabel(role, transfer))}</span></div>
      </div>
      ${subtasksBlock}
      <div style="margin-top:20px;text-align:center;">
        <a href="${escapeHtml(workflowUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;">Open and Confirm</a>
      </div>
    </div>
  `;
};

const buildEmailJsPayload = (job) => ({
  service_id: process.env.EMAILJS_SERVICE_ID,
  template_id: process.env.EMAILJS_TEMPLATE_ID,
  user_id: process.env.EMAILJS_PUBLIC_KEY,
  accessToken: process.env.EMAILJS_PRIVATE_KEY,
  template_params: {
    to_email: job.to,
    cc_email: job.cc || "",
    cc: job.cc || "",
    title: job.title,
    content: job.content,
    transfer_id: job.transferId || "",
    workflow_step: job.step || "",
    workflow_role: job.role || "",
  },
});

const claimJobForSend = async (jobRef, expectedStatus = "pending", triggerJob = null) => {
  const sendingAt = new Date().toISOString();
  const statusResult = await jobRef.child("status").transaction((status) => {
    if (status === expectedStatus) return "sending";
    if ((status === null || status === undefined) && triggerJob?.status === expectedStatus) return "sending";
    return;
  }, undefined, false);

  if (!statusResult.committed) return null;

  const snapshot = await jobRef.once("value");
  const job = snapshot.val();
  if (!job || job.status !== "sending") return null;

  const attempts = (Number(job.attempts) || 0) + 1;
  const updates = {
    attempts,
    sendingAt,
    updatedAt: sendingAt,
    lastError: null,
  };
  await jobRef.update(updates);
  return {
    ...job,
    ...updates,
  };
};

const validateJob = (job) => {
  const missing = ["to", "title", "content"].filter((field) => !job[field]);
  if (missing.length) {
    throw new Error(`Missing required email job field(s): ${missing.join(", ")}`);
  }
};

const sendEmailJsEmail = async (job) => {
  validateJob(job);
  logger.info("Sending EmailJS request", {
    serviceId: process.env.EMAILJS_SERVICE_ID || "",
    templateId: process.env.EMAILJS_TEMPLATE_ID || "",
    to: job.to || "",
    cc: job.cc || "",
    publicKeyPreview: process.env.EMAILJS_PUBLIC_KEY
      ? `${process.env.EMAILJS_PUBLIC_KEY.slice(0, 4)}...${process.env.EMAILJS_PUBLIC_KEY.slice(-4)}`
      : "",
    publicKeyLength: (process.env.EMAILJS_PUBLIC_KEY || "").length,
    hasPrivateKey: Boolean(process.env.EMAILJS_PRIVATE_KEY),
  });
  const response = await fetch(EMAILJS_SEND_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(buildEmailJsPayload(job)),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`EmailJS responded ${response.status}: ${responseText}`);
  }

  return responseText;
};

const sendEmailWithRetries = async (jobRef, jobId, firstClaimedJob) => {
  let claimedJob = firstClaimedJob;

  while (claimedJob) {
    try {
      const emailJsResponse = await sendEmailJsEmail(claimedJob);
      await jobRef.update({
        status: "sent",
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        emailJsResponse,
        lastError: null,
      });
      logger.info("Email job sent", {
        jobId,
        step: claimedJob.step || "",
        to: claimedJob.to,
        attempts: claimedJob.attempts || 0,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = Number(claimedJob.attempts) || 0;

      if (attempts >= MAX_SEND_ATTEMPTS) {
        await jobRef.update({
          status: "failed",
          failedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastError: message,
        });
        logger.error("Email job failed", {jobId, attempts, error: message});
        return;
      }

      const retryDelay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      const retryAt = new Date(Date.now() + retryDelay).toISOString();
      await jobRef.update({
        status: "retrying",
        retryAt,
        updatedAt: new Date().toISOString(),
        lastError: message,
      });
      logger.warn("Email job retry scheduled", {
        jobId,
        attempts,
        retryDelay,
        error: message,
      });
      await sleep(retryDelay);
      claimedJob = await claimJobForSend(jobRef, "retrying", claimedJob);
    }
  }
};

const getJobId = (context) => {
  if (context.params?.jobId) return context.params.jobId;
  const resourceName = context.resource?.name || "";
  const marker = "/refs/email_jobs/";
  const markerIndex = resourceName.indexOf(marker);
  if (markerIndex === -1) return "";
  return resourceName.slice(markerIndex + marker.length).split("/")[0];
};

exports.sendPendingEmailJob = functions
    .region("asia-southeast1")
    .runWith({maxInstances: 1, secrets: EMAILJS_SECRETS})
    .database
    .instance("scheduling-dd672-default-rtdb")
    .ref("/email_jobs/{jobId}")
    .onWrite(async (change, context) => {
      const job = change.after.val();
      const jobId = getJobId(context);

      logger.info("Email job trigger received", {
        jobId,
        paramJobId: context.params?.jobId || "",
        resourceName: context.resource?.name || "",
        status: job?.status || "",
      });

      if (!job || job.status !== "pending") return;
      if (!jobId) {
        logger.error("Email job trigger missing jobId", {
          resourceName: context.resource?.name || "",
        });
        return;
      }

      const jobRef = change.after.ref;
      const claimedJob = await claimJobForSend(jobRef, "pending", job);
      if (!claimedJob) {
        logger.info("Email job was not claimed", {jobId});
        return;
      }

      await sendEmailWithRetries(jobRef, jobId, claimedJob);
    });

const recoverStuckJobsForStatus = async (status) => {
  const snapshot = await admin.database()
      .ref("/email_jobs")
      .orderByChild("status")
      .equalTo(status)
      .once("value");

  const updates = {};
  const now = Date.now();
  snapshot.forEach((child) => {
    const job = child.val() || {};
    const marker = Date.parse(job.sendingAt || job.retryAt || job.updatedAt || "");
    if (!marker || now - marker < STUCK_JOB_MS) return;

    const attempts = Number(job.attempts) || 0;
    if (attempts >= MAX_SEND_ATTEMPTS) {
      updates[`${child.key}/status`] = "failed";
      updates[`${child.key}/failedAt`] = new Date().toISOString();
      updates[`${child.key}/lastError`] = job.lastError || "Email job exceeded retry limit during recovery";
    } else {
      updates[`${child.key}/status`] = "pending";
      updates[`${child.key}/recoveredAt`] = new Date().toISOString();
      updates[`${child.key}/lastError`] = job.lastError || `Recovered stuck ${status} email job`;
    }
    updates[`${child.key}/updatedAt`] = new Date().toISOString();
  });

  if (Object.keys(updates).length) {
    await admin.database().ref("/email_jobs").update(updates);
  }

  return Object.keys(updates).length;
};

const getActiveStockTransferTask = (transfer) => {
  const workflow = getWorkflow(transfer);
  if (transfer.deletedAt || transfer.cancelledAt || isWorkflowComplete(transfer)) return null;
  if (!hasSalesOrder(transfer)) return null;
  if (!workflow.ceoApprovedAt) return {role: "ceo", doneKey: "ceoApprovedAt", emailQueuedAtKey: "ceoEmailQueuedAt"};
  if (!workflow.redoInvoiceDoneAt) return {role: "finance", doneKey: "redoInvoiceDoneAt", emailQueuedAtKey: "financeEmailQueuedAt"};
  if (isExternalTransfer(transfer) && !workflow.transportDoneAt) {
    return {role: "transport", doneKey: "transportDoneAt", emailQueuedAtKey: "transportEmailQueuedAt"};
  }
  if (isExternalTransfer(transfer) && workflow.transportDoneAt && !workflow.purchaseDoneAt) {
    return {role: "purchase", doneKey: "purchaseDoneAt", emailQueuedAtKey: "purchaseEmailQueuedAt"};
  }
  if (!workflow.locationDmsDoneAt) return {role: "location", doneKey: "locationDmsDoneAt", emailQueuedAtKey: "locationEmailQueuedAt"};
  if (isExternalTransfer(transfer) && !workflow.financeDoneAt) {
    return {role: "finance", doneKey: "financeDoneAt", emailQueuedAtKey: "financeEmailQueuedAt"};
  }
  if (isExternalTransfer(transfer) && !workflow.planningBpDoneAt) {
    return {role: "planning", doneKey: "planningBpDoneAt", emailQueuedAtKey: "planningEmailQueuedAt"};
  }
  if (!isExternalTransfer(transfer) && !workflow.transportDoneAt) {
    return {role: "transport", doneKey: "transportDoneAt", emailQueuedAtKey: "transportEmailQueuedAt"};
  }
  if (!isExternalTransfer(transfer) && !workflow.purchaseDoneAt) {
    return {role: "purchase", doneKey: "purchaseDoneAt", emailQueuedAtKey: "purchaseEmailQueuedAt"};
  }
  return null;
};

const queueInitialStockTransferTaskEmail = async ({transfer, config, nowIso}) => {
  const role = "ceo";
  const emailStep = getEmailStep(role, transfer);
  const recipient = getRecipient(config, role, transfer);
  if (!recipient) return {queued: false, reason: "missing_recipient"};

  const workflowUrl = getWorkflowUrl(config, role, transfer);
  const chassis = String(transfer.chassis || "").trim();
  const title = `Action Required: Stock Transfer${chassis ? ` ${chassis}` : ""}`;
  const jobId = `${getSafeFirebaseKey(transfer.id)}_${emailStep}`;
  const jobData = {
    status: "pending",
    step: emailStep,
    role,
    to: recipient,
    cc: getCcRecipient(config, role, transfer),
    title,
    content: buildStockTransferTaskEmailHtml(role, transfer, title, workflowUrl),
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastError: null,
    failedAt: null,
    transferId: transfer.id,
    source: "stock_transfer_workflow",
    taskTransferId: transfer.id,
    workflowUrl,
    approveLink: workflowUrl,
    chassis: transfer.chassis || "",
    currentLocation: transfer.currentLocation || "",
    targetLocation: transfer.targetLocation || "",
    salesOrderDisplay: transfer["Sales Order Display"] || "",
    transferCategory: transfer["Stock Transfer Category"] || "",
  };

  const jobRef = admin.database().ref(`/email_jobs/${jobId}`);
  const result = await jobRef.transaction((existingJob) => {
    if (existingJob && ACTIVE_EMAIL_JOB_STATUSES.includes(existingJob.status)) return;
    return {
      ...(existingJob || {}),
      ...jobData,
      attempts: Number(existingJob?.attempts) || 0,
    };
  }, undefined, false);

  if (!result.committed) return {queued: false, reason: "existing_active_job", jobId};
  return {queued: true, jobId, recipient, emailStep};
};

const queueStockTransferTaskEmail = async ({transfer, config, role, nowIso, source}) => {
  const emailStep = getEmailStep(role, transfer);
  const recipient = getRecipient(config, role, transfer);
  if (!recipient) return {queued: false, reason: "missing_recipient", emailStep};

  const workflowUrl = getWorkflowUrl(config, role, transfer);
  const chassis = String(transfer.chassis || "").trim();
  const title = `Action Required: Stock Transfer${chassis ? ` ${chassis}` : ""}`;
  const jobId = `${getSafeFirebaseKey(transfer.id)}_${emailStep}`;
  const jobData = {
    status: "pending",
    step: emailStep,
    role,
    to: recipient,
    cc: getCcRecipient(config, role, transfer),
    title,
    content: buildStockTransferTaskEmailHtml(role, transfer, title, workflowUrl),
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastError: null,
    failedAt: null,
    transferId: transfer.id,
    source,
    taskTransferId: transfer.id,
    workflowUrl,
    approveLink: workflowUrl,
    chassis: transfer.chassis || "",
    currentLocation: transfer.currentLocation || "",
    targetLocation: transfer.targetLocation || "",
    salesOrderDisplay: transfer["Sales Order Display"] || "",
    transferCategory: transfer["Stock Transfer Category"] || "",
  };

  const jobRef = admin.database().ref(`/email_jobs/${jobId}`);
  const result = await jobRef.transaction((existingJob) => {
    if (existingJob && ACTIVE_EMAIL_JOB_STATUSES.includes(existingJob.status)) return;
    return {
      ...(existingJob || {}),
      ...jobData,
      attempts: Number(existingJob?.attempts) || 0,
    };
  }, undefined, false);

  if (!result.committed) return {queued: false, reason: "existing_active_job", jobId, recipient, emailStep};
  return {queued: true, jobId, recipient, emailStep};
};

const queueReminderEmailJob = async ({transfer, config, task, stage, nowIso}) => {
  const role = task.role;
  const emailStep = getEmailStep(role, transfer);
  const recipient = getRecipient(config, role, transfer);
  if (!recipient) return {queued: false, reason: "missing_recipient"};

  const workflowUrl = getWorkflowUrl(config, role, transfer);
  const chassis = String(transfer.chassis || "").trim();
  const title = `${stage.titlePrefix}: Stock Transfer${chassis ? ` ${chassis}` : ""}`;
  const jobId = `${getSafeFirebaseKey(transfer.id)}_${emailStep}_reminder_${stage.key}`;
  const jobData = {
    status: "pending",
    step: emailStep,
    role,
    to: recipient,
    cc: getCcRecipient(config, role, transfer),
    title,
    content: buildStockTransferTaskEmailHtml(
        role,
        transfer,
        title,
        workflowUrl,
        "This stock transfer task is still waiting for confirmation.",
    ),
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastError: null,
    failedAt: null,
    transferId: transfer.id,
    source: "stock_transfer_workflow_reminder",
    reminderStage: stage.key,
    taskTransferId: transfer.id,
    workflowUrl,
    chassis: transfer.chassis || "",
    currentLocation: transfer.currentLocation || "",
    targetLocation: transfer.targetLocation || "",
    transferCategory: transfer["Stock Transfer Category"] || "",
  };

  const jobRef = admin.database().ref(`/email_jobs/${jobId}`);
  const result = await jobRef.transaction((existingJob) => {
    if (existingJob && ACTIVE_EMAIL_JOB_STATUSES.includes(existingJob.status)) return;
    return {
      ...(existingJob || {}),
      ...jobData,
      attempts: Number(existingJob?.attempts) || 0,
    };
  }, undefined, false);

  if (!result.committed) return {queued: false, reason: "existing_active_job"};

  await admin.database()
      .ref(`/${TRANSFERS_PATH}/${transfer.id}/workflow/reminders/${emailStep}/${stage.key}`)
      .update({
        queuedAt: nowIso,
        jobId,
        recipient,
      });

  return {queued: true, jobId};
};

const queueDueStockTransferReminders = async () => {
  const [transfersSnapshot, configSnapshot] = await Promise.all([
    admin.database().ref(`/${TRANSFERS_PATH}`).once("value"),
    admin.database().ref(`/${CONFIG_PATH}`).once("value"),
  ]);

  const transfers = transfersSnapshot.val() || {};
  const config = configSnapshot.val() || {};
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let checked = 0;
  let queued = 0;

  for (const [transferId, rawTransfer] of Object.entries(transfers)) {
    if (!rawTransfer || typeof rawTransfer !== "object") continue;
    const transfer = {id: transferId, ...rawTransfer};
    const workflow = getWorkflow(transfer);
    const task = getActiveStockTransferTask(transfer);
    if (!task) continue;

    const emailStep = getEmailStep(task.role, transfer);
    const firstQueuedAt = Date.parse(workflow[task.emailQueuedAtKey] || "");
    if (!firstQueuedAt) continue;

    checked += 1;
    const reminderState = workflow.reminders?.[emailStep] || {};

    for (const stage of reminderStages) {
      if (reminderState[stage.key]?.queuedAt) continue;
      if (now - firstQueuedAt < stage.delayMs) continue;
      const result = await queueReminderEmailJob({transfer, config, task, stage, nowIso});
      if (result.queued) queued += 1;
    }
  }

  return {checked, queued};
};

exports.queueStockTransferNsmEmailOnSapReady = functions
    .region("asia-southeast1")
    .runWith({maxInstances: 5})
    .database
    .instance("scheduling-dd672-default-rtdb")
    .ref(`/${TRANSFERS_PATH}/{transferId}`)
    .onWrite(async (change, context) => {
      const after = change.after.val();
      const transferId = context.params.transferId;
      if (!after || !transferId) return;

      const transfer = {id: transferId, ...after};
      const workflow = getWorkflow(transfer);
      if (transfer.deletedAt || transfer.cancelledAt || isWorkflowComplete(transfer)) return;
      if (!hasSalesOrder(transfer)) return;
      if (workflow.ceoApprovedAt || workflow.ceoEmailQueuedAt || workflow.ceoEmailJobId) return;
      if (workflow.ceoEmailError === "Missing recipient for ceo") return;

      const configSnapshot = await admin.database().ref(`/${CONFIG_PATH}`).once("value");
      const config = configSnapshot.val() || {};
      const recipient = getRecipient(config, "ceo", transfer);
      if (!recipient) {
        await admin.database().ref(`/${TRANSFERS_PATH}/${transferId}/workflow`).update({
          ceoEmailError: "Missing recipient for ceo",
          ceoStatus: "Missing NSM approval recipient",
        });
        return;
      }

      const workflowRef = admin.database().ref(`/${TRANSFERS_PATH}/${transferId}/workflow`);
      const claimTime = new Date().toISOString();

      const claimResult = await workflowRef.transaction((currentWorkflow = {}) => {
        if (currentWorkflow.ceoApprovedAt || currentWorkflow.ceoEmailQueuedAt || currentWorkflow.ceoEmailJobId) return;
        const sendingAt = currentWorkflow.ceoEmailSendingAt ? Date.parse(currentWorkflow.ceoEmailSendingAt) : 0;
        const sendingIsFresh = sendingAt && Date.now() - sendingAt < 120000;
        if (sendingIsFresh) return;
        return {
          ...currentWorkflow,
          ceoEmailSendingAt: claimTime,
          ceoStatus: "Queueing NSM approval email",
        };
      }, undefined, false);

      if (!claimResult.committed) return;

      try {
        const result = await queueInitialStockTransferTaskEmail({
          transfer: {...transfer, workflow: claimResult.snapshot.val() || {}},
          config,
          nowIso: new Date().toISOString(),
        });

        const updates = {
          ceoEmailSendingAt: null,
        };

        if (result.queued || result.reason === "existing_active_job") {
          updates.ceoEmailQueuedAt = new Date().toISOString();
          updates.ceoEmailJobId = result.jobId;
          updates.ceoEmailStep = result.emailStep || getEmailStep("ceo", transfer);
          updates.ceoEmailRecipient = result.recipient || recipient || "";
          updates.ceoEmailError = null;
          updates.ceoStatus = "Pending NSM approval";
        } else {
          updates.ceoEmailError = result.reason || "Failed to queue NSM approval email";
          updates.ceoStatus = "Failed to queue NSM approval email";
        }

        await workflowRef.update(updates);
        logger.info("Stock transfer NSM email dispatch checked", {
          transferId,
          queued: result.queued,
          reason: result.reason || "",
          jobId: result.jobId || "",
        });
      } catch (error) {
        await workflowRef.update({
          ceoEmailSendingAt: null,
          ceoEmailError: error instanceof Error ? error.message : String(error),
        });
        logger.error("Failed to queue stock transfer NSM email", {
          transferId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

exports.queueStockTransferNextTaskEmail = functions
    .region("asia-southeast1")
    .runWith({maxInstances: 5})
    .database
    .instance("scheduling-dd672-default-rtdb")
    .ref(`/${TRANSFERS_PATH}/{transferId}`)
    .onWrite(async (change, context) => {
      const after = change.after.val();
      const transferId = context.params.transferId;
      if (!after || !transferId) return;

      const transfer = {id: transferId, ...after};
      const task = getActiveStockTransferTask(transfer);
      if (!task || task.role === "ceo") return;

      const role = task.role;
      const workflow = getWorkflow(transfer);
      const emailStep = getEmailStep(role, transfer);
      if (
        workflow[`${role}EmailStep`] === emailStep &&
        (workflow[`${role}EmailQueuedAt`] || workflow[`${role}EmailJobId`])
      ) {
        return;
      }

      const configSnapshot = await admin.database().ref(`/${CONFIG_PATH}`).once("value");
      const config = configSnapshot.val() || {};
      const recipient = getRecipient(config, role, transfer);
      const workflowRef = admin.database().ref(`/${TRANSFERS_PATH}/${transferId}/workflow`);
      if (!recipient) {
        await workflowRef.update({
          [`${role}EmailError`]: role === "location"
            ? `Missing location recipient for ${normalizeWorkflowLocation(transfer.currentLocation)}`
            : `Missing recipient for ${role}`,
        });
        return;
      }

      const claimTime = new Date().toISOString();
      const claimResult = await workflowRef.transaction((currentWorkflow = {}) => {
        const currentTransfer = {...transfer, workflow: currentWorkflow || {}};
        const currentTask = getActiveStockTransferTask(currentTransfer);
        if (!currentTask || currentTask.role !== role) return;
        const currentEmailStep = getEmailStep(role, currentTransfer);
        if (currentEmailStep !== emailStep) return;
        if (
          currentWorkflow[`${role}EmailStep`] === emailStep &&
          (currentWorkflow[`${role}EmailQueuedAt`] || currentWorkflow[`${role}EmailJobId`])
        ) {
          return;
        }
        const sendingAt = currentWorkflow[`${role}EmailSendingAt`]
          ? Date.parse(currentWorkflow[`${role}EmailSendingAt`])
          : 0;
        const sendingIsFresh = (
          currentWorkflow[`${role}EmailSendingStep`] === emailStep &&
          sendingAt &&
          Date.now() - sendingAt < 120000
        );
        if (sendingIsFresh) return;
        return {
          ...currentWorkflow,
          [`${role}EmailSendingAt`]: claimTime,
          [`${role}EmailSendingStep`]: emailStep,
        };
      }, undefined, false);

      if (!claimResult.committed) return;

      try {
        const claimedWorkflow = claimResult.snapshot.val() || {};
        const claimedTransfer = {...transfer, workflow: claimedWorkflow};
        const result = await queueStockTransferTaskEmail({
          transfer: claimedTransfer,
          config,
          role,
          nowIso: new Date().toISOString(),
          source: "stock_transfer_workflow_server",
        });

        const updates = {
          [`${role}EmailSendingAt`]: null,
          [`${role}EmailSendingStep`]: null,
        };

        if (result.queued || result.reason === "existing_active_job") {
          updates[`${role}EmailQueuedAt`] = new Date().toISOString();
          updates[`${role}EmailJobId`] = result.jobId;
          updates[`${role}EmailStep`] = result.emailStep || emailStep;
          updates[`${role}EmailRecipient`] = result.recipient || recipient || "";
          updates[`${role}EmailError`] = null;
        } else {
          updates[`${role}EmailError`] = result.reason || `Failed to queue ${role} task email`;
        }

        await workflowRef.update(updates);
        logger.info("Stock transfer next task email dispatch checked", {
          transferId,
          role,
          emailStep,
          queued: result.queued,
          reason: result.reason || "",
          jobId: result.jobId || "",
        });
      } catch (error) {
        await workflowRef.update({
          [`${role}EmailSendingAt`]: null,
          [`${role}EmailSendingStep`]: null,
          [`${role}EmailError`]: error instanceof Error ? error.message : String(error),
        });
        logger.error("Failed to queue stock transfer next task email", {
          transferId,
          role,
          emailStep,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

exports.recoverStuckEmailJobs = functions
    .region("asia-southeast1")
    .runWith({maxInstances: 1})
    .pubsub
    .schedule("every 10 minutes")
    .timeZone("Australia/Sydney")
    .onRun(async () => {
      const recoveredSending = await recoverStuckJobsForStatus("sending");
      const recoveredRetrying = await recoverStuckJobsForStatus("retrying");
      logger.info("Recovered stuck email jobs", {
        recoveredSending,
        recoveredRetrying,
      });
    });

exports.sendStockTransferReminderEmails = functions
    .region("asia-southeast1")
    .runWith({maxInstances: 1})
    .pubsub
    .schedule("every day 09:00")
    .timeZone("Australia/Sydney")
    .onRun(async () => {
      const result = await queueDueStockTransferReminders();
      logger.info("Queued stock transfer reminder emails", result);
    });
