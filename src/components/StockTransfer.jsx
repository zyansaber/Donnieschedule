import React, { useEffect, useMemo, useState } from 'react';
import { get, off, onValue, push, ref, set, update } from 'firebase/database';
import { database } from '../utils/firebase';

const initialForm = {
  chassis: '',
  currentLocation: '',
  targetLocation: '',
};

const REQUIRED_STOCK_LOCATIONS = ['Frankston', 'Geelong', 'Launceston', 'Traralgon', 'Perth', 'St James'];
const INTERNAL_STOCK_LOCATIONS = ['Geelong', 'Launceston', 'Traralgon', 'Perth', 'St James'];
const publicRequestActor = {
  name: 'Stock Transfer New Request',
  email: '',
  company: 'Public web form',
};

const getLocalAdminActor = () => ({
  name: 'Local Stock Transfer Admin',
  email: '',
  company: 'Localhost admin page',
  type: 'local_admin',
  host: typeof window !== 'undefined' ? window.location.host : '',
});

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

const getNowIso = () => new Date().toISOString();

const isTransferActive = (transfer) => (
  !transfer?.deletedAt
  && !transfer?.cancelledAt
  && !transfer?.workflow?.purchaseDoneAt
);

const getWorkflowSteps = (transfer) => {
  const category = transfer?.['Stock Transfer Category']
    || getStockTransferCategory(transfer?.currentLocation, transfer?.targetLocation);
  const isExternal = normalizeValue(category).includes('external');
  const steps = [
    {
      label: 'NSM approval',
      contact: 'NSM',
      statusKey: 'ceoStatus',
      doneAtKey: 'ceoApprovedAt',
    },
    {
      label: 'Finance Acctg/AP floorplan check',
      contact: 'Finance Acctg/AP',
      statusKey: 'redoInvoiceStatus',
      doneAtKey: 'redoInvoiceDoneAt',
    },
  ];

  if (isExternal) {
    steps.push(
      {
        label: 'Location DMS reverse goods receiving',
        contact: 'Location DMS',
        statusKey: 'locationDmsStatus',
        doneAtKey: 'locationDmsDoneAt',
      },
      {
        label: 'Finance AR reverse invoice and PGI',
        contact: 'Finance AR',
        statusKey: 'financeStatus',
        doneAtKey: 'financeDoneAt',
      },
      {
        label: 'Planning change SO BP',
        contact: 'Planning',
        statusKey: 'planningBpStatus',
        doneAtKey: 'planningBpDoneAt',
      },
    );
  } else {
    steps.push({
      label: 'Location DMS transfer done',
      contact: 'Location DMS',
      statusKey: 'locationDmsStatus',
      doneAtKey: 'locationDmsDoneAt',
    });
  }

  steps.push(
    {
      label: 'Transport booking',
      contact: 'Transport',
      statusKey: 'transportStatus',
      doneAtKey: 'transportDoneAt',
    },
    {
      label: 'Purchase transport PO',
      contact: 'Purchase',
      statusKey: 'purchaseStatus',
      doneAtKey: 'purchaseDoneAt',
    },
  );

  return steps;
};

const getWorkflowStepStatus = (workflow, step) => {
  const rawStatus = String(workflow?.[step.statusKey] || '').trim();
  const normalizedStatus = rawStatus.toLowerCase();

  if (
    workflow?.[step.doneAtKey]
    || ['done', 'approved', 'completed'].includes(normalizedStatus)
  ) {
    return 'Done';
  }

  return rawStatus || 'Pending';
};

const getActorPayload = (actor) => ({
  name: String(actor?.name || '').trim(),
  email: String(actor?.email || '').trim(),
  company: String(actor?.company || '').trim(),
  type: String(actor?.type || '').trim(),
  host: String(actor?.host || '').trim(),
});

const buildAuditEntry = ({ action, transferId, chassis, actor, reason = '', snapshotBefore = null, snapshotAfter = null }) => ({
  action,
  transferId,
  chassis: chassis || '',
  changedAt: getNowIso(),
  changedBy: getActorPayload(actor),
  reason,
  snapshotBefore,
  snapshotAfter,
});

const buildSapSyncRequest = (reason) => ({
  sapSyncStatus: 'pending',
  sapSyncRequestedAt: getNowIso(),
  sapSyncRequestReason: reason,
  sapSyncError: '',
});

