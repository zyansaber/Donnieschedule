import React, { useMemo, useState, useEffect } from 'react';
import { get, ref, set } from 'firebase/database';
import { database } from '../utils/firebase';

const normalizeChassis = (value) => value.trim().toUpperCase();

const buildReservationKey = (chassis) => normalizeChassis(chassis).replace(/[.#$\/\[\]]/g, '_');

const getMelbourneTime = () => new Date().toLocaleString('en-AU', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const StockReservation = ({ data = [] }) => {
  const [chassisInput, setChassisInput] = useState('');
  const [reason, setReason] = useState('');
  const [reservations, setReservations] = useState({});
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const normalizedChassis = normalizeChassis(chassisInput);
  const reservationKey = normalizedChassis ? buildReservationKey(normalizedChassis) : '';
  const existingReservation = reservationKey ? reservations[reservationKey] : null;

  const selectedVan = useMemo(() => {
    if (!normalizedChassis) return null;
    return (data || []).find((item) => (
      item?.Chassis && item.Chassis.toLowerCase() === normalizedChassis.toLowerCase()
    )) || null;
  }, [data, normalizedChassis]);

  useEffect(() => {
    const loadReservations = async () => {
      try {
        const reservationRef = ref(database, 'stock_reservation');
        const snapshot = await get(reservationRef);
        if (snapshot.exists()) {
          setReservations(snapshot.val() || {});
        } else {
          setReservations({});
        }
      } catch (error) {
        console.error('Failed to load stock reservations:', error);
        setMessage('Error loading stock reservations. Please try refreshing the page.');
      } finally {
        setLoadingReservations(false);
      }
    };

    loadReservations();
  }, []);

  useEffect(() => {
    setReason(existingReservation?.reason || '');
  }, [reservationKey, existingReservation?.reason]);

  const handleSave = async () => {
    if (!normalizedChassis) {
      setMessage('Please enter a chassis number before saving.');
      return;
    }

    if (!selectedVan) {
      setMessage('Chassis number not found in the schedule data.');
      return;
    }

    if (!reason.trim()) {
      setMessage('Please enter a reason before saving.');
      return;
    }

    setSaving(true);
    setMessage('');

    const reservationData = {
      chassis: normalizedChassis,
      forecastProductionDate: selectedVan['Forecast Production Date'] || '',
      status: selectedVan['Regent Production'] || selectedVan['Regent Production Status'] || selectedVan.status || '',
      dealer: selectedVan.Dealer || '',
      reason: reason.trim(),
      savedAt: getMelbourneTime(),
    };

    try {
      await set(ref(database, `stock_reservation/${reservationKey}`), reservationData);
      setReservations((previous) => ({ ...previous, [reservationKey]: reservationData }));
      setMessage(`Stock reservation saved for ${normalizedChassis}.`);
    } catch (error) {
      console.error('Failed to save stock reservation:', error);
      setMessage('Error saving stock reservation. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const reservationList = Object.values(reservations || {}).sort((a, b) => (
    (b?.savedAt || '').localeCompare(a?.savedAt || '')
  ));

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold text-gray-800">Stock Reservation</h2>
        <p className="mt-1 text-sm text-gray-500">
          Enter a chassis number, review the stock details, add a reason, then save it to Firebase under stock_reservation.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chassis Number</label>
            <input
              type="text"
              value={chassisInput}
              onChange={(event) => setChassisInput(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Enter chassis"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Forecast Production Date</label>
            <div className="min-h-[42px] flex items-center px-3 py-2 bg-gray-50 border rounded-md text-sm text-gray-800">
              {selectedVan?.['Forecast Production Date'] || '-'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <div className="min-h-[42px] flex items-center px-3 py-2 bg-gray-50 border rounded-md text-sm text-gray-800">
              {selectedVan?.['Regent Production'] || selectedVan?.['Regent Production Status'] || selectedVan?.status || '-'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dealer</label>
            <div className="min-h-[42px] flex items-center px-3 py-2 bg-gray-50 border rounded-md text-sm text-gray-800">
              {selectedVan?.Dealer || '-'}
            </div>
          </div>
        </div>

        {normalizedChassis && !selectedVan && (
          <div className="mt-3 text-sm text-red-600">Chassis number not found in schedule data.</div>
        )}

        {existingReservation && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This chassis is already in stock_reservation. You can update the reason and save again.
            <div className="mt-1 text-xs text-amber-800">Last saved: {existingReservation.savedAt || 'Unknown'}</div>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reservation Reason</label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full min-h-[110px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Write the stock reservation reason..."
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loadingReservations}
            className={`px-5 py-2 rounded-md font-medium ${
              !saving && !loadingReservations
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-gray-400 text-gray-200 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save Stock Reservation'}
          </button>
          {message && (
            <div className={`text-sm ${message.includes('Error') || message.includes('not found') || message.includes('Please') ? 'text-red-600' : 'text-green-600'}`}>
              {message}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-700">Saved Stock Reservations</h3>
          <span className="text-sm text-gray-500">{reservationList.length} total</span>
        </div>

        {reservationList.length === 0 ? (
          <div className="text-center text-gray-500 py-6">
            {loadingReservations ? 'Loading reservations...' : 'No stock reservations saved yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chassis</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Forecast Production Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dealer</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Saved At</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {reservationList.map((reservation) => (
                  <tr key={reservation.chassis}>
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">{reservation.chassis}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{reservation.forecastProductionDate || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{reservation.status || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{reservation.dealer || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600 max-w-sm whitespace-pre-wrap">{reservation.reason || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{reservation.savedAt || '-'}</td>
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

export default StockReservation;
