import React, { useEffect, useMemo, useState } from 'react';
import { off, onValue, push, ref, set } from 'firebase/database';
import { database } from '../utils/firebase';

const initialForm = {
  chassis: '',
  currentLocation: '',
  targetLocation: '',
};

const REQUIRED_STOCK_LOCATIONS = ['Frankston', 'Geelong', 'Launceston', 'Traralgon', 'Perth', 'St James'];
const INTERNAL_STOCK_LOCATIONS = ['Geelong', 'Launceston', 'Traralgon', 'Perth', 'St James'];

const normalizeChassis = (value) => value.trim().toUpperCase();

const normalizeValue = (value) => String(value || '').trim().toLowerCase();

const normalizeStockLocation = (value) => {
  const normalized = normalizeValue(value);
  return normalized === 'perth' ? 'st james' : normalized;
};

const isRequiredStockLocation = (value) => (
  REQUIRED_STOCK_LOCATIONS.some((location) => normalizeStockLocation(location) === normalizeStockLocation(value))
);

const isInternalStockLocation = (value) => (
  INTERNAL_STOCK_LOCATIONS.some((location) => normalizeStockLocation(location) === normalizeStockLocation(value))
);

const getStockTransferCategory = (currentLocation, targetLocation) => (
  isInternalStockLocation(currentLocation) && isInternalStockLocation(targetLocation)
    ? 'Internal stock transfer'
    : 'External stock transfer'
);

const getTransferRowHighlight = (transfer) => {
  const targetLocation = transfer?.targetLocation;
  const companyStockLocation = transfer?.['Company Stock Current Location'];

  return isRequiredStockLocation(targetLocation)
    && normalizeStockLocation(companyStockLocation) !== normalizeStockLocation(targetLocation);
};

const getSOPGIPostDateDisplay = (transfer) => {
  const pgiPostDate = String(transfer?.['SO PGI Post Date'] || '').trim();
  const pgiStatus = String(transfer?.['SO Is PGI'] || '').trim().toLowerCase();

  if (pgiPostDate && pgiStatus !== 'no_pgi') {
    return pgiPostDate;
  }

  return 'nopgi';
};

const getMelbourneDate = () => new Date().toLocaleDateString('en-AU', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});


