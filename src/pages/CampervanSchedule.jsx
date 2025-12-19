import React, { useMemo, useRef, useState } from 'react';
import { ref, set } from 'firebase/database';
import { database } from '../utils/firebase';

const DAY_MS = 24 * 60 * 60 * 1000;

const formatDate = (date) => {
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (value, days) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const next = new Date(date.getTime() + days * DAY_MS);
  return formatDate(next);
};

const parseDuration = (startValue, endValue) => {
  if (!startValue || !endValue) return '';
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const diff = Math.round((end - start) / DAY_MS);
  return diff >= 0 ? diff : '';
};

const emptyRow = (rowNumber) => ({
  rowNumber,
  forecastProductionDate: '',
  regentProduction: '',
  chassisNumber: '',
  vinNumber: '',
  vehicle: '',
  model: '',
  dealer: '',
  customer: '',
  latestVehicleOrder: '',
  vehicleOrderDate: '',
  vehicleEta: '',
  latestEurPartsOrder: '',
  eurPartsOrderDate: '',
  eurPartsEta: '',
  latestLongtreePartsOrder: '',
  longtreePartsOrderDate: '',
  longtreePartsEta: '',
  signedOrderReceived: '',
  vehiclePlannedEta: '',
  productionPlannedStartDate: '',
  productionPlannedEndDate: '',
  duration: '',
});

const columns = [
  { key: 'forecastProductionDate', label: 'Forecast Production Date', type: 'date' },
  { key: 'regentProduction', label: 'Regent Production', type: 'text' },
  { key: 'chassisNumber', label: 'Chassis Number', type: 'text' },
  { key: 'vinNumber', label: 'Vin Number', type: 'text' },
  { key: 'vehicle', label: 'Vehicle', type: 'text' },
  { key: 'model', label: 'Model', type: 'text' },
  { key: 'dealer', label: 'Dealer', type: 'text' },
  { key: 'customer', label: 'Customer', type: 'text' },
  {
    key: 'latestVehicleOrder',
    label: 'Lastest Vehicle Order (Forecast Production Date - 180)',
    type: 'date',
    readOnly: true,
  },
  { key: 'vehicleOrderDate', label: 'Vehicle Order Date', type: 'date' },
  { key: 'vehicleEta', label: 'Vehicle ETA', type: 'date' },
  {
    key: 'latestEurPartsOrder',
    label: 'Lastest EUR Parts Order (Forecast Production Date - 60)',
    type: 'date',
    readOnly: true,
  },
  { key: 'eurPartsOrderDate', label: 'EUR Parts Order Date', type: 'date' },
  { key: 'eurPartsEta', label: 'EUR Parts ETA', type: 'date' },
  {
    key: 'latestLongtreePartsOrder',
    label: 'Lastest Longtree Parts Order (Forecast Production Date - 90)',
    type: 'date',
    readOnly: true,
  },
  { key: 'longtreePartsOrderDate', label: 'Longtree Parts Order Date', type: 'date' },
  { key: 'longtreePartsEta', label: 'Longtree Parts ETA', type: 'date' },
  { key: 'signedOrderReceived', label: 'Signed Order Received', type: 'date' },
  { key: 'vehiclePlannedEta', label: 'Vehicle Planned ETA', type: 'date' },
  { key: 'productionPlannedStartDate', label: 'Production Planned Start Date', type: 'date' },
  { key: 'productionPlannedEndDate', label: 'Production Planned End Date', type: 'date' },
  { key: 'duration', label: 'Duration (days)', type: 'number', readOnly: true },
];

