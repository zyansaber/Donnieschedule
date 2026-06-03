import React, { useMemo, useState, useEffect } from 'react';
import { get, ref, remove, set } from 'firebase/database';
import { database } from '../utils/firebase';

const INITIAL_ROW_COUNT = 5;
const emptyRows = () => Array.from({ length: INITIAL_ROW_COUNT }, (_, index) => ({ id: index + 1, chassis: '' }));
const normalizeChassis = (value) => value.trim().toUpperCase();
const buildReservationKey = (chassis) => normalizeChassis(chassis).replace(/[.#$\/\[\]]/g, '_');
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

const splitPastedChassis = (value) => value
  .split(/[\s,;]+/)
  .map(normalizeChassis)
  .filter(Boolean);

const StockReservation = ({ data = [] }) => {
  const [reservationRows, setReservationRows] = useState(emptyRows);
  const [reason, setReason] = useState('');
  const [reservations, setReservations] = useState({});
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const scheduleLookup = useMemo(() => {
    const lookup = {};
    (data || []).forEach((item) => {
      if (item?.Chassis) {
        lookup[normalizeChassis(item.Chassis)] = item;
      }
    });
    return lookup;
  }, [data]);

  const previewRows = useMemo(() => reservationRows.map((row) => {
    const chassis = normalizeChassis(row.chassis);
    return {
      ...row,
      chassis,
      van: chassis ? scheduleLookup[chassis] || null : null,
      existingReservation: chassis ? reservations[buildReservationKey(chassis)] || null : null,
    };
  }), [reservationRows, reservations, scheduleLookup]);

  useEffect(() => {
    const loadReservations = async () => {
      try {
        const reservationRef = ref(database, 'stock_reservation');
        const snapshot = await get(reservationRef);
        setReservations(snapshot.exists() ? (snapshot.val() || {}) : {});
      } catch (error) {
        console.error('Failed to load stock reservations:', error);
        setMessage('Error loading reservations.');
      } finally {
        setLoadingReservations(false);
      }
    };

    loadReservations();
  }, []);

  const handleChassisChange = (rowId, value) => {
    setMessage('');
    const pastedValues = splitPastedChassis(value);

    if (pastedValues.length > 1) {
      setReservationRows((currentRows) => {
        const startIndex = currentRows.findIndex((row) => row.id === rowId);
        if (startIndex < 0) return currentRows;

        const nextRows = [...currentRows];
        const requiredLength = startIndex + pastedValues.length;
        while (nextRows.length < requiredLength) {
          nextRows.push({ id: Math.max(...nextRows.map((row) => row.id)) + 1, chassis: '' });
        }

        return nextRows.map((row, index) => {
          const pastedIndex = index - startIndex;
          if (pastedIndex >= 0 && pastedIndex < pastedValues.length) {
            return { ...row, chassis: pastedValues[pastedIndex] };
          }
          return row;
        });
      });
      return;
    }

    setReservationRows((currentRows) => currentRows.map((row) => (
      row.id === rowId ? { ...row, chassis: value } : row
    )));
  };

  const handleClear = () => {
    setReservationRows(emptyRows());
    setReason('');
    setMessage('');
  };

  const handleAddRow = () => {
    setReservationRows((currentRows) => [
      ...currentRows,
      { id: Math.max(...currentRows.map((row) => row.id)) + 1, chassis: '' },
    ]);
  };

  const handleDeleteReservation = async (chassis) => {
    const reservationKey = buildReservationKey(chassis);
    setMessage('');

    try {
      await remove(ref(database, `stock_reservation/${reservationKey}`));
      setReservations((previous) => {
        const nextReservations = { ...previous };
        delete nextReservations[reservationKey];
        return nextReservations;
      });
      setMessage(`Deleted reservation for ${chassis}.`);
    } catch (error) {
      console.error('Failed to delete stock reservation:', error);
      setMessage('Error deleting reservation.');
    }
  };

  const handleSave = async () => {
    const filledRows = previewRows.filter((row) => row.chassis);
    const seenChassis = new Set();
    const uniqueRows = filledRows.filter((row) => {
      if (seenChassis.has(row.chassis)) return false;
      seenChassis.add(row.chassis);
      return true;
    });
    const validRows = uniqueRows.filter((row) => row.van);
    const missingRows = uniqueRows.filter((row) => !row.van);

    if (filledRows.length === 0) {
      setMessage('Please enter at least one chassis number.');
      return;
    }

    if (validRows.length === 0) {
      setMessage('No valid chassis found.');
      return;
    }

    if (!reason.trim()) {
      setMessage('Please enter a reason.');
      return;
    }

    setSaving(true);
    setMessage('');

    const savedAt = getMelbourneTime();

    try {
      const savedReservations = await Promise.all(validRows.map(({ chassis }) => {
        const reservationData = {
          chassis,
          reason: reason.trim(),
          savedAt,
        };

        return set(ref(database, `stock_reservation/${buildReservationKey(chassis)}`), reservationData)
          .then(() => ({ key: buildReservationKey(chassis), data: reservationData }));
      }));

      setReservations((previous) => savedReservations.reduce((nextReservations, reservation) => ({
        ...nextReservations,
        [reservation.key]: reservation.data,
      }), { ...previous }));

      const skippedText = missingRows.length > 0 ? ` (${missingRows.length} skipped)` : '';
      setMessage(`Saved ${validRows.length} reservation(s)${skippedText}.`);
    } catch (error) {
      console.error('Failed to save stock reservations:', error);
      setMessage('Error saving reservations.');
    } finally {
      setSaving(false);
    }
  };

  const reservationList = Object.values(reservations || {}).sort((a, b) => (
    (b?.savedAt || '').localeCompare(a?.savedAt || '')
  ));

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold text-gray-800">Stock Reservation</h2>
        <p className="mt-1 text-sm text-gray-500">Enter chassis numbers, confirm the details, add a reason, then save.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">New Reservations</h3>
            <p className="text-xs text-gray-500">5 starter rows · click + to add more</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddRow}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <span className="text-base leading-none">+</span>
              Add Row
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-12 px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
                <th className="min-w-[220px] px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Chassis Number</th>
                <th className="min-w-[170px] px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Forecast Production Date</th>
                <th className="min-w-[150px] px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="min-w-[180px] px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Dealer</th>
                <th className="min-w-[130px] px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Reservation</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {previewRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70">
                  <td className="px-3 py-2 text-sm text-gray-400 font-medium">{row.id}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={reservationRows.find((inputRow) => inputRow.id === row.id)?.chassis || ''}
                      onChange={(event) => handleChassisChange(row.id, event.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Enter chassis"
                    />
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">{row.van?.['Forecast Production Date'] || '-'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{getVanStatus(row.van) || '-'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{row.van?.Dealer || '-'}</td>
                  <td className="px-3 py-2 text-sm">
                    {!row.chassis ? (
                      <span className="text-gray-400">Empty</span>
                    ) : !row.van ? (
                      <span className="inline-flex px-2 py-1 rounded-full bg-red-50 text-red-700 text-xs font-medium">Not found</span>
                    ) : row.existingReservation ? (
                      <span className="inline-flex px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">Reserved</span>
                    ) : (
                      <span className="inline-flex px-2 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">Ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full min-h-[100px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Write the reservation reason..."
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
            {saving ? 'Saving...' : 'Save Reservations'}
          </button>
          {message && (
            <div className={`text-sm ${message.includes('Error') || message.includes('Please') || message.includes('No valid') ? 'text-red-600' : 'text-green-600'}`}>
              {message}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-700">Saved Stock Reservations</h3>
          <span className="text-sm text-gray-500">{reservationList.length} total</span>
        </div>

        {reservationList.length === 0 ? (
          <div className="text-center text-gray-500 py-6">
            {loadingReservations ? 'Loading reservations...' : 'No saved reservations yet.'}
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
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
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
                      <td className="px-4 py-2 text-sm">
                        <button
                          type="button"
                          onClick={() => handleDeleteReservation(reservation.chassis)}
                          className="px-3 py-1 rounded-md bg-red-50 text-red-700 hover:bg-red-100 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default StockReservation;
