import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  Legend,
} from 'recharts';

const parseDate = (value) => {
  if (!value) return null;
  const parts = String(value).split('/');
  if (parts.length < 3) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const year = Number(parts[2]);
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const monthKeyWithOffset = (value, offsetDays = 20) => {
  const date = parseDate(value);
  if (!date) return '';
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + offsetDays);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
};

const monthKeyFromForecast = (value) => {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const formatMonthToDate = (monthValue) => {
  if (!monthValue || !monthValue.includes('-')) return '';
  const [year, month] = monthValue.split('-');
  return `01/${month}/${year}`;
};

const formatRequestTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
};

const isSameMonth = (dateA, dateB) => {
  const first = parseDate(dateA);
  const second = parseDate(dateB);
  if (!first || !second) return false;
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth();
};

const ScheduleAdjustment = ({ data, shuffleRequests, setShuffleRequests }) => {
  const displayRequests = useMemo(() => (
    (shuffleRequests || []).map((row) => {
      const autoFinished = isSameMonth(row.currentForecastProductionDate, row.adjustedTime);
      return {
        ...row,
        autoFinished,
        status: autoFinished ? 'finished' : (row.status || 'pending'),
      };
    })
  ), [shuffleRequests]);

  const selectedRequests = displayRequests.filter((row) => row.status !== 'finished');

  const selectedDealers = useMemo(
    () => [...new Set(selectedRequests.map((row) => row.dealer).filter(Boolean))],
    [selectedRequests],
  );

  const chartData = useMemo(() => {
    const filtered = (data || []).filter((item) => {
      const stage = String(item['Regent Production'] || '').toLowerCase();
      if (stage === 'finished') return false;
      if (selectedDealers.length === 0) return true;
      return selectedDealers.includes(item.Dealer);
    });

    const base = {};
    filtered.forEach((row) => {
      const key = monthKeyWithOffset(row['Forecast Production Date']);
      if (!key) return;
      base[key] = (base[key] || 0) + 1;
    });

    const movedFrom = {};
    const movedTo = {};
    selectedRequests.forEach((request) => {
      const from = monthKeyWithOffset(request.originalForecastDate);
      const to = monthKeyFromForecast(request.adjustedTime);
      if (from) movedFrom[from] = (movedFrom[from] || 0) + 1;
      if (to) movedTo[to] = (movedTo[to] || 0) + 1;
    });

    const monthKeys = [...new Set([
      ...Object.keys(base),
      ...Object.keys(movedFrom),
      ...Object.keys(movedTo),
    ])].sort();

    return monthKeys.map((month) => {
      const quantity = base[month] || 0;
      const movedOut = movedFrom[month] || 0;
      const afterMove = Math.max(0, quantity - movedOut);
      return {
      month,
      afterMove,
      movedFrom: movedOut,
      movedTo: movedTo[month] || 0,
      quantity,
    };
    });
  }, [data, selectedDealers, selectedRequests]);

  const exportRequests = () => {
    if (!shuffleRequests.length) return;
    const headers = ['Chassis', 'Australia Production Date', 'Vin Number', '申请时间'];
    const rows = shuffleRequests.map((item) => [
      item.chassis || '',
      item.adjustedTime || '',
      item.monthVin || '',
      item.requestedAt || '',
    ]);
    const csv = [headers.join(','), ...rows.map((row) => row.map((v) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `schedule_shuffling_requests_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateRequestStatus = (id, status) => {
    setShuffleRequests((prev) => prev.map((item) => (
      item.id === id ? { ...item, status } : item
    )));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Schedule Shuffling Impact</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="afterMove" stackId="a" fill="#4f46e5" name="Base (After Move)" />
                <Bar dataKey="movedFrom" stackId="a" fill="none" stroke="#ef4444" name="Moved From (Transparent Frame)" />
                <Bar dataKey="movedTo" stackId="a" fill="#111827" fillOpacity={0.5} name="Moved To (Stacked)">
                  {chartData.map((entry) => (
                    <Cell key={`cell-${entry.month}`} fill={entry.movedTo > 0 ? 'url(#stripePattern)' : '#111827'} />
                  ))}
                </Bar>
                <defs>
                  <pattern id="stripePattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="8" height="8" fill="rgba(17,24,39,0.2)" />
                    <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.65)" strokeWidth="3" />
                  </pattern>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h4 className="font-semibold text-gray-800 mb-2">Current Display Dealers</h4>
            <div className="text-sm text-gray-600 mb-3">
              Showing all dealers with pending (not done) requests
            </div>
            <div className="flex flex-wrap gap-2">
              {(selectedDealers.length ? selectedDealers : ['All Dealers']).map((dealer) => (
                <span key={dealer} className="px-2 py-1 text-xs rounded-full bg-indigo-100 text-indigo-700">
                  {dealer}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Schedule Shuffling Requests</h3>
          <div className="flex items-center gap-2">
            <button className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700" onClick={exportRequests}>
              Download Requests
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 border">Dealer</th>
                <th className="px-3 py-2 border">Chassis</th>
                <th className="px-3 py-2 border">Current Forecast Production Date</th>
                <th className="px-3 py-2 border">Adjusted Time</th>
                <th className="px-3 py-2 border">Vin Number</th>
                <th className="px-3 py-2 border">Action</th>
              </tr>
            </thead>
            <tbody>
              {displayRequests.map((row) => (
                <tr
                  key={row.id}
                  className={`transition-colors hover:bg-gray-50 ${row.status === 'finished' ? 'bg-green-100' : ''}`}
                >
                  <td className="px-3 py-2 border">{row.dealer}</td>
                  <td className="px-3 py-2 border">{row.chassis}</td>
                  <td className="px-3 py-2 border">{row.currentForecastProductionDate || ''}</td>
                  <td className="px-3 py-2 border">{row.adjustedTime}</td>
                  <td className="px-3 py-2 border">{row.monthVin || ''}</td>
                  <td className="px-3 py-2 border text-center">
                    {row.status === 'finished' ? (
                      <span className="text-green-700 font-semibold">Finished</span>
                    ) : row.status === 'scheduling' ? (
                      <span className="text-blue-700 font-semibold">Scheduling</span>
                    ) : (
                      <button
                        className="text-green-700 hover:text-green-800"
                        onClick={(event) => {
                          event.stopPropagation();
                          updateRequestStatus(row.id, 'scheduling');
                        }}
                      >
                        Done
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {displayRequests.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                    No schedule shuffling requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const buildShuffleRequests = (rows, targetMonth, allRows) => {
  const firstNumericVinByMonth = {};
  (allRows || []).forEach((row) => {
    const month = monthKeyFromForecast(row['Forecast Production Date']);
    const vin = row['Vin Number'];
    if (!month || firstNumericVinByMonth[month]) return;
    const vinAsNumber = Number(vin);
    if (!Number.isNaN(vinAsNumber) && String(vin).trim() !== '') {
      firstNumericVinByMonth[month] = String(vin);
    }
  });

  return rows.map((row) => ({
    id: `${row.Chassis || 'no-chassis'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dealer: row.Dealer || '',
    chassis: row.Chassis || '',
    targetMonth,
    adjustedTime: formatMonthToDate(targetMonth),
    originalForecastDate: row['Forecast Production Date'] || '',
    currentForecastProductionDate: row['Forecast Production Date'] || '',
    monthVin: firstNumericVinByMonth[targetMonth] || '',
    requestedAt: formatRequestTime(new Date()),
    status: 'pending',
  }));
};

export default ScheduleAdjustment;
