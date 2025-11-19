import React, { useState, useEffect } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchCalendarData } from '../data/scheduleData';

const StockLevelAnalysis = ({ data }) => {
  const [calendarData, setCalendarData] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCalendarData = async () => {
      try {
        const calendar = await fetchCalendarData();
        console.log('Calendar data loaded:', calendar);
        setCalendarData(calendar || {});
      } catch (error) {
        console.error("Error loading calendar data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadCalendarData();
  }, []);

  // Get today's date
  const today = new Date();

  // Filter calendar data to only show valid daily entries from today onwards (for stock trend)
  const getFilteredCalendarData = () => {
    if (!calendarData) return {};

    const filteredData = {};
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    Object.entries(calendarData).forEach(([dateStr, quantity]) => {
      const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);

      if (isFullDate && dateStr >= todayStr) {
        filteredData[dateStr] = quantity;
      }
    });

    return filteredData;
  };

  // Helper to parse DD/MM/YYYY strings to Date objects
  const parseScheduleDate = (dateString) => {
    if (!dateString) return null;

    const parts = dateString.split('/');
    if (parts.length !== 3) return null;

    const [day, month, year] = parts.map((value) => value.padStart(2, '0'));
    const parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  };

  // Safely read working day counts from the calendar dataset
  const getWorkingDaysForMonth = (monthKey) => {
    const monthEntry = calendarData?.[monthKey];

    if (typeof monthEntry === 'number') {
      return monthEntry;
    }

    if (monthEntry && typeof monthEntry === 'object') {
      return monthEntry.workingDays || monthEntry.workDays || 0;
    }

    return 0;
  };

  // Build production counts per month and per week directly from schedule data
  const getMonthlyProductionData = () => {
    if (!data || data.length === 0) return {};

    const monthlyData = {};

    data.forEach((item) => {
      const forecastDate = parseScheduleDate(item["Forecast Production Date"]);
      if (!forecastDate) return;

      const year = forecastDate.getFullYear();
      const month = String(forecastDate.getMonth() + 1).padStart(2, '0');
      const day = forecastDate.getDate();
      const monthKey = `${year}-${month}`;
      const monthName = new Date(year, forecastDate.getMonth(), 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
      });

      // Calculate week-of-month (1-based) to surface weekly production volume
      const monthStartDay = new Date(year, forecastDate.getMonth(), 1).getDay();
      const weekInMonth = Math.ceil((day + monthStartDay) / 7);

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          monthName,
          total: 0,
          workingDays: getWorkingDaysForMonth(monthKey),
          weeklyBreakdown: {}
        };
      }

      monthlyData[monthKey].total += 1;
      monthlyData[monthKey].weeklyBreakdown[weekInMonth] =
        (monthlyData[monthKey].weeklyBreakdown[weekInMonth] || 0) + 1;
    });

    return monthlyData;
  };

  // Calculate van arrived count (Production Stages = "Van Arrived")
  const getVanArrivedCount = () => {
    if (!data) return 0;
    return data.filter(item => 
      item["Regent Production"] && 
      item["Regent Production"].toLowerCase().includes("van arrived")
    ).length;
  };

  // Find the last estimate date for "van on the sea" items
  const getLastVanOnSeaEstimateDate = () => {
    if (!data) return today;
    
    let lastDate = today;
    
    data.forEach(item => {
      if (item["Regent Production"] && 
          item["Regent Production"].toLowerCase().includes("van on the sea") &&
          item["Estimate Semi Received Date"]) {
        
        // Convert DD/MM/YYYY to Date object
        const parts = item["Estimate Semi Received Date"].split('/');
        if (parts.length === 3) {
          const date = new Date(parts[2], parts[1] - 1, parts[0]);
          if (date > lastDate) {
            lastDate = date;
          }
        }
      }
    });
    
    return lastDate;
  };

  // Generate combined trend chart data with both stock levels and estimate arrivals
  const getCombinedChartData = () => {
    if (!data) return [];
    
    const filteredCalendar = getFilteredCalendarData();

    // Get estimate date data from actual schedule data
    const estimateDates = {};
    let maxEstimateDate = new Date(today);
    
    data.forEach(item => {
      if (item["Estimate Semi Received Date"]) {
        const dateString = item["Estimate Semi Received Date"].trim();
        // Handle DD/MM/YYYY format
        const parts = dateString.split('/');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          const year = parts[2];
          
          const dateStr = `${year}-${month}-${day}`;
          const estimateDate = new Date(year, month - 1, day);
          
          // Track the maximum estimate date for chart range
          if (estimateDate > maxEstimateDate) {
            maxEstimateDate = estimateDate;
          }
          
          if (!estimateDates[dateStr]) {
            estimateDates[dateStr] = 0;
          }
          estimateDates[dateStr]++;
        }
      }
    });
    
    // Chart shows today + 1 month only
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 1);
    
    console.log('Chart date range:', {
      today: today.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      calendarDataCount: Object.keys(filteredCalendar).length,
      estimateDatesCount: Object.keys(estimateDates).length
    });
    
    const chartData = [];
    let currentStock = getVanArrivedCount();
    const currentDate = new Date(today);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Subtract vans based on Calendar data for this specific date (daily reduction)
      if (filteredCalendar[dateStr]) {
        currentStock -= filteredCalendar[dateStr];
      }
      
      // Add vans based on Estimate Semi Received Date (arrivals increase stock)
      const vansReceived = estimateDates[dateStr] || 0;
      currentStock += vansReceived;
      
      // Ensure stock doesn't go below 0
      currentStock = Math.max(0, currentStock);
      
      chartData.push({
        date: dateStr,
        displayDate: currentDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: currentDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        }),
        semivanstock: currentStock,
        estimateArrivals: vansReceived // This will be 0 for dates without estimates
      });
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return chartData;
  };

  // Get Van on the sea status model ranges count
  const getVanOnSeaData = () => {
    if (!data) return [];
    
    const vanOnSeaItems = data.filter(item => 
      item["Regent Production"] && 
      item["Regent Production"].toLowerCase().includes("van on the sea")
    );
    
    const modelRanges = {};
    vanOnSeaItems.forEach(item => {
      if (item.Chassis) {
        const modelRange = item.Chassis.substring(0, 3);
        if (!modelRanges[modelRange]) {
          modelRanges[modelRange] = 0;
        }
        modelRanges[modelRange]++;
      }
    });
    
    return Object.entries(modelRanges).map(([range, count]) => ({
      modelRange: range,
      count: count
    }));
  };

  // Get estimate semi received dates for chart
  const getEstimateDateData = () => {
    if (!data) return [];
    
    const estimateDates = {};
    
    data.forEach(item => {
      if (item["Estimate Semi Received Date"]) {
        const parts = item["Estimate Semi Received Date"].split('/');
        if (parts.length === 3) {
          const dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          if (!estimateDates[dateStr]) {
            estimateDates[dateStr] = 0;
          }
          estimateDates[dateStr]++;
        }
      }
    });
    
    return Object.entries(estimateDates).map(([date, count]) => ({
      date,
      displayDate: new Date(date).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      }),
      count
    })).sort((a, b) => a.date.localeCompare(b.date));
  };

  const monthlyProductionData = getMonthlyProductionData();
  const combinedChartData = getCombinedChartData();
  const vanOnSeaData = getVanOnSeaData();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">Loading stock level analysis...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Stock Level Analysis</h1>
      
      {/* Monthly production by schedule, reconciled with calendar working days */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Monthly Production (Schedule vs Working Days)
        </h2>

        {Object.keys(monthlyProductionData).length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No production data available
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(monthlyProductionData)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([monthKey, monthData]) => (
                <div key={monthKey} className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-6 text-center">
                  <h3 className="text-lg font-semibold text-blue-800 mb-4">
                    {monthData.monthName}
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-sm text-gray-600">Monthly Total</div>
                      <div className="text-2xl font-bold text-blue-600">{monthData.total}</div>
                      <div className="text-xs text-gray-500">units</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-sm text-gray-600">Daily Average</div>
                      <div className="text-xl font-bold text-green-600">
                        {monthData.workingDays > 0 ? (monthData.total / monthData.workingDays).toFixed(1) : '0.0'}
                      </div>
                      <div className="text-xs text-gray-500">units per day</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-sm text-gray-600">Working Days (Calendar)</div>
                      <div className="text-lg font-bold text-purple-600">{monthData.workingDays || 0}</div>
                      <div className="text-xs text-gray-500">days available</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-left">
                      <div className="text-sm text-gray-600 mb-1">Weekly Breakdown</div>
                      <ul className="space-y-1">
                        {Object.entries(monthData.weeklyBreakdown)
                          .sort(([weekA], [weekB]) => Number(weekA) - Number(weekB))
                          .map(([week, count]) => (
                            <li key={week} className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">Week {week}</span>
                              <span className="font-semibold text-blue-700">{count}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Trend Chart */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Semi Van Stock Trend (Next 30 Days)
        </h2>
        <div className="mb-4">
          <div className="text-sm text-gray-600">
            Starting stock (Van Arrived): <span className="font-semibold text-blue-600">{getVanArrivedCount()}</span> units
          </div>
          <div className="text-sm text-gray-600">
            Chart period: <span className="font-semibold text-green-600">
              {today.toLocaleDateString('en-US')} - {(() => {
                const nextMonth = new Date(today);
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                return nextMonth.toLocaleDateString('en-US');
              })()}
            </span>
          </div>
        </div>
        
        {combinedChartData.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No trend data available
          </div>
        ) : (
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combinedChartData.filter((_, index) => index % Math.max(1, Math.floor(combinedChartData.length / 30)) === 0)}>
                <defs>
                  <linearGradient id="stockGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
                <XAxis 
                  dataKey="displayDate" 
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  interval="preserveStartEnd"
                  axisLine={{ stroke: '#9ca3af' }}
                />
                <YAxis 
                  yAxisId="stock"
                  orientation="left"
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  axisLine={{ stroke: '#9ca3af' }}
                  label={{ value: 'Stock Level', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
                />
                <YAxis 
                  yAxisId="arrivals"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  axisLine={{ stroke: '#9ca3af' }}
                  label={{ value: 'Expected Arrivals', angle: 90, position: 'insideRight', style: { textAnchor: 'middle' } }}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }}
                  labelFormatter={(value) => `Date: ${value}`}
                  formatter={(value, name) => [
                    `${value} ${name === 'Semi Van Stock' ? 'units' : 'arrivals'}`,
                    name
                  ]}
                />
                <Legend 
                  wrapperStyle={{
                    paddingTop: '20px'
                  }}
                />
                <Bar 
                  yAxisId="arrivals"
                  dataKey="estimateArrivals" 
                  fill="#10b981"
                  fillOpacity={0.7}
                  name="Expected Arrivals"
                  radius={[2, 2, 0, 0]}
                />
                <Line 
                  yAxisId="stock"
                  type="monotone" 
                  dataKey="semivanstock" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  name="Semi Van Stock"
                  dot={{ 
                    fill: '#3b82f6', 
                    strokeWidth: 2, 
                    stroke: '#ffffff',
                    r: 4 
                  }}
                  activeDot={{ 
                    r: 6, 
                    fill: '#1d4ed8',
                    stroke: '#ffffff',
                    strokeWidth: 2
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Van on the Sea Status Cards */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Van on the Sea Status - Model Ranges</h2>
        {vanOnSeaData.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {vanOnSeaData.map((item) => (
              <div key={item.modelRange} className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg p-4 text-center">
                <div className="text-lg font-bold text-orange-800 mb-2">
                  {item.modelRange}
                </div>
                <div className="text-2xl font-bold text-orange-600">
                  {item.count}
                </div>
                <div className="text-xs text-orange-700 mt-1">
                  vans on sea
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">
            No vans currently on the sea
          </div>
        )}
      </div>

      {/* Estimated Arrivals Summary */}
      <div className="bg-white p-6 rounded-lg border mb-6">
        <h3 className="text-lg font-semibold mb-4">📅 Estimated Arrivals</h3>
        
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-blue-50">
                <th className="border border-gray-300 px-4 py-2 text-left">Date</th>
                <th className="border border-gray-300 px-4 py-2 text-left">Number of Units</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const dateStats = {};
                data.forEach(item => {
                  const estimateDate = item["Estimate Semi Received Date"];
                  if (estimateDate && estimateDate.trim() !== '') {
                    const dateString = estimateDate.trim();
                    const parts = dateString.split('/');
                    if (parts.length === 3) {
                      const day = parts[0].padStart(2, '0');
                      const month = parts[1].padStart(2, '0');
                      const year = parts[2];
                      const standardDate = `${year}-${month}-${day}`;
                      
                      if (!dateStats[standardDate]) {
                        dateStats[standardDate] = {
                          count: 0,
                          originalDate: dateString
                        };
                      }
                      dateStats[standardDate].count++;
                    }
                  }
                });
                
                const sortedDates = Object.keys(dateStats).sort();
                
                if (sortedDates.length === 0) {
                  return (
                    <tr>
                      <td colSpan="2" className="border border-gray-300 px-4 py-8 text-center text-gray-500">
                        No estimated arrival dates found
                      </td>
                    </tr>
                  );
                }
                
                return sortedDates.map(date => (
                  <tr key={date} className="hover:bg-blue-50">
                    <td className="border border-gray-300 px-4 py-2 font-mono font-semibold">
                      {dateStats[date].originalDate}
                    </td>
                    <td className="border border-gray-300 px-4 py-2">
                      <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-semibold">
                        {dateStats[date].count}
                      </span>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StockLevelAnalysis;
