import React, { useEffect, useMemo, useState } from 'react';
import { off, onValue, push, ref, set, update } from 'firebase/database';
import { database } from '../utils/firebase';

const initialForm = {
  chassis: '',
  currentLocation: '',
  targetLocation: '',
};

const initialActor = {
  name: '',
  email: '',
  company: '',
};

const actorStorageKey = 'stockTransferActor';
const deleteReasons = [
  'Wrong chassis number',
  'Wrong stock location',
  'Duplicate request',
  'Requested by mistake',
  'Other',
];

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

const getNowIso = () => new Date().toISOString();

const getStoredActor = () => {
  try {
    return { ...initialActor, ...JSON.parse(window.localStorage.getItem(actorStorageKey) || '{}') };
  } catch {
    return initialActor;
  }
};

const isActorComplete = (actor) => Boolean(actor.name.trim() && actor.email.trim() && actor.company.trim());

const isTransferActive = (transfer) => (
  !transfer?.deletedAt
  && !transfer?.cancelledAt
  && !transfer?.workflow?.purchaseDoneAt
);

const hasWorkflowProgress = (transfer) => {
  const workflow = transfer?.workflow || {};
  return Boolean(
    workflow.ceoApprovedAt
    || workflow.redoInvoiceDoneAt
    || workflow.locationDmsDoneAt
    || workflow.financeDoneAt
    || workflow.planningBpDoneAt
    || workflow.transportDoneAt
    || workflow.purchaseDoneAt
  );
};

const getActorPayload = (actor) => ({
  name: actor.name.trim(),
  email: actor.email.trim(),
  company: actor.company.trim(),
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

const StockTransfer = ({ data = [] }) => {
  const [form, setForm] = useState(initialForm);
  const [actor, setActor] = useState(getStoredActor);
  const [actorDraft, setActorDraft] = useState(getStoredActor);
  const [transfers, setTransfers] = useState({});
  const [auditLogs, setAuditLogs] = useState({});
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedTransferIds, setExpandedTransferIds] = useState({});
  const [historyTransferId, setHistoryTransferId] = useState('');
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deleteReason, setDeleteReason] = useState(deleteReasons[0]);
  const [customDeleteReason, setCustomDeleteReason] = useState('');

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

  const historicalTransferList = useMemo(() => Object.entries(transfers || {})
    .map(([id, transfer]) => ({ id, ...transfer }))
    .filter((transfer) => transfer.deletedAt || transfer.cancelledAt || transfer.workflow?.purchaseDoneAt)
    .sort((a, b) => (
      (b.deletedAt || b.cancelledAt || b.workflow?.purchaseDoneAt || b.savedAt || '')
        .localeCompare(a.deletedAt || a.cancelledAt || a.workflow?.purchaseDoneAt || a.savedAt || '')
    )), [transfers]);

  useEffect(() => {
    window.localStorage.setItem(actorStorageKey, JSON.stringify(actor));
  }, [actor]);

  useEffect(() => {
    if (!isActorComplete(actor)) setActorDraft(actor);
  }, [actor]);

  useEffect(() => {
    const auditRef = ref(database, 'stock_transfer_audit');
    const handleValue = (snapshot) => setAuditLogs(snapshot.exists() ? snapshot.val() || {} : {});
    onValue(auditRef, handleValue);
    return () => off(auditRef, 'value', handleValue);
  }, []);

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

    if (!isActorComplete(actor)) {
      setMessage('Please enter your name, email, and company before saving.');
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
      createdBy: getActorPayload(actor),
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
        actor,
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

  const getWorkflowSteps = (transfer) => {
    const isExternal = String(transfer?.['Stock Transfer Category'] || '').trim().toLowerCase() === 'external stock transfer';
    const steps = [
      ['NSM Approval', 'ceoStatus', 'ceoApprovedAt'],
      ['Finance Acctg/AP - Floorplan Check', 'redoInvoiceStatus', 'redoInvoiceDoneAt'],
    ];

    if (isExternal) {
      steps.push(
        ['Location DMS Reverse Goods Receiving', 'locationDmsStatus', 'locationDmsDoneAt'],
        ['Finance AR - Reverse Invoice and PGI', 'financeStatus', 'financeDoneAt'],
        ['Planning Change SO BP', 'planningBpStatus', 'planningBpDoneAt'],
      );
    } else {
      steps.push(['Location DMS Transfer Done', 'locationDmsStatus', 'locationDmsDoneAt']);
    }

    steps.push(
      ['Transport Booking', 'transportStatus', 'transportDoneAt'],
      ['Purchase Transport PO', 'purchaseStatus', 'purchaseDoneAt'],
    );

    return steps;
  };

  const toggleTransferExpanded = (transferId) => {
    setExpandedTransferIds((current) => ({ ...current, [transferId]: !current[transferId] }));
  };

  const openDeleteDialog = (transfer) => {
    setDeleteDialog({ transfer, action: hasWorkflowProgress(transfer) ? 'cancel' : 'delete' });
    setDeleteReason(deleteReasons[0]);
    setCustomDeleteReason('');
  };

  const closeDeleteDialog = () => {
    setDeleteDialog(null);
    setDeleteReason(deleteReasons[0]);
    setCustomDeleteReason('');
  };

  const handleSoftDeleteOrCancel = async () => {
    if (!deleteDialog?.transfer) return;
    if (!isActorComplete(actor)) {
      setMessage('Please enter your name, email, and company before deleting or cancelling.');
      return;
    }

    const reason = deleteReason === 'Other' ? customDeleteReason.trim() : deleteReason;
    if (!reason) {
      setMessage('Please select or enter a reason.');
      return;
    }

    const { transfer, action } = deleteDialog;
    const now = getNowIso();
    const statusFields = action === 'cancel'
      ? { cancelledAt: now, cancelledBy: getActorPayload(actor), cancelReason: reason }
      : { deletedAt: now, deletedBy: getActorPayload(actor), deleteReason: reason };
    const snapshotAfter = { ...transfer, ...statusFields };

    try {
      await update(ref(database, `stock_transfer/${transfer.id}`), statusFields);
      const auditRef = push(ref(database, `stock_transfer_audit/${transfer.id}`));
      await set(auditRef, buildAuditEntry({
        action,
        transferId: transfer.id,
        chassis: transfer.chassis,
        actor,
        reason,
        snapshotBefore: transfer,
        snapshotAfter,
      }));
      setMessage(`${action === 'cancel' ? 'Cancelled' : 'Deleted'} stock transfer for ${transfer.chassis || 'selected chassis'}.`);
      closeDeleteDialog();
    } catch (error) {
      console.error('Failed to delete or cancel stock transfer:', error);
      setMessage('Error deleting or cancelling stock transfer.');
    }
  };

  const historyEntries = useMemo(() => {
    if (!historyTransferId) return [];
    return Object.values(auditLogs?.[historyTransferId] || {})
      .sort((a, b) => String(b.changedAt || '').localeCompare(String(a.changedAt || '')));
  }, [auditLogs, historyTransferId]);

  const historyTransfer = historyTransferId ? transfers?.[historyTransferId] : null;

  const saveActorDraft = () => {
    if (!isActorComplete(actorDraft)) {
      setMessage('Please enter your name, email, and company.');
      return;
    }
    setActor(getActorPayload(actorDraft));
    setMessage('');
  };

  const isErrorMessage = message.includes('Error') || message.includes('Please') || message.includes('must') || message.includes('should not');

  return (
    <div className="w-full space-y-5 px-4 py-5 text-slate-900">
      {!isActorComplete(actor) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold text-slate-950">Audit Details</h3>
            <p className="mt-2 text-sm text-slate-500">Saved on this computer for future stock transfer actions.</p>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Name" value={actorDraft.name} onChange={(event) => setActorDraft((current) => ({ ...current, name: event.target.value }))} autoFocus />
              <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Email" value={actorDraft.email} onChange={(event) => setActorDraft((current) => ({ ...current, email: event.target.value }))} />
              <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Company" value={actorDraft.company} onChange={(event) => setActorDraft((current) => ({ ...current, company: event.target.value }))} />
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={saveActorDraft} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                Save details
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock Control</div>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">Stock Transfer</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">Yard stock only</span>
            <a className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" href="#/stock-transfer-workflow/settings">Email Settings</a>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">Audit Details</div>
          <div className="text-xs text-slate-400">Local device</div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Name" value={actor.name} onChange={(event) => setActor((current) => ({ ...current, name: event.target.value }))} />
          <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Email" value={actor.email} onChange={(event) => setActor((current) => ({ ...current, email: event.target.value }))} />
          <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Company" value={actor.company} onChange={(event) => setActor((current) => ({ ...current, company: event.target.value }))} />
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
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Tasks</th>
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
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {transferList.map((transfer) => {
                  const workflow = transfer.workflow || {};
                  const isExpanded = Boolean(expandedTransferIds[transfer.id]);

                  return (
                    <React.Fragment key={transfer.id}>
                      <tr className={getTransferRowHighlight(transfer) ? 'bg-rose-50 text-rose-950' : 'hover:bg-slate-50/70'}>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          <button
                            type="button"
                            onClick={() => toggleTransferExpanded(transfer.id)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
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
                        <td className="px-4 py-2 text-sm text-gray-600">
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setHistoryTransferId(transfer.id)} className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">History</button>
                            <button type="button" onClick={() => openDeleteDialog(transfer)} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">{hasWorkflowProgress(transfer) ? 'Cancel' : 'Delete'}</button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={16} className="bg-slate-50 px-4 py-3">
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                              {getWorkflowSteps(transfer).map(([label, statusKey, doneKey]) => (
                                <div key={label} className="rounded-md border border-slate-200 bg-white p-3 text-xs shadow-sm">
                                  <div className="font-semibold text-slate-700">{label}</div>
                                  <div className={workflow[doneKey] ? 'mt-1 text-green-700' : 'mt-1 text-amber-700'}>
                                    {workflow[statusKey] || (workflow[doneKey] ? 'Done' : 'Pending')}
                                  </div>
                                  {workflow[doneKey] && <div className="mt-1 text-gray-500">{workflow[doneKey]}</div>}
                                  {label === 'Transport Booking' && workflow.transportDoneAt && (
                                    <div className="mt-2 text-gray-600">
                                      <div>Vendor: {workflow.transportVendor || '-'}</div>
                                      <div>Time: {workflow.transportBookingTime || '-'}</div>
                                    </div>
                                  )}
                                  {label === 'Purchase Transport PO' && workflow.purchaseDoneAt && (
                                    <div className="mt-2 text-gray-600">PO: {workflow.purchasePoNumber || '-'}</div>
                                  )}
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
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-950">History</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{historicalTransferList.length}</span>
        </div>
        {historicalTransferList.length === 0 ? (
          <div className="text-center text-gray-500 py-6">No completed, deleted, or cancelled stock transfers yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chassis</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Current Location</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Target Location</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {historicalTransferList.map((transfer) => {
                  const isDeleted = Boolean(transfer.deletedAt);
                  const isCancelled = Boolean(transfer.cancelledAt);
                  const status = isDeleted ? 'Deleted' : isCancelled ? 'Cancelled' : 'Completed';
                  const statusDate = transfer.deletedAt || transfer.cancelledAt || transfer.workflow?.purchaseDoneAt || '-';
                  const actorInfo = isDeleted ? transfer.deletedBy : isCancelled ? transfer.cancelledBy : transfer.createdBy;
                  const reason = isDeleted ? transfer.deleteReason : isCancelled ? transfer.cancelReason : '';

                  return (
                    <tr key={transfer.id}>
                      <td className="px-4 py-2 text-sm font-semibold text-gray-900">{transfer.chassis || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{status}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{transfer.currentLocation || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{transfer.targetLocation || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{statusDate}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{actorInfo?.name || '-'}{actorInfo?.company ? ` / ${actorInfo.company}` : ''}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{reason || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        <button type="button" onClick={() => setHistoryTransferId(transfer.id)} className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">History</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">{deleteDialog.action === 'cancel' ? 'Cancel' : 'Delete'} stock transfer</h3>
            <p className="mt-2 text-sm text-gray-600">Are you sure to {deleteDialog.action} '{deleteDialog.transfer?.chassis || 'this chassis'}'?</p>
            <label className="mt-4 block text-sm font-medium text-gray-700">Reason</label>
            <select className="mt-1 w-full rounded border px-3 py-2 text-sm" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)}>
              {deleteReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
            {deleteReason === 'Other' && (
              <textarea className="mt-3 w-full rounded border px-3 py-2 text-sm" rows="3" placeholder="Enter reason" value={customDeleteReason} onChange={(event) => setCustomDeleteReason(event.target.value)} />
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeDeleteDialog} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Close</button>
              <button type="button" onClick={handleSoftDeleteOrCancel} className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">{deleteDialog.action === 'cancel' ? 'Cancel transfer' : 'Delete transfer'}</button>
            </div>
          </div>
        </div>
      )}
      {historyTransferId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">History: {historyTransfer?.chassis || historyTransferId}</h3>
                <p className="text-sm text-gray-500">{historyEntries.length} audit entr{historyEntries.length === 1 ? 'y' : 'ies'}</p>
              </div>
              <button type="button" onClick={() => setHistoryTransferId('')} className="rounded border border-gray-300 px-3 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-50">Close</button>
            </div>
            <div className="mt-4 space-y-3">
              {historyEntries.length === 0 && <div className="rounded border border-dashed border-gray-200 p-4 text-sm text-gray-500">No history yet.</div>}
              {historyEntries.map((entry) => (
                <div key={`${entry.action}-${entry.changedAt}`} className="rounded-lg border border-gray-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold uppercase text-blue-700">{entry.action}</span>
                    <span className="font-semibold text-gray-800">{entry.changedAt || '-'}</span>
                    <span className="text-gray-600">by {entry.changedBy?.name || '-'} ({entry.changedBy?.email || '-'})</span>
                    <span className="text-gray-500">{entry.changedBy?.company || ''}</span>
                  </div>
                  {entry.reason && <div className="mt-2 text-gray-700">Reason: {entry.reason}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockTransfer;
