import React, { useState, useEffect } from 'react';
import ReminderChecker from './components/ReminderChecker';
import Header from './components/Header';
import ScheduleDashboard from './components/ScheduleDashboard';
import LoadingOverlay from './components/LoadingOverlay';
import AllocationSummary from './components/AllocationSummary';
import PieChartComponent from './components/charts/PieChart';
import StockLevelAnalysis from './components/StockLevelAnalysis';
import UnfinishedVanTracking from './components/UnfinishedVanTracking';
import Reallocation from './components/Reallocation';
import CampervanSchedule from './pages/CampervanSchedule';
import InternalSnowyPage from './pages/InternalSnowy';
import { fetchScheduleData, mockScheduleData } from './data/scheduleData';

function App() {
  const [activeView, setActiveView] = useState('schedule');
  const [scheduleData, setScheduleData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const internalSnowyPath = '/xxx/internal-snowy-2487';
  const isInternalSnowy = window.location.pathname === internalSnowyPath;

  const menuItems = [
    { id: 'schedule', name: 'Schedule', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'stock-level', name: 'Stock Level Analysis', icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
    { id: 'van-tracking', name: 'Unfinished Van Date Tracking', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'allocation-summary', name: 'Allocation Summary', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
    { id: 'reallocation', name: 'Reallocation', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
    { id: 'campervan-schedule', name: 'Campervan Schedule', icon: 'M3 7h18M3 12h18M3 17h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z' },
    { id: 'internal-snowy', name: 'Yard Cards', icon: 'M12 8v8m4-4H8m4-6a9 9 0 100 18 9 9 0 000-18z' }
  ];

  useEffect(() => {
    document.body.style.zoom = "125%";
    return () => {
      document.body.style.zoom = "100%";
    };
  }, []);

  useEffect(() => {
    const getScheduleData = async () => {
      try {
        setLoading(true);
        try {
          const firebaseData = await fetchScheduleData();
          setScheduleData(firebaseData);
        } catch (firebaseError) {
          console.error("Error fetching from Firebase, using mock data:", firebaseError);
          setScheduleData(mockScheduleData);
        }
      } catch (err) {
        console.error("Fatal error fetching schedule data:", err);
        setError("Failed to load schedule data. Please try again later.");
        setScheduleData([]);
      } finally {
        setLoading(false);
      }
    };

    getScheduleData();
  }, []);

  const handleMenuClick = (itemId) => {
    setActiveView(itemId);
  };

  if (isInternalSnowy) {
    return <InternalSnowyPage />;
  }
  
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header />
      <div className="bg-white shadow-sm p-2 flex flex-wrap justify-center">
        <nav className="flex">
          <ul className="flex space-x-2">
            {menuItems.map((item) => (
              <li key={item.id}>
                <button
                  className={`flex items-center px-4 py-2 text-sm rounded-md ${activeView === item.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
                  onClick={() => handleMenuClick(item.id)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <main className="flex-1 p-4 overflow-auto">
        <LoadingOverlay isLoading={loading} message="Loading dashboard data..." />
        {error ? (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <ReminderChecker data={scheduleData} />
            {activeView === 'schedule' && <ScheduleDashboard data={scheduleData} />}
            {activeView === 'stock-level' && <StockLevelAnalysis data={scheduleData} />}
            {activeView === 'van-tracking' && <UnfinishedVanTracking />}
            {activeView === 'allocation-summary' && (
              <>
                <AllocationSummary data={scheduleData} />
                <div className="mt-8">
                  <PieChartComponent scheduleData={scheduleData} />
                </div>
              </>
            )}
            {activeView === 'reallocation' && <Reallocation data={scheduleData} />}
            {activeView === 'campervan-schedule' && <CampervanSchedule />}
            {activeView === 'internal-snowy' && <InternalSnowyPage />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
