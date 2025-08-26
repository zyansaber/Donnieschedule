import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList
} from 'recharts';
import { fetchScheduleData, fetchDealerNotes } from '../../data/scheduleData';

const COLORS = {
  'JV Dealer': '#2196f3',
  'Self-owned Dealer': '#4caf50',
  'External Dealer': '#ff9800',
};

const StagesByClassChart = ({ selectedStages }) => {
  const [chartData, setChartData] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stageSelections, setStageSelections] = useState({});
  const [isLocked, setIsLocked] = useState(true);

  // Memoize fetch function to improve performance
  const fetchData = useMemo(() => async () => {
    try {
      setLoading(true);
      
      const scheduleData = await fetchScheduleData();
      const dealerNotes = await fetchDealerNotes();
      
      // Get all unique stages except "Finished"
      const allStages = new Set();
      scheduleData.forEach(item => {
        if (item["Regent Production"] && 
            item["Regent Production"].toLowerCase() !== "finished") {
          let stage = item["Regent Production"];
          if (stage.includes('-')) {
            stage = "Sea Freighting";
          }
          allStages.add(stage);
        }
      });
      
      const stagesList = Array.from(allStages);
      setStages(stagesList);
      
      // Initialize all stages as selected
      const initialSelections = {};
      stagesList.forEach(stage => {
        initialSelections[stage] = true;
      });
      setStageSelections(initialSelections);
      
      // Count by class and stage
      const stagesByClass = {
        'JV Dealer': {},
        'Self-owned Dealer': {},
        'External Dealer': {},
      };
      
      // Initialize counters
      Object.keys(stagesByClass).forEach(className => {
        stagesList.forEach(stage => {
          stagesByClass[className][stage] = 0;
        });
      });
      
      // Count items by stage and dealer class
      scheduleData.forEach(item => {
        if (!item["Regent Production"] || 
            item["Regent Production"].toLowerCase() === "finished") {
          return;
        }
        
        let stage = item["Regent Production"];
        if (stage.includes('-')) {
          stage = "Sea Freighting";
        }
        
        const dealer = item["Dealer"] || '';
        let dealerClass = 'External Dealer'; // Default class
        
        // Get dealer class from notes
        if (dealer && dealerNotes[dealer] && dealerNotes[dealer].class) {
          const classKey = dealerNotes[dealer].class;
          
          if (classKey === 'jv_dealer') {
            dealerClass = 'JV Dealer';
          } else if (classKey === 'self_owned_dealer') {
            dealerClass = 'Self-owned Dealer';
          }
        }
        
        // Increment the count
        stagesByClass[dealerClass][stage]++;
      });
      
      // Convert to array format for recharts - restructure for stages on x-axis
      const formattedData = stagesList.map(stage => {
        const stageData = { stage: stage };
        Object.keys(stagesByClass).forEach(className => {
          stageData[className] = stagesByClass[className][stage];
        });
        return stageData;
      });
      
      setChartData(formattedData);
      setLoading(false);
    } catch (error) {
      console.error("Error preparing stages by class chart data:", error);
      setError("Failed to load chart data");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Get the stages to display based on the local selections
  const stagesToDisplay = useMemo(() => {
    return stages.filter(stage => stageSelections[stage]);
  }, [stages, stageSelections]);
  
  // Share selected stages with parent components when unlocked
  useEffect(() => {
    if (!isLocked && typeof selectedStages === 'function') {
      const activeStages = stages.filter(stage => stageSelections[stage]);
      selectedStages(activeStages);
    }
  }, [stageSelections, isLocked, stages, selectedStages]);

  const handleStageToggle = (stage) => {
    if (isLocked) return;
    
    setStageSelections(prev => ({
      ...prev,
      [stage]: !prev[stage]
    }));
  };

  const toggleLock = () => {
    setIsLocked(!isLocked);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-800">Selected Stages by Dealer Class</h3>
        <button 
          className={`text-xs px-3 py-1 rounded ${isLocked ? 'bg-gray-200 text-gray-600' : 'bg-blue-100 text-blue-700'}`}
          onClick={toggleLock}
        >
          {isLocked ? (
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              Locked
            </span>
          ) : (
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
              </svg>
              Unlocked {!isLocked && "(Filters Applied to Table)"}
            </span>
          )}
        </button>
      </div>
      
      <div className="grid grid-cols-6 gap-4">
        <div className="col-span-5 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="stage" />
              <YAxis />
              <Tooltip formatter={(value) => [`${value}`, 'Count']} />
              <Legend />
              {Object.keys(COLORS).map((dealerClass, index) => (
                <Bar 
                  key={dealerClass} 
                  dataKey={dealerClass}
                  fill={COLORS[dealerClass]}
                  name={dealerClass}
                  // Removing stackId for side-by-side bars
                >
                  <LabelList dataKey={dealerClass} position="top" />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        <div className="col-span-1 p-3 bg-gray-50 rounded-lg shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-medium text-gray-700">Filter Stages</h4>
          </div>
          <div className={`space-y-1 max-h-72 overflow-y-auto ${isLocked ? 'opacity-60' : 'opacity-100'}`}>
            {stages.map(stage => (
              <div key={stage} className="flex items-center">
                <input
                  type="checkbox"
                  id={`chart-stage-${stage}`}
                  checked={stageSelections[stage] || false}
                  onChange={() => handleStageToggle(stage)}
                  disabled={isLocked}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label 
                  htmlFor={`chart-stage-${stage}`} 
                  className={`ml-2 block text-sm ${isLocked ? 'text-gray-500' : 'text-gray-700'} cursor-pointer`}
                >
                  {stage}
                </label>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-500 mt-2 italic">
            {isLocked ? "Unlock to filter stages" : "Select stages to display"}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StagesByClassChart;