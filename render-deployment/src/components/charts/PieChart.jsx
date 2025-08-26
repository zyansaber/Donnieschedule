
import React, { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const COLORS = ['#0088FE', '#FF8042'];

const PieChartComponent = ({ scheduleData }) => {
  const [selectedDealers, setSelectedDealers] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);

  const generatePieData = (year) => {
    const filtered = scheduleData.filter(item => {
      const dateStr = item["Forecast Production Date"];
      const yearFromDate = dateStr?.split("/")?.[2]; // expects DD/MM/YYYY
      return yearFromDate === String(year);
    });

    const withChassis = filtered.filter(item => item["Chassis"]);
    const withoutChassis = filtered.filter(item => !item["Chassis"]);

    return [
      { name: 'With Chassis', value: withChassis.length, details: withChassis },
      { name: 'Without Chassis', value: withoutChassis.length, details: withoutChassis },
    ];
  };

  const handleClick = (entry, year) => {
    if (entry.name === 'Without Chassis') {
      const dealers = {};
      entry.details.forEach(item => {
        const dealer = item["Dealer"] || 'Unknown';
        dealers[dealer] = (dealers[dealer] || 0) + 1;
      });
      setSelectedDealers(dealers);
      setSelectedYear(year);
    } else {
      setSelectedDealers(null);
    }
  };

  const renderDealerBreakdown = () => {
    if (!selectedDealers) return null;
    return (
      <div className="mt-4 p-4 border rounded bg-gray-50 shadow">
        <h3 className="font-bold text-lg mb-2">No Chassis Breakdown by Dealer ({selectedYear})</h3>
        <ul className="list-disc pl-6">
          {Object.entries(selectedDealers).map(([dealer, count]) => (
            <li key={dealer}>
              {dealer}: {count}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const years = [2025, 2026];

  return (
    <div className="space-y-8">
      {years.map(year => {
        const pieData = generatePieData(year);
        return (
          <div key={year} className="border rounded p-4 shadow bg-white">
            <h2 className="text-xl font-semibold mb-2">Forecast Year {year}</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  onClick={(e) => handleClick(e, year)}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );
      })}
      {renderDealerBreakdown()}
    </div>
  );
};

export default PieChartComponent;
