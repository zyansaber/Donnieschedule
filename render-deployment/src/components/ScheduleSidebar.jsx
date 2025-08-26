import React, { useMemo } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { getProductionStageCounts, getForecastYearCounts, getMonthlyOrderData, getMonthlyProductionData } from '../data/scheduleData';
import { isDateWithinNext20Weeks } from '../data/scheduleData';

const ScheduleSidebar = ({ data }) => {
  // Calculate stats based on filtered data
  const filteredCount = data?.length || 0;

  // Calculate Red Slots count
  const redSlotsCount = useMemo(() => {
    if (!data) return 0;
    return data.filter(item => 
      isDateWithinNext20Weeks(item["Forecast Production Date"]) && !item["Chassis"]
    ).length;
  }, [data]);

  const productionStageCounts = useMemo(() => {
    if (!data) return [];
    const counts = getProductionStageCounts(data);
    return Object.entries(counts).map(([stage, count]) => ({
      name: stage,
      value: count
    }));
  }, [data]);

  const forecastYearCounts = useMemo(() => {
    if (!data) return [];
    const counts = getForecastYearCounts(data);
    return Object.entries(counts)
      .filter(([year]) => year !== "2024") // Filter out 2024 data
      .map(([year, count]) => ({
        name: year,
        value: count
      }));
  }, [data]);

  const monthlyOrderData = useMemo(() => {
    if (!data) return [];
    return getMonthlyOrderData(data);
  }, [data]);

  const monthlyProductionData = useMemo(() => {
    if (!data) return [];
    return getMonthlyProductionData(data);
  }, [data]);

  // Colors for pie charts
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7c43', '#665191'];

  return (
    <div className="bg-white p-3 rounded-lg shadow-sm w-full">
      <div className="flex flex-wrap justify-between items-center mb-2">
        <h2 className="text-lg font-medium text-gray-800">Schedule Insights</h2>
        <div className="bg-blue-50 px-3 py-1 rounded-md">
          <span className="text-sm font-medium text-gray-700">Filtered Records:</span>
          <span className="text-lg font-bold text-blue-700 ml-2">{filteredCount}</span>
        </div>
      </div>
      
      <div className="flex flex-wrap -mx-2">
        {/* First Row - 3 charts (including new Red Slots card) */}
        <div className="w-full md:w-1/3 p-2">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Forecast Year Distribution</h3>
          <div className="border rounded-md p-1" style={{ height: "130px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={forecastYearCounts}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={40}
                  fill="#8884d8"
                  dataKey="value"
                  nameKey="name"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {forecastYearCounts.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name, props) => [value, props.payload.name]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* Red Slots Card */}
        <div className="w-full md:w-1/3 p-2">
          <h3 className="text-sm font-medium text-gray-700 mb-1 text-center">Total Red Slots</h3>
          <div className="border rounded-md p-1 flex items-center justify-center" style={{ height: "130px", background: "linear-gradient(to right, #fee2e2, #fecaca)" }}>
            <div className="text-center">
              <div className="text-4xl font-bold text-red-600 text-center">{redSlotsCount}</div>
              <div className="text-sm text-red-700 mt-2 text-center">Slots</div>
              <div className="text-xs text-red-500 mt-1 text-center">(Next 20 Weeks)</div>
            </div>
          </div>
        </div>
        
        <div className="w-full md:w-1/3 p-2">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Production Stages</h3>
          <div className="border rounded-md p-1" style={{ height: "130px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productionStageCounts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{fontSize: 9}} />
                <YAxis tick={{fontSize: 9}} />
                <Tooltip />
                <Bar dataKey="value" fill="#8884d8">
                  {productionStageCounts.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* Second Row - 2 charts */}
        <div className="w-full md:w-1/2 p-2">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Monthly Orders (Past Year)</h3>
          <div className="border rounded-md p-1" style={{ height: "130px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyOrderData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{fontSize: 9}} />
                <YAxis tick={{fontSize: 9}} />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="count" 
                  stroke="#0088FE" 
                  activeDot={{ r: 6 }} 
                  name="Orders" 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="w-full md:w-1/2 p-2">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Production Forecast</h3>
          <div className="border rounded-md p-1" style={{ height: "130px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyProductionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{fontSize: 9}} />
                <YAxis tick={{fontSize: 9}} />
                <Tooltip />
                <Bar dataKey="count" fill="#00C49F" name="Production" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleSidebar;