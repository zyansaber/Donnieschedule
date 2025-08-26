import React, { useState } from "react";

const transformData = (raw) => {
  return raw
    .map(item => {
      if (!item["Forecast Production Date"]) return null;
      const [day, month, year] = item["Forecast Production Date"].split("/");
      return {
        forecastProductionDate: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
        chassisNo: item["Chassis"] || "",
        dealer: item["Dealer"] || "Unknown"
      };
    })
    .filter(Boolean);
};

const getContrastColor = (hex) => {
  if (!hex) return "#000";
  const r = parseInt(hex.substr(1, 2), 16);
  const g = parseInt(hex.substr(3, 2), 16);
  const b = parseInt(hex.substr(5, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? "#000" : "#fff";
};

const AllocationSummary = ({ data, dealerColors }) => {
  const transformed = transformData(data);
  const [expandedMonth, setExpandedMonth] = useState(null);
  const [visibleMonths, setVisibleMonths] = useState([]);

  const data2025 = transformed.filter(item => {
    const d = new Date(item.forecastProductionDate);
    return d.getFullYear() === 2025;
  });

  const data2026 = transformed.filter(item => {
    const d = new Date(item.forecastProductionDate);
    return d.getFullYear() === 2026;
  });

  if (!data2025.length && !data2026.length) return <div className="text-center text-gray-500 mt-10">No 2025/2026 forecast data found.</div>;

  const monthDealerMap2025 = {};
  const monthDateMap2025 = {};
  const monthDealerMap2026 = {};
  const monthDateMap2026 = {};
  
  const allDealers = Array.from(new Set([...data2025.map(d => d.dealer), ...data2026.map(d => d.dealer)])).sort();

  data2025.forEach(item => {
    const date = new Date(item.forecastProductionDate);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const day = date.toISOString().split("T")[0];
    const dealer = item.dealer || "Unknown";
    const isOccupied = item.chassisNo ? "Occupied" : "Empty";

    if (!monthDealerMap2025[month]) monthDealerMap2025[month] = {};
    if (!monthDealerMap2025[month][dealer]) monthDealerMap2025[month][dealer] = { Occupied: 0, Empty: 0 };
    monthDealerMap2025[month][dealer][isOccupied]++;

    if (!monthDateMap2025[month]) monthDateMap2025[month] = {};
    if (!monthDateMap2025[month][day]) monthDateMap2025[month][day] = {};
    if (!monthDateMap2025[month][day][dealer]) monthDateMap2025[month][day][dealer] = { Occupied: 0, Empty: 0 };
    monthDateMap2025[month][day][dealer][isOccupied]++;
  });

  data2026.forEach(item => {
    const date = new Date(item.forecastProductionDate);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const day = date.toISOString().split("T")[0];
    const dealer = item.dealer || "Unknown";
    const isOccupied = item.chassisNo ? "Occupied" : "Empty";

    if (!monthDealerMap2026[month]) monthDealerMap2026[month] = {};
    if (!monthDealerMap2026[month][dealer]) monthDealerMap2026[month][dealer] = { Occupied: 0, Empty: 0 };
    monthDealerMap2026[month][dealer][isOccupied]++;

    if (!monthDateMap2026[month]) monthDateMap2026[month] = {};
    if (!monthDateMap2026[month][day]) monthDateMap2026[month][day] = {};
    if (!monthDateMap2026[month][day][dealer]) monthDateMap2026[month][day][dealer] = { Occupied: 0, Empty: 0 };
    monthDateMap2026[month][day][dealer][isOccupied]++;
  });

  const allMonths2025 = Object.keys(monthDealerMap2025).sort();
  const allMonths2026 = Object.keys(monthDealerMap2026).sort();

  const toggleMonth = (month) => {
    setVisibleMonths(prev =>
      prev.includes(month) ? prev.filter(m => m !== month) : [...prev, month]
    );
  };

  const handleExpand = (month) => {
    setExpandedMonth(prev => (prev === month ? null : month));
  };

  const renderTable = (year, monthDealerMap, monthDateMap, allMonths) => (
    <div className="mb-8">
      <h3 className="text-xl font-semibold mb-4 text-gray-700">Allocation Summary ({year})</h3>
      
      <div className="mb-4">
        <label className="font-medium">Select Months for {year}:</label>
        <div className="flex flex-wrap gap-3 mt-2">
          {allMonths.map(month => (
            <label key={month} className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                checked={visibleMonths.includes(month)}
                onChange={() => toggleMonth(month)}
              />
              {month}
            </label>
          ))}
        </div>
      </div>

      <table className="min-w-full border-collapse text-sm shadow rounded overflow-hidden">
        <thead>
          <tr>
            <th className="border p-2 bg-gray-100 sticky left-0 z-10 w-40">Dealer</th>
            {visibleMonths.filter(month => allMonths.includes(month)).map(month => (
              <th key={month} colSpan={2} className="border p-2 bg-gray-100 text-center min-w-32">
                <div className="text-md font-semibold">{month}</div>
                <button
                  onClick={() => handleExpand(month)}
                  className="text-xs text-blue-600 underline"
                >
                  {expandedMonth === month ? "Collapse" : "Expand"}
                </button>
              </th>
            ))}
          </tr>
          <tr>
            <th className="border bg-gray-50 sticky left-0 z-10"></th>
            {visibleMonths.filter(month => allMonths.includes(month)).map(month => (
              <React.Fragment key={month + "-sub"}>
                <th className="border text-center text-green-700">Occ</th>
                <th className="border text-center text-red-700">Emp</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {allDealers.map(dealer => {
            const bg = dealerColors?.[dealer] || "#f9fafb";
            const textColor = getContrastColor(bg);
            return (
              <React.Fragment key={dealer}>
                <tr className="hover:bg-yellow-50 transition">
                  <td className="border p-2 sticky left-0 z-0 font-medium" style={{ backgroundColor: bg, color: textColor }}>
                    <span className="px-2 py-1 rounded">{dealer}</span>
                  </td>
                  {visibleMonths.filter(month => allMonths.includes(month)).map(month => {
                    const stats = monthDealerMap[month]?.[dealer] || { Occupied: 0, Empty: 0 };
                    return (
                      <React.Fragment key={month}>
                        <td className="border p-2 text-center text-green-700 text-lg font-bold">{stats.Occupied}</td>
                        <td className="border p-2 text-center text-red-600 text-lg font-bold">{stats.Empty}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
                {expandedMonth === visibleMonths.find(m => m === expandedMonth) && allMonths.includes(expandedMonth) && (
                  Object.entries(monthDateMap[expandedMonth] || {}).sort().map(([date, dealers]) => (
                    <tr key={dealer + date} className="bg-gray-50">
                      <td className="border px-2 py-1 text-xs text-gray-500 sticky left-0 bg-white z-0">{date}</td>
                      {visibleMonths.filter(month => allMonths.includes(month)).map(month => {
                        if (month !== expandedMonth) return <td key={month} colSpan={2}></td>;
                        const s = dealers[dealer] || { Occupied: 0, Empty: 0 };
                        return (
                          <React.Fragment key={month + dealer + date}>
                            <td className="border px-1 py-1 text-center text-green-600 text-sm">{s.Occupied}</td>
                            <td className="border px-1 py-1 text-center text-red-600 text-sm">{s.Empty}</td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="overflow-auto p-4">
      <h2 className="text-2xl font-semibold mb-6 text-gray-800">Allocation Summary (2025 & 2026)</h2>

      {data2025.length > 0 && renderTable("2025", monthDealerMap2025, monthDateMap2025, allMonths2025)}
      {data2026.length > 0 && renderTable("2026", monthDealerMap2026, monthDateMap2026, allMonths2026)}
    </div>
  );
};

export default AllocationSummary;