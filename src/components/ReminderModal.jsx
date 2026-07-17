import React, { useState } from 'react';
import { queueEmailJob } from '../utils/emailJobs';

const ReminderModal = ({ selectedChassis = [], onClose }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  if (!selectedChassis.length) return null;

  const handleSubmit = async () => {
    if (!email) return;

    setLoading(true);
    try {
      await queueEmailJob({
        step: 'schedule_dashboard_reminder',
        role: 'schedule',
        to: email,
        title: 'Schedule Dashboard Reminder',
        content: `
          <h2>Schedule Dashboard Reminder</h2>
          <p>Selected chassis count: ${selectedChassis.length}</p>
          <p>${selectedChassis.join(', ')}</p>
        `,
        metadata: {
          source: 'schedule_dashboard_reminder',
          selectedChassis,
          chassisCount: selectedChassis.length,
        },
      });
      console.log('Reminder email queued successfully');
    } catch (error) {
      console.error('Error queueing email reminder:', error);
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
        <h2 className="text-lg font-bold mb-4">Set Email Reminder</h2>
        <p className="mb-4">Selected Chassis: {selectedChassis.join(', ')}</p>
        <input
          type="email"
          placeholder="Enter email address"
          className="w-full border rounded px-3 py-2 mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="bg-blue-600 text-white px-4 py-2 rounded"
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Send Reminder'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReminderModal;
