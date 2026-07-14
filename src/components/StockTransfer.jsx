import React, { useEffect, useMemo, useState } from 'react';
import { off, onValue, push, ref, set } from 'firebase/database';
import { database } from '../utils/firebase';

const initialForm = {
  chassis: '',
  currentLocation: '',
  targetLocation: '',
};

const normalizeChassis = (value) => value.trim().toUpperCase();

const getMelbourneTime = () => new Date().toLocaleString('en-AU', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const StockTransfer = () => {
  const [form, setForm] = useState(initialForm);
  const [transfers, setTransfers] = useState({});
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const transfersRef = ref(database, 'stock_transfer');
    const handleValue = (snapshot) => {
      setTransfers(snapshot.exists() ? (snapshot.val() || {}) : {});
      setLoadingTransfers(false);
    };

    const handleError = (error) => {
      console.error('Failed to load stock transfers:', error);
      setMessage('Error loading stock transfers.');
      setLoadingTransfers(false);
    };

    onValue(transfersRef, handleValue, handleError);
    return () => off(transfersRef, 'value', handleValue);
  }, []);

  const transferList = useMemo(() => Object.entries(transfers || {})
    .map(([id, transfer]) => ({ id, ...transfer }))
    .sort((a, b) => (b?.savedAt || '').localeCompare(a?.savedAt || '')), [transfers]);

  const handleInputChange = (field, value) => {
    setMessage('');
    setForm((currentForm) => ({
      ...currentForm,
      [field]: field === 'chassis' ? value.toUpperCase() : value,
    }));
  };

  const handleClear = () => {
    setForm(initialForm);
    setMessage('');
  };

  const handleSave = async () => {
    const chassis = normalizeChassis(form.chassis);
    const currentLocation = form.currentLocation.trim();
    const targetLocation = form.targetLocation.trim();

    if (!chassis) {
      setMessage('Please enter a chassis number.');
      return;
    }

    if (!currentLocation) {
      setMessage('Please enter the current stock location.');
      return;
    }

    if (!targetLocation) {
      setMessage('Please enter the target stock location.');
      return;
    }

    if (currentLocation.toLowerCase() === targetLocation.toLowerCase()) {
      setMessage('Current and target stock locations must be different.');
      return;
    }

    setSaving(true);
    setMessage('');

    const savedAt = getMelbourneTime();
    const transferData = {
      chassis,
      currentLocation,
      targetLocation,
      transferType: 'Yard stock to yard stock only',
      savedAt,
    };

    try {
      const newTransferRef = push(ref(database, 'stock_transfer'));
      await set(newTransferRef, transferData);
      setForm(initialForm);
      setMessage(`Saved stock transfer for ${chassis}.`);
    } catch (error) {
      console.error('Failed to save stock transfer:', error);
      setMessage('Error saving stock transfer.');
    } finally {
      setSaving(false);
    }
  };

  const isErrorMessage = message.includes('Error') || message.includes('Please') || message.includes('must');

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold text-gray-800">Stock Transfer</h2>
        <p className="mt-1 text-sm text-gray-500">
          This page is only for transfers from yard stock to yard stock. Enter the chassis number,
          current stock location, and the stock location you want to move it to.
        </p>
      </div>

      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <span className="font-semibold">Important:</span> Only use this page for yard stock to yard stock transfers.
        Do not use it for customer sold units, dealer transfers, or non-yard stock moves.
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-800">New Stock Transfer</h3>
          <p className="text-xs text-gray-500">All fields are required before saving to Firebase.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="stock-transfer-chassis">
              Chassis Number
            </label>
            <input
              id="stock-transfer-chassis"
              type="text"
              value={form.chassis}
              onChange={(event) => handleInputChange('chassis', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter chassis number"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="stock-transfer-current-location">
              Current Stock Location
            </label>
            <input
              id="stock-transfer-current-location"
              type="text"
              value={form.currentLocation}
              onChange={(event) => handleInputChange('currentLocation', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Current yard stock location"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="stock-transfer-target-location">
              Target Stock Location
            </label>
            <input
              id="stock-transfer-target-location"
              type="text"
              value={form.targetLocation}
              onChange={(event) => handleInputChange('targetLocation', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Move to yard stock location"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loadingTransfers}
            className={`px-5 py-2 rounded-md font-medium ${
              !saving && !loadingTransfers
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-gray-400 text-gray-200 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save Stock Transfer'}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="px-4 py-2 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
          {message && (
            <div className={`text-sm ${isErrorMessage ? 'text-red-600' : 'text-green-600'}`}>
              {message}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-700">Saved Stock Transfers</h3>
          <span className="text-sm text-gray-500">{transferList.length} total</span>
        </div>

        {transferList.length === 0 ? (
          <div className="text-center text-gray-500 py-6">
            {loadingTransfers ? 'Loading stock transfers...' : 'No saved stock transfers yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chassis</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Current Location</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Move To</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Allowed Use</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Saved At</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transferList.map((transfer) => (
                  <tr key={transfer.id}>
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">{transfer.chassis || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{transfer.currentLocation || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{transfer.targetLocation || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{transfer.transferType || 'Yard stock to yard stock only'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{transfer.savedAt || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default StockTransfer;
