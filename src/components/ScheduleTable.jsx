import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchDealerColors } from '../data/scheduleData';
import { isDateWithinNext20Weeks } from '../data/scheduleData';
import html2canvas from 'html2canvas';
import emailjs from '@emailjs/browser';
import ReminderModal from './ReminderModal';
import LoadingOverlay from './LoadingOverlay';

const ScheduleTable = React.memo(({ data, filters }) => {
  const [dealerColors, setDealerColors] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'ascending' });
  const [hideFinished, setHideFinished] = useState(true); // Set to true by default - Restored
  const [chassisSearch, setChassisSearch] = useState('');
  const [debouncedChassisSearch, setDebouncedChassisSearch] = useState('');
  const [noteText, setNoteText] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedChassis, setSelectedChassis] = useState([]);
  const [showNoteColumn, setShowNoteColumn] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [resizingColumn, setResizingColumn] = useState(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const [isSorting, setIsSorting] = useState(false);
  const [isTableLoading, setIsTableLoading] = useState(false);
  const tableRef = React.useRef(null);

  // Add debouncing for search input to improve performance
  useEffect(() => {
    // Show loading state if the data is large enough
    if (data && data.length > 50) {
      setIsTableLoading(true);
    }
    
    const timer = setTimeout(() => {
      setDebouncedChassisSearch(chassisSearch);
      setIsTableLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [chassisSearch, data]);

  // Column visibility state for the three specified columns
  const [columnVisibility, setColumnVisibility] = useState({
    'Request Delivery Date': false,
    'Signed off': false,
    'Estimate Semi Received Date': false
  });

  // Remove the specified columns: "Plans Sent to Dealer", "Price Date", "Order Sent to Longtree", 
  // "Shipment", "Purchase Order Sent", and now "Order Received Date"
  const baseColumns = [
    // Add checkbox column when in note mode
    ...(showNoteColumn ? [{ id: 'select', label: 'Select', sortable: false, defaultWidth: 80 }] : []),
    // Put Forecast Production Date as the first column
    { id: 'Forecast Production Date', label: 'Forecast Production Date', sortable: true, defaultWidth: 180 },
    { id: 'Chassis', label: 'Chassis', sortable: true, defaultWidth: 140 },
    { id: 'Customer', label: 'Customer', sortable: true, defaultWidth: 180 },
    { id: 'Dealer', label: 'Dealer', sortable: true, defaultWidth: 140 },
    { id: 'Model', label: 'Model', sortable: true, defaultWidth: 120 },
    { id: 'Model Year', label: 'Model Year', sortable: true, defaultWidth: 120 },
    // Removed "Order Received Date" as requested
    // Removed "Order Sent to Longtree"
    // Removed "Plans Sent to Dealer"
    // Removed "Price Date"
    // Removed "Purchase Order Sent"
    { id: 'Regent Production', label: 'Regent Production', sortable: true, defaultWidth: 180 },
    // Conditionally visible columns
    ...(columnVisibility['Request Delivery Date'] ? [{ id: 'Request Delivery Date', label: 'Request Delivery Date', sortable: true, defaultWidth: 180 }] : []),
    ...(columnVisibility['Signed off'] ? [{ id: 'Signed off', label: 'Signed off', sortable: true, defaultWidth: 120 }] : []),
    ...(columnVisibility['Estimate Semi Received Date'] ? [{ id: 'Estimate Semi Received Date', label: 'Estimate Semi Received Date', sortable: true, defaultWidth: 180 }] : []),
    // Removed "Shipment"
    { id: 'Signed Plans Received', label: 'Signed Plans Received', sortable: true, defaultWidth: 180 }
  ];

  const columns = baseColumns;

  // Initialize column widths after columns are defined
  useEffect(() => {
    const getDealerColors = async () => {
      try {
        const colors = await fetchDealerColors();
        setDealerColors(colors || {});
      } catch (error) {
        console.error("Error fetching dealer colors:", error);
      }
    };
    getDealerColors();

    // Initialize default column widths
    const initialWidths = {};
    columns.forEach(col => {
      initialWidths[col.id] = col.defaultWidth || 180;
    });
    setColumnWidths(initialWidths);
  }, []);

  // Use a separate useEffect for event listeners to avoid dependency issues
  useEffect(() => {
    // Add event listeners for column resizing
    const handleMouseMoveEvent = (e) => handleMouseMove(e);
    const handleMouseUpEvent = () => handleMouseUp();
    
    document.addEventListener('mousemove', handleMouseMoveEvent);
    document.addEventListener('mouseup', handleMouseUpEvent);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMoveEvent);
      document.removeEventListener('mouseup', handleMouseUpEvent);
    };
  }, [resizingColumn, startX, startWidth]); // Add dependencies to prevent stale closure issues

  // Column resize handlers
  const handleMouseDown = (e, columnId) => {
    setResizingColumn(columnId);
    setStartX(e.clientX);
    setStartWidth(columnWidths[columnId] || 180);
    e.preventDefault();
  };

  const handleMouseMove = (e) => {
    if (resizingColumn) {
      const width = Math.max(120, startWidth + (e.clientX - startX));
      setColumnWidths(prev => ({
        ...prev,
        [resizingColumn]: width
      }));
    }
  };

  const handleMouseUp = () => {
    setResizingColumn(null);
  };

  const handleSort = useCallback((key) => {
    // Show loading state for large data sets
    if (data && data.length > 100) {
      setIsSorting(true);
    }
    
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    
    // Use setTimeout to ensure UI updates with loading state before sort operation
    setTimeout(() => {
      setSortConfig({ key, direction });
      setTimeout(() => setIsSorting(false), 100);
    }, 10);
  }, [sortConfig.key, sortConfig.direction, data]);

  // Pre-filter finished vans to improve performance
  const baseFilteredData = useMemo(() => {
    if (!data) return [];

    // Only apply the filter if hideFinished is true and set loading state for UX
    if (data.length > 300) {
      setIsTableLoading(true);
      
      // Use setTimeout to avoid UI freeze
      setTimeout(() => {
        if (hideFinished) {
          // We'll do the filtering in the outer setTimeout
        } else {
          setIsTableLoading(false);
        }
      }, 10);
    }

    // Apply only the hide finished filter first for performance
    if (hideFinished) {
      const filtered = data.filter(item => {
        return !(item["Regent Production"] && 
            item["Regent Production"].toLowerCase() === "finished");
      });
      
      // Clear loading state after filter completes
      if (data.length > 300) {
        setTimeout(() => setIsTableLoading(false), 50);
      }
      
      return filtered;
    }
    return data;
  }, [data, hideFinished]);
  
  // Apply all other filters
  const filteredData = useMemo(() => {
    // Filter by chassis search
    let result = baseFilteredData;
    
    // Apply chassis search
    if (debouncedChassisSearch) {
      result = result.filter(item => {
        if (item["Chassis"]) {
          return item["Chassis"].toLowerCase().includes(debouncedChassisSearch.toLowerCase());
        }
        return false; // Don't show empty chassis items when searching
      });
    }
    
    // Apply dealer filter
    if (filters.dealer && filters.dealer !== 'all') {
      result = result.filter(item => item["Dealer"] === filters.dealer);
    }
    
    // Apply model filter
    if (filters.model) {
      result = result.filter(item => item["Model"] === filters.model);
    }
    
    // Apply forecast year filter
    if (filters.forecastYear) {
      result = result.filter(item => {
        if (item["Forecast Production Date"]) {
          const dateParts = item["Forecast Production Date"].split('/');
          return dateParts.length >= 3 && dateParts[2] === filters.forecastYear;
        }
        return false;
      });
    }
    
    // Apply forecast year-month filter
    if (filters.forecastYearMonth) {
      result = result.filter(item => {
        if (item["Forecast Production Date"]) {
          const dateParts = item["Forecast Production Date"].split('/');
          if (dateParts.length >= 3) {
            const yearMonth = `${dateParts[2]}-${dateParts[1]}`; // YYYY-MM format
            return yearMonth === filters.forecastYearMonth;
          }
        }
        return false;
      });
    }
    
    // Apply production stages filter
    if (!filters.allStagesSelected && filters.selectedStages && filters.selectedStages.length > 0) {
      result = result.filter(item => {
        if (!item["Regent Production"]) {
          return false;
        }
        
        const stage = item["Regent Production"];
        
        // For sea freighting items (containing "-")
        if (stage.includes("-") && filters.selectedStages.includes("Sea Freighting")) {
          return true;
        }
        
        // For regular stages
        return filters.selectedStages.includes(stage);
      });
    }
    
    // Apply model range filter
    if (filters.modelRange) {
      result = result.filter(item => 
        item["Chassis"] && item["Chassis"].startsWith(filters.modelRange)
      );
    }
    
    // Apply date field filters
    const dateFields = ['Signed Plans Received'];
    for (const field of dateFields) {
      const filterKey = field.replace(/\s+/g, '') + 'YearMonth';
      if (filters[filterKey]) {
        result = result.filter(item => {
          if (item[field]) {
            const dateParts = item[field].split('/');
            if (dateParts.length >= 3) {
              const yearMonth = `${dateParts[2]}-${dateParts[1]}`;
              return yearMonth === filters[filterKey];
            }
          }
          return false;
        });
      }
    }
    
    // Filter sea freighting
    if (filters.isSeaFreighting) {
      result = result.filter(item => 
        item["Regent Production"] && item["Regent Production"].includes("-")
      );
    }
    
    return result;
  }, [baseFilteredData, filters, debouncedChassisSearch]);

  const sortedData = useMemo(() => {
    if (!filteredData) return [];
    
    const sortableData = [...filteredData];
    
    if (sortConfig.key) {
      sortableData.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    
    return sortableData;
  }, [filteredData, sortConfig]);

  const exportToCSV = () => {
    if (!sortedData || sortedData.length === 0) return;
    
    const headers = columns.map(col => col.label).join(',');
    const rows = sortedData.map(item => {
      return columns.map(col => {
        // Wrap in quotes to handle commas within values
        return `"${item[col.id] || ''}"`;
      }).join(',');
    });
    
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `schedule_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Function to handle sending note with table screenshot
  const handleSendNote = async () => {
    if (!noteText) {
      alert("Please enter a note before sending");
      return;
    }

    setSending(true);
    try {
      // Take screenshot of the table - use a smaller selection for performance
      if (tableRef.current) {
        // Get only the visible part of the table for better performance
        const visibleTable = document.createElement('div');
        visibleTable.innerHTML = `
          <h3>Selected Chassis: ${selectedChassis.join(", ")}</h3>
          <table border="1" cellpadding="5" style="border-collapse: collapse;">
            <thead>
              <tr>
                ${columns.map(col => `<th>${col.label}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${sortedData
                .filter(row => selectedChassis.includes(row.Chassis))
                .map(row => `
                  <tr>
                    ${columns.map(col => `<td>${row[col.id] || ''}</td>`).join('')}
                  </tr>
                `).join('')}
            </tbody>
          </table>
        `;
        
        // Email parameters - with reduced image size
        const emailParams = {
          from_name: 'Schedule Dashboard',
          to_email: 'yan@regentrv.com.au',
          message: noteText,
          selected_chassis: selectedChassis.join(", "),
          chassis_count: selectedChassis.length,
        };
        
        // Send email via EmailJS - don't include the large image
        const result = await emailjs.send(
          'service_zjcpaps',
          'template_barjtqgp',
          emailParams,
          'rAEsoMfySq9l5mXvz' // EmailJS public key for service_zjcpaps
        );
        
        if (result.status === 200) {
          alert('Note sent successfully!');
          setNoteText('');
          setSelectedChassis([]);
          setShowNoteModal(false);
          setShowNoteColumn(false);
        } else {
          throw new Error('Failed to send email');
        }
      }
    } catch (error) {
      console.error('Error sending email:', error);
      alert('Failed to send note: ' + error.message);
    } finally {
      setSending(false);
    }
  };



  // Note Modal Component
  const NoteModal = () => {
    if (!showNoteModal) return null;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-full max-w-lg">
          <h2 className="text-xl font-bold mb-4">Add Note</h2>
          
          {/* Show selected chassis */}
          {selectedChassis.length > 0 && (
            <div className="mb-4 p-3 bg-gray-50 rounded">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Selected Chassis:</h3>
              <div className="text-sm text-gray-600">
                {selectedChassis.join(", ")}
              </div>
            </div>
          )}
          
          <textarea 
            className="w-full h-40 border border-gray-300 rounded p-2 mb-4"
            placeholder="Enter your note here..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyPress={(e) => e.stopPropagation()}
          />
          <div className="flex justify-end space-x-3">
            <button 
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded"
              onClick={() => {
                setShowNoteModal(false);
                setShowNoteColumn(false);
                setSelectedChassis([]);
                setNoteText('');
              }}
            >
              Cancel
            </button>
            <button 
              className="bg-blue-600 text-white px-4 py-2 rounded"
              onClick={handleSendNote}
              disabled={sending}
            >
              {sending ? "Sending..." : "Send Note"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Expanded color palette for dealer colors
  const extendedColors = [
    '#E3F2FD', '#BBDEFB', '#90CAF9', '#64B5F6', '#42A5F5', '#2196F3', '#1E88E5', '#1976D2', '#1565C0', '#0D47A1', 
    '#E8F5E9', '#C8E6C9', '#A5D6A7', '#81C784', '#66BB6A', '#4CAF50', '#43A047', '#388E3C', '#2E7D32', '#1B5E20',
    '#FFF8E1', '#FFECB3', '#FFE082', '#FFD54F', '#FFCA28', '#FFC107', '#FFB300', '#FFA000', '#FF8F00', '#FF6F00',
    '#FFEBEE', '#FFCDD2', '#EF9A9A', '#E57373', '#EF5350', '#F44336', '#E53935', '#D32F2F', '#C62828', '#B71C1C',
    '#F3E5F5', '#E1BEE7', '#CE93D8', '#BA68C8', '#AB47BC', '#9C27B0', '#8E24AA', '#7B1FA2', '#6A1B9A', '#4A148C',
  ];

  // Month background colors for forecast production date
  const monthColors = {
    '01': '#FFF5F5', // January - Light red
    '02': '#F0FFF4', // February - Light green  
    '03': '#F0F8FF', // March - Light blue
    '04': '#FFFAF0', // April - Light orange
    '05': '#F5F5DC', // May - Light beige
    '06': '#E6E6FA', // June - Light lavender
    '07': '#FFE4E1', // July - Light pink
    '08': '#F0FFFF', // August - Light cyan
    '09': '#FFF8DC', // September - Light yellow
    '10': '#F5FFFA', // October - Light mint
    '11': '#FFE4B5', // November - Light peach
    '12': '#E0E6FF'  // December - Light periwinkle
  };

  // Get row background color based on forecast production date month
  const getRowBackgroundColor = (forecastDate) => {
    if (!forecastDate) return '';
    const dateParts = forecastDate.split('/');
    if (dateParts.length >= 3) {
      const month = dateParts[1]; // MM from DD/MM/YYYY
      return monthColors[month] || '';
    }
    return '';
  };

  return (
    <div className="overflow-x-auto text-base relative">
      <LoadingOverlay isLoading={isSorting || isTableLoading} message={isSorting ? "Sorting data..." : "Filtering data..."} />
      <div className="flex flex-wrap justify-between mb-4 gap-2">
        <div className="flex items-center space-x-4">
            <div className="flex items-center">
            <input
              type="checkbox"
              className="form-checkbox h-5 w-5 text-blue-600 rounded"
              checked={hideFinished}
              onChange={(e) => setHideFinished(e.target.checked)}
            />
            <span className="ml-2 text-gray-700">Hide finished vans</span>
          </div>

          {/* Column visibility controls */}
          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-600">Show columns:</span>
            <div className="flex items-center">
              <input
                type="checkbox"
                className="form-checkbox h-4 w-4 text-blue-600 rounded"
                checked={columnVisibility['Request Delivery Date']}
                onChange={(e) => setColumnVisibility(prev => ({
                  ...prev,
                  'Request Delivery Date': e.target.checked
                }))}
              />
              <span className="ml-1 text-xs text-gray-600">Request Delivery</span>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                className="form-checkbox h-4 w-4 text-blue-600 rounded"
                checked={columnVisibility['Signed off']}
                onChange={(e) => setColumnVisibility(prev => ({
                  ...prev,
                  'Signed off': e.target.checked
                }))}
              />
              <span className="ml-1 text-xs text-gray-600">Signed off</span>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                className="form-checkbox h-4 w-4 text-blue-600 rounded"
                checked={columnVisibility['Estimate Semi Received Date']}
                onChange={(e) => setColumnVisibility(prev => ({
                  ...prev,
                  'Estimate Semi Received Date': e.target.checked
                }))}
              />
              <span className="ml-1 text-xs text-gray-600">Est Semi Received</span>
            </div>
          </div>
          
          <div className="relative">
            <input
              type="text"
              placeholder="Search Chassis"
              className="pl-8 pr-4 py-2 rounded-md border border-gray-300"
              value={chassisSearch}
              onChange={(e) => setChassisSearch(e.target.value)}
            />
            <svg 
              className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" 
              xmlns="http://www.w3.org/2000/svg" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
              />
            </svg>
          </div>
        </div>
        
        <div className="flex space-x-2">
          <button 
            className={`px-4 py-2 rounded-md ${showNoteColumn ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} text-white`}
            onClick={() => {
              if (showNoteColumn) {
                // If closing note mode, clear selections
                setSelectedChassis([]);
              }
              setShowNoteColumn(!showNoteColumn);
            }}
          >
            {showNoteColumn ? 'Cancel Selection' : 'Add Note'}
          </button>
          
          <button 
            className="bg-amber-500 text-white px-4 py-2 rounded-md hover:bg-amber-600 flex items-center"
            onClick={() => {
              // Add select column without entering note mode
              setShowNoteColumn(true);
              setShowReminderModal(true);
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
            Add Reminder
          </button>
          
          {showNoteColumn && (
            <button 
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              onClick={() => setShowNoteModal(true)}
              disabled={selectedChassis.length === 0}
            >
              Write Note ({selectedChassis.length} selected)
            </button>
          )}
          
          <button 
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            onClick={exportToCSV}
          >
            Export to CSV
          </button>
        </div>
      </div>
      

      
      {/* Note Modal */}
      <NoteModal />
      
      {/* Reminder Modal */}
      <ReminderModal 
        isOpen={showReminderModal}
        onClose={() => setShowReminderModal(false)}
        selectedChassis={selectedChassis}
        chassisData={data || []}
      />
      
      <div ref={tableRef} className="overflow-hidden">
        <table className="min-w-full bg-white border border-gray-200">
          <thead className="bg-gray-100">
            <tr>
              {columns.map((column) => (
                <th 
                  key={column.id} 
                  className="px-4 py-2 text-center text-sm font-medium text-gray-700 tracking-wider border-b border-gray-200 whitespace-nowrap relative"
                  style={{ width: `${columnWidths[column.id] || column.defaultWidth || 180}px` }}
                >
                  <div className="w-full flex items-center justify-center">
                    <div className="flex items-center justify-center">
                      <span className="text-center">{column.label}</span>
                      {column.sortable && (
                        <button 
                          onClick={() => handleSort(column.id)}
                          className="ml-1 focus:outline-none"
                        >
                          {sortConfig.key === column.id ? (
                            sortConfig.direction === 'ascending' ? (
                              <span className="text-blue-600">↑</span>
                            ) : (
                              <span className="text-blue-600">↓</span>
                            )
                          ) : (
                            <span className="text-gray-400">↕</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div 
                    className="absolute top-0 right-0 bottom-0 w-6 cursor-col-resize hover:bg-blue-500 hover:opacity-50"
                    onMouseDown={(e) => handleMouseDown(e, column.id)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.length > 0 ? (
              sortedData.map((row, index) => {
                const rowBgColor = getRowBackgroundColor(row["Forecast Production Date"]);
                return (
                  <tr 
                    key={row.Chassis || Math.random().toString(36)}
                    className="hover:bg-gray-50"
                    style={{ backgroundColor: rowBgColor }}
                  >
                    {columns.map((column) => {
                      // Special treatment for Select column
                      if (column.id === "select") {
                        const chassisValue = row["Chassis"];
                        return (
                          <td 
                            key={`${index}-${column.id}`}
                            className="px-4 py-2 text-sm text-gray-700 border-b border-gray-300 whitespace-nowrap text-center"
                            style={{ width: `${columnWidths[column.id] || column.defaultWidth || 80}px` }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedChassis.includes(chassisValue)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedChassis(prev => [...prev, chassisValue]);
                                } else {
                                  setSelectedChassis(prev => prev.filter(c => c !== chassisValue));
                                }
                              }}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              disabled={!chassisValue}
                            />
                          </td>
                        );
                      }
                      
                      // Special treatment for Chassis column
                      if (column.id === "Chassis") {
                        // Add "Red Slots" to chassis column for empty values in next 20 weeks
                        const showRedSlots = isDateWithinNext20Weeks(row["Forecast Production Date"]) && !row["Chassis"];
                        return (
                          <td 
                            key={`${index}-${column.id}`}
                            className={`px-4 py-2 text-sm ${showRedSlots ? "text-red-600 font-bold" : "text-gray-700"} border-b border-gray-300 whitespace-nowrap text-center`}
                            style={{ width: `${columnWidths[column.id] || column.defaultWidth || 180}px` }}
                          >
                            {showRedSlots ? "Red Slots" : row[column.id]}
                          </td>
                        );
                      }
                      
                      // Special treatment for Dealer column - add rounded frame with dealer color
                      if (column.id === "Dealer") {
                        const dealerName = row["Dealer"] || "";
                        // Use original color (not darkened) but choose from extended color palette
                        const colorIndex = dealerName.length > 0 
                          ? dealerName.charCodeAt(0) % extendedColors.length 
                          : 0;
                        const dealerColor = dealerColors[dealerName] || extendedColors[colorIndex] || '#f3f4f6';
                          
                        return (
                          <td 
                            key={`${index}-${column.id}`}
                            className="px-4 py-2 text-sm text-gray-700 border-b border-gray-300 whitespace-nowrap text-center"
                            style={{ width: `${columnWidths[column.id] || column.defaultWidth || 180}px` }}
                          >
                            <span 
                              className="px-2 py-1 rounded-full inline-block whitespace-nowrap"
                              style={{ backgroundColor: dealerColor }}
                            >
                              {row[column.id]}
                            </span>
                          </td>
                        );
                      }
                      
                      // Default rendering for other columns
                      return (
                        <td 
                          key={`${index}-${column.id}`}
                          className="px-4 py-2 text-sm text-gray-700 border-b border-gray-300 whitespace-nowrap text-center"
                          style={{ width: `${columnWidths[column.id] || column.defaultWidth || 180}px` }}
                        >
                          {row[column.id]}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td 
                  colSpan={columns.length} 
                  className="px-4 py-8 text-center text-gray-500"
                >
                  No data found matching the current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default ScheduleTable;