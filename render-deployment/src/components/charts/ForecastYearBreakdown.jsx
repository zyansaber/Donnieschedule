import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import DialogWrapper from "../DialogWrapper";

const COLORS = ['#4CAF50', '#FF9800'];

const ForecastYearBreakdown = ({ data }) => {
  const [selectedYear, setSelectedYear] = useState(null);
  const [showDealers, setShowDealers] = useState(false);
  const [dealersData, setDealersData] = useState([]);

  const yearData = useMemo(() => {
    const summary = { "2025": { chassis: 0, nochassis: 0 }, "2026": { chassis: 0, nochassis: 0 } };

    data.forEach(item => {
      const date = item["Forecast Production Date"];
      const chassis = item["Chassis"];
      if (!date) return;
      const year = date.split('/')[2];
      if (summary[year]) {
        if (chassis && chassis.trim()) summary[year].chassis++;
        else summary[year].nochassis++;
      }
    });

    return summary;
  }, [data]);

  const handleClick = (year, isChassis) => {
    if (isChassis) return;
    const filtered = {};
    data.forEach(item => {
      const date = item["Forecast Production Date"];
      const chassis = item["Chassis"];
      const dealer = item["Dealer"];
      if (date && date.split('/')[2] === year && (!chassis || !chassis.trim())) {
        filtered[dealer] = (filtered[dealer] || 0) + 1;
      }
    });
    const dealerList = Object.entries(filtered).map(([dealer, count]) => ({ dealer, count }));
    setDealersData(dealerList);
    setSelectedYear(year);
    setShowDealers(true);
  };

  const closeDialog = () => {
    setShowDealers(false);
  };

  return (
    <div>
      <div className="flex flex-wrap justify-around">
        {["2025", "2026"].map((year, index) => (
          <div key={year}>
            <h3 className="font-bold text-center mb-2">{year}</h3>
            <PieChart width={300} height={250}>
              <Pie
                data={[
                  { name: 'With Chassis', value: yearData[year].chassis },
                  { name: 'No Chassis', value: yearData[year].nochassis }
                ]}
                cx={150}
                cy={100}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
                onClick={(entry, i) => handleClick(year, i === 0)}
              >
                <Cell key="chassis" fill={COLORS[0]} />
                <Cell key="nochassis" fill={COLORS[1]} />
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </div>
        ))}
      </div>

      <DialogWrapper isOpen={showDealers} onClose={closeDialog}>
        <div className="p-4">
          <h4 className="font-semibold text-lg mb-2">
            {selectedYear} - No Chassis Dealer Breakdown
          </h4>
          <ul className="list-disc pl-5 max-h-[400px] overflow-y-auto">
            {dealersData.map(({ dealer, count }) => (
              <li key={dealer}>
                <span className="font-medium">{dealer}:</span> {count}
              </li>
            ))}
          </ul>
        </div>
      </DialogWrapper>
    </div>
  );
};

export default ForecastYearBreakdown;
