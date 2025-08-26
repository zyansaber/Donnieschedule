
import React, { useState } from "react";
import DashboardOverview from "./DashboardOverview";
import AllocationSummary from "./AllocationSummary";

const Dashboard = ({ scheduleData }) => {
  const [page, setPage] = useState("dashboard");

  return (
    <div className="w-full p-4">
      <div className="flex space-x-4 mb-4">
        <button
          onClick={() => setPage("dashboard")}
          className={`px-4 py-2 rounded ${page === "dashboard" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setPage("allocation")}
          className={`px-4 py-2 rounded ${page === "allocation" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
        >
          Allocation Summary
        </button>
      </div>

      {page === "dashboard" && <DashboardOverview />}
      {page === "allocation" && <AllocationSummary data={scheduleData} />}
    </div>
  );
};

export default Dashboard;
