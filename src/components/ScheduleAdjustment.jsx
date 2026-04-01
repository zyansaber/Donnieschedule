import React, { useMemo, useState } from 'react';
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

const ScheduleAdjustment = ({ data, shuffleRequests, setShuffleRequests }) => {
  const [selectedRows, setSelectedRows] = useState([]);

  const toggleRowSelection = (id) => {
    setSelectedRows((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  const selectedRequests = useMemo(() => {
    if (selectedRows.length === 0) return shuffleRequests;
    return shuffleRequests.filter((item) => selectedRows.includes(item.id));
  }, [shuffleRequests, selectedRows]);

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
      const to = `${request.targetMonth}`;
      if (from) movedFrom[from] = (movedFrom[from] || 0) + 1;
      if (to) movedTo[to] = (movedTo[to] || 0) + 1;
    });

    const monthKeys = [...new Set([
      ...Object.keys(base),
      ...Object.keys(movedFrom),
      ...Object.keys(movedTo),
    ])].sort();

    return monthKeys.map((month) => ({
      month,
      quantity: base[month] || 0,
      movedFrom: movedFrom[month] || 0,
      movedTo: movedTo[month] || 0,
    }));
  }, [data, selectedDealers, selectedRequests]);

  const exportRequests = () => {
    if (!shuffleRequests.length) return;
    const headers = ['Dealer', 'Chassis', 'Adjusted Month', 'Vin Number'];
    const rows = shuffleRequests.map((item) => [
      item.dealer || '',
      item.chassis || '',
      item.targetMonth || '',
      item.monthVin || '',
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

  const removeRequest = (id) => {
    setShuffleRequests((prev) => prev.filter((item) => item.id !== id));
    setSelectedRows((prev) => prev.filter((item) => item !== id));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Schedule Shuffling Impact</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="quantity" fill="#4f46e5" name="Base Quantity" />
              <Bar dataKey="movedFrom" fill="none" stroke="#ef4444" name="Moved From (Frame)" />
              <Bar dataKey="movedTo" fill="#22c55e" fillOpacity={0.35} name="Moved To (Transparent)">
                {chartData.map((entry) => (
                  <Cell key={`cell-${entry.month}`} fill={entry.movedTo > 0 ? 'url(#stripePattern)' : '#22c55e'} />
                ))}
              </Bar>
              <defs>
                <pattern id="stripePattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill="rgba(34,197,94,0.2)" />
                  <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(34,197,94,0.6)" strokeWidth="3" />
                </pattern>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Schedule Shuffling Requests</h3>
          <button className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700" onClick={exportRequests}>
            Download Requests
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 border">Select</th>
                <th className="px-3 py-2 border">Dealer</th>
                <th className="px-3 py-2 border">Chassis</th>
                <th className="px-3 py-2 border">Adjusted Time</th>
                <th className="px-3 py-2 border">Vin Number</th>
                <th className="px-3 py-2 border">Action</th>
              </tr>
            </thead>
            <tbody>
              {shuffleRequests.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 border text-center">
                    <input
                      type="checkbox"
                      checked={selectedRows.includes(row.id)}
                      onChange={() => toggleRowSelection(row.id)}
                    />
                  </td>
                  <td className="px-3 py-2 border">{row.dealer}</td>
                  <td className="px-3 py-2 border">{row.chassis}</td>
                  <td className="px-3 py-2 border">{row.targetMonth}</td>
                  <td className="px-3 py-2 border">{row.monthVin || ''}</td>
                  <td className="px-3 py-2 border text-center">
                    <button
                      className="text-red-600 hover:text-red-700"
                      onClick={() => removeRequest(row.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {shuffleRequests.length === 0 && (
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
    originalForecastDate: row['Forecast Production Date'] || '',
    monthVin: firstNumericVinByMonth[targetMonth] || '',
  }));
};

export default ScheduleAdjustment;
