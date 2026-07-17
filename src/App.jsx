import React, { useState, useEffect } from 'react';
import { get, ref, set } from 'firebase/database';
import ReminderChecker from './components/ReminderChecker';
import Header from './components/Header';
import ScheduleDashboard from './components/ScheduleDashboard';
import LoadingOverlay from './components/LoadingOverlay';
import StockReservation from './components/StockReservation';
import StockTransfer from './components/StockTransfer';
import StockTransferWorkflow, { StockTransferConfirmCenter } from './components/StockTransferWorkflow';
import UnfinishedVanTracking from './components/UnfinishedVanTracking';
import Reallocation from './components/Reallocation';
import CampervanSchedule from './pages/CampervanSchedule';
import InternalSnowyPage from './pages/InternalSnowy';
import ScheduleAdjustment, { buildShuffleRequests } from './components/ScheduleAdjustment';
import { fetchScheduleData, mockScheduleData } from './data/scheduleData';
import { database } from './utils/firebase';
import { queueEmailJob } from './utils/emailJobs';

const getCurrentRoutePath = () => (
  (window.location.hash.replace(/^#/, '') || window.location.pathname).split('?')[0]
);

function App() {
  const [activeView, setActiveView] = useState('schedule');
  const [routePath, setRoutePath] = useState(getCurrentRoutePath);
  const [scheduleData, setScheduleData] = useState([]);
  const [shuffleRequests, setShuffleRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shuffleRequestsLoaded, setShuffleRequestsLoaded] = useState(false);
  const [dealerStockLevels, setDealerStockLevels] = useState({});
  const [dealerStockLevelsLoaded, setDealerStockLevelsLoaded] = useState(false);
  const internalSnowyPath = '/xxx/internal-snowy-2487';
  const stockTransferWorkflowRoutes = {
    '/stock-transfer-workflow/ceo': 'ceo',
    '/stock-transfer-workflow/finance': 'finance',
    '/stock-transfer-workflow/location': 'location',
    '/stock-transfer-workflow/planning': 'planning',
    '/stock-transfer-workflow/transport': 'transport',
    '/stock-transfer-workflow/purchase': 'purchase',
    '/stock-transfer-workflow/settings': 'settings',
  };
  const isInternalSnowy = window.location.pathname === internalSnowyPath;
  const standaloneStockTransferWorkflowRole = stockTransferWorkflowRoutes[routePath];

  const menuItems = [
    { id: 'schedule', name: 'Schedule', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'schedule-adjustment', name: 'Schedule Adjustment', icon: 'M8 7h8m-8 5h8m-8 5h8M6 7h.01M6 12h.01M6 17h.01' },
    { id: 'stock-reservation', name: 'Stock Reservation', icon: 'M5 5a2 2 0 012-2h6l4 4v14l-7-3-7 3V5a2 2 0 012-2z' },
    { id: 'stock-transfer', name: 'Stock Transfer', icon: 'M7 7h10m0 0l-3-3m3 3l-3 3M17 17H7m0 0l3 3m-3-3l3-3' },
    { id: 'stock-transfer-confirm', name: 'Stock Transfer Confirm', icon: 'M9 12l2 2 4-4M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z' },
    { id: 'van-tracking', name: 'Unfinished Van Date Tracking', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'reallocation', name: 'Reallocation', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
    { id: 'campervan-schedule', name: 'SRV/SRM Schedule', icon: 'M3 7h18M3 12h18M3 17h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z' },
  ];

  const handleCreateShuffleRequests = async (selectedRows, targetMonth) => {
    if (!selectedRows || selectedRows.length === 0 || !targetMonth) return;
    const newRequests = buildShuffleRequests(selectedRows, targetMonth, scheduleData);
    setShuffleRequests((prev) => [...newRequests, ...prev]);
    const requestRows = newRequests.map((item) => (
      `${item.chassis || ''}, ${item.adjustedTime || ''}, ${item.monthVin || ''}`
    ));

    await queueEmailJob({
      step: 'schedule_shuffle_requests',
      role: 'schedule',
      to: 'leo.li@regentrv.com.au',
      title: 'Schedule Shuffling Requests',
      content: `
        <h2>Schedule Shuffling Requests</h2>
        <p>Total requests: ${newRequests.length}</p>
        <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;">${requestRows.join('\n')}</pre>
      `,
      metadata: {
        source: 'schedule_shuffling_requests',
        totalCount: newRequests.length,
        generatedAt: new Date().toISOString(),
      },
    }).catch((error) => {
      console.error('Failed to queue schedule shuffling email:', error);
    });
    setActiveView('schedule-adjustment');
  };

  useEffect(() => {
    document.body.style.zoom = "125%";
    return () => {
      document.body.style.zoom = "100%";
    };
  }, []);

  useEffect(() => {
    const syncRoutePath = () => setRoutePath(getCurrentRoutePath());
    window.addEventListener('hashchange', syncRoutePath);
    window.addEventListener('popstate', syncRoutePath);
    return () => {
      window.removeEventListener('hashchange', syncRoutePath);
      window.removeEventListener('popstate', syncRoutePath);
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

  useEffect(() => {
    const loadShuffleRequests = async () => {
      try {
        const shuffleRef = ref(database, 'scheduleShufflingRequests');
        const snapshot = await get(shuffleRef);
        if (snapshot.exists()) {
          const raw = snapshot.val();
          if (Array.isArray(raw)) {
            setShuffleRequests(raw.filter(Boolean));
          } else if (raw && typeof raw === 'object') {
            setShuffleRequests(Object.values(raw).filter(Boolean));
          }
        } else {
          setShuffleRequests([]);
        }
      } catch (loadError) {
        console.error('Failed to load schedule shuffling requests:', loadError);
      } finally {
        setShuffleRequestsLoaded(true);
      }
    };

    loadShuffleRequests();
  }, []);


  useEffect(() => {
    const loadDealerStockLevels = async () => {
      try {
        const stockRef = ref(database, 'scheduleDealerStockLevels');
        const snapshot = await get(stockRef);
        if (snapshot.exists()) {
          const raw = snapshot.val();
          if (raw && typeof raw === 'object') {
            setDealerStockLevels(raw);
          }
        }
      } catch (loadError) {
        console.error('Failed to load dealer stock levels:', loadError);
      } finally {
        setDealerStockLevelsLoaded(true);
      }
    };

    loadDealerStockLevels();
  }, []);

  useEffect(() => {
    if (!dealerStockLevelsLoaded) return;
    const persistDealerStockLevels = async () => {
      try {
        const stockRef = ref(database, 'scheduleDealerStockLevels');
        await set(stockRef, dealerStockLevels);
      } catch (saveError) {
        console.error('Failed to save dealer stock levels:', saveError);
      }
    };
    persistDealerStockLevels();
  }, [dealerStockLevels, dealerStockLevelsLoaded]);

  useEffect(() => {
    if (!shuffleRequestsLoaded) return;
    const persistShuffleRequests = async () => {
      try {
        const shuffleRef = ref(database, 'scheduleShufflingRequests');
        await set(shuffleRef, shuffleRequests);
      } catch (saveError) {
        console.error('Failed to save schedule shuffling requests:', saveError);
      }
    };
    persistShuffleRequests();
  }, [shuffleRequests, shuffleRequestsLoaded]);

  const handleMenuClick = (itemId) => {
    setActiveView(itemId);
  };

  if (isInternalSnowy) {
    return <InternalSnowyPage />;
  }

  if (standaloneStockTransferWorkflowRole) {
    return <StockTransferWorkflow role={standaloneStockTransferWorkflowRole} standalone />;
  }
  
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header />
      <div className="border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm">
        <nav className="overflow-x-auto">
          <ul className="mx-auto flex w-max gap-1">
            {menuItems.map((item) => (
              <li key={item.id}>
                <button
                  className={`flex items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${activeView === item.id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}
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
            {activeView === 'schedule' && <ScheduleDashboard data={scheduleData} onCreateShuffleRequests={handleCreateShuffleRequests} />}
            {activeView === 'schedule-adjustment' && (
              <ScheduleAdjustment
                data={scheduleData}
                shuffleRequests={shuffleRequests}
                setShuffleRequests={setShuffleRequests}
                dealerStockLevels={dealerStockLevels}
                setDealerStockLevels={setDealerStockLevels}
              />
            )}
            {activeView === 'stock-reservation' && <StockReservation data={scheduleData} />}
            {activeView === 'stock-transfer' && <StockTransfer data={scheduleData} />}
            {activeView === 'stock-transfer-confirm' && <StockTransferConfirmCenter />}
            {activeView === 'van-tracking' && <UnfinishedVanTracking />}
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
