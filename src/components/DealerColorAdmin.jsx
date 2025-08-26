import React, { useState, useEffect } from 'react';
import { fetchDealerColors, saveDealerColors, fetchDealerNotes, saveDealerNotes, getUniqueDealers } from '../data/scheduleData';

const DealerColorAdmin = ({ data }) => {
  const [dealerColors, setDealerColors] = useState({});
  const [dealerNotes, setDealerNotes] = useState({});
  const [dealerClasses, setDealerClasses] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');

  // Get unique dealers from data
  const uniqueDealers = React.useMemo(() => {
    return getUniqueDealers(data || []);
  }, [data]);

  // Fetch dealer colors and notes from Firebase on component mount
  useEffect(() => {
    const getDealerData = async () => {
      try {
        setLoading(true);
        const colors = await fetchDealerColors();
        setDealerColors(colors || {});
        
        const notes = await fetchDealerNotes();
        setDealerNotes(notes || {});
        
        // Extract classes from notes
        const classesObj = {};
        Object.entries(notes || {}).forEach(([dealer, note]) => {
          if (note && note.class) {
            classesObj[dealer] = note.class;
          }
        });
        setDealerClasses(classesObj);
      } catch (error) {
        console.error("Error fetching dealer data:", error);
      } finally {
        setLoading(false);
      }
    };
    getDealerData();
  }, []);

  // Handle color change for a dealer
  const handleColorChange = (dealer, color) => {
    setDealerColors(prev => ({
      ...prev,
      [dealer]: color
    }));
  };

  // Handle note change for a dealer
  const handleNoteChange = (dealer, noteText) => {
    setDealerNotes(prev => ({
      ...prev,
      [dealer]: {
        ...prev[dealer] || {},
        text: noteText,
        class: dealerClasses[dealer] || 'external_dealer'
      }
    }));
  };

  // Handle class change for a dealer
  const handleClassChange = (dealer, className) => {
    setDealerNotes(prev => ({
      ...prev,
      [dealer]: {
        ...prev[dealer] || {},
        text: prev[dealer]?.text || '',
        class: className
      }
    }));
    
    setDealerClasses(prev => ({
      ...prev,
      [dealer]: className
    }));
  };

  // Save colors and notes to Firebase
  const handleSaveData = async () => {
    try {
      setSaveStatus('saving');
      await saveDealerColors(dealerColors);
      await saveDealerNotes(dealerNotes);
      setSaveStatus('success');
      
      // Reset status after showing success message
      setTimeout(() => {
        setSaveStatus('');
      }, 3000);
    } catch (error) {
      console.error("Error saving dealer data:", error);
      setSaveStatus('error');
    }
  };

  // Default color options
  const colorOptions = [
    { name: 'None', value: '' },
    { name: 'Blue Light', value: '#e3f2fd' },
    { name: 'Purple Light', value: '#f3e5f5' },
    { name: 'Green Light', value: '#e8f5e9' },
    { name: 'Yellow Light', value: '#fff8e1' },
    { name: 'Orange Light', value: '#fff3e0' },
    { name: 'Red Light', value: '#ffebee' },
    { name: 'Brown Light', value: '#efebe9' },
    { name: 'Grey Light', value: '#f5f5f5' },
    { name: 'Blue', value: '#bbdefb' },
    { name: 'Purple', value: '#e1bee7' },
    { name: 'Green', value: '#c8e6c9' },
    { name: 'Yellow', value: '#ffecb3' },
    { name: 'Orange', value: '#ffe0b2' },
    { name: 'Red', value: '#ffcdd2' },
    { name: 'Brown', value: '#d7ccc8' },
    { name: 'Grey', value: '#e0e0e0' },
  ];

  // Class options for dealers - updated as requested
  const classOptions = [
    { value: 'jv_dealer', label: 'JV Dealer' },
    { value: 'self_owned_dealer', label: 'Self-owned Dealer' },
    { value: 'external_dealer', label: 'External Dealer' }
  ];

  return (
    <div className="p-6 bg-white rounded-lg shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">Dealer Administration</h1>
        <button
          className={`px-4 py-2 rounded-md text-white ${
            saveStatus === 'saving' 
              ? 'bg-gray-400' 
              : saveStatus === 'error' 
                ? 'bg-red-600' 
                : 'bg-blue-600 hover:bg-blue-700'
          }`}
          onClick={handleSaveData}
          disabled={saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? 'Saving...' : 
           saveStatus === 'success' ? 'Saved!' : 
           saveStatus === 'error' ? 'Error!' : 'Save Changes'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {uniqueDealers.map(dealer => (
            <div 
              key={dealer} 
              className="border border-gray-200 rounded-md p-4"
              style={{ backgroundColor: dealerColors[dealer] || 'white' }}
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium">{dealer}</h3>
              </div>
              
              <div className="flex flex-col space-y-3">
                {/* Color Selection */}
                <div>
                  <label className="text-sm text-gray-600 block mb-1">Background Color</label>
                  <select
                    className="border border-gray-300 rounded-md py-2 px-3 w-full"
                    value={dealerColors[dealer] || ''}
                    onChange={(e) => handleColorChange(dealer, e.target.value)}
                  >
                    {colorOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  
                  <div className="flex flex-wrap gap-1 mt-2">
                    {colorOptions.slice(1).map(option => (
                      <button
                        key={option.value}
                        className={`w-6 h-6 rounded-full border ${
                          dealerColors[dealer] === option.value ? 'border-black' : 'border-gray-200'
                        }`}
                        style={{ backgroundColor: option.value }}
                        onClick={() => handleColorChange(dealer, option.value)}
                        title={option.name}
                      />
                    ))}
                  </div>
                </div>
                
                {/* Dealer Class */}
                <div>
                  <label className="text-sm text-gray-600 block mb-1">Dealer Type</label>
                  <select
                    className="border border-gray-300 rounded-md py-2 px-3 w-full"
                    value={dealerClasses[dealer] || dealerNotes[dealer]?.class || 'external_dealer'}
                    onChange={(e) => handleClassChange(dealer, e.target.value)}
                  >
                    {classOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                {/* Dealer Notes */}
                <div>
                  <label className="text-sm text-gray-600 block mb-1">Notes</label>
                  <textarea
                    className="border border-gray-300 rounded-md py-2 px-3 w-full h-24"
                    value={dealerNotes[dealer]?.text || ''}
                    onChange={(e) => handleNoteChange(dealer, e.target.value)}
                    placeholder="Add notes about this dealer..."
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DealerColorAdmin;