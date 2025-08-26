import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchScheduleData, fetchDealerNotes } from '../../data/scheduleData';

const COLORS = {
  'In Progress': '#4caf50',
  'Queued': '#2196f3',
  'Planning': '#ff9800',
  'Sea Freighting': '#9c27b0',
  'pending': '#607d8b',
  'scheduled': '#795548',
  'design': '#009688'
};

const DealerClassChart = () => {
  const [chartData, setChartData] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const scheduleData = await fetchScheduleData();
        const dealerNotes = await fetchDealerNotes();
        
        // Group by dealer class and production stage
        const stagesByClass = {
          'JV Dealer': {},
          'Self-owned Dealer': {},
          'External Dealer': {}
        };
        
        // Get all unique production stages (excluding 'finished')
        const allStages = new Set();
        
        scheduleData.forEach(item => {
          if (!item["Regent Production"] || 
              item["Regent Production"].toLowerCase() === "finished") {
            return;
          }
          
          const stage = item["Regent Production"].includes('-') ? 
            'Sea Freighting' : item["Regent Production"];
            
          allStages.add(stage);
          
          const dealer = item["Dealer"] || '';
          let dealerClass = 'External Dealer'; // Default class
          
          // Get dealer class from notes if available
          if (dealer && dealerNotes[dealer] && dealerNotes[dealer].class) {
            const classKey = dealerNotes[dealer].class;
            
            if (classKey === 'jv_dealer') {
              dealerClass = 'JV Dealer';
            } else if (classKey === 'self_owned_dealer') {
              dealerClass = 'Self-owned Dealer';
            }
          }
          
          // Initialize if needed
          if (!stagesByClass[dealerClass][stage]) {
            stagesByClass[dealerClass][stage] = 0;
          }
          
          // Increment the count
          stagesByClass[dealerClass][stage]++;
        });
        
        // Format data for chart
        const formattedChartData = Object.entries(stagesByClass).map(([className, stages]) => {
          const classData = { class: className };
          Array.from(allStages).forEach(stage => {
            classData[stage] = stages[stage] || 0;
          });
          return classData;
        });
        
        setChartData(formattedChartData);
        setStages(Array.from(allStages));
        setLoading(false);
      } catch (error) {
        console.error("Error preparing dealer class chart data:", error);
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!chartData || chartData.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <p className="text-gray-500">No dealer class data available</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="text-lg font-medium text-gray-700 mb-2">Production Stages by Dealer Class</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="class" />
          <YAxis />
          <Tooltip />
          <Legend />
          {stages.map((stage, index) => (
            <Bar 
              key={stage} 
              dataKey={stage} 
              stackId="a" 
              fill={COLORS[stage] || `hsl(${index * 60}, 70%, 60%)`} 
              name={stage}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DealerClassChart;