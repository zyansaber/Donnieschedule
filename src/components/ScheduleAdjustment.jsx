import React, { useMemo, useState } from 'react';
import { push, ref } from 'firebase/database';
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
import { database } from '../utils/firebase';

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

const STOCK_STATES = ['less', 'normal', 'over'];

const nextStockState = (current) => {
  const index = STOCK_STATES.indexOf(current);
  return STOCK_STATES[(index + 1) % STOCK_STATES.length] || 'normal';
};

const ScheduleAdjustment = ({ data, shuffleRequests, setShuffleRequests, dealerStockLevels = {}, setDealerStockLevels }) => {
  const [dealerFilter, setDealerFilter] = useState('all');
  const [urgentChassis, setUrgentChassis] = useState('');
  const [urgentSubmitting, setUrgentSubmitting] = useState(false);
  const displayRequests = useMemo(() => {
    const latestForecastDateByChassis = new Map(
      (data || [])
        .filter((item) => item?.Chassis)
        .map((item) => [String(item.Chassis), item['Forecast Production Date'] || '']),
    );

    return (shuffleRequests || []).map((row) => {
      const latestForecastDate = latestForecastDateByChassis.get(String(row.chassis || '')) || '';
      const currentForecastProductionDate = latestForecastDate || row.currentForecastProductionDate || row.originalForecastDate || '';
      const autoFinished = isSameMonth(currentForecastProductionDate, row.adjustedTime);
      return {
        ...row,
        currentForecastProductionDate,
        autoFinished,
        status: autoFinished ? 'finished' : (row.status || 'pending'),
      };
    });
  }, [data, shuffleRequests]);


  const allDealers = useMemo(
    () => [...new Set((data || []).map((row) => row?.Dealer).filter(Boolean))].sort(),
    [data],
  );

  const unfinishedDealers = useMemo(() => (
    [...new Set((data || [])
      .filter((row) => String(row?.['Regent Production'] || '').toLowerCase() !== 'finished')
      .map((row) => row?.Dealer)
      .filter(Boolean))].sort()
  ), [data]);

  const chassisRegentMap = useMemo(() => new Map(
    (data || [])
      .filter((item) => item?.Chassis)
      .map((item) => [String(item.Chassis).trim().toLowerCase(), item['Regent Production'] || '']),
  ), [data]);

  const matchedRegentProduction = useMemo(() => (
    chassisRegentMap.get(String(urgentChassis || '').trim().toLowerCase()) || ''
  ), [chassisRegentMap, urgentChassis]);

  const needsCurrentFactory = ['Production Commenced Regent', 'Van Arrived', 'Van on the sea'];

  const submitUrgentRequest = async () => {
    const trimmedChassis = String(urgentChassis || '').trim();
    if (!trimmedChassis || !matchedRegentProduction || urgentSubmitting) return;

    const payload = {
      type: 'change-production-date',
      changeMode: 'expedite',
      chassis: trimmedChassis,
      description: '加急车，尽快完成',
      approvals: { productionApproved: false },
      createdAt: Date.now(),
    };

    if (needsCurrentFactory.includes(matchedRegentProduction)) {
      payload.currentfactory = 'Melbourne';
    }

    try {
      setUrgentSubmitting(true);
      await push(ref(database, 'mes/requisitionTickets'), payload);
      setUrgentChassis('');
      alert('Urgent request submitted.');
    } catch (error) {
      console.error('Failed to submit urgent request:', error);
      alert('Failed to submit urgent request.');
    } finally {
      setUrgentSubmitting(false);
    }
  };

  const toggleDealerStockLevel = (dealer) => {
    if (!setDealerStockLevels) return;
    setDealerStockLevels((prev) => ({
      ...prev,
      [dealer]: nextStockState(prev?.[dealer] || 'normal'),
    }));
  };

  const filteredDisplayRequests = useMemo(() => {
    if (dealerFilter === 'all') return displayRequests;
    return displayRequests.filter((row) => row.dealer === dealerFilter);
  }, [dealerFilter, displayRequests]);

  const selectedRequests = filteredDisplayRequests.filter((row) => row.status !== 'finished');

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
        <h3 className="text-lg font-semibold mb-3">Unfinished Vans Dealer Stock Status</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-10 gap-3">
          {unfinishedDealers.map((dealer) => {
            const stockLevel = dealerStockLevels?.[dealer] || 'normal';
            const isLess = stockLevel === 'less';
            const isOver = stockLevel === 'over';
            return (
              <div key={dealer} className={`border rounded-lg p-2 ${stockLevel === 'normal' ? 'border-gray-200 bg-gray-50' : 'border-red-300 bg-red-50'}`}>
                <div className="text-xs text-gray-700 mb-2 truncate" title={dealer}>{dealer}</div>
                <button
                  type="button"
                  onClick={() => toggleDealerStockLevel(dealer)}
                  className="relative w-full h-9 rounded-lg bg-gray-100 border border-gray-300 flex items-center justify-between px-1 overflow-hidden transition-all"
                >
                  <div 
                    className={`absolute top-0.5 bottom-0.5 w-1/3 rounded-md bg-white border border-gray-300 transition-transform duration-300 ease-out shadow-sm ${isLess ? 'translate-x-0' : isOver ? 'translate-x-[200%]' : 'translate-x-[100%]'}`}
                    style={{ left: '2px' }}
                  />
                  <span className={`relative z-10 flex-1 text-center text-xs font-semibold transition-colors duration-200 ${isLess ? 'text-green-700' : 'text-gray-500'}`}>Less</span>
                  <span className={`relative z-10 flex-1 text-center text-xs font-semibold transition-colors duration-200 ${!isLess && !isOver ? 'text-gray-800' : 'text-gray-500'}`}>Normal</span>
                  <span className={`relative z-10 flex-1 text-center text-xs font-semibold transition-colors duration-200 ${isOver ? 'text-red-700' : 'text-gray-500'}`}>Over</span>
                </button>
              </div>
            );
          })}
          {unfinishedDealers.length === 0 && (
            <div className="col-span-full text-sm text-gray-500">No unfinished van dealers found.</div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Urgent Request</h3>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="block text-sm text-gray-700 mb-1">Chassis</label>
            <input
              type="text"
              value={urgentChassis}
              onChange={(e) => setUrgentChassis(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Enter chassis number"
            />
          </div>
          <button
            type="button"
            onClick={submitUrgentRequest}
            disabled={!String(urgentChassis || '').trim() || !matchedRegentProduction || urgentSubmitting}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {urgentSubmitting ? 'Submitting...' : 'Confirm Urgent Request'}
          </button>
        </div>
        <div className="mt-3 text-sm text-gray-700">
          <span className="font-medium">Regent Production: </span>
          {matchedRegentProduction || 'No matching chassis found in current schedule'}
        </div>
      </div>

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
            <select
              className="border border-gray-300 rounded px-2 py-2 text-sm"
              value={dealerFilter}
              onChange={(event) => setDealerFilter(event.target.value)}
            >
              <option value="all">All Dealers</option>
              {allDealers.map((dealer) => (
                <option key={dealer} value={dealer}>
                  {dealer}
                </option>
              ))}
            </select>
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
              {filteredDisplayRequests.map((row) => (
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
              {filteredDisplayRequests.length === 0 && (
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
