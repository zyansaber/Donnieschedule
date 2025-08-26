import React, { useState, useRef, useEffect } from 'react';
import Chart from 'chart.js/auto';

const AICharts = ({ data }) => {
  const [query, setQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chartConfig, setChartConfig] = useState(null);
  const [error, setError] = useState('');
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  // Sample queries for users to try
  const sampleQueries = [
    "Show me a bar chart of orders by dealer",
    "Create a pie chart of production stages distribution", 
    "Display a line chart of forecast production dates by month",
    "Generate a bar chart showing models by year",
    "Show me a doughnut chart of customer distribution"
  ];

  // Destroy existing chart when component unmounts or new chart is created
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, []);

  // AI-powered chart generation (using local processing)
  const generateChart = async () => {
    if (!query.trim() || !data || data.length === 0) {
      setError('Please enter a query and ensure data is loaded');
      return;
    }

    setIsGenerating(true);
    setError('');

    try {
      // Simple AI logic to parse queries and generate charts
      const config = parseQueryToChartConfig(query, data);
      
      if (!config) {
        throw new Error('Unable to understand the query. Try using keywords like "bar chart", "pie chart", "line chart" with data fields like "dealer", "model", "production stage".');
      }

      setChartConfig(config);
      renderChart(config);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Parse natural language query to chart configuration
  const parseQueryToChartConfig = (query, data) => {
    const lowerQuery = query.toLowerCase();
    
    // Determine chart type
    let chartType = 'bar'; // default
    if (lowerQuery.includes('pie')) chartType = 'pie';
    else if (lowerQuery.includes('line')) chartType = 'line';
    else if (lowerQuery.includes('doughnut')) chartType = 'doughnut';
    else if (lowerQuery.includes('scatter')) chartType = 'scatter';

    // Determine data field
    let dataField = null;
    let labelField = null;
    
    if (lowerQuery.includes('dealer')) {
      dataField = 'Dealer';
      labelField = 'Dealer';
    } else if (lowerQuery.includes('model')) {
      dataField = 'Model';
      labelField = 'Model';
    } else if (lowerQuery.includes('production stage') || lowerQuery.includes('stage')) {
      dataField = 'Regent Production';
      labelField = 'Production Stage';
    } else if (lowerQuery.includes('customer')) {
      dataField = 'Customer';
      labelField = 'Customer';
    } else if (lowerQuery.includes('forecast') || lowerQuery.includes('date')) {
      dataField = 'Forecast Production Date';
      labelField = 'Forecast Month';
    } else {
      return null; // Unable to parse
    }

    // Process data based on field
    const processedData = processDataForChart(data, dataField, lowerQuery);
    
    if (!processedData || processedData.labels.length === 0) {
      throw new Error(`No data found for ${labelField}`);
    }

    // Generate colors
    const colors = generateColors(processedData.labels.length);

    return {
      type: chartType,
      data: {
        labels: processedData.labels,
        datasets: [{
          label: `Count by ${labelField}`,
          data: processedData.values,
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: `${labelField} Distribution`
          },
          legend: {
            display: chartType === 'pie' || chartType === 'doughnut'
          }
        },
        scales: chartType === 'bar' || chartType === 'line' ? {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1
            }
          }
        } : {}
      }
    };
  };

  // Process data for chart generation
  const processDataForChart = (data, field, query) => {
    if (!data || !field) return null;

    const counts = {};
    
    data.forEach(item => {
      let value = item[field];
      
      // Special processing for dates
      if (field === 'Forecast Production Date' && value) {
        const dateParts = value.split('/');
        if (dateParts.length >= 3) {
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = parseInt(dateParts[1]) - 1;
          const year = dateParts[2];
          value = `${monthNames[month]} ${year}`;
        }
      }
      
      // Handle empty values
      if (!value || value.trim() === '') {
        value = 'No Data';
      }
      
      counts[value] = (counts[value] || 0) + 1;
    });

    // Sort by count (descending) and limit to top 15 for readability
    const sortedEntries = Object.entries(counts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 15);

    return {
      labels: sortedEntries.map(([label]) => label),
      values: sortedEntries.map(([, count]) => count)
    };
  };

  // Generate colors for chart
  const generateColors = (count) => {
    const baseColors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
      '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF6384',
      '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'
    ];
    
    const background = [];
    const border = [];
    
    for (let i = 0; i < count; i++) {
      background.push(baseColors[i % baseColors.length]);
      border.push(baseColors[i % baseColors.length]);
    }
    
    return { background, border };
  };

  // Render chart using Chart.js
  const renderChart = (config) => {
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }
    
    const ctx = chartRef.current?.getContext('2d');
    if (ctx) {
      chartInstance.current = new Chart(ctx, config);
    }
  };

  const handleSampleQuery = (sampleQuery) => {
    setQuery(sampleQuery);
  };

  const clearChart = () => {
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }
    setChartConfig(null);
    setError('');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Chart Generator</h1>
        <p className="text-gray-600">
          Generate charts from your data using natural language queries. Try asking for bar charts, pie charts, or line charts of different data fields.
        </p>
      </div>

      {/* Query Input */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex flex-col space-y-4">
          <div>
            <label htmlFor="query" className="block text-sm font-medium text-gray-700 mb-2">
              Describe the chart you want to create:
            </label>
            <textarea
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., Show me a bar chart of orders by dealer"
              className="w-full p-3 border border-gray-300 rounded-md resize-none"
              rows={3}
            />
          </div>
          
          <div className="flex space-x-3">
            <button
              onClick={generateChart}
              disabled={isGenerating || !query.trim()}
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Generating...' : 'Generate Chart'}
            </button>
            
            <button
              onClick={clearChart}
              className="bg-gray-500 text-white px-6 py-2 rounded-md hover:bg-gray-600"
            >
              Clear Chart
            </button>
          </div>
        </div>
      </div>

      {/* Sample Queries */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Try these sample queries:</h3>
        <div className="flex flex-wrap gap-2">
          {sampleQueries.map((sample, index) => (
            <button
              key={index}
              onClick={() => handleSampleQuery(sample)}
              className="text-sm bg-white border border-gray-300 rounded-full px-3 py-1 hover:bg-gray-100 transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <div className="flex">
            <div className="text-red-800">
              <strong>Error:</strong> {error}
            </div>
          </div>
        </div>
      )}

      {/* Chart Display */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="h-96 w-full relative">
          {chartConfig ? (
            <canvas ref={chartRef} className="max-w-full max-h-full" />
          ) : (
            <div className="h-full flex items-center justify-center text-center text-gray-500">
              <div>
                <div className="text-4xl mb-4">📊</div>
                <p>Your AI-generated chart will appear here</p>
                <p className="text-sm mt-2">Enter a query above to get started</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Data Info */}
      <div className="mt-6 bg-blue-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">Available Data Fields:</h3>
        <div className="text-sm text-blue-700 grid grid-cols-2 md:grid-cols-4 gap-2">
          <span>• Dealer</span>
          <span>• Model</span>
          <span>• Customer</span>
          <span>• Production Stage</span>
          <span>• Forecast Date</span>
          <span>• Chassis</span>
          <span>• Model Year</span>
        </div>
      </div>
    </div>
  );
};

export default AICharts;