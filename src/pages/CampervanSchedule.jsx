import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Bar,
  BarChart,
  Line,
  LineChart,
  Legend,
  LabelList,
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
const COMPANY_HOLIDAYS = [
  '14/07/2025',
  '11/08/2025',
  '22/09/2025',
  '23/09/2025',
  '24/09/2025',
  '25/09/2025',
  '26/09/2025',
  '6/10/2025',
  '3/11/2025',
  '4/11/2025',
  '24/12/2025',
  '25/12/2025',
  '26/12/2025',
  '29/12/2025',
  '1/01/2026',
  '2/01/2026',
  '5/01/2026',
  '6/01/2026',
  '7/01/2026',
  '8/01/2026',
  '9/01/2026',
  '28/01/2026',
  '16/02/2026',
  '9/03/2026',
  '10/03/2026',
  '3/04/2026',
  '6/04/2026',
  '7/04/2026',
  '8/04/2026',
  '9/04/2026',
  '10/04/2026',
  '13/04/2026',
  '18/05/2026',
  '8/06/2026',
  '9/06/2026',
  '20/07/2026',
  '24/08/2026',
  '18/09/2026',
  '21/09/2026',
  '22/09/2026',
  '23/09/2026',
  '24/09/2026',
  '25/09/2026',
  '19/10/2026',
  '2/11/2026',
  '3/11/2026',
  '16/11/2026',
  '24/12/2026',
  '25/12/2026',
  '28/12/2026',
  '29/12/2026',
  '30/12/2026',
  '31/12/2026',
];

const toStartOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const parseHolidayDate = (value) => {
  const [day, month, year] = value.split('/').map((part) => parseInt(part, 10));
  if ([day, month, year].some((part) => Number.isNaN(part))) return null;
  return toStartOfDay(new Date(year, month - 1, day));
};

const companyHolidaySet = new Set(
  COMPANY_HOLIDAYS.map(parseHolidayDate)
    .filter(Boolean)
    .map((date) => date.getTime()),
);

const countHolidaysBetween = (startDate, endDate) => {
  if (!startDate || !endDate) return 0;
  const start = toStartOfDay(startDate).getTime();
  const end = toStartOfDay(endDate).getTime();
  if (end <= start) return 0;
  let count = 0;
  companyHolidaySet.forEach((timestamp) => {
    if (timestamp >= start && timestamp < end) {
      count += 1;
    }
  });
  return count;
};

const getEffectiveDaysBetween = (startDate, endDate) => {
  if (!startDate || !endDate) return 0;
  const start = toStartOfDay(startDate);
  const end = toStartOfDay(endDate);
  const diffDays = Math.max(0, (end - start) / DAY_MS);
  const holidayCount = countHolidaysBetween(start, end);
  return Math.max(0, diffDays - holidayCount);
};