const normalizeHeader = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const CampervanSchedule = () => {
  const [rows, setRows] = useState([emptyRow(1)]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const saveTimersRef = useRef({});

  const headerMap = useMemo(() => {
    const mapping = {};
    columns.forEach((column) => {
      mapping[normalizeHeader(column.label)] = column.key;
      mapping[normalizeHeader(column.key)] = column.key;
    });
    return mapping;
  }, []);

  const recalcRow = (row) => {
    const forecastDate = row.forecastProductionDate;
    return {
      ...row,
      latestVehicleOrder: addDays(forecastDate, -180),
      latestEurPartsOrder: addDays(forecastDate, -60),
      latestLongtreePartsOrder: addDays(forecastDate, -90),
      duration: parseDuration(row.productionPlannedStartDate, row.productionPlannedEndDate),
    };
  };

  const scheduleRowSave = (row) => {
    const rowNumber = row.rowNumber;
    if (!rowNumber) return;
    const payload = recalcRow(row);

    if (saveTimersRef.current[rowNumber]) {
      clearTimeout(saveTimersRef.current[rowNumber]);
    }

    saveTimersRef.current[rowNumber] = setTimeout(async () => {
      try {
        const rowRef = ref(database, `campervanSchedule/${rowNumber}`);
        await set(rowRef, payload);
        setStatusMessage(`Row ${rowNumber} saved to Firebase.`);
      } catch (error) {
        console.error('Failed to save campervan schedule row:', error);
        setStatusMessage(`Row ${rowNumber} failed to save.`);
      }
    }, 600);
  };

  const updateRow = (index, key, value) => {
    setRows((prev) => {
      const next = [...prev];
      const updated = { ...next[index], [key]: value };
      const recalculated = recalcRow(updated);
      next[index] = recalculated;
      scheduleRowSave(recalculated);
      return next;
    });
  };

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow(prev.length + 1)]);
  };

  const removeRow = (index) => {
    setRows((prev) => {
      const rowNumber = prev[index]?.rowNumber;
      if (rowNumber && saveTimersRef.current[rowNumber]) {
        clearTimeout(saveTimersRef.current[rowNumber]);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const parseCsvLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleCsvUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const text = loadEvent.target?.result;
      if (typeof text !== 'string') return;
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) return;

      const headers = parseCsvLine(lines[0]);
      const headerKeys = headers.map((header) => headerMap[normalizeHeader(header)] || null);

      const nextRows = lines.slice(1).map((line, index) => {
        const values = parseCsvLine(line);
        const row = emptyRow(index + 1);
        values.forEach((value, colIndex) => {
          const key = headerKeys[colIndex];
          if (key) row[key] = value;
        });
        return recalcRow(row);
      });

      const fallbackRows = nextRows.length ? nextRows : [emptyRow(1)];
      setRows(fallbackRows);
      fallbackRows.forEach((row) => scheduleRowSave(row));
    };
    reader.readAsText(file);
  };

  const handleTemplateDownload = () => {
    const headers = columns.map((column) => column.label);
    const sampleRow = [
      '2025-02-15',
      'Scheduled',
      'CHS-001',
      'VIN-001',
      'Campervan',
      'Model X',
      'Sample Dealer',
      'Sample Customer',
      '',
      '2024-08-19',
      '2024-09-01',
      '',
      '2024-12-17',
      '2025-01-05',
      '',
      '2024-11-17',
      '2024-12-05',
      '2024-10-01',
      '2025-02-10',
      '2025-02-01',
      '2025-02-14',
      '',
    ];

    const escapeValue = (value) => {
      if (value == null) return '';
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const csvContent = [headers, sampleRow]
      .map((row) => row.map(escapeValue).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'campervan-schedule-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) {
      return rows.map((row, index) => ({ row, index }));
    }
    const term = searchTerm.toLowerCase();
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const rowText = [
          row.rowNumber,
          ...columns.map((column) => row[column.key]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return rowText.includes(term);
      });
  }, [rows, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Campervan Schedule</h2>
            <p className="text-sm text-gray-500">
              Fill in the table to auto-save rows to Firebase using the row number as the identifier.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleTemplateDownload}
              className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-md bg-white hover:bg-gray-50"
            >
              Download Template
            </button>
            <label className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 bg-white cursor-pointer hover:bg-gray-50">
              Upload CSV
              <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
            </label>
            <button
              type="button"
              onClick={addRow}
              className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
            >
              Add Row
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search all rows..."
              className="w-full md:max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="text-xs text-gray-500">
            Showing {filteredRows.length} of {rows.length} rows
          </div>
        </div>
        {statusMessage && (
          <div className="mt-3 rounded-md bg-blue-50 text-blue-700 text-sm px-3 py-2">
            {statusMessage}
          </div>
        )}
      </div>

      <div className="bg-white shadow rounded-lg overflow-auto">
        <div className="min-w-full overflow-x-auto overflow-y-visible">
        <table className="min-w-full text-xs text-left">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-3 py-2 sticky left-0 bg-gray-100 z-10">Row #</th>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2 whitespace-nowrap">
                  {column.label}
                </th>
              ))}
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ row, index }) => (
              <tr key={row.rowNumber} className="border-b last:border-none">
                <td className="px-3 py-2 sticky left-0 bg-white z-10 font-semibold text-gray-600">
                  {row.rowNumber}
                </td>
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2">
                    <input
                      type={column.type}
                      value={row[column.key]}
                      onChange={(event) => updateRow(index, column.key, event.target.value)}
                      readOnly={column.readOnly}
                      className={`w-40 rounded border px-2 py-1 text-xs ${
                        column.readOnly
                          ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                          : 'border-gray-300'
                      }`}
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-red-500 hover:text-red-700 text-xs"
                    disabled={rows.length === 1}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};

export default CampervanSchedule;
