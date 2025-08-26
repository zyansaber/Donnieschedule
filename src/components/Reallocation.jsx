import React, { useState, useEffect } from 'react';
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
    message: '' 
  }]);
  const [allDealers, setAllDealers] = useState([]);
  const [reallocationRequests, setReallocationRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [stats, setStats] = useState({ totalPending: 0, totalDone: 0, dealerStats: {} });
  const [showFilter, setShowFilter] = useState('all'); // 'all', 'pending', 'done'


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
        const requestsList = Object.entries(requestsData).map(([chassis, data]) => ({
          chassisNumber: chassis,
          ...data
        }));
        setReallocationRequests(requestsList);
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

  const handleChassisNumberChange = (rowId, chassis) => {
    const newRows = reallocationRows.map(row => {
      if (row.id === rowId) {
        if (chassis) {
          // Find van information from data
          const vanInfo = data.find(item => 
            item.Chassis && item.Chassis.toLowerCase() === chassis.toLowerCase()
          );
          
          if (vanInfo) {
            const signedPlansReceived = vanInfo['Signed Plans Received'] || '';
            let message = '';
            
            if (signedPlansReceived.toLowerCase() === 'no') {
              message = "⚠️ The van isn't signed, please sign off or cancel to reorder";
            }
            
            return {
              ...row,
              chassisNumber: chassis,
              currentVanInfo: vanInfo,
              selectedDealer: '',
              message
            };
          } else {
            return {
              ...row,
              chassisNumber: chassis,
              currentVanInfo: null,
              selectedDealer: '',
              message: 'Chassis number not found'
            };
          }
        } else {
          return {
            ...row,
            chassisNumber: chassis,
            currentVanInfo: null,
            selectedDealer: '',
            message: ''
          };
        }
      }
      return row;
    });
    setReallocationRows(newRows);
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
      message: '' 
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
        const chassis = row.chassisNumber || 'Unknown';
        const dealer = row.selectedDealer || 'Unknown';
        const currentVan = row.currentVanInfo || {};

        // Realtime DB data
        const reallocationData = {
          status: currentVan['Regent Production'] || 'Unknown',
          originalDealer: currentVan.Dealer || 'Unknown',
          reallocatedTo: dealer,
          submitTime: getMelbourneTime(),
          model: currentVan.Model || '',
          customer: currentVan.Customer || '',
          signedPlansReceived: currentVan['Signed Plans Received'] || ''
        };

        // Write to Realtime Database
        const reallocationRef = ref(database, `reallocation/${chassis}`);
        await set(reallocationRef, reallocationData);
        console.log("11111")

        // Queue email in Firestore
        await addDoc(collection(firestoreDB, "reallocation_mail"), {
          to: ["dongning@regentrv.com.au", "planning@regentrv.com.au"],
          message: {
            subject: `New Reallocation Request: Chassis ${chassis}`,
            text: `Chassis number ${chassis} has been requested to dealer ${dealer}.`,
            html: `Chassis number <strong>${chassis}</strong> has been requested to dealer <strong>${dealer}</strong>.`,
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
        message: ''
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

  const handleMarkDone = async (chassisNumber, selectedDealer) => {
    try {
      const reallocationRef = ref(database, `reallocation/${chassis}/status`);
      await set(reallocationRef, 'completed');

      // Reload requests
      await loadReallocationRequests();

      setGlobalMessage('Reallocation marked as completed');

    } catch (error) {
      console.error('❌ Error marking reallocation as done:', error);
      setGlobalMessage('Error updating status. Please try again.');
    }
  };


  const handleIssueUpdate = async (chassisNumber, issueType) => {
    try {

      const issueRef = ref(database, `reallocation/${chassisNumber}/issue`);

      await set(issueRef, {
        type: issueType,
        timestamp: getMelbourneTime()
      });

      // Queue completion email in Firestore
      await addDoc(collection(firestoreDB, "reallocation_mail"), {
        to: ["dongning@regentrv.com.au", "planning@regentrv.com.au"],
        message: {
          subject: `Chassis ${chassis} New Issue`,
          html: `Chassis number <strong>${chassisNumber}</strong> has been marked as <strong>${issueType}</strong>.`,
        },
      });

      console.log(`✅ Queued completion email for chassis ${chassis}`);
      
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
    
    // Can't submit if status is finished
    if (status.toLowerCase() === 'finished') return false;
    
    // Can't submit if signed plans received is "No"
    if (signedPlansReceived.toLowerCase() === 'no') return false;
    
    return true;
  };

  const getRowStatus = (row) => {
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
        {Object.keys(stats.dealerStats).length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Dealer Movements</h4>
            <div className="flex flex-wrap gap-4">
              {Object.entries(stats.dealerStats).slice(0, 8).map(([dealer, counts]) => (
                <div key={dealer} className="flex flex-col items-center">
                  <div className="text-xs font-medium text-gray-700 mb-2 max-w-[60px] truncate" title={dealer}>
                    {dealer}
                  </div>
                  <div className="flex items-end h-20">
                    {/* Negative bar (moved from) */}
                    <div className="flex flex-col items-center mr-1">
                      <div 
                        className="bg-red-400 w-4 rounded-t"
                        style={{ height: `${Math.max(counts.moved_from * 8, 4)}px` }}
                      ></div>
                      <div className="text-xs text-red-600 mt-1">-{counts.moved_from}</div>
                    </div>
                    {/* Positive bar (moved to) */}
                    <div className="flex flex-col items-center ml-1">
                      <div 
                        className="bg-green-400 w-4 rounded-t"
                        style={{ height: `${Math.max(counts.moved_to * 8, 4)}px` }}
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
                    onChange={(e) => handleChassisNumberChange(row.id, e.target.value.trim())}
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

              {getRowStatus(row) && (
                <div className={`mt-2 text-xs ${
                  getRowStatus(row).includes('Cannot') || getRowStatus(row).includes('dispatched')
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

      {/* Reallocation Requests List */}
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
                {filteredRequests.map((request, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">
                      {request.chassisNumber}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      {request.originalDealer}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">
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
                    <td className="px-4 py-2 text-sm text-gray-500">
                      <span className={`px-2 py-1 text-xs rounded ${
                        (request.signedPlansReceived || '').toLowerCase() === 'no'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {request.signedPlansReceived || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      {request.submitTime}
                    </td>
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
                              handleIssueUpdate(request.chassisNumber, e.target.value);
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
                      {request.status !== 'completed' && (
                        <button
                          onClick={() => handleMarkDone(request.chassisNumber)}
                          className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs font-medium"
                        >
                          Done
                        </button>
                      )}
                      {request.status === 'completed' && (
                        <span className="text-green-600 text-xs font-medium">✓ Completed</span>
                      )}
                    </td>
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

export default Reallocation;
