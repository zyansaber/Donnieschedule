import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Bar,
  BarChart,
  Line,
  LineChart,
  Legend,
  Pie,
  PieChart,
  Cell,
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
    if (Number.isNaN(value)) return null;
    if (value > 100000000000) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (value >= 19000101 && value <= 21001231) {
      const year = Math.floor(value / 10000);
      const month = Math.floor((value % 10000) / 100);
      const day = value % 100;
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (value >= 30000 && value <= 80000) {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + value * DAY_MS);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const fallbackDate = new Date(value);
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  }

  const stringValue = String(value).trim();
  if (!stringValue) return null;
  if (stringValue.toLowerCase() === 'dd/mm/yyyy') return null;
  if (/^\d+$/.test(stringValue)) {
    const timestamp = Number(stringValue);
    if (!Number.isNaN(timestamp)) {
      if (timestamp >= 19000101 && timestamp <= 21001231) {
        const year = Math.floor(timestamp / 10000);
        const month = Math.floor((timestamp % 10000) / 100);
        const day = timestamp % 100;
        const date = new Date(year, month - 1, day);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (timestamp >= 30000 && timestamp <= 80000) {
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + timestamp * DAY_MS);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    const date = new Date(`${stringValue}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(stringValue)) {
    const [day, month, year] = stringValue.split('-').map((part) => parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(stringValue)) {
    const [day, month, year] = stringValue.split('.').map((part) => parseInt(part, 10));
    const date = new Date(year, month - 1, day);
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

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);

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
  const [orderBreakdownType, setOrderBreakdownType] = useState('vehicle');
  const [orderStockFilter, setOrderStockFilter] = useState('all');
  const scheduleChartRef = useRef(null);
  const [scheduleChartSize, setScheduleChartSize] = useState({ width: 0, height: 0 });
  const [productionSchedulePoints, setProductionSchedulePoints] = useState([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [addPointMode, setAddPointMode] = useState(false);
  const [newPointIndex, setNewPointIndex] = useState('');
  const [newPointValue, setNewPointValue] = useState('1');
  const [addPointError, setAddPointError] = useState('');
  const draggingPointRef = useRef(null);
  const initializedScheduleRef = useRef(false);
  const scheduleTouchedRef = useRef(false);

  const headerMap = useMemo(() => {
    const mapping = {};
    columns.forEach((column) => {
      mapping[normalizeHeader(column.label)] = column.key;
      mapping[normalizeHeader(column.key)] = column.key;
    });
    return mapping;
  }, []);

  const scheduleStartDate = useMemo(() => new Date(2025, 6, 1), []);
  const scheduleEndDate = useMemo(() => new Date(2026, 11, 1), []);

  const firstSchedulePointDate = useMemo(() => {
    if (rows.length === 0) return scheduleStartDate;
    const lastIndex = [...rows].reverse().findIndex((row) =>
      String(row.regentProduction || '').includes('Production Commenced Regent'),
    );
    if (lastIndex === -1) return scheduleStartDate;
    const targetIndex = rows.length - 1 - lastIndex + 1;
    const candidate = rows[targetIndex];
    if (!candidate) return scheduleStartDate;
    const parsed = parseDateValue(candidate.forecastProductionDate);
    return parsed || scheduleStartDate;
  }, [rows, scheduleStartDate]);

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
    if (!scheduleChartRef.current) return;
    const element = scheduleChartRef.current;
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const { width, height } = entry.contentRect;
        setScheduleChartSize({ width, height });
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (productionSchedulePoints.length > 0) return;
    if (initializedScheduleRef.current) return;
    const firstDate =
      firstSchedulePointDate instanceof Date
        ? firstSchedulePointDate
        : scheduleStartDate;
    const secondDate = new Date(2026, 5, 1);
    setProductionSchedulePoints([
      { id: 'point-1', date: firstDate, value: 1 },
      { id: 'point-2', date: secondDate, value: 2 },
    ]);
    initializedScheduleRef.current = true;
  }, [firstSchedulePointDate, productionSchedulePoints.length, scheduleStartDate]);

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

  const handleExportExcel = () => {
    const escapeXml = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const headerRow = ['Row #', ...columns.map((column) => column.label)];
    const bodyRows = filteredRows.map(({ row }) => [
      row.rowNumber,
      ...columns.map((column) => row[column.key] ?? ''),
    ]);

    const worksheetRows = [headerRow, ...bodyRows]
      .map(
        (row) =>
          `<Row>${row
            .map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`)
            .join('')}</Row>`
      )
      .join('');

    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Campervan Schedule">
  <Table>
   ${worksheetRows}
  </Table>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'campervan-schedule.xls';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const cutoffDate = new Date(todayStart);
    cutoffDate.setMonth(cutoffDate.getMonth() + 3);
    const shouldHideRow = (row) => {
      const forecastDate = parseDateValue(row.forecastProductionDate);
      if (!forecastDate) return false;
      const chassisEmpty = String(row.chassisNumber || '').trim().length === 0;
      const dealerEmpty = String(row.dealer || '').trim().length === 0;
      return forecastDate < cutoffDate && chassisEmpty && dealerEmpty;
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
      regentProduction: 230,
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

  const completedRegentCount = useMemo(
    () =>
      rows.filter((row) => {
        const status = String(row.regentProduction || '').trim().toLowerCase();
        return status === 'finished' || status === 'ready for dispatch';
      }).length,
    [rows],
  );

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

  const resolveOrderCategory = (row) => {
    if (orderBreakdownType === 'vehicle') {
      const vehicleText = String(row.vehicle || '').trim().toLowerCase();
      if (vehicleText.includes('ldv')) return 'LDV';
      if (vehicleText.includes('ford')) return 'Ford';
      return 'Other';
    }
    const modelText = String(row.model || '').trim().toUpperCase();
    if (modelText.includes('SRV19.1')) return 'SRV19.1';
    if (modelText.includes('SRV22.1')) return 'SRV22.1';
    if (modelText.includes('SRV22.2')) return 'SRV22.2';
    if (modelText.includes('SRV22.3')) return 'SRV22.3';
    return 'Other';
  };

  const filteredOrderRows = useMemo(() => {
    return rows.reduce((acc, row) => {
      const chassisText = String(row.chassisNumber || '').trim();
      if (!chassisText) return acc;
      const dateValue = parseDateValue(row.signedOrderReceived);
      if (!dateValue) return acc;
      const customerText = String(row.customer || '').trim().toLowerCase();
      const isStock = customerText.includes('stock');
      if (orderStockFilter === 'stock' && !isStock) return acc;
      if (orderStockFilter === 'non-stock' && isStock) return acc;
      acc.push({ row, dateValue });
      return acc;
    }, []);
  }, [rows, orderStockFilter]);

  const orderBreakdownData = useMemo(() => {
    const categories =
      orderBreakdownType === 'vehicle'
        ? ['LDV', 'Ford']
        : ['SRV19.1', 'SRV22.1', 'SRV22.2', 'SRV22.3'];

    const monthlyCounts = filteredOrderRows.reduce((acc, { row, dateValue }) => {
      const monthKey = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[monthKey]) {
        acc[monthKey] = categories.reduce(
          (entry, category) => ({ ...entry, [category]: 0 }),
          { month: monthKey },
        );
      }
      const category = resolveOrderCategory(row);
      if (acc[monthKey][category] !== undefined) {
        acc[monthKey][category] += 1;
      }
      return acc;
    }, {});

    return Object.values(monthlyCounts).sort((a, b) => {
      const [yearA, monthA] = a.month.split('-').map((value) => Number.parseInt(value, 10));
      const [yearB, monthB] = b.month.split('-').map((value) => Number.parseInt(value, 10));
      return new Date(yearA, monthA - 1, 1) - new Date(yearB, monthB - 1, 1);
    });
  }, [filteredOrderRows, orderBreakdownType]);

  const orderBreakdownSummary = useMemo(() => {
    const categories =
      orderBreakdownType === 'vehicle'
        ? ['LDV', 'Ford']
        : ['SRV19.1', 'SRV22.1', 'SRV22.2', 'SRV22.3'];
    const summary = categories.reduce(
      (acc, category) => ({ ...acc, [category]: 0 }),
      {},
    );
    const missingByVehicleType = {
      ford: 0,
      ldv: 0,
      other: 0,
    };
    let total = 0;
    let missingVehicleCount = 0;
    filteredOrderRows.forEach(({ row }) => {
      total += 1;
      const category = resolveOrderCategory(row);
      if (summary[category] !== undefined) {
        summary[category] += 1;
      }
      const isVehicleMissing =
        String(row.chassisNumber || '').trim().length > 0 &&
        String(row.vehicleOrderDate || '').trim().length === 0;
      if (isVehicleMissing) {
        missingVehicleCount += 1;
        const vehicleText = String(row.vehicle || '').trim().toLowerCase();
        if (vehicleText.includes('ldv')) {
          missingByVehicleType.ldv += 1;
        } else if (vehicleText.includes('ford')) {
          missingByVehicleType.ford += 1;
        } else {
          missingByVehicleType.other += 1;
        }
      }
    });
    const data = categories.map((category) => ({
      name: category,
      value: summary[category],
    }));
    return { data, total, missingVehicleCount, missingByVehicleType };
  }, [filteredOrderRows, orderBreakdownType]);

  const orderBreakdownCategories =
    orderBreakdownType === 'vehicle'
      ? ['LDV', 'Ford']
      : ['SRV19.1', 'SRV22.1', 'SRV22.2', 'SRV22.3'];
  const orderBreakdownColors = {
    LDV: '#34d399',
    Ford: '#60a5fa',
    Other: '#94a3b8',
    'SRV19.1': '#f472b6',
    'SRV22.1': '#60a5fa',
    'SRV22.2': '#818cf8',
    'SRV22.3': '#a78bfa',
  };

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

  const renderOrderShareLabel = ({ name, value, percent }) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    const safePercent = Number.isFinite(percent) ? percent : 0;
    return `${name}: ${safeValue} (${(safePercent * 100).toFixed(0)}%)`;
  };

  const scheduleMonthSpan = useMemo(() => {
    const diff =
      (scheduleEndDate.getFullYear() - scheduleStartDate.getFullYear()) * 12 +
      (scheduleEndDate.getMonth() - scheduleStartDate.getMonth());
    return diff;
  }, [scheduleEndDate, scheduleStartDate]);

  const scheduleStepCount = useMemo(() => scheduleMonthSpan * 2, [scheduleMonthSpan]);
  const schedulePadding = { left: 56, right: 24, top: 24, bottom: 56 };

  const scheduleIndexFromDate = useCallback(
    (date) => {
      if (!date) return 0;
      const diff =
        (date.getFullYear() - scheduleStartDate.getFullYear()) * 12 +
        (date.getMonth() - scheduleStartDate.getMonth());
      const half = date.getDate() >= 15 ? 1 : 0;
      return Math.min(Math.max(diff * 2 + half, 0), scheduleStepCount);
    },
    [scheduleStartDate, scheduleStepCount],
  );

  const scheduleDateFromIndex = useCallback(
    (index) => {
      const clamped = Math.min(Math.max(index, 0), scheduleStepCount);
      const wholeMonths = Math.floor(clamped / 2);
      const isHalf = clamped % 2 === 1;
      const baseDate = addMonths(scheduleStartDate, wholeMonths);
      return new Date(baseDate.getFullYear(), baseDate.getMonth(), isHalf ? 15 : 1);
    },
    [scheduleStartDate, scheduleStepCount],
  );

  useEffect(() => {
    if (scheduleTouchedRef.current) return;
    setProductionSchedulePoints((prev) => {
      if (prev.length === 0) return prev;
      const targetIndex = prev.findIndex((point) => point.id === 'point-1');
      if (targetIndex === -1) return prev;
      const currentPoint = prev[targetIndex];
      if (scheduleIndexFromDate(currentPoint.date) === scheduleIndexFromDate(firstSchedulePointDate)) {
        return prev;
      }
      const updated = [...prev];
      updated[targetIndex] = { ...currentPoint, date: firstSchedulePointDate };
      return updated;
    });
  }, [firstSchedulePointDate, scheduleIndexFromDate]);

  const scheduleXFromIndex = useCallback(
    (index) => {
      if (scheduleChartSize.width === 0) return schedulePadding.left;
      const innerWidth = Math.max(scheduleChartSize.width - schedulePadding.left - schedulePadding.right, 1);
      return schedulePadding.left + (index / scheduleStepCount) * innerWidth;
    },
    [scheduleChartSize.width, scheduleStepCount],
  );

  const scheduleYFromValue = useCallback(
    (value) => {
      if (scheduleChartSize.height === 0) return schedulePadding.top;
      const innerHeight = Math.max(scheduleChartSize.height - schedulePadding.top - schedulePadding.bottom, 1);
      const clamped = Math.min(Math.max(value, 0), 5);
      return schedulePadding.top + ((5 - clamped) / 5) * innerHeight;
    },
    [scheduleChartSize.height],
  );

  const scheduleValueFromY = useCallback(
    (y) => {
      const innerHeight = Math.max(scheduleChartSize.height - schedulePadding.top - schedulePadding.bottom, 1);
      const ratio = (y - schedulePadding.top) / innerHeight;
      const value = Math.round(5 - ratio * 5);
      return Math.min(Math.max(value, 1), 5);
    },
    [scheduleChartSize.height],
  );

  const scheduleIndexFromX = useCallback(
    (x) => {
      const innerWidth = Math.max(scheduleChartSize.width - schedulePadding.left - schedulePadding.right, 1);
      const ratio = (x - schedulePadding.left) / innerWidth;
      const rawIndex = ratio * scheduleStepCount;
      const snappedIndex = Math.round(rawIndex * 2) / 2;
      return Math.min(Math.max(snappedIndex, 0), scheduleStepCount);
    },
    [scheduleChartSize.width, scheduleStepCount],
  );

  const sortedSchedulePoints = useMemo(
    () =>
      [...productionSchedulePoints].sort(
        (a, b) => scheduleIndexFromDate(a.date) - scheduleIndexFromDate(b.date),
      ),
    [productionSchedulePoints, scheduleIndexFromDate],
  );

  const firstPointIndex =
    sortedSchedulePoints.length > 0 ? scheduleIndexFromDate(sortedSchedulePoints[0].date) : 0;

  const scheduleMonthLabels = useMemo(() => {
    const labels = [];
    const startMonthIndex = Math.floor(firstPointIndex / 2);
    for (let monthOffset = startMonthIndex; monthOffset <= scheduleMonthSpan; monthOffset += 1) {
      const date = addMonths(scheduleStartDate, monthOffset);
      const showYear = monthOffset === startMonthIndex || date.getMonth() === 0;
      const label = `${date.toLocaleString('en-US', { month: 'short' })}${showYear ? ` ${date.getFullYear()}` : ''}`;
      labels.push({ monthOffset, label, date });
    }
    return labels;
  }, [firstPointIndex, scheduleMonthSpan, scheduleStartDate]);

  const scheduleLinePath = useMemo(() => {
    if (sortedSchedulePoints.length === 0) return '';
    const pointsWithEnd = [...sortedSchedulePoints];
    const lastPoint = pointsWithEnd[pointsWithEnd.length - 1];
    const endDate = scheduleEndDate;
    if (scheduleIndexFromDate(endDate) > scheduleIndexFromDate(lastPoint.date)) {
      pointsWithEnd.push({ ...lastPoint, id: 'end', date: endDate });
    }
    let path = '';
    pointsWithEnd.forEach((point, index) => {
      const pointIndex = scheduleIndexFromDate(point.date);
      const x = scheduleXFromIndex(pointIndex);
      const y = scheduleYFromValue(point.value);
      if (index === 0) {
        path = `M ${x} ${y}`;
      } else {
        const prevPoint = pointsWithEnd[index - 1];
        const prevIndex = scheduleIndexFromDate(prevPoint.date);
        const prevX = scheduleXFromIndex(prevIndex);
        const prevY = scheduleYFromValue(prevPoint.value);
        path += ` L ${x} ${prevY} L ${x} ${y}`;
      }
    });
    return path;
  }, [sortedSchedulePoints, scheduleEndDate, scheduleIndexFromDate, scheduleXFromIndex, scheduleYFromValue]);

  const lastForecastProductionDate = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const candidate = rows[index];
      const parsed = parseDateValue(candidate?.forecastProductionDate);
      if (parsed) return parsed;
    }
    return null;
  }, [rows]);

  const scheduleDeltaTotal = useMemo(() => {
    if (!lastForecastProductionDate || sortedSchedulePoints.length === 0) return 0;
    return sortedSchedulePoints.reduce((total, point, index) => {
      const prevPoint = sortedSchedulePoints[index - 1] ?? null;
      const diffDays = (lastForecastProductionDate - point.date) / DAY_MS;
      const weeks = Math.max(0, Math.ceil(diffDays / 7));
      const delta = prevPoint ? point.value - prevPoint.value : point.value;
      return total + weeks * delta;
    }, 0);
  }, [lastForecastProductionDate, sortedSchedulePoints]);

  const scheduleIndexOptions = useMemo(() => {
    if (sortedSchedulePoints.length === 0) return [];
    const startIndex = Math.max(firstPointIndex, 0);
    return Array.from({ length: scheduleStepCount - startIndex + 1 }, (_, offset) => {
      const index = startIndex + offset;
      const date = scheduleDateFromIndex(index);
      const isHalf = date.getDate() === 15;
      const label = `${date.toLocaleString('en-US', { month: 'short' })} ${date.getFullYear()} (${
        isHalf ? '15th' : '1st'
      })`;
      return { value: String(index), label };
    });
  }, [firstPointIndex, scheduleDateFromIndex, scheduleStepCount, sortedSchedulePoints.length]);

  useEffect(() => {
    if (!addPointMode) return;
    const defaultIndex = scheduleIndexOptions[0]?.value ?? '';
    setNewPointIndex(defaultIndex);
    setNewPointValue('1');
    setAddPointError('');
  }, [addPointMode, scheduleIndexOptions]);

  const handleScheduleMouseMove = useCallback(
    (event) => {
      const dragTarget = draggingPointRef.current;
      if (!dragTarget || !scheduleChartRef.current) return;
      scheduleTouchedRef.current = true;
      const rect = scheduleChartRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left - (dragTarget.offsetX || 0);
      const y = event.clientY - rect.top - (dragTarget.offsetY || 0);
      setProductionSchedulePoints((prev) => {
        const updated = prev.map((point) => {
          if (point.id !== dragTarget.id) return point;
          return { ...point };
        });
        const targetIndex = updated.findIndex((point) => point.id === dragTarget.id);
        if (targetIndex === -1) return prev;
        const sorted = [...updated].sort(
          (a, b) => scheduleIndexFromDate(a.date) - scheduleIndexFromDate(b.date),
        );
        const current = updated[targetIndex];
        const sortedIndex = sorted.findIndex((point) => point.id === current.id);
        const leftNeighbor = sortedIndex > 0 ? sorted[sortedIndex - 1] : null;
        const minIndex = leftNeighbor ? scheduleIndexFromDate(leftNeighbor.date) : 0;
        const nextIndex = scheduleIndexFromX(x);
        const clampedIndex = Math.max(nextIndex, minIndex);
        const newDate = dragTarget.lockX ? dragTarget.lockedDate : scheduleDateFromIndex(clampedIndex);
        const newValue = scheduleValueFromY(y);
        updated[targetIndex] = { ...current, date: newDate, value: newValue };
        return updated;
      });
    },
    [scheduleDateFromIndex, scheduleIndexFromDate, scheduleIndexFromX, scheduleValueFromY],
  );

  const handleScheduleMouseUp = useCallback(() => {
    draggingPointRef.current = null;
    window.removeEventListener('mousemove', handleScheduleMouseMove);
    window.removeEventListener('mouseup', handleScheduleMouseUp);
  }, [handleScheduleMouseMove]);

  const handlePointMouseDown = useCallback(
    (event, pointId) => {
      if (deleteMode) return;
      if (event.button !== 0) return;
      if (!scheduleChartRef.current) return;
      event.preventDefault();
      const rect = scheduleChartRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const targetPoint = productionSchedulePoints.find((point) => point.id === pointId);
      if (!targetPoint) return;
      const pointIndex = scheduleIndexFromDate(targetPoint.date);
      const pointX = scheduleXFromIndex(pointIndex);
      const pointY = scheduleYFromValue(targetPoint.value);
      const isFirstPoint = sortedSchedulePoints[0]?.id === pointId;
      draggingPointRef.current = {
        id: pointId,
        offsetX: x - pointX,
        offsetY: y - pointY,
        lockX: isFirstPoint,
        lockedDate: targetPoint.date,
      };
      window.addEventListener('mousemove', handleScheduleMouseMove);
      window.addEventListener('mouseup', handleScheduleMouseUp);
    },
    [
      deleteMode,
      handleScheduleMouseMove,
      handleScheduleMouseUp,
      productionSchedulePoints,
      scheduleIndexFromDate,
      scheduleXFromIndex,
      scheduleYFromValue,
      sortedSchedulePoints,
    ],
  );

  const handlePointClick = useCallback(
    (pointId) => {
      if (!deleteMode) return;
      scheduleTouchedRef.current = true;
      setProductionSchedulePoints((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((point) => point.id !== pointId);
      });
      setDeleteMode(false);
    },
    [deleteMode],
  );

  const handleAddPoint = useCallback(() => {
    const indexValue = Number(newPointIndex);
    const value = Number(newPointValue);
    if (!Number.isFinite(indexValue) || !Number.isFinite(value)) {
      setAddPointError('Please select both a date and a weekly build rate.');
      return;
    }
    let hasDuplicate = false;
    scheduleTouchedRef.current = true;
    setProductionSchedulePoints((prev) => {
      if (prev.some((point) => scheduleIndexFromDate(point.date) === indexValue)) {
        hasDuplicate = true;
        return prev;
      }
      const newPoint = {
        id: `point-${Date.now()}`,
        date: scheduleDateFromIndex(indexValue),
        value,
      };
      return [...prev, newPoint];
    });
    if (hasDuplicate) {
      setAddPointError('A point already exists at that date.');
      return;
    }
    setAddPointError('');
    setAddPointMode(false);
  }, [newPointIndex, newPointValue, scheduleDateFromIndex, scheduleIndexFromDate]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleScheduleMouseMove);
      window.removeEventListener('mouseup', handleScheduleMouseUp);
    };
  }, [handleScheduleMouseMove, handleScheduleMouseUp]);

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
              onClick={handleExportExcel}
              className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
            >
              Export Excel
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

          <div className="mt-6 border-t border-gray-100 pt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Monthly Order Mix</h3>
                <p className="text-sm text-gray-500">
                  Orders received each month, grouped by vehicle or model and filtered by stock status.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-gray-500">
                <div className="flex items-center gap-2 rounded-full bg-gray-100 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setOrderBreakdownType('vehicle')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      orderBreakdownType === 'vehicle'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Vehicle
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderBreakdownType('model')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      orderBreakdownType === 'model'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Model
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-gray-100 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setOrderStockFilter('all')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      orderStockFilter === 'all'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderStockFilter('stock')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      orderStockFilter === 'stock'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderStockFilter('non-stock')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      orderStockFilter === 'non-stock'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Customer
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-gray-100 bg-gradient-to-br from-sky-50 via-white to-indigo-50 p-4">
              {orderBreakdownData.length === 0 ? (
                <div className="text-sm text-gray-500">No monthly order data available yet.</div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={orderBreakdownData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="month"
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
                        cursor={{ fill: '#dbeafe', opacity: 0.4 }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {orderBreakdownCategories.map((category) => (
                        <Bar
                          key={category}
                          dataKey={category}
                          name={category}
                          stackId="orders"
                          fill={orderBreakdownColors[category] || '#94a3b8'}
                          radius={[6, 6, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h4 className="text-base font-semibold text-gray-800">Production Pace Control</h4>
                  <p className="text-sm text-gray-500">
                    Drag points to adjust the weekly build rate. The grey region shows months already locked in.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddPointMode((current) => !current);
                      setDeleteMode(false);
                    }}
                    className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition ${
                      addPointMode
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {addPointMode ? 'Cancel add point' : 'Add a point'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteMode((current) => !current);
                      setAddPointMode(false);
                    }}
                    className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition ${
                      deleteMode
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {deleteMode ? 'Select a point to delete' : 'Delete a point'}
                  </button>
                </div>
              </div>
              {addPointMode && (
                <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-indigo-700">
                      Date (half/full month)
                      <select
                        value={newPointIndex}
                        onChange={(event) => setNewPointIndex(event.target.value)}
                        className="min-w-[180px] rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-gray-700"
                      >
                        {scheduleIndexOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-indigo-700">
                      Builds / week
                      <select
                        value={newPointValue}
                        onChange={(event) => setNewPointValue(event.target.value)}
                        className="min-w-[120px] rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-gray-700"
                      >
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={handleAddPoint}
                      className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
                    >
                      Confirm add
                    </button>
                  </div>
                  {addPointError && <p className="mt-2 text-xs text-rose-600">{addPointError}</p>}
                </div>
              )}

              <div className="mt-4 h-80 rounded-[28px] border border-slate-100 bg-slate-50 shadow-inner">
                <div ref={scheduleChartRef} className="h-full w-full">
                  <svg width="100%" height="100%">
                    <defs>
                      <linearGradient id="lockedRegion" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#e5e7eb" stopOpacity="0.85" />
                        <stop offset="100%" stopColor="#f1f5f9" stopOpacity="0.95" />
                      </linearGradient>
                    </defs>
                    <rect
                      x={scheduleXFromIndex(0)}
                      y={schedulePadding.top}
                      width={Math.max(scheduleXFromIndex(firstPointIndex) - scheduleXFromIndex(0), 0)}
                      height={Math.max(
                        scheduleChartSize.height - schedulePadding.top - schedulePadding.bottom,
                        0,
                      )}
                      fill="url(#lockedRegion)"
                      rx="20"
                    />
                    <line
                      x1={schedulePadding.left}
                      y1={schedulePadding.top}
                      x2={schedulePadding.left}
                      y2={Math.max(scheduleChartSize.height - schedulePadding.bottom, 0)}
                      stroke="#e5e7eb"
                    />
                    {Array.from({ length: 6 }).map((_, index) => {
                      const yValue = 5 - index;
                      const y = scheduleYFromValue(yValue);
                      return (
                        <g key={`y-${yValue}`}>
                          <line
                            x1={schedulePadding.left}
                            y1={y}
                            x2={Math.max(scheduleChartSize.width - schedulePadding.right, 0)}
                            y2={y}
                            stroke="#e5e7eb"
                            strokeDasharray="3 6"
                          />
                          <text x={schedulePadding.left - 12} y={y + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
                            {yValue}
                          </text>
                        </g>
                      );
                    })}
                    <path d={scheduleLinePath} fill="none" stroke="#3b82f6" strokeWidth="3" />
                    {sortedSchedulePoints.map((point) => {
                      const pointIndex = scheduleIndexFromDate(point.date);
                      const x = scheduleXFromIndex(pointIndex);
                      const y = scheduleYFromValue(point.value);
                      const isHighlighted = deleteMode;
                      return (
                        <g key={point.id} onMouseDown={(event) => handlePointMouseDown(event, point.id)}>
                          <circle
                            cx={x}
                            cy={y}
                            r={4}
                            fill={isHighlighted ? '#fca5a5' : '#ffffff'}
                            stroke={isHighlighted ? '#ef4444' : '#3b82f6'}
                            strokeWidth={2}
                            onClick={() => handlePointClick(point.id)}
                            style={{ cursor: deleteMode ? 'pointer' : 'grab' }}
                          />
                        </g>
                      );
                    })}
                    {scheduleMonthLabels.map((label) => {
                      const x = scheduleXFromIndex(label.monthOffset * 2);
                      const y = Math.max(scheduleChartSize.height - schedulePadding.bottom + 18, 0);
                      return (
                        <g key={`label-${label.monthOffset}`} transform={`translate(${x}, ${y})`}>
                          <text
                            textAnchor="end"
                            fill="#64748b"
                            fontSize="11"
                            transform="rotate(-35)"
                            dy={12}
                          >
                            {label.label}
                          </text>
                        </g>
                      );
                    })}
                    <g>
                      <rect
                        x={schedulePadding.left + 6}
                        y={schedulePadding.top + 6}
                        width="170"
                        height="24"
                        rx="12"
                        fill="#e5e7eb"
                      />
                      <text
                        x={schedulePadding.left + 16}
                        y={schedulePadding.top + 22}
                        fontSize="11"
                        fill="#94a3b8"
                      >
                        {completedRegentCount} vehicles built - locked
                      </text>
                    </g>
                    <g>
                      <rect
                        x={scheduleXFromIndex(firstPointIndex) + 6}
                        y={schedulePadding.top + 6}
                        width="170"
                        height="24"
                        rx="12"
                        fill="#dbeafe"
                      />
                      <text
                        x={scheduleXFromIndex(firstPointIndex) + 16}
                        y={schedulePadding.top + 22}
                        fontSize="11"
                        fill="#2563eb"
                      >
                        {scheduleDeltaTotal.toLocaleString('en-US')} pace delta
                      </text>
                    </g>
                  </svg>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
                  Drag points to adjust pace (snap to half-month, min 1 build/week).
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />
                  Delete mode highlights points for removal.
                </div>
              </div>
            </div>
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
          <div className="mt-6 rounded-xl border border-gray-100 bg-gradient-to-br from-amber-50 via-white to-rose-50 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-700">Order Type Share</h4>
                <p className="text-xs text-gray-500">
                  Pie chart view of received orders with stock filters.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-gray-500">
                <div className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setOrderBreakdownType('vehicle')}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      orderBreakdownType === 'vehicle'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Vehicle
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderBreakdownType('model')}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      orderBreakdownType === 'model'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Model
                  </button>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setOrderStockFilter('all')}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      orderStockFilter === 'all'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderStockFilter('stock')}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      orderStockFilter === 'stock'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderStockFilter('non-stock')}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      orderStockFilter === 'non-stock'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Customer
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-100 bg-white p-3">
                  <div className="text-xs font-semibold text-gray-500">Signed Order Received</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-800">
                    {orderBreakdownSummary.total}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-white p-3">
                  <div className="text-xs font-semibold text-gray-500">Missing Vehicles</div>
                  <div className="mt-2 text-2xl font-semibold text-rose-600">
                    {orderBreakdownSummary.missingVehicleCount}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Ford: {orderBreakdownSummary.missingByVehicleType.ford} · LDV:{' '}
                    {orderBreakdownSummary.missingByVehicleType.ldv}
                  </div>
                </div>
              </div>
              <div className="h-56">
                {orderBreakdownSummary.total === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-gray-500">
                    No order share data available.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip
                        contentStyle={{
                          borderRadius: '12px',
                          borderColor: '#e2e8f0',
                          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
                          fontSize: '12px',
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Pie
                        data={orderBreakdownSummary.data}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={2}
                        labelLine={false}
                        label={renderOrderShareLabel}
                      >
                        {orderBreakdownSummary.data.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={orderBreakdownColors[entry.name] || '#94a3b8'}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
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
