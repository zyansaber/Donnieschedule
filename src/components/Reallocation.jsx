import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';

// Chart colors
const chartColors = ['#2563eb','#16a34a','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#10b981','#f97316','#64748b','#d946ef'];
import { ref, set, get, push } from 'firebase/database';
import { getDatabase } from 'firebase/database';
import { collection, addDoc, getDocs } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";
import { database, firestoreDB } from '../utils/firebase';

const Reallocation = ({ data }) => {
  const [reallocationRows, setReallocationRows] = useState([{
    id: 1,
    chassisNumber: '',
    currentVanInfo: null,
    selectedDealer: '',
    message: '',
    historyInfo: null,
    transportCompany: ''
  }]);
  const [allDealers, setAllDealers] = useState([]);
  const [reallocationRequests, setReallocationRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [trendFilter, setTrendFilter] = useState('all'); // 'all' | 'snowy'
  const [campervanScheduleRows, setCampervanScheduleRows] = useState([]);
  // ====== Charts Data (Snowy Stock not finished + Prefix distribution + 10-week trend) ======
  const getPrefix = (ch) => {
    if (!ch) return 'UNK';
    const onlyLetters = String(ch).toUpperCase().replace(/[^A-Z]/g, '');
    return (onlyLetters.slice(0, 3) || 'UNK');
  };

  // 1) Current snapshot from schedule data: Dealer == 'Snowy Stock' && Regent Production != 'Finished'
  const snowyNotFinished = (data || []).filter(item => {
    const dealer = (item?.Dealer || '').trim();
    const prod = (item?.['Regent Production'] || item?.['Regent Production Status'] || item?.status || '').trim();
    return dealer === 'Snowy Stock' && prod !== 'Finished';
  });

  const totalSnowy = snowyNotFinished.length;
  const prefixCounts = snowyNotFinished.reduce((acc, it) => {
    const p = getPrefix(it?.Chassis);
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const prefixPieData = Object.entries(prefixCounts).map(([name, count]) => ({
    name,
    value: count,
    percent: totalSnowy ? Math.round((count / totalSnowy) * 1000) / 10 : 0,
  })).sort((a, b) => b.value - a.value);

  // 2) Last 10 weeks trend from reallocationRequests: count per prefix by submitTime week
  const parseSubmitToDate = (s) => {
    if (!s) return null;
    // Expect "DD/MM/YYYY, hh:mm:ss am/pm"
    try {
      const parts = s.replace(',', '').split(' ');
      const [day, month, year] = parts[0].split('/').map(Number);
      let [hh, mm, ss] = (parts[1] || '00:00:00').split(':').map(Number);
      const ampm = (parts[2] || '').toLowerCase();
      if (ampm === 'pm' && hh < 12) hh += 12;
      if (ampm === 'am' && hh === 12) hh = 0;
      return new Date(year, (month || 1) - 1, day || 1, hh || 0, mm || 0, ss || 0);
    } catch { return null; }
  };

  const getMonday = (d) => {
    const dt = new Date(d);
    const day = dt.getDay(); // 0 Sun .. 6 Sat
    const diff = (day === 0 ? -6 : 1) - day; // back to Monday
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0,0,0,0);
    return dt;
  };

  // Build last 10 Monday week-start labels
  const now = new Date();
  const weeks = [];
  let cur = getMonday(now);
  for (let i = 0; i < 10; i++) {
    const label = cur.toLocaleDateString('en-AU', { year: '2-digit', month: '2-digit', day: '2-digit' }); // e.g., 09/09/25
    weeks.unshift({ start: new Date(cur), label }); // oldest -> newest
    cur = new Date(cur); cur.setDate(cur.getDate() - 7);
  }

  const trendFilteredRequests = (reallocationRequests || []).filter(req => {
    if (trendFilter !== 'snowy') return true;
    const origin = (req?.originalDealer || '').trim().toLowerCase();
    return origin === 'snowy stock';
  });

  // Aggregate counts per prefix
  const prefixWeekCounts = {}; // {prefix: {label: count}}
  trendFilteredRequests.forEach(req => {
    const dt = parseSubmitToDate(req?.submitTime);
    if (!dt) return;
    // map to the week bucket by finding the week whose start <= dt < start+7d
    for (const w of weeks) {
      const start = w.start.getTime();
      const end = start + 7 * 24 * 3600 * 1000;
      const t = dt.getTime();
      if (t >= start && t < end) {
        const p = getPrefix(req?.chassisNumber);
        prefixWeekCounts[p] = prefixWeekCounts[p] || {};
        prefixWeekCounts[p][w.label] = (prefixWeekCounts[p][w.label] || 0) + 1;
        break;
      }
    }
  });

  // Pick top 6 prefixes by total counts across 10 weeks; others grouped as 'OTHER'
  const totalsByPrefix = Object.entries(prefixWeekCounts).map(([p, obj]) => ({
    prefix: p,
    total: Object.values(obj).reduce((a,b)=>a+b,0)
  })).sort((a,b)=>b.total-a.total);

  const topPrefixes = totalsByPrefix.slice(0, 6).map(x => x.prefix);
  const trendData = weeks.map(w => {
    const row = { week: w.label };
    Object.keys(prefixWeekCounts).forEach(p => {
      const key = topPrefixes.includes(p) ? p : 'OTHER';
      row[key] = (row[key] || 0) + (prefixWeekCounts[p][w.label] || 0);
    });
    return row;
  });

  const trendSeriesKeys = Array.from(new Set(Object.keys(trendData.reduce((acc,row)=>{
    Object.keys(row).forEach(k=>{ if(k!=='week') acc[k]=true; });
    return acc;
  }, {}))));

  const [stats, setStats] = useState({ totalPending: 0, totalDone: 0, dealerStats: {} });
  const [showFilter, setShowFilter] = useState('all'); // 'all', 'pending', 'done'

  const chassisRequestCounts = reallocationRequests.reduce((acc, req) => {
    const key = (req?.chassisNumber || '').toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  
  const dealerEntries = Object.entries(stats.dealerStats || {}).map(([dealer, counts]) => ({
    dealer,
    counts,
    total: (counts?.moved_from || 0) + (counts?.moved_to || 0),
  }));

  const topDealerEntries = dealerEntries
    .sort((a, b) => b.total - a.total || a.dealer.localeCompare(b.dealer))
    .slice(0, 8);

const repetitionBadgeStyles = {
    2: 'from-blue-500 to-indigo-600 shadow-blue-200/80 text-white',
    3: 'from-emerald-500 to-teal-600 shadow-emerald-200/80 text-white',
    4: 'from-amber-500 to-orange-600 shadow-amber-200/80 text-white',
    5: 'from-rose-500 to-pink-600 shadow-rose-200/80 text-white',
    6: 'from-purple-500 to-fuchsia-600 shadow-purple-200/80 text-white',
  };

  const getRepetitionBadgeClass = (count) => {
    if (count <= 1) return '';
    const base = 'inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br text-[11px] font-semibold shadow-md border border-white';
    return `${base} ${repetitionBadgeStyles[count] || 'from-slate-500 to-slate-700 shadow-slate-200/80 text-white'}`;
  };


  const maxMovementValue = topDealerEntries.reduce(
    (max, entry) => Math.max(max, entry.counts?.moved_from || 0, entry.counts?.moved_to || 0),
    0
  );

  const getBarHeight = (value) => {
    if (!value || maxMovementValue === 0) return 0;
    const scaledHeight = Math.round((value / maxMovementValue) * 72);
    return Math.max(4, scaledHeight);
  };
  
  // Get unique dealers from data
  useEffect(() => {
    if (data && data.length > 0) {
      const dealers = [...new Set(data.map(item => item.Dealer).filter(Boolean))].sort();
      setAllDealers(dealers);
    }
  }, [data]);

  // Load reallocation requests from Firebase
  useEffect(() => {
    loadReallocationRequests();
  }, []);

  useEffect(() => {
    const loadCampervanSchedule = async () => {
      try {
        const scheduleRef = ref(database, 'campervanSchedule');
        const snapshot = await get(scheduleRef);
        if (!snapshot.exists()) return;

        const rawData = snapshot.val();
        const parsedRows = Object.values(rawData || {}).filter(Boolean);
        setCampervanScheduleRows(parsedRows);
      } catch (error) {
        console.error('Error loading campervan schedule:', error);
      }
    };

    loadCampervanSchedule();
  }, []);

  // Calculate statistics
  useEffect(() => {
    calculateStats();
  }, [reallocationRequests]);

  const loadReallocationRequests = async () => {
    try {
      const reallocationRef = ref(database, 'reallocation');
      const snapshot = await get(reallocationRef);
      if (snapshot.exists()) {
        const requestsData = snapshot.val();
  
        const parseDateTime = (s) => {
          if (!s) return 0;
        
          // Example: "27/08/2025, 08:46:41 am"
          const [datePart, timePart, ampm] = s.replace(",", "").split(" ");
          const [day, month, year] = datePart.split("/").map(Number);
          const [hoursStr, minutesStr, secondsStr] = timePart.split(":");
          let hours = parseInt(hoursStr, 10);
          const minutes = parseInt(minutesStr, 10);
          const seconds = parseInt(secondsStr, 10);
        
          if (ampm?.toLowerCase() === "pm" && hours < 12) hours += 12;
          if (ampm?.toLowerCase() === "am" && hours === 12) hours = 0;
        
          return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
        };
  
        const requestsList = [];
          Object.entries(requestsData).forEach(([chassis, requests]) => {
           Object.entries(requests).forEach(([reqId, data]) => {
             requestsList.push({
               id: reqId,
               chassisNumber: chassis,
               ...data
             });
           });
         });
        
         const sortedRequests = requestsList.sort(
           (a, b) => parseDateTime(b.submitTime) - parseDateTime(a.submitTime)
         );
        
        setReallocationRequests(sortedRequests);
      }
    } catch (error) {
      console.error('Error loading reallocation requests:', error);
    }
  };

  const calculateStats = () => {
    const dealerStats = {};
    let totalPending = 0;
    let totalDone = 0;

    reallocationRequests.forEach(request => {
      if (request.status === 'completed') {
        totalDone++;
      } else {
        totalPending++;
      }
      
      // Count chassis being moved from original dealer
      if (request.originalDealer) {
        if (!dealerStats[request.originalDealer]) {
          dealerStats[request.originalDealer] = { moved_from: 0, moved_to: 0 };
        }
        dealerStats[request.originalDealer].moved_from++;
      }

      // Count chassis being moved to new dealer
      if (request.reallocatedTo) {
        if (!dealerStats[request.reallocatedTo]) {
          dealerStats[request.reallocatedTo] = { moved_from: 0, moved_to: 0 };
        }
        dealerStats[request.reallocatedTo].moved_to++;
      }
    });

    setStats({ totalPending, totalDone, dealerStats });
  };

  const fetchDispatchTransportCompany = async (chassis) => {
    if (!chassis) return '';
    try {
      const dispatchRef = ref(database, `Dispatch/${chassis}`);
      const snapshot = await get(dispatchRef);
      if (!snapshot.exists()) return '';
      const dispatchData = snapshot.val();
      return (dispatchData?.TransportCompany || '').trim();
    } catch (error) {
      console.error('Error loading dispatch data:', error);
      return '';
    }
  };

  const handleChassisNumberChange = async (rowId, chassis) => {
    const trimmedChassis = chassis.trim();
    const transportCompany = await fetchDispatchTransportCompany(trimmedChassis);
    setReallocationRows((prevRows) => prevRows.map(row => {
      if (row.id === rowId) {
        if (trimmedChassis) {
          // Find van information from data
          const vanInfo = (data || []).find(item =>
            item.Chassis && item.Chassis.toLowerCase() === trimmedChassis.toLowerCase()
          );
          const campervanMatch = campervanScheduleRows.find(item =>
            item?.chassisNumber && item.chassisNumber.toLowerCase() === trimmedChassis.toLowerCase()
          );
          const campervanInfo = campervanMatch ? {
            Chassis: campervanMatch.chassisNumber,
            Dealer: campervanMatch.dealer || '',
            Model: campervanMatch.model || '',
            Customer: campervanMatch.customer || '',
            'Regent Production': campervanMatch.regentProduction || '',
            'Signed Plans Received': campervanMatch.signedOrderReceived || '',
          } : null;

          const resolvedVanInfo = vanInfo || campervanInfo;
          
          if (resolvedVanInfo) {
            const signedPlansReceived = resolvedVanInfo['Signed Plans Received'] || '';
            let message = '';
            
            if (signedPlansReceived.toLowerCase() === 'no') {
              message = "⚠️ The van isn't signed, please sign off or cancel to reorder";
            }

            const historyMatches = reallocationRequests.filter(req =>
              (req?.chassisNumber || '').toLowerCase() === trimmedChassis.toLowerCase()
            );
            const historyInfo = historyMatches.length
              ? {
                  count: historyMatches.length,
                  lastDealer: historyMatches[0]?.reallocatedTo || 'N/A',
                  lastSubmitTime: historyMatches[0]?.submitTime || 'Unknown'
                }
              : null;

            return {
              ...row,
              chassisNumber: trimmedChassis,
              currentVanInfo: resolvedVanInfo,
              selectedDealer: '',
              message,
              historyInfo,
              transportCompany
            };
          } else {
            return {
              ...row,
              chassisNumber: trimmedChassis,
              currentVanInfo: null,
              selectedDealer: '',
              message: 'Chassis number not found',
              historyInfo: null,
              transportCompany
            };
          }
        } else {
          return {
            ...row,
            chassisNumber: trimmedChassis,
            currentVanInfo: null,
            selectedDealer: '',
            message: '',
            historyInfo: null,
            transportCompany: ''
          };
        }
      }
      return row;
    }));
  };

  const handleDealerChange = (rowId, dealer) => {
    const newRows = reallocationRows.map(row => {
      if (row.id === rowId) {
        return { ...row, selectedDealer: dealer };
      }
      return row;
    });
    setReallocationRows(newRows);
  };

  const addRow = () => {
    const newId = Math.max(...reallocationRows.map(r => r.id)) + 1;
    setReallocationRows([...reallocationRows, {
      id: newId,
      chassisNumber: '',
      currentVanInfo: null,
      selectedDealer: '',
      message: '',
      historyInfo: null,
      transportCompany: ''
    }]);
  };

  const removeRow = (rowId) => {
    if (reallocationRows.length > 1) {
      setReallocationRows(reallocationRows.filter(row => row.id !== rowId));
    }
  };

  const getMelbourneTime = () => {
    return new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleSubmit = async () => {

    const validRows = reallocationRows.filter(row => canSubmitRow(row));

    if (validRows.length === 0) {
      setGlobalMessage('Please enter valid chassis numbers and select dealers for at least one row');
      return;
    }

    setLoading(true);

    try {
      const promises = validRows.map(async (row) => {
        const chassis = row.chassisNumber || '';
        const dealer = row.selectedDealer || '';
        const currentVan = row.currentVanInfo || {};
        const dealerOri = currentVan.Dealer || '';

        // Realtime DB data
        const reallocationData = {
          status: currentVan['Regent Production'] || 'Unknown',
          originalDealer: dealerOri,
          reallocatedTo: dealer,
          submitTime: getMelbourneTime(),
          model: currentVan.Model || '',
          customer: currentVan.Customer || '',
          signedPlansReceived: currentVan['Signed Plans Received'] || ''
        };

        // Write to Realtime Database
        const reallocationRef = ref(database, `reallocation/${chassis}`);
        const newRequestRef = push(reallocationRef);
        await set(newRequestRef, reallocationData);

        // Queue email in Firestore
        await addDoc(collection(firestoreDB, "reallocation_mail"), {
          to: ["darin@regentrv.com.au", "planning@regentrv.com.au", "marg@regentrv.com.au","karena@regentrv.com.au"],
          message: {
            subject: `New Reallocation Request: Chassis ${chassis}`,
            text: `Chassis number ${chassis} has been requested for dealer ${dealer}.`,
            html: `Chassis number <strong>${chassis}</strong> has been reallocated from dealer <strong>${dealerOri}</strong> to dealer <strong>${dealer}</strong>.`,
          },
        });

        console.log(`Reallocation and email queued for chassis ${chassis}`);
      });

      await Promise.all(promises);

      setGlobalMessage(`Successfully submitted ${validRows.length} reallocation request(s)!`);

      // Reset rows
      setReallocationRows([{
        id: 1,
        chassisNumber: '',
        currentVanInfo: null,
        selectedDealer: '',
        message: '',
        historyInfo: null,
        transportCompany: ''
      }]);

      // Reload requests
      await loadReallocationRequests();

    } catch (error) {
      console.error('❌ Error submitting reallocation requests:', error);
      setGlobalMessage('Error submitting requests. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDone = async (chassisNumber, requestId) => {
    try {
      const reallocationRef = ref(database, `reallocation/${chassisNumber}/${requestId}/status`);
      await set(reallocationRef, 'completed');

      // Reload requests
      await loadReallocationRequests();

      setGlobalMessage('Reallocation marked as completed');

    } catch (error) {
      console.error('❌ Error marking reallocation as done:', error);
      setGlobalMessage('Error updating status. Please try again.');
    }
  };


  const handleIssueUpdate = async (chassisNumber, issueType, requestId) => {
    try {

      const issueRef = ref(database, `reallocation/${chassisNumber}/${requestId}/issue`);

      await set(issueRef, {
        type: issueType,
        timestamp: getMelbourneTime()
      });

      // Queue completion email in Firestore
      await addDoc(collection(firestoreDB, "reallocation_mail"), {
        to: ["planning@regentrv.com.au","Ryan.Hogan@regentrv.com.au", "accounts.receivable@regentrv.com.au", "michaele@regentrv.com.au","karena@regentrv.com.au"],
        message: {
          subject: `New Issue: Chassis ${chassisNumber}`,
          html: `Chassis number <strong>${chassisNumber}</strong> has been marked as <strong>${issueType}</strong>.`,
        },
      });

      console.log(`✅ Queued completion email for chassis ${chassisNumber}`);
      
      await loadReallocationRequests();
      setGlobalMessage(`Issue "${issueType}" recorded for ${chassisNumber}`);
    } catch (error) {
      console.error('Error updating issue:', error);
      setGlobalMessage('Error recording issue. Please try again.');
    }
  };

  const canSubmitRow = (row) => {
    if (!row.currentVanInfo || !row.selectedDealer) return false;
    
    const status = row.currentVanInfo['Regent Production'] || '';
    const signedPlansReceived = row.currentVanInfo['Signed Plans Received'] || '';
    
    if (row.transportCompany) return false;

    // Can't submit if status is finished
    if (status.toLowerCase() === 'finished') return false;
    
    // Can't submit if signed plans received is "No"
    if (signedPlansReceived.toLowerCase() === 'no') return false;
    
    return true;
  };

  const getRowStatus = (row) => {
    if (row.transportCompany) {
      return 'This caravan already has a transport company assigned. Please contact the transporting manager to adjust freight.';
    }

    if (!row.currentVanInfo) return '';
    
    const status = row.currentVanInfo['Regent Production'] || '';
    const signedPlansReceived = row.currentVanInfo['Signed Plans Received'] || '';
    
    if (status.toLowerCase() === 'finished') {
      return 'The van was dispatched - cannot reallocate';
    }
    
    if (signedPlansReceived.toLowerCase() === 'no') {
      return 'Cannot submit - van is not signed';
    }
    
    return '';
  };

  const canSubmitAnyRow = () => {
    return reallocationRows.some(row => canSubmitRow(row));
  };

  const filteredRequests = reallocationRequests.filter(request => {
    if (showFilter === 'pending') return request.status !== 'completed';
    if (showFilter === 'done') return request.status === 'completed';
    return true; // 'all'
  });

  const downloadCSV = () => {
    const headers = ['Chassis', 'From Dealer', 'To Dealer', 'Van Status', 'Signed Plans', 'Submit Time', 'Request Status', 'Issue Type', 'Issue Time'];
    const csvData = [
      headers,
      ...filteredRequests.map(request => [
        request.chassisNumber,
        request.originalDealer,
        request.reallocatedTo,
        request.status === 'completed' ? 'Done' : request.status,
        request.signedPlansReceived || 'N/A',
        request.submitTime,
        request.status === 'completed' ? 'Completed' : 'Pending',
        request.issue?.type || 'None',
        request.issue?.timestamp || 'N/A'
      ])
    ];
    
    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `reallocation_requests_${showFilter}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800">Dealer Reallocation</h2>
      
      {/* Statistics Section - Compact */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-4 items-center mb-4">
          <div className="bg-blue-50 px-4 py-2 rounded-lg">
            <div className="text-lg font-bold text-blue-600">{stats.totalPending}</div>
            <div className="text-xs text-gray-600">Pending</div>
          </div>
          <div className="bg-green-50 px-4 py-2 rounded-lg">
            <div className="text-lg font-bold text-green-600">{stats.totalDone}</div>
            <div className="text-xs text-gray-600">Done</div>
          </div>
        </div>
        
        {/* Dealer Bar Chart */}
        {/* Dealer Bar Chart */}
        {topDealerEntries.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Dealer Movements</h4>
            <div className="flex flex-wrap gap-4">
              {topDealerEntries.map(({ dealer, counts }) => (
                <div key={dealer} className="flex flex-col items-center bg-slate-50 rounded-lg px-3 py-2 shadow-inner border border-slate-200">
                  <div className="text-xs font-medium text-gray-700 mb-2 max-w-[80px] truncate" title={dealer}>
                    {dealer}
                  </div>
                  <div className="flex items-end justify-center gap-2 h-24">
                    {/* Negative bar (moved from) */}
                    <div className="flex flex-col items-center">
                      <div
                        className="bg-red-400 w-4 rounded-t"
                        style={{ height: `${getBarHeight(counts.moved_from)}px` }}
                      ></div>
                      <div className="text-xs text-red-600 mt-1">-{counts.moved_from}</div>
                    </div>
                    {/* Positive bar (moved to) */}
                    <div className="flex flex-col items-center">
                      <div
                        className="bg-green-400 w-4 rounded-t"
                        style={{ height: `${getBarHeight(counts.moved_to)}px` }}
                      ></div>
                      <div className="text-xs text-green-600 mt-1">+{counts.moved_to}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reallocation Form */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-700">Submit Reallocation Request</h3>
          <button
            onClick={addRow}
            className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1"
          >
            <span className="text-lg">+</span> Add Row
          </button>
        </div>
        
        <div className="space-y-3">
          {reallocationRows.map((row, index) => (
            <div key={row.id} className="border rounded-lg p-3 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-start">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Chassis Number
                  </label>
                  <input
                    type="text"
                    value={row.chassisNumber}
                    onChange={(e) => {
                      void handleChassisNumberChange(row.id, e.target.value);
                    }}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Enter chassis"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Current Dealer
                  </label>
                  <div className="text-sm text-gray-800 py-1 px-2 bg-white rounded border min-h-[28px] flex items-center">
                    {row.currentVanInfo?.Dealer || '-'}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Model
                  </label>
                  <div className="text-sm text-gray-800 py-1 px-2 bg-white rounded border min-h-[28px] flex items-center">
                    {row.currentVanInfo?.Model || '-'}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Status
                  </label>
                  <div className="text-sm text-gray-800 py-1 px-2 bg-white rounded border min-h-[28px] flex items-center">
                    {row.currentVanInfo?.['Regent Production'] || '-'}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    New Dealer
                  </label>
                  <select
                    value={row.selectedDealer}
                    onChange={(e) => handleDealerChange(row.id, e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    disabled={!row.currentVanInfo}
                  >
                    <option value="">Select...</option>
                    {allDealers
                      .filter(dealer => dealer !== row.currentVanInfo?.Dealer)
                      .map(dealer => (
                        <option key={dealer} value={dealer}>{dealer}</option>
                      ))}
                  </select>
                </div>

                <div className="flex items-end">
                  {reallocationRows.length > 1 && (
                    <button
                      onClick={() => removeRow(row.id)}
                      className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-sm"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Row Messages */}
                {row.message && (
                  <div className={`mt-2 text-xs ${
                    row.message.includes('Error') || row.message.includes('not found')
                      ? 'text-red-600'
                      : row.message.includes("isn't signed")
                      ? 'text-orange-600 font-medium'
                      : 'text-green-600'
                  }`}>
                    {row.message}
                  </div>
                )}

                {row.historyInfo && (
                  <div className="mt-2 flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-md px-3 py-2 shadow-inner">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-semibold shadow">
                      ×{row.historyInfo.count}
                    </div>
                    <div className="text-xs text-blue-900 space-y-0.5">
                      <div className="font-semibold">Previously reallocated {row.historyInfo.count} {row.historyInfo.count === 1 ? 'time' : 'times'}</div>
                      <div className="text-[11px] text-blue-800/80">Last to <span className="font-semibold">{row.historyInfo.lastDealer}</span> on {row.historyInfo.lastSubmitTime}</div>
                    </div>
                  </div>
                )}

              {getRowStatus(row) && (
                <div className={`mt-2 text-xs ${
                  getRowStatus(row).includes('Cannot') ||
                  getRowStatus(row).includes('dispatched') ||
                  getRowStatus(row).includes('transport company')
                    ? 'text-red-600 font-medium'
                    : 'text-gray-500'
                }`}>
                  {getRowStatus(row)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Submit Button */}
        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={handleSubmit}
            disabled={loading || !canSubmitAnyRow()}
            className={`px-6 py-2 rounded-md font-medium ${
              !loading && canSubmitAnyRow()
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-400 text-gray-200 cursor-not-allowed'
            }`}
          >

            {loading ? 'Submitting...' : 'Submit All Requests'}
          </button>
          
          {globalMessage && (
            <div className={`text-sm ${
              globalMessage.includes('Error') 
                ? 'text-red-600' 
                : 'text-green-600'
            }`}>
              {globalMessage}
            </div>
          )}
        </div>
      </div>

{/* ===== Charts Section ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Pie: Prefix percentage within Snowy Stock & not finished */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-semibold">Active Vans by Model (Snowy Stock)</h3>
            <div className="text-sm text-gray-500">Total: {totalSnowy}</div>
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={prefixPieData} dataKey="value" nameKey="name" outerRadius={80} label={({ percent, value }) => (percent > 0.1 ? `${value}` : "")}>
                  {prefixPieData.map((entry, index) => (<Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />))}
                </Pie>
                <Tooltip formatter={(v) => [String(v), "Count"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Line: last 10 weeks trend by prefix */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-base font-semibold">Reallocation Trend (Last 10 Weeks)</h3>
            <button
              onClick={() => setTrendFilter(trendFilter === 'snowy' ? 'all' : 'snowy')}
              className={`px-3 py-1 rounded text-sm ${
                trendFilter === 'snowy'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {trendFilter === 'snowy' ? 'Showing Snowy Stock' : 'Show Snowy Stock Only'}
            </button>
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {trendSeriesKeys.map((key, idx) => (
                  <Line key={key} type="monotone" dataKey={key} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {trendFilter === 'snowy'
              ? 'Displaying reallocation requests originating from Snowy Stock only. Top 6 models shown; others are grouped as OTHER.'
              : 'Top 6 models shown; others are grouped as OTHER.'}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-700">Reallocation Requests</h3>
          <div className="flex gap-2">
            <button
              onClick={downloadCSV}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1"
            >
              📥 Download CSV
            </button>
            <button
              onClick={() => setShowFilter('all')}
              className={`px-3 py-1 rounded text-sm ${
                showFilter === 'all' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All ({reallocationRequests.length})
            </button>
            <button
              onClick={() => setShowFilter('pending')}
              className={`px-3 py-1 rounded text-sm ${
                showFilter === 'pending' 
                  ? 'bg-orange-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Pending ({stats.totalPending})
            </button>
            <button
              onClick={() => setShowFilter('done')}
              className={`px-3 py-1 rounded text-sm ${
                showFilter === 'done' 
                  ? 'bg-green-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Done ({stats.totalDone})
            </button>
          </div>
        </div>
        
        {filteredRequests.length === 0 ? (
          <div className="text-center text-gray-500 py-4">
            No {showFilter === 'all' ? '' : showFilter} reallocation requests
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Chassis
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    From
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    To
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Signed Plans
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Submit Time
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Issue
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredRequests.map((request, index) => {
                  const chassisCount = chassisRequestCounts[(request.chassisNumber || '').toLowerCase()] || 0;
                  const rowBgColor = 'white';
                  return (
                    <tr key={index} style={{ backgroundColor: rowBgColor }}>
                      <td className="px-4 py-2 text-sm text-black font-bold">
                        <div className="flex items-center gap-2">
                          <span>{request.chassisNumber}</span>
                          {chassisCount > 1 && (
                            <span
                              className={getRepetitionBadgeClass(chassisCount)}
                              title={`Submitted ${chassisCount} ${chassisCount === 1 ? 'time' : 'times'} in total`}
                            >
                              ×{chassisCount}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {request.originalDealer}
                      </td>
                      <td className="px-4 py-2 text-sm text-black font-bold">
                        {request.reallocatedTo}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          request.status === 'completed' 
                            ? 'bg-green-100 text-green-800'
                            : request.status === 'finished'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {request.status === 'completed' ? 'Done' : request.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">{request.signedPlansReceived || 'N/A'}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">{request.submitTime}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {request.issue ? (
                          <div className="text-xs">
                            <div className={`px-2 py-1 rounded text-white text-center ${
                              request.issue.type === 'SAP Issue' ? 'bg-red-500' :
                              request.issue.type === 'Invoice Issue' ? 'bg-orange-500' :
                              request.issue.type === 'Dispatched Status Issue' ? 'bg-blue-500' : 'bg-gray-500'
                            }`}>
                              {request.issue.type}
                            </div>
                            <div className="text-gray-400 mt-1">{request.issue.timestamp}</div>
                          </div>
                        ) : (
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                handleIssueUpdate(request.chassisNumber, e.target.value, request.id);
                                e.target.value = '';
                              }
                            }}
                            className="text-xs border border-gray-300 rounded px-1 py-1"
                          >
                            <option value="">Select Issue</option>
                            <option value="SAP Issue">SAP Issue</option>
                            <option value="Invoice Issue">Invoice Issue</option>
                            <option value="Dispatched Status Issue">Dispatched Status Issue</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {request.status !== 'completed' ? (
                          <button
                            onClick={() => handleMarkDone(request.chassisNumber, request.id)}
                            className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs font-medium"
                          >
                            Done
                          </button>
                        ) : (
                          <span className="text-green-600 text-xs font-medium">✓ Completed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reallocation;