const addProductionDays = (startDate, productionDays) => {
  if (!startDate || !Number.isFinite(productionDays) || productionDays <= 0) {
    return startDate ? toStartOfDay(startDate) : null;
  }
  let remaining = productionDays;
  let current = toStartOfDay(startDate);

  while (remaining >= 1) {
    const next = new Date(current.getTime() + DAY_MS);
    const nextStart = toStartOfDay(next);
    if (!companyHolidaySet.has(nextStart.getTime())) {
      remaining -= 1;
    }
    current = nextStart;
  }

  if (remaining > 0) {
    let next = new Date(current.getTime() + DAY_MS);
    let nextStart = toStartOfDay(next);
    while (companyHolidaySet.has(nextStart.getTime())) {
      nextStart = new Date(nextStart.getTime() + DAY_MS);
    }
    current = new Date(nextStart.getTime() + remaining * DAY_MS);
  }

  return current;
};

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
  const buildDate = (year, month, day) => {
    if ([year, month, day].some((part) => Number.isNaN(part))) return null;
    const candidate = new Date(year, month - 1, day);
    return Number.isNaN(candidate.getTime()) ? null : candidate;
  };
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

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(stringValue)) {
    const [year, month, day] = stringValue.split('-').map((part) => parseInt(part, 10));
    return buildDate(year, month, day);
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(stringValue)) {
    const [first, second, year] = stringValue.split('-').map((part) => parseInt(part, 10));
    const useMonthFirst = second > 12 && first <= 12;
    const day = useMonthFirst ? second : first;
    const month = useMonthFirst ? first : second;
    return buildDate(year, month, day);
  }

  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(stringValue)) {
    const [day, month, year] = stringValue.split('.').map((part) => parseInt(part, 10));
    return buildDate(year, month, day);
  }

  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(stringValue)) {
    const [year, month, day] = stringValue.split('/').map((part) => parseInt(part, 10));
    return buildDate(year, month, day);
  }

  const slashParts = stringValue.split('/');
  if (slashParts.length === 3) {
    const [first, second, third] = slashParts.map((part) => parseInt(part, 10));
    if (!Number.isNaN(first) && !Number.isNaN(second) && !Number.isNaN(third)) {
      if (String(slashParts[0]).length === 4) {
        return buildDate(first, second, third);
      }
      const useMonthFirst = second > 12 && first <= 12;
      const day = useMonthFirst ? second : first;
      const month = useMonthFirst ? first : second;
      return buildDate(third, month, day);
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
  {
    key: 'latestEurPartsOrder',
    label: 'Latest EUR Parts Order (Forecast Production Date - 60)',
    type: 'date',
    readOnly: true,
  },
  { key: 'eurPartsOrderDate', label: 'EUR Parts Order Date', type: 'date' },
  { key: 'eurPartsEta', label: 'EUR Parts ETA', type: 'date' },
  {
    key: 'latestLongtreePartsOrder',
    label: 'Latest Longtree Parts Order (Forecast Production Date - 90)',
    type: 'date',
    readOnly: true,
  },
  { key: 'longtreePartsOrderDate', label: 'Longtree Parts Order Date', type: 'date' },
  { key: 'longtreePartsEta', label: 'Longtree Parts ETA', type: 'date' },
  { key: 'signedOrderReceived', label: 'Signed Order Received', type: 'date' },
  { key: 'vehiclePlannedEta', label: 'Vehicle Planned ETA', type: 'date' },
  { key: 'productionPlannedStartDate', label: 'Production Planned Start Date', type: 'date' },
  { key: 'productionPlannedEndDate', label: 'Production Planned End Date', type: 'date' },
  { key: 'duration', label: 'Duration (Days)', type: 'text', readOnly: true },
];

const normalizeHeader = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const dateKeys = columns.filter((column) => column.type === 'date').map((column) => column.key);
const hiddenColumnKeys = new Set([
  'latestEurPartsOrder',
  'eurPartsOrderDate',
  'eurPartsEta',
  'latestLongtreePartsOrder',
  'longtreePartsOrderDate',
  'longtreePartsEta',
  'vehiclePlannedEta',
  'productionPlannedStartDate',
  'productionPlannedEndDate',
  'duration',
]);

const CampervanSchedule = () => {
  const [rows, setRows] = useState([emptyRow(1)]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const saveTimersRef = useRef({});
  const paceControlSaveTimerRef = useRef(null);
  const paceControlLoadedRef = useRef(false);
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
  const displayColumns = useMemo(
    () => columns.filter((column) => !hiddenColumnKeys.has(column.key)),
    [],
  );

  const headerMap = useMemo(() => {
    const mapping = {
      [normalizeHeader('Row #')]: 'rowNumber',
      [normalizeHeader('Row Number')]: 'rowNumber',
    };
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
        const paceControlRef = ref(database, 'campervanProductionPaceControl');
        const [scheduleSnapshot, paceControlSnapshot] = await Promise.all([
          get(scheduleRef),
          get(paceControlRef),
        ]);

        if (scheduleSnapshot.exists()) {
          const data = scheduleSnapshot.val();
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
        }

        if (paceControlSnapshot.exists()) {
          const parsedPoints = (Array.isArray(paceControlSnapshot.val()) ? paceControlSnapshot.val() : [])
            .map((point, index) => {
              const parsedDate = parseDateValue(point?.date);
              const parsedValue = Number(point?.value);
              if (!parsedDate || !Number.isFinite(parsedValue)) return null;
              return {
                id: point?.id || `point-${index + 1}`,
                date: parsedDate,
                value: Math.min(Math.max(Math.round(parsedValue), 1), 5),
              };
            })
            .filter(Boolean);

          if (parsedPoints.length > 0) {
            setProductionSchedulePoints(parsedPoints);
            initializedScheduleRef.current = true;
            scheduleTouchedRef.current = true;
          }
        }
      } catch (error) {
        console.error('Failed to load campervan schedule data:', error);
        setStatusMessage('Failed to load Firebase data.');
      } finally {
        paceControlLoadedRef.current = true;
      }
    };

    loadRows();
  }, []);

  useEffect(() => {
    if (!paceControlLoadedRef.current) return;
    if (productionSchedulePoints.length === 0) return;

    if (paceControlSaveTimerRef.current) {
      clearTimeout(paceControlSaveTimerRef.current);
    }

    paceControlSaveTimerRef.current = setTimeout(async () => {
      try {
        const paceControlRef = ref(database, 'campervanProductionPaceControl');
        await set(
          paceControlRef,
          productionSchedulePoints.map((point) => ({
            id: point.id,
            date: formatDate(point.date),
            value: point.value,
          })),
        );
      } catch (error) {
        console.error('Failed to save production pace control:', error);
        setStatusMessage('Production pace control failed to save.');
      }
    }, 600);

    return () => {
      if (paceControlSaveTimerRef.current) {
        clearTimeout(paceControlSaveTimerRef.current);
      }
    };
  }, [productionSchedulePoints]);

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
    reader.onload = async (loadEvent) => {
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
          if (!key) return;
          if (key === 'rowNumber') {
            const parsedRow = Number.parseInt(value, 10);
            if (Number.isFinite(parsedRow) && parsedRow > 0) {
              row.rowNumber = parsedRow;
            }
            return;
          }
          row[key] = value;
        });
        return recalcRow(row);
      });

      const fallbackRows = nextRows.length ? nextRows : [emptyRow(1)];
      setRows(fallbackRows);

      try {
        const rowsPayload = fallbackRows.reduce((acc, row) => {
          if (!row.rowNumber) return acc;
          acc[row.rowNumber] = recalcRow(row);
          return acc;
        }, {});
        await set(ref(database, 'campervanSchedule'), rowsPayload);
        setStatusMessage('CSV data uploaded and saved to Firebase.');
      } catch (error) {
        console.error('Failed to save uploaded CSV to Firebase:', error);
        setStatusMessage('Failed to save uploaded CSV data.');
      }
    };
    reader.readAsText(file);
  };

  const handleTemplateDownload = () => {
    const headers = ['Row #', ...columns.map((column) => column.label)];
    const sampleRow = [
      '1',
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
      '',
      '05/11/2024',
      '20/11/2024',
      '',
      '17/11/2024',
      '01/12/2024',
      '01/10/2024',
      '',
      '10/02/2025',
      '20/02/2025',
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
      latestEurPartsOrder: 140,
      eurPartsOrderDate: 120,
      eurPartsEta: 120,
      latestLongtreePartsOrder: 150,
      longtreePartsOrderDate: 110,
      longtreePartsEta: 120,
      signedOrderReceived: 110,
      vehiclePlannedEta: 130,
      productionPlannedStartDate: 150,
      productionPlannedEndDate: 150,
      duration: 110,
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

  const signedOrderReceivedCount = useMemo(
    () => rows.filter((row) => parseDateValue(row.signedOrderReceived)).length,
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
    if (orderBreakdownType === 'dealer') {
      const dealerName = String(row.dealer || '').trim();
      return dealerName || 'Unknown';
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

  const orderBreakdownCategories = useMemo(() => {
    if (orderBreakdownType === 'dealer') {
      const dealerCounts = filteredOrderRows.reduce((acc, { row }) => {
        const dealerName = String(row.dealer || '').trim() || 'Unknown';
        acc[dealerName] = (acc[dealerName] || 0) + 1;
        return acc;
      }, {});
      return Object.entries(dealerCounts)
        .sort(([, countA], [, countB]) => countB - countA)
        .map(([dealerName]) => dealerName);
    }
    return orderBreakdownType === 'vehicle'
      ? ['LDV', 'Ford']
      : ['SRV19.1', 'SRV22.1', 'SRV22.2', 'SRV22.3'];
  }, [filteredOrderRows, orderBreakdownType]);

  const orderBreakdownData = useMemo(() => {
    const categories = orderBreakdownCategories;

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

    return Object.values(monthlyCounts)
      .map((entry) => {
        const total = categories.reduce((sum, category) => sum + (entry[category] || 0), 0);
        return { ...entry, total };
      })
      .sort((a, b) => {
        const [yearA, monthA] = a.month.split('-').map((value) => Number.parseInt(value, 10));
        const [yearB, monthB] = b.month.split('-').map((value) => Number.parseInt(value, 10));
        return new Date(yearA, monthA - 1, 1) - new Date(yearB, monthB - 1, 1);
      });
  }, [filteredOrderRows, orderBreakdownCategories]);

  const orderBreakdownSummary = useMemo(() => {
    const categories = orderBreakdownCategories;
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
  }, [filteredOrderRows, orderBreakdownCategories]);

  const averageOrdersFromOct2025 = useMemo(() => {
    const startDate = new Date(2025, 9, 1);
    const filteredDates = filteredOrderRows
      .map(({ dateValue }) => dateValue)
      .filter((dateValue) => dateValue >= startDate);
    if (filteredDates.length === 0) {
      return { monthly: null, weekly: null };
    }
    const latestDate = filteredDates.reduce(
      (latest, current) => (current > latest ? current : latest),
      filteredDates[0],
    );
    const totalOrders = filteredDates.length;

    const monthSpan =
      (latestDate.getFullYear() - startDate.getFullYear()) * 12 +
      (latestDate.getMonth() - startDate.getMonth()) +
      1;
    const monthly = totalOrders / Math.max(monthSpan, 1);

    const startWeek = new Date(startDate);
    const startDay = startWeek.getDay();
    const startDiff = (startDay + 6) % 7;
    startWeek.setDate(startWeek.getDate() - startDiff);
    startWeek.setHours(0, 0, 0, 0);

    const endWeek = new Date(latestDate);
    const endDay = endWeek.getDay();
    const endDiff = (endDay + 6) % 7;
    endWeek.setDate(endWeek.getDate() - endDiff);
    endWeek.setHours(0, 0, 0, 0);

    const weekSpan = Math.floor((endWeek - startWeek) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const weekly = totalOrders / Math.max(weekSpan, 1);

    return { monthly, weekly };
  }, [filteredOrderRows]);

  const orderBreakdownColors = useMemo(() => {
    const baseColors = {
      LDV: '#34d399',
      Ford: '#60a5fa',
      Other: '#94a3b8',
      Unknown: '#94a3b8',
      'SRV19.1': '#f472b6',
      'SRV22.1': '#60a5fa',
      'SRV22.2': '#818cf8',
      'SRV22.3': '#a78bfa',
    };
    if (orderBreakdownType !== 'dealer') {
      return baseColors;
    }
    const palette = [
      '#38bdf8',
      '#f59e0b',
      '#34d399',
      '#a78bfa',
      '#fb7185',
      '#22c55e',
      '#60a5fa',
      '#f472b6',
      '#818cf8',
      '#f97316',
    ];
    const dealerColors = orderBreakdownCategories.reduce((acc, category, index) => {
      acc[category] = palette[index % palette.length];
      return acc;
    }, {});
    return { ...baseColors, ...dealerColors };
  }, [orderBreakdownCategories, orderBreakdownType]);

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

  const renderMonthlyOrderTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const entries = payload
      .filter((item) => Number(item.value) > 0)
      .sort((a, b) => Number(b.value) - Number(a.value));

    if (entries.length === 0) return null;

    return (
      <div className="rounded-lg border border-gray-200 bg-white/95 p-3 text-xs text-gray-700 shadow-lg">
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="mt-2 grid gap-1">
          {entries.map((entry) => (
            <div key={entry.dataKey ?? entry.name} className="flex items-center justify-between gap-4">
              <span className="truncate">{entry.name || entry.dataKey}</span>
              <span className="font-semibold">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMonthlyTotalLabel = ({ x, y, width, value }) => {
    if (!Number.isFinite(value) || value <= 0) return null;
    const label = String(value);
    const labelWidth = Math.max(24, label.length * 8 + 12);
    const labelHeight = 18;
    const centerX = x + width / 2;
    const rectX = centerX - labelWidth / 2;
    const rectY = y - labelHeight - 6;

    return (
      <g>
        <rect
          x={rectX}
          y={rectY}
          width={labelWidth}
          height={labelHeight}
          rx={9}
          ry={9}
          fill="#ffffff"
          stroke="#e2e8f0"
          strokeWidth={1}
        />
        <text
          x={centerX}
          y={rectY + labelHeight / 2}
          fill="#475569"
          fontSize={11}
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label}
        </text>
      </g>
    );
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

  const formatSchedulePointDate = useCallback((date) => {
    const label = date.getDate() === 15 ? '15th' : '1st';
    return `${date.toLocaleString('en-US', { month: 'short' })} ${date.getFullYear()} (${label})`;
  }, []);

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
      const effectiveDays = getEffectiveDaysBetween(point.date, lastForecastProductionDate);
      const weeks = Math.max(0, Math.ceil(effectiveDays / 7));
      const delta = prevPoint ? point.value - prevPoint.value : point.value;
      return total + weeks * delta;
    }, 0);
  }, [lastForecastProductionDate, sortedSchedulePoints]);

  const paceControlDates = useMemo(() => {
    const d1 = new Date(2026, 4, 15);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d2 = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
    return { d1, d2 };
  }, []);

  const paceControlTotals = useMemo(() => {
    const computeTotal = (targetDate) => {
      return sortedSchedulePoints.reduce((total, point, index) => {
        if (!point.date || point.date >= targetDate) return total;
        const prevPoint = sortedSchedulePoints[index - 1] ?? null;
        const effectiveDays = getEffectiveDaysBetween(point.date, targetDate);
        const weeks = Math.max(0, Math.ceil(effectiveDays / 7));
        const delta = prevPoint ? point.value - prevPoint.value : point.value;
        return total + weeks * delta;
      }, 0);
    };

    return {
      p1: computeTotal(paceControlDates.d1),
      p2: computeTotal(paceControlDates.d2),
    };
  }, [paceControlDates.d1, paceControlDates.d2, sortedSchedulePoints]);

  const leadTimeSummary = useMemo(() => {
    const targetUnits = signedOrderReceivedCount - completedRegentCount;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (sortedSchedulePoints.length === 0 || targetUnits <= 0) {
      return {
        targetUnits,
        leadTimeWeeks: 0,
        leadTimeDays: 0,
        leadTimeMonths: 0,
        leadTimeDate: today,
      };
    }

    let remaining = targetUnits;
    for (let index = 0; index < sortedSchedulePoints.length; index += 1) {
      const point = sortedSchedulePoints[index];
      const rate = Number(point.value);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      const start = point.date;
      const nextPoint = sortedSchedulePoints[index + 1];
      if (nextPoint) {
        const durationWeeks = Math.max(0, getEffectiveDaysBetween(start, nextPoint.date) / 7);
        const capacity = durationWeeks * rate;
        if (remaining <= capacity) {
          const weeksNeeded = remaining / rate;
          const leadTimeDate = addProductionDays(start, weeksNeeded * 7);
          const leadTimeWeeks = Math.max(0, (leadTimeDate - today) / DAY_MS / 7);
          const leadTimeDays = Math.max(0, (leadTimeDate - today) / DAY_MS);
          const leadTimeMonths = Math.max(0, leadTimeDays / 30.4);
          return { targetUnits, leadTimeWeeks, leadTimeDays, leadTimeMonths, leadTimeDate };
        }
        remaining -= capacity;
      } else {
        const weeksNeeded = remaining / rate;
        const leadTimeDate = addProductionDays(start, weeksNeeded * 7);
        const leadTimeWeeks = Math.max(0, (leadTimeDate - today) / DAY_MS / 7);
        const leadTimeDays = Math.max(0, (leadTimeDate - today) / DAY_MS);
        const leadTimeMonths = Math.max(0, leadTimeDays / 30.4);
        return { targetUnits, leadTimeWeeks, leadTimeDays, leadTimeMonths, leadTimeDate };
      }
    }

    return { targetUnits, leadTimeWeeks: 0, leadTimeDays: 0, leadTimeMonths: 0, leadTimeDate: today };
  }, [completedRegentCount, signedOrderReceivedCount, sortedSchedulePoints]);

  const totalSlots = completedRegentCount + scheduleDeltaTotal;
  const availableSlots = totalSlots - signedOrderReceivedCount;
  const p1Limit = 19;
  const p2Limit = 38;
  const p1Exceeded = paceControlTotals.p1 > p1Limit;
  const p2Exceeded = paceControlTotals.p2 > p2Limit;
  const paceControlWarning = p1Exceeded || p2Exceeded;

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
        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Monthly Order</h3>
                <p className="text-sm text-gray-500">
                  Orders received each month, grouped by vehicle, model, or dealer and filtered by stock status.
                </p>
                <div className="mt-2 text-sm text-gray-600">
                  <span className="mr-2">
                    Avg monthly orders since Oct 2025:{' '}
                    <span className="font-semibold text-gray-800">
                      {averageOrdersFromOct2025.monthly === null
                        ? '—'
                        : averageOrdersFromOct2025.monthly.toFixed(1)}
                    </span>
                  </span>
                  <span>
                    Avg weekly orders:{' '}
                    <span className="font-semibold text-gray-800">
                      {averageOrdersFromOct2025.weekly === null
                        ? '—'
                        : averageOrdersFromOct2025.weekly.toFixed(2)}
                    </span>
                  </span>
                </div>
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
                  <button
                    type="button"
                    onClick={() => setOrderBreakdownType('dealer')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      orderBreakdownType === 'dealer'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Dealer
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
                    <BarChart data={orderBreakdownData} margin={{ top: 26, right: 20, left: 0, bottom: 5 }}>
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
                        content={orderBreakdownType === 'dealer' ? renderMonthlyOrderTooltip : undefined}
                        contentStyle={{
                          borderRadius: '12px',
                          borderColor: '#e2e8f0',
                          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
                          fontSize: '12px',
                        }}
                        cursor={{ fill: '#dbeafe', opacity: 0.4 }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {orderBreakdownCategories.map((category, index) => (
                        <Bar
                          key={category}
                          dataKey={category}
                          name={category}
                          stackId="orders"
                          fill={orderBreakdownColors[category] || '#94a3b8'}
                          radius={[6, 6, 0, 0]}
                        >
                          {index === orderBreakdownCategories.length - 1 && (
                            <LabelList
                              dataKey="total"
                              position="top"
                              content={renderMonthlyTotalLabel}
                            />
                          )}
                        </Bar>
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
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500">
                    <span className="inline-block h-[10px] w-[10px] rounded-full bg-indigo-500" />
                    Lead Time (days / months)
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-gray-800">
                    {leadTimeSummary.leadTimeDays.toFixed(0)} / {leadTimeSummary.leadTimeMonths.toFixed(1)}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500">
                    <span className="inline-block h-[10px] w-[10px] rounded-full bg-sky-500" />
                    Total Slots
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-gray-800">
                    {totalSlots.toLocaleString('en-US')}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500">
                    <span className="inline-block h-[10px] w-[10px] rounded-full bg-emerald-500" />
                    Available Slots
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-gray-800">
                    {availableSlots.toLocaleString('en-US')}
                  </div>
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
                      const pointLabel = `${formatSchedulePointDate(point.date)} · ${point.value}/wk`;
                      const labelWidth = Math.max(88, pointLabel.length * 5.6 + 16);
                      const maxLabelX = Math.max(
                        schedulePadding.left,
                        scheduleChartSize.width - schedulePadding.right - labelWidth,
                      );
                      const labelX = Math.min(x + 10, maxLabelX);
                      const labelY = y - 10;
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
                          <g transform={`translate(${labelX}, ${labelY})`} pointerEvents="none">
                            <rect x={0} y={-12} rx={8} width={labelWidth} height={18} fill="#ffffff" opacity="0.9" />
                            <text x={8} y={1} fontSize="10" fill="#475569">
                              {pointLabel}
                            </text>
                          </g>
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
                        {scheduleDeltaTotal.toLocaleString('en-US')} future slots
                      </text>
                    </g>
                  </svg>
                </div>
              </div>
              <div className="mt-2 rounded-md border border-gray-100 bg-slate-50 p-2 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-700">Vehicle Limits</h4>
                    <p className="text-[10px] text-gray-500">
                      D1 is fixed at {formatDate(paceControlDates.d1)}, and D2 is today plus 6 months.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <span className="rounded-full bg-gray-200 px-1.5 py-0.5">P1 ≤ {p1Limit}</span>
                    <span className="rounded-full bg-gray-200 px-1.5 py-0.5">P2 ≤ {p2Limit}</span>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div
                    className={`rounded-md border px-2 py-1.5 text-[11px] shadow-sm ${
                      p1Exceeded ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-gray-100 bg-white text-gray-700'
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">P1</div>
                    <div className="mt-0.5 text-sm font-semibold">
                      {paceControlTotals.p1.toFixed(0)} / {p1Limit}
                    </div>
                    <div className="text-[10px] text-gray-500">Based on D1: {formatDate(paceControlDates.d1)}</div>
                  </div>
                  <div
                    className={`rounded-md border px-2 py-1.5 text-[11px] shadow-sm ${
                      p2Exceeded ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-gray-100 bg-white text-gray-700'
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">P2</div>
                    <div className="mt-0.5 text-sm font-semibold">
                      {paceControlTotals.p2.toFixed(0)} / {p2Limit}
                    </div>
                    <div className="text-[10px] text-gray-500">Based on D2: {formatDate(paceControlDates.d2)}</div>
                  </div>
                </div>
                {paceControlWarning && (
                  <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-semibold text-rose-700">
                    Insufficient vehicle count.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg p-5">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Dealer Order</h3>
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
                  <button
                    type="button"
                    onClick={() => setOrderBreakdownType('dealer')}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      orderBreakdownType === 'dealer'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Dealer
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
              <th
                className="px-3 py-2 sticky left-0 bg-gray-100 z-10"
                style={{ width: '3rem', minWidth: '3rem', maxWidth: '3rem' }}
              >
                Row #
              </th>
              {displayColumns.map((column) => (
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
                <td
                  className="px-3 py-2 sticky left-0 bg-white z-10 font-semibold text-gray-600"
                  style={{ width: '3rem', minWidth: '3rem', maxWidth: '3rem' }}
                >
                  {row.rowNumber}
                </td>
                {displayColumns.map((column) => {
                  const inputType = column.type === 'date' ? 'text' : column.type;
                  const isEmptyDate = column.type === 'date' && !row[column.key] && inputType === 'date';
                  const isVehicleOrderMissing =
                    column.key === 'vehicle' &&
                    String(row.chassisNumber || '').trim().length > 0 &&
                    String(row.vehicleOrderDate || '').trim().length === 0;
                  const customerText = String(row.customer || '').trim().toLowerCase();
                  const isCustomerNonStock =
                    column.key === 'customer' && customerText && !customerText.includes('stock');
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
                        } ${
                          isCustomerNonStock
                            ? 'bg-gradient-to-r from-amber-100 to-amber-50 text-amber-900 ring-1 ring-amber-200 shadow-sm'
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
