import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CartesianGrid,
  Bar,
  BarChart,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { get, ref, set } from 'firebase/database';
import { database } from '../utils/firebase';

const DAY_MS = 24 * 60 * 60 * 1000;

const formatDate = (date) => {
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${day}/${month}/${year}`;
};

const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const stringValue = String(value).trim();
  if (!stringValue) return null;
  if (/^\d+$/.test(stringValue)) {
    const timestamp = Number(stringValue);
    if (!Number.isNaN(timestamp)) {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    const date = new Date(`${stringValue}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slashParts = stringValue.split('/');
  if (slashParts.length === 3) {
    const [first, second, third] = slashParts.map((part) => parseInt(part, 10));
    if (!Number.isNaN(first) && !Number.isNaN(second) && !Number.isNaN(third)) {
      const day = first;
      const month = second;
      const year = third;
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const fallback = new Date(stringValue);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const addDays = (value, days) => {
  const date = parseDateValue(value);
  if (!date) return '';
  const next = new Date(date.getTime() + days * DAY_MS);
  return formatDate(next);
};

const normalizeDateString = (value) => {
  const date = parseDateValue(value);
  return date ? formatDate(date) : '';
};

const parseDuration = (startValue, endValue) => {
  if (!startValue || !endValue) return '';
  const start = parseDateValue(startValue);
  const end = parseDateValue(endValue);
  if (!start || !end) return '';
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
  { key: 'longtreePartsOrderDate', label: 'Longtree Parts Order Date', type: 'date' },
  { key: 'signedOrderReceived', label: 'Signed Order Received', type: 'date' },
];

const normalizeHeader = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const dateKeys = columns.filter((column) => column.type === 'date').map((column) => column.key);

const CampervanSchedule = () => {
  const [rows, setRows] = useState([emptyRow(1)]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const saveTimersRef = useRef({});
  const [scrollWidth, setScrollWidth] = useState(0);
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const [selectedDealer, setSelectedDealer] = useState('');
  const [showDealerTable, setShowDealerTable] = useState(false);

  const headerMap = useMemo(() => {
    const mapping = {};
    columns.forEach((column) => {
      mapping[normalizeHeader(column.label)] = column.key;
      mapping[normalizeHeader(column.key)] = column.key;
    });
    return mapping;
  }, []);

  const recalcRow = (row) => {
    const normalizedDates = dateKeys.reduce((acc, key) => {
      acc[key] = normalizeDateString(row[key]);
      return acc;
    }, {});
    const forecastDate = normalizedDates.forecastProductionDate;
    return {
      ...row,
      ...normalizedDates,
      latestVehicleOrder: addDays(forecastDate, -180),
      latestEurPartsOrder: addDays(forecastDate, -60),
      latestLongtreePartsOrder: addDays(forecastDate, -90),
      duration: parseDuration(row.productionPlannedStartDate, row.productionPlannedEndDate),
    };
  };

  useEffect(() => {
    const loadRows = async () => {
      try {
        const scheduleRef = ref(database, 'campervanSchedule');
        const snapshot = await get(scheduleRef);
        if (!snapshot.exists()) return;

        const data = snapshot.val();
        const parsedRows = Object.entries(data)
          .map(([key, value]) => {
            const rowNumber = Number(key);
            return recalcRow({
              ...emptyRow(Number.isNaN(rowNumber) ? 0 : rowNumber),
              ...value,
              rowNumber: Number.isNaN(rowNumber) ? value.rowNumber : rowNumber,
            });
          })
          .filter((row) => row.rowNumber)
          .sort((a, b) => a.rowNumber - b.rowNumber);

        if (parsedRows.length) {
          setRows(parsedRows);
        }
      } catch (error) {
        console.error('Failed to load campervan schedule data:', error);
        setStatusMessage('Failed to load Firebase data.');
      }
    };

    loadRows();
  }, []);

  const handleTopScroll = () => {
    if (topScrollRef.current && tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };

  const handleTableScroll = () => {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
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

  const handleExcelUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const data = loadEvent.target?.result;
      if (!data) return;
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) return;
      const worksheet = workbook.Sheets[firstSheetName];
      const rowsData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
      if (!rowsData.length) return;

      const headers = rowsData[0] || [];
      const headerKeys = headers.map((header) => headerMap[normalizeHeader(header)] || null);

      const nextRows = rowsData.slice(1).map((values, index) => {
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
    reader.readAsArrayBuffer(file);
  };

  const handleTemplateDownload = () => {
    const headers = columns.map((column) => column.label);
    const sampleRow = [
      '15/02/2025',
      'Scheduled',
      'CHS-001',
      'VIN-001',
      'Campervan',
      'Model X',
      'Sample Dealer',
      'Sample Customer',
      '',
      '19/08/2024',
      '17/11/2024',
      '01/10/2024',
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Campervan Schedule');
    XLSX.writeFile(workbook, 'campervan-schedule-template.xlsx');
  };

  const filteredRows = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const shouldHideRow = (row) => {
      const forecastDate = parseDateValue(row.forecastProductionDate);
      if (!forecastDate) return false;
      const chassisEmpty = String(row.chassisNumber || '').trim().length === 0;
      const dealerEmpty = String(row.dealer || '').trim().length === 0;
      return forecastDate < todayStart && chassisEmpty && dealerEmpty;
    };
    const visibleRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !shouldHideRow(row));

    if (!searchTerm.trim()) {
      return visibleRows;
    }
    const term = searchTerm.toLowerCase();
    return visibleRows.filter(({ row }) => {
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

  const columnWidths = useMemo(() => {
    const fixedColumnWidths = {
      forecastProductionDate: 120,
      regentProduction: 200,
      chassisNumber: 140,
      vinNumber: 160,
      model: 120,
      dealer: 120,
      customer: 180,
      latestVehicleOrder: 110,
      vehicleOrderDate: 110,
      longtreePartsOrderDate: 110,
      signedOrderReceived: 110,
    };
    return columns.reduce((acc, column) => {
      if (fixedColumnWidths[column.key]) {
        acc[column.key] = `${fixedColumnWidths[column.key]}px`;
        return acc;
      }
      const maxLength = rows.reduce((max, row) => {
        const value = row?.[column.key];
        const length = value == null ? 0 : String(value).length;
        return Math.max(max, length);
      }, 0);
      acc[column.key] = `${Math.max(maxLength, 6)}ch`;
      return acc;
    }, {});
  }, [rows]);

  useEffect(() => {
    if (tableScrollRef.current) {
      setScrollWidth(tableScrollRef.current.scrollWidth);
    }
  }, [filteredRows.length]);

  const dealerOptions = useMemo(() => {
    const options = new Set();
    rows.forEach((row) => {
      const dealerName = String(row.dealer || '').trim();
      if (dealerName) options.add(dealerName);
    });
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  useEffect(() => {
    if (dealerOptions.length === 0) {
      setSelectedDealer('');
      return;
    }
    if (!selectedDealer || !dealerOptions.includes(selectedDealer)) {
      setSelectedDealer(dealerOptions[0]);
    }
  }, [dealerOptions, selectedDealer]);

  const dealerChartData = useMemo(() => {
    if (!selectedDealer) return [];
    const counts = rows.reduce((acc, row) => {
      const dealerName = String(row.dealer || '').trim();
      if (dealerName !== selectedDealer) return acc;
      const dateKey = normalizeDateString(row.signedOrderReceived);
      if (!dateKey) return acc;
      acc[dateKey] = (acc[dateKey] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => {
        const first = parseDateValue(a.date);
        const second = parseDateValue(b.date);
        if (!first || !second) return 0;
        return first - second;
      });
  }, [rows, selectedDealer]);

  const dealerOrderMix = useMemo(() => {
    const summary = rows.reduce((acc, row) => {
      const dealerName = String(row.dealer || '').trim();
      if (!dealerName) return acc;
      if (!acc[dealerName]) {
        acc[dealerName] = {
          dealer: dealerName,
          total: 0,
          ldv: 0,
          ford: 0,
          srv221: 0,
          srv222: 0,
          srv223: 0,
          fordOther: 0,
        };
      }
      const entry = acc[dealerName];
      entry.total += 1;

      const vehicleText = String(row.vehicle || '').trim().toLowerCase();
      const modelText = String(row.model || '').trim().toUpperCase();
      if (vehicleText.includes('ldv')) {
        entry.ldv += 1;
        return acc;
      }
      if (vehicleText.includes('ford')) {
        entry.ford += 1;
        if (modelText.includes('SRV22.1')) {
          entry.srv221 += 1;
        } else if (modelText.includes('SRV22.2')) {
          entry.srv222 += 1;
        } else if (modelText.includes('SRV22.3')) {
          entry.srv223 += 1;
        } else {
          entry.fordOther += 1;
        }
      }
      return acc;
    }, {});

    return Object.values(summary).sort((a, b) => b.total - a.total);
  }, [rows]);

  const renderDealerTooltip = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-gray-200 bg-white/95 p-3 text-xs text-gray-700 shadow-lg">
        <div className="text-sm font-semibold text-gray-900">{data.dealer}</div>
        <div className="mt-1 text-gray-500">Total: {data.total}</div>
        <div className="mt-2 grid gap-1">
          <div className="flex items-center justify-between">
            <span>LDV</span>
            <span className="font-semibold">{data.ldv}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Ford (total)</span>
            <span className="font-semibold">{data.ford}</span>
          </div>
          <div className="flex items-center justify-between text-gray-500">
            <span>SRV22.1</span>
            <span>{data.srv221}</span>
          </div>
          <div className="flex items-center justify-between text-gray-500">
            <span>SRV22.2</span>
            <span>{data.srv222}</span>
          </div>
          <div className="flex items-center justify-between text-gray-500">
            <span>SRV22.3</span>
            <span>{data.srv223}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderDealerTick = ({ x, y, payload }) => {
    const label = String(payload.value || '');
    return (
      <g transform={`translate(${x}, ${y})`}>
        <text textAnchor="end" fill="#64748b" fontSize={11} transform="rotate(-35)" dy={16}>
          {label}
        </text>
      </g>
    );
  };

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
              Download Excel Template
            </button>
            <label className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 bg-white cursor-pointer hover:bg-gray-50">
              Upload Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleExcelUpload}
              />
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
              className="w-full md:max-w-md rounded-md border-0 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-0"
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

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white shadow rounded-lg p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Signed Orders Trend</h3>
              <p className="text-sm text-gray-500">
                Signed Order Received counts by date for the selected dealer.
              </p>
            </div>
            <div className="w-full sm:w-56">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Dealer</label>
              <select
                value={selectedDealer}
                onChange={(event) => setSelectedDealer(event.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {dealerOptions.length === 0 ? (
                  <option value="">No dealer data</option>
                ) : (
                  dealerOptions.map((dealer) => (
                    <option key={dealer} value={dealer}>
                      {dealer}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-gray-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4">
            {dealerChartData.length === 0 ? (
              <div className="text-sm text-gray-500">
                No signed order data available for this dealer yet.
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dealerChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="orderLine" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#4f46e5" />
                        <stop offset="100%" stopColor="#38bdf8" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        borderColor: '#e2e8f0',
                        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
                        fontSize: '12px',
                      }}
                      cursor={{ stroke: '#cbd5f5', strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="url(#orderLine)"
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#4f46e5' }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-5">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Dealer Order Mix</h3>
            <p className="text-sm text-gray-500">
              Vehicles ordered by dealer, highlighting LDV and Ford model splits.
            </p>
          </div>
          <div className="mt-4 rounded-xl border border-gray-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-4">
            {dealerOrderMix.length === 0 ? (
              <div className="text-sm text-gray-500">No dealer order data available yet.</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dealerOrderMix} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="dealer"
                      interval={0}
                      height={90}
                      tickLine={false}
                      axisLine={false}
                      tick={renderDealerTick}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={renderDealerTooltip} cursor={{ fill: '#dbeafe', opacity: 0.4 }} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="ldv" name="LDV" stackId="orders" fill="#34d399" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="srv221" name="Ford SRV22.1" stackId="orders" fill="#60a5fa" />
                    <Bar dataKey="srv222" name="Ford SRV22.2" stackId="orders" fill="#818cf8" />
                    <Bar dataKey="srv223" name="Ford SRV22.3" stackId="orders" fill="#a78bfa" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          {dealerOrderMix.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-xs text-left">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">
                      <button
                        type="button"
                        onClick={() => setShowDealerTable((prev) => !prev)}
                        className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900"
                        aria-expanded={showDealerTable}
                      >
                        Dealer
                        <span
                          className={`text-[10px] uppercase tracking-wide text-gray-400 ${
                            showDealerTable ? 'rotate-180' : ''
                          } transition-transform`}
                        >
                          ▼
                        </span>
                      </button>
                    </th>
                    <th className="px-3 py-2 font-semibold">Total</th>
                    <th className="px-3 py-2 font-semibold text-emerald-600">LDV</th>
                    <th className="px-3 py-2 font-semibold text-blue-600">Ford</th>
                    <th className="px-3 py-2 font-semibold text-indigo-500">SRV22.1</th>
                    <th className="px-3 py-2 font-semibold text-indigo-500">SRV22.2</th>
                    <th className="px-3 py-2 font-semibold text-indigo-500">SRV22.3</th>
                  </tr>
                </thead>
                {showDealerTable ? (
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {dealerOrderMix.map((dealer) => (
                      <tr key={dealer.dealer} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-700">{dealer.dealer}</td>
                        <td className="px-3 py-2 text-gray-700">{dealer.total}</td>
                        <td className="px-3 py-2 text-emerald-700">{dealer.ldv}</td>
                        <td className="px-3 py-2 text-blue-700">{dealer.ford}</td>
                        <td className="px-3 py-2 text-indigo-700">{dealer.srv221}</td>
                        <td className="px-3 py-2 text-indigo-700">{dealer.srv222}</td>
                        <td className="px-3 py-2 text-indigo-700">{dealer.srv223}</td>
                      </tr>
                    ))}
                  </tbody>
                ) : (
                  <tbody className="bg-white">
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-gray-400">
                        Click “Dealer” to expand the breakdown.
                      </td>
                    </tr>
                  </tbody>
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="overflow-x-scroll overflow-y-hidden"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <div style={{ width: scrollWidth || '100%' }} className="h-4" />
        </div>
        <div
          ref={tableScrollRef}
          onScroll={handleTableScroll}
          className="min-w-full overflow-x-scroll overflow-y-visible"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
        <table className="min-w-full text-xs text-left">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-3 py-2 sticky left-0 bg-gray-100 z-10">Row #</th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="px-3 py-2 whitespace-normal"
                  style={{ width: columnWidths[column.key], minWidth: columnWidths[column.key] }}
                >
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
                {columns.map((column) => {
                  const inputType = column.type === 'date' ? 'text' : column.type;
                  const isEmptyDate = column.type === 'date' && !row[column.key] && inputType === 'date';
                  const isVehicleOrderMissing =
                    column.key === 'vehicle' &&
                    String(row.chassisNumber || '').trim().length > 0 &&
                    String(row.vehicleOrderDate || '').trim().length === 0;
                  return (
                    <td
                      key={column.key}
                      className="px-3 py-2"
                      style={{ width: columnWidths[column.key], minWidth: columnWidths[column.key] }}
                    >
                      <input
                        type={inputType}
                        value={row[column.key]}
                        onChange={(event) => updateRow(index, column.key, event.target.value)}
                        readOnly={column.readOnly}
                        placeholder={column.type === 'date' ? 'DD/MM/YYYY' : undefined}
                        className={`w-full rounded border-0 px-2 py-1 text-xs focus:outline-none focus:ring-0 ${
                          column.readOnly
                            ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                            : 'bg-white'
                        } ${isEmptyDate ? 'text-transparent' : ''} ${
                          isVehicleOrderMissing
                            ? 'bg-red-50 text-red-700 ring-1 ring-red-200 shadow-inner transition-colors'
                            : ''
                        }`}
                      />
                    </td>
                  );
                })}
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
