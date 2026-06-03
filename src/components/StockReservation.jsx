import React, { useMemo, useState, useEffect } from 'react';
import { get, ref, set } from 'firebase/database';
import { database } from '../utils/firebase';

const normalizeChassis = (value) => value.trim().toUpperCase();

const buildReservationKey = (chassis) => normalizeChassis(chassis).replace(/[.#$\/\[\]]/g, '_');

const parseChassisInput = (value) => Array.from(new Set(
  value
    .split(/[\s,;]+/)
    .map(normalizeChassis)
    .filter(Boolean)
));

const getVanStatus = (van) => van?.['Regent Production'] || van?.['Regent Production Status'] || van?.status || '';

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

  const chassisNumbers = useMemo(() => parseChassisInput(chassisInput), [chassisInput]);
  const singleReservationKey = chassisNumbers.length === 1 ? buildReservationKey(chassisNumbers[0]) : '';
  const existingSingleReservation = singleReservationKey ? reservations[singleReservationKey] : null;

  const scheduleLookup = useMemo(() => {
    const lookup = {};
    (data || []).forEach((item) => {
      if (item?.Chassis) {
        lookup[normalizeChassis(item.Chassis)] = item;
      }
    });
    return lookup;
  }, [data]);

  const chassisPreviewRows = useMemo(() => chassisNumbers.map((chassis) => ({
    chassis,
    van: scheduleLookup[chassis] || null,
    existingReservation: reservations[buildReservationKey(chassis)] || null,
  })), [chassisNumbers, reservations, scheduleLookup]);

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
    if (chassisNumbers.length === 1) {
      setReason(existingSingleReservation?.reason || '');
    }
  }, [chassisNumbers.length, existingSingleReservation?.reason, singleReservationKey]);

  const handleSave = async () => {
    if (chassisNumbers.length === 0) {
      setMessage('Please enter at least one chassis number before saving.');
      return;
    }

    const validRows = chassisPreviewRows.filter((row) => row.van);
    const missingRows = chassisPreviewRows.filter((row) => !row.van);

    if (validRows.length === 0) {
      setMessage('No entered chassis numbers were found in the schedule data.');
      return;
    }

    if (!reason.trim()) {
      setMessage('Please enter a reason before saving.');
      return;
    }

    setSaving(true);
    setMessage('');

    const savedAt = getMelbourneTime();

    try {
      const updates = validRows.map(({ chassis }) => {
        const reservationData = {
          chassis,
          reason: reason.trim(),
          savedAt,
        };

        return set(ref(database, `stock_reservation/${buildReservationKey(chassis)}`), reservationData)
          .then(() => ({ key: buildReservationKey(chassis), data: reservationData }));
      });

      const savedReservations = await Promise.all(updates);
      setReservations((previous) => savedReservations.reduce((nextReservations, reservation) => ({
        ...nextReservations,
        [reservation.key]: reservation.data,
      }), { ...previous }));

      const missingText = missingRows.length > 0
        ? ` ${missingRows.length} chassis number(s) were not found and were skipped: ${missingRows.map((row) => row.chassis).join(', ')}.`
        : '';
      setMessage(`Saved ${validRows.length} stock reservation(s).${missingText}`);
    } catch (error) {
      console.error('Failed to save stock reservations:', error);
      setMessage('Error saving stock reservations. Please try again.');
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
          Enter one or many chassis numbers, review the live schedule details, add a reason, then save them to Firebase under stock_reservation.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Chassis Numbers</label>
          <textarea
            value={chassisInput}
            onChange={(event) => setChassisInput(event.target.value)}
            className="w-full min-h-[130px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Enter chassis numbers, one per line"
          />
          <div className="mt-1 text-xs text-gray-500">
            You can paste multiple chassis numbers separated by new lines, spaces, commas, or semicolons.
          </div>
        </div>

        {chassisPreviewRows.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chassis</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Forecast Production Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dealer</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reservation</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {chassisPreviewRows.map(({ chassis, van, existingReservation }) => (
                  <tr key={chassis}>
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">{chassis}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{van?.['Forecast Production Date'] || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{getVanStatus(van) || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{van?.Dealer || '-'}</td>
                    <td className="px-4 py-2 text-sm">
                      {!van ? (
                        <span className="text-red-600">Not found in schedule data</span>
                      ) : existingReservation ? (
                        <span className="text-amber-700">Already reserved</span>
                      ) : (
                        <span className="text-green-700">Ready to save</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {existingSingleReservation && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This chassis is already in stock_reservation. You can update the reason and save again.
            <div className="mt-1 text-xs text-amber-800">Last saved: {existingSingleReservation.savedAt || 'Unknown'}</div>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reservation Reason</label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full min-h-[110px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Write the stock reservation reason. This reason will be saved for every valid chassis above."
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
            {saving ? 'Saving...' : 'Save Stock Reservations'}
          </button>
          {message && (
            <div className={`text-sm ${message.includes('Error') || message.includes('not found') || message.includes('Please') || message.includes('No entered') ? 'text-red-600' : 'text-green-600'}`}>
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
                {reservationList.map((reservation) => {
                  const liveVan = scheduleLookup[normalizeChassis(reservation.chassis || '')] || null;
                  return (
                    <tr key={reservation.chassis}>
                      <td className="px-4 py-2 text-sm font-semibold text-gray-900">{reservation.chassis}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{liveVan?.['Forecast Production Date'] || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{getVanStatus(liveVan) || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{liveVan?.Dealer || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600 max-w-sm whitespace-pre-wrap">{reservation.reason || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{reservation.savedAt || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 text-xs text-gray-500">
              Forecast Production Date, Status, and Dealer are read live from the schedule data, so they update when the database changes.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StockReservation;