const getSafeFirebaseKey = (value) => String(value || '').replace(/[.#$\[\]/]/g, '_');

const getKnownEmailJobIds = (transfer) => {
  const workflow = transfer?.workflow || {};
  const jobIds = new Set([
    `${getSafeFirebaseKey(transfer?.id)}_nsm_approval`,
  ]);

  Object.entries(workflow).forEach(([key, value]) => {
    if (key.endsWith('EmailJobId') && value) jobIds.add(String(value));
  });

  return Array.from(jobIds).filter(Boolean);
};


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
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
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
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const StockTransfer = ({ data = [], showEmailSettings = false }) => {
  const [form, setForm] = useState(initialForm);
  const [transfers, setTransfers] = useState({});
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedTransferIds, setExpandedTransferIds] = useState({});
  const [deletingTransferIds, setDeletingTransferIds] = useState({});

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
    .filter((transfer) => !transfer.deletedAt && !transfer.cancelledAt)
    .filter((transfer) => !transfer.workflow?.purchaseDoneAt)
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

    const activeDuplicate = Object.values(transfers || {}).find((transfer) => (
      normalizeChassis(String(transfer?.chassis || '')) === chassis && isTransferActive(transfer)
    ));

    if (activeDuplicate) {
      setMessage('This chassis already has an active stock transfer request.');
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
      createdAt: getNowIso(),
      createdBy: getActorPayload(publicRequestActor),
      sapSyncAttempt: 0,
      ...buildSapSyncRequest('created'),
    };

    try {
      const newTransferRef = push(ref(database, 'stock_transfer'));
      await set(newTransferRef, transferData);
      const auditRef = push(ref(database, `stock_transfer_audit/${newTransferRef.key}`));
      await set(auditRef, buildAuditEntry({
        action: 'create',
        transferId: newTransferRef.key,
        chassis,
        actor: publicRequestActor,
        snapshotAfter: transferData,
      }));
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

  const toggleTransferExpanded = (transferId) => {
    setExpandedTransferIds((current) => ({
      ...current,
      [transferId]: !current[transferId],
    }));
  };

  const cancelQueuedEmailJobs = async (transfer, deletedAt) => {
    const emailJobIds = getKnownEmailJobIds(transfer);
    const updates = {};

    await Promise.all(emailJobIds.map(async (jobId) => {
      const jobRef = ref(database, `email_jobs/${jobId}`);
      const snapshot = await get(jobRef);
      const job = snapshot.exists() ? snapshot.val() : null;
      const status = String(job?.status || '').toLowerCase();
      if (!['pending', 'retrying'].includes(status)) return;

      updates[`email_jobs/${jobId}/status`] = 'cancelled';
      updates[`email_jobs/${jobId}/cancelledAt`] = deletedAt;
      updates[`email_jobs/${jobId}/cancelReason`] = 'Stock transfer request deleted by local admin';
      updates[`email_jobs/${jobId}/updatedAt`] = deletedAt;
    }));

    if (Object.keys(updates).length) {
      await update(ref(database), updates);
    }
  };

  const handleDeleteTransfer = async (transfer) => {
    if (!showEmailSettings || !transfer?.id) return;

    const confirmed = window.confirm(
      `Delete stock transfer request ${transfer.chassis || transfer.id}? This will hide it from Active Requests and record the deletion in audit history.`
    );
    if (!confirmed) return;

    const deletedAt = getNowIso();
    const actor = getLocalAdminActor();
    const deleteReason = 'Deleted from localhost stock transfer admin page';
    const snapshotAfter = {
      ...transfer,
      deletedAt,
      deletedBy: getActorPayload(actor),
      deleteReason,
    };

    setDeletingTransferIds((current) => ({ ...current, [transfer.id]: true }));
    setMessage('');

    try {
      const auditRef = push(ref(database, `stock_transfer_audit/${transfer.id}`));
      await update(ref(database), {
        [`stock_transfer/${transfer.id}/deletedAt`]: deletedAt,
        [`stock_transfer/${transfer.id}/deletedBy`]: getActorPayload(actor),
        [`stock_transfer/${transfer.id}/deleteReason`]: deleteReason,
        [`stock_transfer/${transfer.id}/sapSyncStatus`]: 'deleted',
        [`stock_transfer_audit/${transfer.id}/${auditRef.key}`]: buildAuditEntry({
          action: 'delete',
          transferId: transfer.id,
          chassis: transfer.chassis,
          actor,
          reason: deleteReason,
          snapshotBefore: transfer,
          snapshotAfter,
        }),
      });
      await cancelQueuedEmailJobs(transfer, deletedAt);
      setExpandedTransferIds((current) => {
        const next = { ...current };
        delete next[transfer.id];
        return next;
      });
      setMessage(`Deleted stock transfer request ${transfer.chassis || transfer.id}.`);
    } catch (error) {
      console.error('Failed to delete stock transfer:', error);
      setMessage('Error deleting stock transfer.');
    } finally {
      setDeletingTransferIds((current) => {
        const next = { ...current };
        delete next[transfer.id];
        return next;
      });
    }
  };

  const isErrorMessage = message.includes('Error') || message.includes('Please') || message.includes('must') || message.includes('should not');

  return (
    <div className="w-full space-y-5 px-4 py-5 text-slate-900">
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock Control</div>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">Stock Transfer</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">Yard stock only</span>
            {showEmailSettings && (
              <a className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" href="#/stock-transfer-workflow/settings">Email Settings</a>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-950">New Request</h3>
          <span className="text-xs font-medium text-slate-400">Required fields</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="stock-transfer-chassis">
              Chassis
            </label>
            <input
              id="stock-transfer-chassis"
              type="text"
              value={form.chassis}
              onChange={(event) => handleInputChange('chassis', event.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              placeholder="SRT..."
            />
            {shouldReallocate && (
              <p className="mt-1 text-xs font-medium text-red-600">Use Reallocation for unfinished schedule units.</p>
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

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loadingTransfers}
            className={`rounded-md px-5 py-2 text-sm font-semibold ${
              !saving && !loadingTransfers
                ? 'bg-slate-950 text-white hover:bg-slate-800'
                : 'bg-gray-400 text-gray-200 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save Request'}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
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

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-950">Active Requests</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{transferList.length}</span>
        </div>

        {transferList.length === 0 ? (
          <div className="text-center text-gray-500 py-6">
            {loadingTransfers ? 'Loading stock transfers...' : 'No saved stock transfers yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Chassis</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Model</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Current</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Target</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Saved</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">PGI Date</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Stock Location</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Sales Order</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Invoice To</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Invoice Date</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Invoice No.</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">BP Changed By</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">BP Changed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {transferList.map((transfer) => {
                  const workflow = transfer.workflow || {};
                  const workflowSteps = getWorkflowSteps(transfer);
                  const expanded = Boolean(expandedTransferIds[transfer.id]);
                  const firstPendingStep = workflowSteps.find((step) => getWorkflowStepStatus(workflow, step) !== 'Done');

                  return (
                    <React.Fragment key={transfer.id}>
                      <tr className={getTransferRowHighlight(transfer) ? 'bg-rose-50 text-rose-950' : 'hover:bg-slate-50/70'}>
                        <td className="px-4 py-2 text-sm">
                          <div className="font-semibold text-gray-900">{transfer.chassis || '-'}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleTransferExpanded(transfer.id)}
                              className="whitespace-nowrap rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              {expanded ? 'Hide tasks' : 'Show tasks'}
                            </button>
                            {showEmailSettings && (
                              <button
                                type="button"
                                onClick={() => handleDeleteTransfer(transfer)}
                                disabled={Boolean(deletingTransferIds[transfer.id])}
                                className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold ${
                                  deletingTransferIds[transfer.id]
                                    ? 'border-slate-200 text-slate-400'
                                    : 'border-red-200 text-red-700 hover:bg-red-50'
                                }`}
                              >
                                {deletingTransferIds[transfer.id] ? 'Deleting...' : 'Delete'}
                              </button>
                            )}
                          </div>
                        </td>
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
                      {expanded && (
                        <tr>
                          <td colSpan={14} className="bg-slate-50 px-4 py-4">
                            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                              <span className="font-semibold text-slate-950">Current task:</span>
                              <span>{firstPendingStep?.label || 'All tasks done'}</span>
                              {firstPendingStep && (
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                                  Contact {firstPendingStep.contact}
                                </span>
                              )}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {workflowSteps.map((step) => {
                                const status = getWorkflowStepStatus(workflow, step);
                                const isDone = status === 'Done';
                                return (
                                  <div key={step.statusKey} className="rounded-md border border-slate-200 bg-white p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-semibold text-slate-950">{step.label}</div>
                                        <div className="mt-1 text-xs text-slate-500">Contact: {step.contact}</div>
                                      </div>
                                      <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                                        isDone ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                      }`}
                                      >
                                        {status}
                                      </span>
                                    </div>
                                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                                      <div>Completed: {workflow?.[step.doneAtKey] || '-'}</div>
                                      {step.statusKey === 'transportStatus' && (
                                        <>
                                          <div>Vendor: {workflow.transportVendor || '-'}</div>
                                          <div>Pickup: {workflow.transportPickupAt || '-'}</div>
                                        </>
                                      )}
                                      {step.statusKey === 'purchaseStatus' && (
                                        <div>PO: {workflow.purchasePoNumber || '-'}</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
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
