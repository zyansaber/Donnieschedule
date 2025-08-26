import React, { useState, useEffect } from 'react';
import { fetchDateTrackData } from '../data/scheduleData';

const UnfinishedVanTracking = () => {
  const [dateTrackData, setDateTrackData] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    dealer: '',
    model: '',
    status: '',
    chassisNumber: '',
    customerType: '',
    overdueFilter: '',
    potentialOverdue: false
  });
  const [sortByDays, setSortByDays] = useState(false);
  const [expandedChassis, setExpandedChassis] = useState(new Set());

  useEffect(() => {
    const loadDateTrackData = async () => {
      try {
        const data = await fetchDateTrackData();
        console.log('Date track data loaded:', data);
        setDateTrackData(data || {});
      } catch (error) {
        console.error("Error loading date track data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadDateTrackData();
  }, []);

  // Convert DD/MM/YYYY to Date object
  const parseDate = (dateString) => {
    if (!dateString) return null;
    const parts = dateString.split('/');
    if (parts.length === 3) {
      return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    // Handle YYYY-MM-DD format as well
    if (dateString.includes('-')) {
      return new Date(dateString);
    }
    return null;
  };

  // Calculate days between two dates
  const calculateDays = (startDate, endDate) => {
    if (!startDate || !endDate) return 0;
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) return 0;
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Get progress data for a chassis
  const getProgressData = (chassisData) => {
    const stages = [
      { 
        key: 'Purchasing Order', 
        label: 'Purchase Order', 
        color: '#4f46e5',
        standardDays: 0,
        showDuration: false
      },
      { 
        key: 'Left Port', 
        label: 'Longtree Production', 
        color: '#059669',
        standardDays: 70,
        showDuration: true
      },
      { 
        key: 'Received in Melbourne', 
        label: 'Sea Freight Duration', 
        color: '#0891b2',
        standardDays: 27,
        showDuration: true
      },
      { 
        key: 'Dispatched from Factory', 
        label: 'Melbourne Factory', 
        color: '#dc2626',
        standardDays: 40,
        showDuration: true
      }
    ];

    const today = new Date();
    const progress = [];
    const startDate = chassisData['Purchasing Order']; // First stage date
    
    // Calculate total days from first stage to today
    const totalDaysFromStart = startDate ? calculateDays(startDate, today.toISOString().split('T')[0]) : 0;
    const totalStandardDays = 140; // 70 + 27 + 40
    const isTotalOverdue = totalDaysFromStart > totalStandardDays;
    const totalOverdueDays = isTotalOverdue ? totalDaysFromStart - totalStandardDays : 0;

    // Find available stages and merge missing ones
    let currentStartDate = chassisData['Purchasing Order'];
    let accumulatedStandard = 0;
    
    for (let i = 1; i < stages.length; i++) {
      const stage = stages[i];
      const stageDate = chassisData[stage.key];
      
      if (currentStartDate) {
        accumulatedStandard += stage.standardDays;
        
        if (stageDate || i === stages.length - 1) {
          // This stage has data or is the last stage
          const endDate = stageDate || today.toISOString().split('T')[0];
          const actualDays = calculateDays(currentStartDate, endDate);
          const isOverdue = actualDays > accumulatedStandard;
          
          // Determine label for merged stages
          let stageLabel = stage.label;
          if (accumulatedStandard > stage.standardDays) {
            // Multiple stages merged
            const startIndex = stages.findIndex(s => s.standardDays > 0 && 
              accumulatedStandard >= s.standardDays);
            if (startIndex > 0 && startIndex !== i) {
              stageLabel = `${stages[startIndex].label} → ${stage.label}`;
            }
          }
          
          progress.push({
            ...stage,
            label: stageLabel,
            startDate: currentStartDate,
            endDate: stageDate,
            days: actualDays,
            standardDays: accumulatedStandard,
            completed: !!stageDate,
            isCurrent: !stageDate,
            isOverdue: isOverdue,
            overdueDays: isOverdue ? actualDays - accumulatedStandard : 0
          });
          
          // Reset for next stage group
          currentStartDate = stageDate;
          accumulatedStandard = 0;
        }
      } else {
        // Previous stage not available, show as not started
        progress.push({
          ...stage,
          startDate: null,
          endDate: null,
          days: 0,
          completed: false,
          isCurrent: false,
          isOverdue: false,
          overdueDays: 0
        });
      }
    }

    return {
      stages: progress,
      totalDays: totalDaysFromStart,
      totalStandardDays: totalStandardDays,
      isTotalOverdue: isTotalOverdue,
      totalOverdueDays: totalOverdueDays
    };
  };

  // Filter and sort data
  const getFilteredData = () => {
    let filtered = Object.entries(dateTrackData).filter(([chassisNum, data]) => {
      const dealerMatch = !filters.dealer || (data.Dealer && data.Dealer.toLowerCase().includes(filters.dealer.toLowerCase()));
      const modelMatch = !filters.model || (data.Model && data.Model.substring(0, 3).toLowerCase().includes(filters.model.toLowerCase()));
      const statusMatch = !filters.status || (data.Status && data.Status.toLowerCase().includes(filters.status.toLowerCase()));
      const chassisMatch = !filters.chassisNumber || chassisNum.toLowerCase().includes(filters.chassisNumber.toLowerCase());
      
      // Customer type filter
      const customerTypeMatch = !filters.customerType || (() => {
        const customer = data.Customer || '';
        const isStock = customer.slice(-5).toLowerCase() === 'stock';
        if (filters.customerType === 'stock') return isStock;
        if (filters.customerType === 'customer') return !isStock;
        return true;
      })();
      
      // Overdue filter
      const overdueMatch = !filters.overdueFilter || (() => {
        const progressResult = getProgressData(data);
        const isOverdue = progressResult.isTotalOverdue;
        const potentialOverdue = progressResult.stages.some(stage => stage.isOverdue);
        if (filters.overdueFilter === 'overdue') return isOverdue;
        if (filters.overdueFilter === 'potential-overdue') return potentialOverdue && !isOverdue;
        if (filters.overdueFilter === 'not-overdue') return !isOverdue && !potentialOverdue;
        return true;
      })();
      
      return dealerMatch && modelMatch && statusMatch && chassisMatch && customerTypeMatch && overdueMatch;
    });

    // Sort by total days if enabled
    if (sortByDays) {
      filtered = filtered.sort(([, dataA], [, dataB]) => {
        const progressA = getProgressData(dataA);
        const progressB = getProgressData(dataB);
        return progressB.totalDays - progressA.totalDays; // Descending order
      });
    }

    return filtered;
  };

  // Get unique values for filter options
  const getUniqueValues = (field) => {
    const values = new Set();
    Object.values(dateTrackData).forEach(data => {
      if (data[field]) {
        if (field === 'Model') {
          values.add(data[field].substring(0, 3));
        } else {
          values.add(data[field]);
        }
      }
    });
    return Array.from(values).sort();
  };

  const filteredData = getFilteredData();

  const toggleExpanded = (chassisNum) => {
    setExpandedChassis(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chassisNum)) {
        newSet.delete(chassisNum);
      } else {
        newSet.add(chassisNum);
      }
      return newSet;
    });
  };

  // Download CSV function
  const downloadCSV = () => {
    const csvData = filteredData.map(([chassisNum, data]) => {
      const progressResult = getProgressData(data);
      return {
        'Chassis Number': chassisNum,
        'Dealer': data.Dealer || '',
        'Status': data.Status || '',
        'Overdue Days': progressResult.isTotalOverdue ? progressResult.totalOverdueDays : 0
      };
    });

    const headers = ['Chassis Number', 'Dealer', 'Status', 'Overdue Days'];
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => headers.map(header => `"${row[header]}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `van_tracking_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Calculate statistics for different prefixes
  const getStatistics = () => {
    const prefixes = ['NGB', 'NGC', 'SRC', 'SRT', 'SRH', 'SRP', 'SRL'];
    const stats = {};
    
    prefixes.forEach(prefix => {
      const prefixData = Object.entries(dateTrackData).filter(([chassisNum]) => 
        chassisNum.startsWith(prefix)
      );
      
      if (prefixData.length > 0) {
        const progressResults = prefixData.map(([, data]) => getProgressData(data));
        const overdueCount = progressResults.filter(result => result.isTotalOverdue).length;
        
        stats[prefix] = {
          count: prefixData.length,
          overdueCount,
          overduePercentage: Math.round((overdueCount / prefixData.length) * 100)
        };
      }
    });
    
    return stats;
  };

  const statistics = getStatistics();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg">
          <div className="text-xl text-blue-800 font-semibold">Loading van tracking data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Statistics Cards */}
        {Object.keys(statistics).length > 0 && (
          <div className="mb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {Object.entries(statistics).map(([prefix, stats]) => (
                <button
                  key={prefix}
                  onClick={() => setFilters({...filters, model: prefix})}
                  className={`bg-white rounded-lg shadow-md p-3 text-center hover:shadow-lg transition-all duration-200 hover:scale-105 ${
                    filters.model === prefix ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                  }`}
                  title={`Click to filter by ${prefix} models`}
                >
                  <div className="text-sm font-bold text-blue-900">{prefix}</div>
                  <div className="text-xs text-gray-600">{stats.count} vans</div>
                  <div className={`text-sm font-semibold ${stats.overdueCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {stats.overdueCount} overdue
                  </div>
                  <div className={`text-xs ${stats.overdueCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {stats.overduePercentage}%
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filters and Controls */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-blue-900">Filters & Controls</h2>
            <div className="flex gap-2">
              <button
                onClick={downloadCSV}
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
              >
                📥 Download CSV
              </button>
              <button
                onClick={() => setSortByDays(!sortByDays)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  sortByDays 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {sortByDays ? '📅 Sorted by Days' : '📅 Sort by Days (Desc)'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-2">Chassis Number</label>
              <input
                type="text"
                value={filters.chassisNumber}
                onChange={(e) => setFilters({...filters, chassisNumber: e.target.value})}
                placeholder="Search chassis number..."
                className="w-full p-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-2">Dealer</label>
              <select
                value={filters.dealer}
                onChange={(e) => setFilters({...filters, dealer: e.target.value})}
                className="w-full p-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Dealers</option>
                {getUniqueValues('Dealer').map(dealer => (
                  <option key={dealer} value={dealer}>{dealer}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-2">Model (First 3 letters)</label>
              <select
                value={filters.model}
                onChange={(e) => setFilters({...filters, model: e.target.value})}
                className="w-full p-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Models</option>
                {getUniqueValues('Model').map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-2">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({...filters, status: e.target.value})}
                className="w-full p-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Statuses</option>
                {getUniqueValues('Status').map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-2">Customer Type</label>
              <select
                value={filters.customerType}
                onChange={(e) => setFilters({...filters, customerType: e.target.value})}
                className="w-full p-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Types</option>
                <option value="stock">Stock</option>
                <option value="customer">Customer</option>
              </select>
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-blue-800 mb-2">
                <span className="bg-yellow-100 px-2 py-1 rounded text-yellow-800 font-semibold">
                  ⚡ Overdue Status
                </span>
              </label>
              <select
                value={filters.overdueFilter}
                onChange={(e) => setFilters({...filters, overdueFilter: e.target.value})}
                className={`w-full p-2 border-2 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 ${
                  filters.overdueFilter ? 'border-yellow-400 bg-yellow-50' : 'border-blue-300'
                }`}
              >
                <option value="">All Status</option>
                <option value="overdue">🚨 Overdue Only</option>
                <option value="potential-overdue">⚠️ Potential Overdue</option>
                <option value="not-overdue">✅ Not Overdue</option>
              </select>
              {filters.overdueFilter && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-pulse"></div>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-between items-center text-sm">
            <div className="text-blue-600">
              Showing {filteredData.length} of {Object.keys(dateTrackData).length} vans
              {sortByDays && <span className=" ml-2 text-green-600">(sorted by total days)</span>}
            </div>
            <div className="flex items-center space-x-4 text-xs">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded mr-1"></div>
                <span>Standard Duration</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-red-500 rounded mr-1"></div>
                <span>Overdue</span>
              </div>
            </div>
          </div>
        </div>

        {/* Van Progress Cards */}
        <div className="space-y-3">
          {filteredData.length === 0 ? (
            <div className="bg-white rounded-lg shadow-lg p-8 text-center">
              <div className="text-blue-600 text-lg">No vans match the selected filters</div>
            </div>
          ) : (
            filteredData.map(([chassisNum, chassisData]) => {
              const progressResult = getProgressData(chassisData);
              const { stages: progressData, totalDays, totalStandardDays, isTotalOverdue, totalOverdueDays } = progressResult;
              const isExpanded = expandedChassis.has(chassisNum);

              return (
                <div key={chassisNum} className="bg-white rounded-lg shadow-md p-4">
                  {/* Compact Chassis Info Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleExpanded(chassisNum)}
                        className="mr-3 p-1 hover:bg-gray-100 rounded transition-colors"
                        title={isExpanded ? "Collapse details" : "Expand details"}
                      >
                        {isExpanded ? (
                          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-4 mb-1">
                          <h3 className="text-lg font-bold text-blue-900">{chassisNum}</h3>
                          {chassisData.Customer && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              Customer: {chassisData.Customer}
                            </span>
                          )}
                          {chassisData['Special Request Date'] && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                              Special Request: {chassisData['Special Request Date']}
                            </span>
                          )}
                          {chassisData['Request Delivery Date'] && (
                            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                              Request: {chassisData['Request Delivery Date']}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-blue-600">
                          {chassisData.Model && <span className="mr-3">Model: {chassisData.Model}</span>}
                          {chassisData.Dealer && <span className="mr-3">Dealer: {chassisData.Dealer}</span>}
                          {chassisData.Status && <span>Status: {chassisData.Status}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-blue-600">
                      <span className={`${isTotalOverdue ? 'text-red-600 font-semibold' : ''}`}>
                        Total: {totalDays} days
                        {isTotalOverdue && <span className="text-red-500"> (+{totalOverdueDays})</span>}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar - Always Visible */}
                  <div className="mb-3">
                    <div className="relative">
                      <div className="grid grid-cols-3 h-6 bg-gray-200 rounded-full overflow-hidden">
                        {progressData.map((stage, index) => {
                          if (stage.days === 0) return null;
                          
                          return (
                            <div
                              key={index}
                              className={`flex items-center justify-center text-xs font-medium text-white transition-all duration-300 ${
                                stage.completed 
                                  ? '' 
                                  : stage.isCurrent
                                  ? 'animate-pulse'
                                  : 'opacity-50'
                              } ${stage.isOverdue ? 'border-t-2 border-red-500' : ''}`}
                              style={{ 
                                backgroundColor: stage.color
                              }}
                              title={`${stage.label}: ${stage.days} days (Standard: ${stage.standardDays}) ${stage.isOverdue ? '- OVERDUE' : ''}`}
                            >
                              <span className="px-1 text-xs font-bold">{stage.days}d</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Expandable Stage Details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {progressData.map((stage, index) => (
                          <div
                            key={index}
                            className={`p-3 rounded-lg border transition-all duration-200`}
                            style={{
                              backgroundColor: `${stage.color}15`,
                              borderColor: stage.color
                            }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center">
                                <div
                                  className="w-3 h-3 rounded-full mr-2"
                                  style={{ backgroundColor: stage.color }}
                                />
                                <span className="text-sm font-medium text-gray-800">
                                  {stage.label}
                                </span>
                              </div>
                              {stage.isOverdue && (
                                <span className="text-xs bg-red-500 text-white px-2 py-1 rounded">OVERDUE</span>
                              )}
                            </div>
                            
                            {stage.days > 0 && (
                              <>
                                <div className="text-xs text-gray-600 mb-1">
                                  Standard: {stage.standardDays} days
                                </div>
                                <div className={`text-xs font-semibold ${
                                  stage.isOverdue ? 'text-red-700' : 'text-gray-700'
                                }`}>
                                  Actual: {stage.days} days
                                  {stage.isOverdue && <span className="text-red-600"> (+{stage.overdueDays})</span>}
                                </div>
                                <div className="text-xs text-gray-600 mt-1">
                                  {stage.endDate ? `Completed: ${stage.endDate}` : 'In Progress'}
                                </div>
                              </>
                            )}
                            
                            {stage.days === 0 && (
                              <div className="text-xs text-gray-500">Not Started</div>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      {/* Additional Details when expanded */}
                      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            {chassisData.Customer && <div><strong>Customer:</strong> {chassisData.Customer}</div>}
                            {chassisData['Special Request Date'] && (
                              <div><strong>Special Request:</strong> {chassisData['Special Request Date']}</div>
                            )}
                          </div>
                          <div className="text-right">
                            <div><strong>Total Standard:</strong> {totalStandardDays} days</div>
                            <div className={`${isTotalOverdue ? 'text-red-600 font-semibold' : ''}`}>
                              <strong>Total Actual:</strong> {totalDays} days
                              {isTotalOverdue && <span className="text-red-500"> (+{totalOverdueDays} overdue)</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default UnfinishedVanTracking;