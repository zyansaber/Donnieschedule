import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ScheduleTable from './ScheduleTable';
import ScheduleFilters from './ScheduleFilters';
import ScheduleSidebar from './ScheduleSidebar';
import StagesByClassChart from './charts/StagesByClassChart';
import ForecastYearBreakdown from './charts/ForecastYearBreakdown';
import LoadingOverlay from './LoadingOverlay';

const ScheduleDashboard = ({ data }) => {
  const [filteredData, setFilteredData] = useState(data);
  const [filters, setFilters] = useState({});
  const [showCharts, setShowCharts] = useState(true);
  const [selectedChartStages, setSelectedChartStages] = useState([]);
  const [isFilteringData, setIsFilteringData] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Handle scroll events for back to top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll to top function
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  useEffect(() => {
    if (!data) {
      setFilteredData([]);
      return;
    }

    if (data.length > 100) {
      setIsFilteringData(true);
    }

    const filterTimeout = setTimeout(() => {
      const newFilteredData = data.filter(item => {
        try {
          if (filters.dealer && filters.dealer !== 'all' && item["Dealer"] !== filters.dealer) {
            return false;
          }
          if (filters.model && item["Model"] !== filters.model) {
            return false;
          }
          if (filters.modelYear && item["Model Year"] !== filters.modelYear) {
            return false;
          }
          if (filters.forecastYear && item["Forecast Production Date"]) {
            const dateParts = item["Forecast Production Date"].split('/');
            if (dateParts.length >= 3 && dateParts[2] !== filters.forecastYear) {
              return false;
            }
          }
          if (filters.forecastYearMonth && item["Forecast Production Date"]) {
            const dateParts = item["Forecast Production Date"].split('/');
            if (dateParts.length >= 3) {
              const itemYearMonth = `${dateParts[2]}-${dateParts[1]}`;
              if (itemYearMonth !== filters.forecastYearMonth) return false;
            }
          }
          if (filters.modelRange && item["Chassis"] && !item["Chassis"].startsWith(filters.modelRange)) {
            return false;
          }

          const dateFields = [
            { filter: 'OrderSentToLongtreeYearMonth', field: 'Order Sent to Longtree' },
            { filter: 'PlansSentToDealerYearMonth', field: 'Plans Sent to Dealer' },
            { filter: 'SignedPlansReceivedYearMonth', field: 'Signed Plans Received' }
          ];

          for (const { filter, field } of dateFields) {
            if (filters[filter] && item[field]) {
              const dateParts = item[field].split('/');
              if (dateParts.length >= 3) {
                const itemYearMonth = `${dateParts[2]}-${dateParts[1]}`;
                if (itemYearMonth !== filters[filter]) {
                  return false;
                }
              }
            }
          }

          
          if (filters.type === 'stock') {
            const val = (item["Customer"] || "").toLowerCase();
            if (!(val.endsWith("stock") || val === "prototype")) return false;
          } else if (filters.type === 'customer') {
            const val = (item["Customer"] || "").toLowerCase();
            if (val.endsWith("stock") || val === "prototype") return false;
          } else if (filters.type === 'customer') {
            const val = item["Customer"] || "";
            if (val.endsWith("stock") || val === "prototype") return false;
          }

          return true;
        } catch (error) {
          console.error("Error filtering item:", item, error);
          return false;
        }
      });

      setFilteredData(newFilteredData);
      setIsFilteringData(false);
    }, 300);

    return () => clearTimeout(filterTimeout);
  }, [data, filters]);

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleStageSelection = useCallback((stages) => {
    if (stages && stages.length > 0) {
      setFilters(prev => ({
        ...prev,
        selectedStages: stages,
        allStagesSelected: false
      }));
    }
  }, []);

  return (
    <div className="flex flex-col gap-6 relative" style={{ scrollBehavior: 'smooth' }}>
      <LoadingOverlay isLoading={isFilteringData} message="Updating filters..." />
      
      {/* Back to Top Button */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-110"
          title="Back to Top"
          style={{ fontSize: '24px' }}
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            className="h-6 w-6" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}
      
      <div className="flex justify-end">
        <button 
          onClick={() => setShowCharts(!showCharts)}
          className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded flex items-center"
        >
          {showCharts ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-14-14z" />
                <path fillRule="evenodd" d="M16.293 2.293a1 1 0 011.414 1.414l-14 14a1 1 0 01-1.414-1.414l14-14z" />
              </svg>
              Hide Charts
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12z" clipRule="evenodd" />
              </svg>
              Show Charts
            </>
          )}
        </button>
      </div>

      {showCharts && (
        <>
          <div className="w-full">
            <ScheduleSidebar data={filteredData} />
          </div>

          <div className="w-full bg-white p-4 rounded-lg shadow-sm">
            <ForecastYearBreakdown data={filteredData} />
          </div>

          <div className="w-full bg-white p-4 rounded-lg shadow-sm">
            <StagesByClassChart selectedStages={handleStageSelection} />
          </div>
        </>
      )}

      <div className="w-full">
        <ScheduleFilters data={data} onFilterChange={handleFilterChange} />
        <ScheduleTable data={filteredData} filters={filters} />
      </div>
    </div>
  );
};

export default ScheduleDashboard;