const StockLocationCombobox = ({ id, label, value, onChange, options, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const normalizedSearch = normalizeValue(value);
  const filteredOptions = options
    .filter((option) => normalizeValue(option).includes(normalizedSearch))
    .slice(0, 12);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        placeholder={placeholder}
        autoComplete="off"
      />
      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const StockTransfer = ({ data = [] }) => {
  const [form, setForm] = useState(initialForm);
  const [transfers, setTransfers] = useState({});
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedTransferIds, setExpandedTransferIds] = useState({});

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

  const scheduleByChassis = useMemo(() => new Map((data || [])
    .map((row) => [normalizeChassis(String(row?.Chassis || '')), row])
    .filter(([chassis]) => chassis)), [data]);

  const stockLocationOptions = useMemo(() => ([
    ...new Set([
      ...REQUIRED_STOCK_LOCATIONS,
      ...INTERNAL_STOCK_LOCATIONS,
      ...(data || []).map((row) => row?.Dealer).filter(Boolean),
    ]),
  ].sort()), [data]);

  const selectedScheduleRow = scheduleByChassis.get(normalizeChassis(form.chassis));
  const selectedScheduleStatus = String(
    selectedScheduleRow?.['Regent Production'] || selectedScheduleRow?.Status || ''
  ).trim();
  const shouldReallocate = Boolean(
    normalizeChassis(form.chassis)
    && selectedScheduleStatus
    && selectedScheduleStatus.toLowerCase() !== 'finished'
  );
  const hasBothLocations = Boolean(form.currentLocation.trim() && form.targetLocation.trim());
  const transferInvolvesRequiredLocation = isRequiredStockLocation(form.currentLocation)
    || isRequiredStockLocation(form.targetLocation);
  const shouldNotApplyTransfer = hasBothLocations && !transferInvolvesRequiredLocation;
  const selectedTransferCategory = hasBothLocations
    ? getStockTransferCategory(form.currentLocation, form.targetLocation)
    : '';

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

    if (normalizeStockLocation(currentLocation) === normalizeStockLocation(targetLocation)) {
      setMessage('Current and target stock locations must be different.');
      return;
    }

    if (!isRequiredStockLocation(currentLocation) && !isRequiredStockLocation(targetLocation)) {
      setMessage('This transfer should not be requested on this page.');
      return;
    }

    const scheduleRow = scheduleByChassis.get(chassis);
    const scheduleStatus = String(scheduleRow?.['Regent Production'] || scheduleRow?.Status || '').trim();
    const scheduleModel = String(scheduleRow?.Model || '').trim();
    if (scheduleStatus && scheduleStatus.toLowerCase() !== 'finished') {
      setMessage('This chassis is not finished in Schedule. Please switch to the Reallocation page to do a reallocation.');
      return;
    }

    setSaving(true);
    setMessage('');

    const savedAt = getMelbourneDate();
    const stockTransferCategory = getStockTransferCategory(currentLocation, targetLocation);
    const transferData = {
      'Company Stock Current Location': 'Not in company warehouse',
      'Invoice BP Last Change Date': '',
      'Invoice BP Last Changed By': '',
      'Invoice-to Name': '',
      'Last Invoice Date': '',
      'Last Invoice Number': '',
      'SO Is PGI': 'No_PGI',
      'SO PGI Post Date': '',
      'Sales Order Display': '',
      Model: scheduleModel,
      'Stock Transfer Category': stockTransferCategory,
      chassis,
      currentLocation,
      savedAt,
      targetLocation,
      transferType: 'Yard stock to yard stock only',
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

  const getTransferModel = (transfer) => (
    transfer?.Model
    || transfer?.model
    || scheduleByChassis.get(normalizeChassis(String(transfer?.chassis || '')))?.Model
    || '-'
  );

  const workflowSteps = [
    ['CEO Approval', 'ceoStatus', 'ceoApprovedAt'],
    ['Location DMS Done', 'locationDmsStatus', 'locationDmsDoneAt'],
    ['Finance Reverse PGI / Redo Invoice', 'financeStatus', 'financeDoneAt'],
    ['Transport Booking', 'transportStatus', 'transportDoneAt'],
    ['Purchase Transport PO', 'purchaseStatus', 'purchaseDoneAt'],
  ];

  const toggleTransferExpanded = (transferId) => {
    setExpandedTransferIds((current) => ({ ...current, [transferId]: !current[transferId] }));
  };

  const isErrorMessage = message.includes('Error') || message.includes('Please') || message.includes('must') || message.includes('should not');

  return (
    <div className="p-4 w-full">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold text-gray-800">Stock Transfer</h2>
        <p className="mt-1 text-sm text-gray-500">
          This page is only for transfers from yard stock to yard stock. Enter the chassis number,
          current stock location, and the stock location you want to move it to.
        </p>
      </div>

      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <span className="font-semibold">Important:</span> Only use this page for yard stock to yard stock transfers.
        Do not use it for customer sold units, dealer transfers, or non-yard stock moves. Any stock transfer involving
        Frankston, Geelong, Launceston, Traralgon, or Perth must use this page.
        <a className="ml-2 font-semibold underline" href="#/stock-transfer-workflow/settings">Edit workflow email settings</a>.
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
            {shouldReallocate && (
              <p className="mt-1 text-xs font-medium text-red-600">
                This chassis is not finished in Schedule. Please switch to the Reallocation page to do a reallocation.
              </p>
            )}
          </div>
          <StockLocationCombobox
            id="stock-transfer-current-location"
            label="Current Stock Location"
            value={form.currentLocation}
            onChange={(value) => handleInputChange('currentLocation', value)}
            options={stockLocationOptions}
            placeholder="Search or select current stock location"
          />
          <StockLocationCombobox
            id="stock-transfer-target-location"
            label="Target Stock Location"
            value={form.targetLocation}
            onChange={(value) => handleInputChange('targetLocation', value)}
            options={stockLocationOptions}
            placeholder="Search or select target stock location"
          />
        </div>

        {(shouldNotApplyTransfer || selectedTransferCategory) && (
          <div className={`mt-4 rounded-md border p-3 text-sm ${
            shouldNotApplyTransfer
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
          >
            {shouldNotApplyTransfer
              ? 'This transfer should not be requested on this page.'
              : `Transfer category: ${selectedTransferCategory}`}
          </div>
        )}

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
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tasks</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chassis</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Current Location</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Target Location</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Saved At</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Stock Transfer Category</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SO PGI Post Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Company Stock Current Location</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sales Order Display</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice-to Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Invoice Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Invoice Number</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice BP Last Changed By</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice BP Last Change Date</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transferList.map((transfer) => {
                  const workflow = transfer.workflow || {};
                  const isExpanded = Boolean(expandedTransferIds[transfer.id]);

                  return (
                    <React.Fragment key={transfer.id}>
                      <tr className={getTransferRowHighlight(transfer) ? 'bg-red-100 text-red-900' : ''}>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          <button
                            type="button"
                            onClick={() => toggleTransferExpanded(transfer.id)}
                            className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            {isExpanded ? 'Hide' : 'Show'} tasks
                          </button>
                        </td>
                        <td className="px-4 py-2 text-sm font-semibold text-gray-900">{transfer.chassis || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{getTransferModel(transfer)}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer.currentLocation || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer.targetLocation || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer.savedAt || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Stock Transfer Category'] || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{getSOPGIPostDateDisplay(transfer)}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Company Stock Current Location'] || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Sales Order Display'] || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Invoice-to Name'] || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Last Invoice Date'] || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Last Invoice Number'] || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Invoice BP Last Changed By'] || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{transfer['Invoice BP Last Change Date'] || '-'}</td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={15} className="bg-gray-50 px-4 py-3">
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                              {workflowSteps.map(([label, statusKey, doneKey]) => (
                                <div key={label} className="rounded-lg border border-gray-200 bg-white p-3 text-xs">
                                  <div className="font-semibold text-gray-700">{label}</div>
                                  <div className={workflow[doneKey] ? 'mt-1 text-green-700' : 'mt-1 text-amber-700'}>
                                    {workflow[statusKey] || (workflow[doneKey] ? 'Done' : 'Pending')}
                                  </div>
                                  {workflow[doneKey] && <div className="mt-1 text-gray-500">{workflow[doneKey]}</div>}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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

export default StockTransfer;
