import React, { useEffect, useMemo, useState } from 'react';
import { get, ref, set } from 'firebase/database';
import { database } from '../utils/firebase';

const FIREBASE_PATH = 'campervanSchedule';

const PROTECTED_FIELDS = [
  '3110_price',
  'BOM Number',
  'Sales Order Number',
  'dealerprice',
];

const DEFAULT_COLUMNS = [
  'forecastProductionDate',
  'regentProduction',
  'chassisNumber',
  'vinNumber',
  'vehicle',
  'model',
  'modelYear',
  'dealer',
  'customer',
  'requestedVehicleOrderDate',
  'requestedVehicleDeliveryDate',
  'signedOrderReceived',
];

const normalizeChassisNumber = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase();

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === ',' && !insideQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !insideQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      row.push(field);
      field = '';

      if (row.some((value) => String(value).trim() !== '')) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += character;
  }

  row.push(field);
  if (row.some((value) => String(value).trim() !== '')) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((header, index) => {
    const cleaned = String(header ?? '').replace(/^\uFEFF/, '').trim();
    return index === 0 ? cleaned.replace(/^\uFEFF/, '') : cleaned;
  });

  const records = rows.slice(1).map((values) => {
    const record = {};

    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = String(values[index] ?? '').trim();
    });

    return record;
  });

  return {
    headers,
    records: records.filter((record) =>
      Object.values(record).some((value) => String(value).trim() !== ''),
    ),
  };
};

const sortFirebaseEntries = (data) =>
  Object.entries(data || {}).sort(([keyA], [keyB]) => {
    const numberA = Number(keyA);
    const numberB = Number(keyB);

    if (Number.isFinite(numberA) && Number.isFinite(numberB)) {
      return numberA - numberB;
    }

    return String(keyA).localeCompare(String(keyB));
  });

const CampervanSchedule = () => {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [scheduleType, setScheduleType] = useState('SRV');
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const loadSchedule = async () => {
      try {
        setIsLoading(true);
        const snapshot = await get(ref(database, FIREBASE_PATH));

        if (!snapshot.exists()) {
          setRows([]);
          return;
        }

        const loadedRows = sortFirebaseEntries(snapshot.val()).map(([, value]) => value || {});
        setRows(loadedRows);
      } catch (error) {
        console.error('Failed to load campervan schedule:', error);
        setStatusMessage('Failed to load schedule data from Firebase.');
      } finally {
        setIsLoading(false);
      }
    };

    loadSchedule();
  }, []);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const model = String(row.model ?? '').trim().toUpperCase();
      return scheduleType === 'SRM' ? model.includes('SRM') : model.includes('SRV');
    });
  }, [rows, scheduleType]);

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    try {
      setIsUploading(true);
      setStatusMessage('Reading CSV file...');

      const csvText = await file.text();
      const { headers, records } = parseCsv(csvText);

      if (headers.length === 0) {
        throw new Error('The CSV file does not contain a header row.');
      }

      if (!headers.includes('chassisNumber')) {
        throw new Error('The CSV file must contain a chassisNumber column.');
      }

      if (records.length === 0) {
        throw new Error('The CSV file does not contain any data rows.');
      }

      const duplicateHeaders = headers.filter(
        (header, index) => header && headers.indexOf(header) !== index,
      );

      if (duplicateHeaders.length > 0) {
        throw new Error(`Duplicate CSV headers found: ${[...new Set(duplicateHeaders)].join(', ')}`);
      }

      const existingSnapshot = await get(ref(database, FIREBASE_PATH));
      const existingRows = existingSnapshot.exists() ? existingSnapshot.val() : {};

      const existingByChassis = new Map();

      Object.values(existingRows || {}).forEach((existingRow) => {
        const chassisKey = normalizeChassisNumber(existingRow?.chassisNumber);
        if (chassisKey) {
          existingByChassis.set(chassisKey, existingRow);
        }
      });

      const duplicateChassis = new Set();
      const seenChassis = new Set();

      records.forEach((record) => {
        const chassisKey = normalizeChassisNumber(record.chassisNumber);
        if (!chassisKey) return;

        if (seenChassis.has(chassisKey)) {
          duplicateChassis.add(chassisKey);
        }

        seenChassis.add(chassisKey);
      });

      if (duplicateChassis.size > 0) {
        throw new Error(
          `Duplicate chassisNumber values found in the CSV: ${[...duplicateChassis].join(', ')}`,
        );
      }

      const payload = {};
      const uploadedRows = records.map((csvRecord, index) => {
        const cleanRecord = {};

        headers.forEach((header) => {
          if (!header) return;
          cleanRecord[header] = csvRecord[header] ?? '';
        });

        const chassisKey = normalizeChassisNumber(cleanRecord.chassisNumber);
        const oldRecord = chassisKey ? existingByChassis.get(chassisKey) : null;

        if (oldRecord) {
          PROTECTED_FIELDS.forEach((fieldName) => {
            if (Object.prototype.hasOwnProperty.call(oldRecord, fieldName)) {
              cleanRecord[fieldName] = oldRecord[fieldName];
            }
          });
        }

        payload[index + 1] = cleanRecord;
        return cleanRecord;
      });

      await set(ref(database, FIREBASE_PATH), payload);

      setColumns(headers);
      setRows(uploadedRows);
      setStatusMessage(
        `Upload complete. ${uploadedRows.length} rows were saved. Protected fields were preserved by chassisNumber.`,
      );
    } catch (error) {
      console.error('Failed to upload CSV:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to upload CSV.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">SRV / SRM Schedule</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a CSV file to replace the schedule data in Firebase.
            </p>
          </div>

          <label
            className={`inline-flex w-fit items-center rounded-md px-4 py-2 text-sm font-semibold text-white ${
              isUploading
                ? 'cursor-not-allowed bg-gray-400'
                : 'cursor-pointer bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {isUploading ? 'Uploading...' : 'Upload CSV'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={isUploading}
              onChange={handleCsvUpload}
            />
          </label>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700">
            {statusMessage}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-white p-5 shadow">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setScheduleType('SRV')}
              className={`min-w-28 rounded-md border px-5 py-2.5 text-sm font-semibold ${
                scheduleType === 'SRV'
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              SRV
            </button>

            <button
              type="button"
              onClick={() => setScheduleType('SRM')}
              className={`min-w-28 rounded-md border px-5 py-2.5 text-sm font-semibold ${
                scheduleType === 'SRM'
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              SRM
            </button>
          </div>

          <div className="text-sm text-gray-500">
            {visibleRows.length} {visibleRows.length === 1 ? 'row' : 'rows'}
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading schedule...</div>
        ) : visibleRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No {scheduleType} schedule data is available.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-gray-100">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column}
                      className="whitespace-nowrap border-b border-gray-200 px-3 py-3 font-semibold text-gray-700"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr
                    key={`${normalizeChassisNumber(row.chassisNumber) || 'row'}-${rowIndex}`}
                    className="odd:bg-white even:bg-gray-50"
                  >
                    {columns.map((column) => (
                      <td
                        key={column}
                        className="whitespace-nowrap border-b border-gray-100 px-3 py-2.5 text-gray-700"
                      >
                        {String(row[column] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CampervanSchedule;
