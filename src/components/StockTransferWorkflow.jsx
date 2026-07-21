import React, { useEffect, useMemo, useRef, useState } from 'react';
import { off, onValue, ref, runTransaction, update } from 'firebase/database';
import { database } from '../utils/firebase';
import { getSafeFirebaseKey, queueEmailJob } from '../utils/emailJobs';

const TRANSFERS_PATH = 'stock_transfer';
const CONFIG_PATH = 'stockTransferWorkflowConfig';

const LOCATION_WORKFLOW_LOCATIONS = [
  ['frankston', 'Frankston'],
  ['geelong', 'Geelong'],
  ['st_james', 'Perth / St James'],
  ['traralgon', 'Traralgon'],
  ['launceston', 'Launceston'],
];

const normalizeWorkflowLocation = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('perth') || normalized.includes('st james')) return 'st_james';
  if (normalized.includes('frankston')) return 'frankston';
  if (normalized.includes('geelong')) return 'geelong';
  if (normalized.includes('traralgon') || normalized.includes('trarlagon')) return 'traralgon';
  if (normalized.includes('launceston')) return 'launceston';
  return normalized.replace(/\s+/g, '_');
};

const getLocationLabel = (locationKey) => (
  LOCATION_WORKFLOW_LOCATIONS.find(([key]) => key === locationKey)?.[1] || 'Location'
);

const defaultConfig = {
  appBaseUrl: 'https://schedule-final-tyn6.onrender.com',
  serviceId: '',
  publicKey: '',
  templateId: '',
  templates: {
    ceo: '',
    location: '',
    planning: '',
    finance: '',
    transport: '',
    purchase: '',
  },
  subjects: {
    ceo: 'Stock Transfer NSM Approval Required',
    planning: 'Stock Transfer Planning Change SO BP Task',
    finance: 'Stock Transfer Finance Acctg/AP - Floorplan Check Task',
    transport: 'Stock Transfer Transport Task',
    purchase: 'Stock Transfer Purchase Task',
  },
  bodyNotes: {
    ceo: 'Please review and approve this stock transfer.',
    location: 'Please complete the DMS stock transfer task for your location.',
    planning: 'Please confirm Planning Change SO BP is done for this stock transfer.',
    finance: 'Please complete the required Finance check for this stock transfer.',
    transport: 'Please book transport and enter vendor/time.',
    purchase: 'Please raise and confirm the Transport PO.',
  },
  locationRecipients: {
    frankston: '',
    geelong: '',
    st_james: '',
    traralgon: '',
    launceston: '',
  },
  recipients: {
    ceo: '',
    location: '',
    planning: '',
    finance: '',
    transport: '',
    purchase: '',
  },
  ccRecipients: {
    ceo: '',
    location: '',
    planning: '',
    finance: '',
    transport: '',
    purchase: '',
  },
};

const workflowPaths = {
  ceo: '#/stock-transfer-workflow/ceo',
  location: '#/stock-transfer-workflow/location',
  planning: '#/stock-transfer-workflow/planning',
  finance: '#/stock-transfer-workflow/finance',
  transport: '#/stock-transfer-workflow/transport',
  purchase: '#/stock-transfer-workflow/purchase',
  settings: '#/stock-transfer-workflow/settings',
};

const getConfiguredBaseUrl = (config = {}) => (
  String(config.appBaseUrl || defaultConfig.appBaseUrl || window.location.origin)
    .trim()
    .replace(/\/+$/, '')
);

const roleLabels = {
  ceo: 'NSM Approval',
  location: 'Location DMS Work',
  planning: 'Planning Work',
  finance: 'Finance Work',
  transport: 'Transport Work',
  purchase: 'Purchase Work',
};

const workflowFlowSummaries = {
  internal: [
    'NSM Approval',
    'Finance Acctg/AP - Floorplan Check',
    'Current Location confirms DMS transfer done',
    'Transport books transport',
    'Purchase raises Transport PO',
  ],
  external: [
    'NSM Approval',
    'Finance Acctg/AP - Floorplan Check',
    'Current Location confirms DMS reverse goods receiving',
    'Finance AR - Reverse Invoice and PGI',
    'Planning Change SO BP',
    'Transport books transport',
    'Purchase raises Transport PO',
  ],
};

const getWorkflow = (transfer) => transfer?.workflow || {};
const isExternalTransfer = (transfer) => String(transfer?.['Stock Transfer Category'] || '').trim().toLowerCase() === 'external stock transfer';
const hasSalesOrder = (transfer) => String(transfer?.['Sales Order Display'] || '').trim();

const buildRows = (transfers) => Object.entries(transfers || {})
  .map(([id, transfer]) => ({ id, ...transfer }))
  .filter(hasSalesOrder)
  .sort((a, b) => (b?.savedAt || '').localeCompare(a?.savedAt || ''));

const getTaskList = (role, transfers, locationKey = '') => buildRows(transfers).filter((transfer) => {
  const workflow = getWorkflow(transfer);
  if (role === 'ceo') return !workflow.ceoApprovedAt;
  if (!workflow.ceoApprovedAt) return false;
  if (role === 'location') {
    const transferLocationKey = normalizeWorkflowLocation(transfer.currentLocation);
    const readyForLocation = workflow.redoInvoiceDoneAt;
    return readyForLocation
      && !workflow.locationDmsDoneAt
      && (!locationKey || transferLocationKey === locationKey);
  }
  if (role === 'planning') return isExternalTransfer(transfer) && workflow.financeDoneAt && !workflow.planningBpDoneAt;
  if (role === 'finance') {
    if (!workflow.redoInvoiceDoneAt) return true;
    return isExternalTransfer(transfer) && workflow.locationDmsDoneAt && !workflow.financeDoneAt;
  }
  if (role === 'transport') {
    if (isExternalTransfer(transfer) && !workflow.planningBpDoneAt) return false;
    if (!isExternalTransfer(transfer) && !workflow.locationDmsDoneAt) return false;
    return !workflow.transportDoneAt;
  }
  if (role === 'purchase') return workflow.transportDoneAt && !workflow.purchaseDoneAt;
  return false;
});

const getNextEmailRole = (completedRole, transfer) => {
  const workflow = getWorkflow(transfer);
  if (completedRole === 'ceo') return 'finance';
  if (completedRole === 'location') return isExternalTransfer(transfer) ? 'finance' : 'transport';
  if (completedRole === 'finance') return workflow.financeDoneAt ? 'planning' : 'location';
  if (completedRole === 'planning') return 'transport';
  if (completedRole === 'transport') return 'purchase';
  return '';
};

const legacyDefaultSubjects = {
  ceo: 'Stock Transfer CEO Approval Required',
  planning: 'Stock Transfer Planning Task',
  finance: 'Stock Transfer Finance Task',
};

const legacyDefaultBodyNotes = {
  planning: 'Please confirm DMS is done for this stock transfer.',
  finance: 'External transfers use Finance twice: first redo the invoice, then after Location DMS reverse goods receiving, reverse PGI.',
};

const normalizeWorkflowConfig = (config = {}) => {
  const merged = {
    ...defaultConfig,
    ...config,
    templates: { ...defaultConfig.templates, ...(config.templates || {}) },
    subjects: { ...defaultConfig.subjects, ...(config.subjects || {}) },
    bodyNotes: { ...defaultConfig.bodyNotes, ...(config.bodyNotes || {}) },
    locationRecipients: { ...defaultConfig.locationRecipients, ...(config.locationRecipients || {}) },
    recipients: { ...defaultConfig.recipients, ...(config.recipients || {}) },
    ccRecipients: { ...defaultConfig.ccRecipients, ...(config.ccRecipients || {}) },
  };

  Object.entries(legacyDefaultSubjects).forEach(([role, oldValue]) => {
    if (merged.subjects[role] === oldValue) merged.subjects[role] = defaultConfig.subjects[role];
  });
  Object.entries(legacyDefaultBodyNotes).forEach(([role, oldValue]) => {
    if (merged.bodyNotes[role] === oldValue) merged.bodyNotes[role] = defaultConfig.bodyNotes[role];
  });

  return merged;
};

const getEmailStep = (role, transfer = {}) => {
  if (role === 'ceo') return 'nsm_approval';
  if (role === 'location') return 'location_dms';
  if (role === 'planning') return 'planning_change_so_bp';
  if (role === 'transport') return 'transport_booking';
  if (role === 'purchase') return 'purchase_po';
  if (role === 'finance') {
    return !getWorkflow(transfer).redoInvoiceDoneAt
      ? 'finance_acctg_ap_floorplan_check'
      : 'finance_ar_reverse_invoice_pgi';
  }
  return role || 'unknown';
};

const getEmailJobId = (transfer, role) => (
  `${getSafeFirebaseKey(transfer?.id)}_${getEmailStep(role, transfer)}`
);

const isFinanceFloorplanStep = (transfer) => !getWorkflow(transfer).redoInvoiceDoneAt;

const getFinanceTaskLabel = (transfer) => (
  isFinanceFloorplanStep(transfer)
    ? 'Finance Acctg/AP - Floorplan Check'
    : 'Finance AR - Reverse Invoice and PGI'
);

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const getTaskLabel = (role, transfer) => {
  if (role === 'finance') return getFinanceTaskLabel(transfer);
  return roleLabels[role] || 'Stock Transfer Task';
};

const getTaskSubtasks = (role, transfer) => {
  if (role === 'ceo') {
    return [
      'Review the stock transfer request.',
      'Confirm NSM approval can proceed.',
    ];
  }
  if (role === 'location') {
    return isExternalTransfer(transfer)
      ? [
        'Confirm the unit is ready for Location DMS work.',
        'Complete DMS reverse goods receiving.',
        'Confirm when Location DMS work is done.',
      ]
      : [
        'Confirm the unit is ready for Location DMS work.',
        'Complete the DMS stock transfer.',
        'Confirm when Location DMS transfer is done.',
      ];
  }
  if (role === 'planning') {
    return [
      'Change the Sales Order BP as required.',
      'Confirm the Planning update is complete.',
    ];
  }
  if (role === 'finance') {
    return isFinanceFloorplanStep(transfer)
      ? [
        'Check floorplan status.',
        'Confirm Accounting/AP requirements.',
        'Confirm finance clearance before Location DMS work.',
      ]
      : [
        'Confirm Location DMS reverse goods receiving is done.',
        'Reverse invoice as required.',
        'Confirm PGI reversal / finance clearance before Planning work.',
      ];
  }
  if (role === 'transport') {
    return [
      'Book transport for this stock transfer.',
      'Enter the transport vendor.',
      'Enter the pickup / booking time before confirming.',
    ];
  }
  if (role === 'purchase') {
    return [
      'Raise the Transport PO.',
      'Enter the PO number before confirming.',
    ];
  }
  return [];
};

const getEmailTitle = (role, transfer) => {
  const chassis = String(transfer?.chassis || '').trim();
  return `Action Required: Stock Transfer${chassis ? ` ${chassis}` : ''}`;
};

const getApproveLink = (config, transferId) => `${getConfiguredBaseUrl(config)}/#/stock-transfer-workflow/ceo?approveTransfer=${encodeURIComponent(transferId)}`;

const getWorkflowUrl = (config, role, transfer = {}) => {
  const basePath = workflowPaths[role] || '#/stock-transfer-workflow/ceo';
  const params = new URLSearchParams();
  if (transfer.id) params.set('taskTransfer', transfer.id);
  if (role === 'location') {
    params.set('location', normalizeWorkflowLocation(transfer.currentLocation));
  }
  const query = params.toString();
  return `${getConfiguredBaseUrl(config)}/${basePath}${query ? `?${query}` : ''}`;
};

const emailJsTemplateExample = `<div style="font-family:Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:720px;margin:0 auto;background:white;border-radius:14px;overflow:hidden;border:1px solid #dbeafe;">
    <div style="background:#2563eb;color:white;padding:20px 24px;">
      <h2 style="margin:0;">{{title}}</h2>
      <p style="margin:8px 0 0;">Unfinished tasks: {{task_count}}</p>
    </div>
    <div style="padding:24px;">
      {{{content}}}
      <p style="margin-top:20px;">
        <a href="{{workflow_url}}" style="color:#2563eb;font-weight:bold;">Open this stock transfer task</a>
      </p>
      <p>NSM approve link, if this email is for NSM Approval: <a href="{{approve_link}}">{{approve_link}}</a></p>
    </div>
  </div>
</div>`;

const buildEmailHtml = (role, transfer, workflowUrl) => {
  const taskButton = workflowUrl ? `
    <div style="margin-top:20px;text-align:center;">
      <a href="${escapeHtml(workflowUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;">Open and Confirm</a>
    </div>
  ` : '';

  const taskLabel = getTaskLabel(role, transfer);
  const subtasks = getTaskSubtasks(role, transfer);
  const subtasksBlock = subtasks.length ? `
    <div style="margin-top:16px;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;background:#eff6ff;">
      <div style="font-weight:700;color:#1d4ed8;margin-bottom:8px;">${escapeHtml(role === 'finance' ? 'Finance subtasks' : 'Subtasks')}</div>
      <ul style="margin:0;padding-left:20px;color:#1e3a8a;line-height:1.55;">
        ${subtasks.map((subtask) => `<li>${escapeHtml(subtask)}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#172554;">
      <div style="border-left:4px solid #2563eb;background:#eff6ff;padding:14px 16px;border-radius:10px;">
        <div style="font-weight:700;color:#1d4ed8;margin-bottom:4px;">Please confirm this stock transfer task.</div>
        <div style="color:#1e40af;font-size:13px;">Open the link and confirm once your part is done.</div>
      </div>
      <div style="margin-top:16px;border:1px solid #bfdbfe;border-radius:12px;overflow:hidden;">
        <div style="padding:10px 14px;border-bottom:1px solid #dbeafe;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">Chassis</span><span style="color:#172554;">${escapeHtml(transfer.chassis || '-')}</span></div>
        <div style="padding:10px 14px;border-bottom:1px solid #dbeafe;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">From</span><span style="color:#172554;">${escapeHtml(transfer.currentLocation || '-')}</span></div>
        <div style="padding:10px 14px;border-bottom:1px solid #dbeafe;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">To</span><span style="color:#172554;">${escapeHtml(transfer.targetLocation || '-')}</span></div>
        <div style="padding:10px 14px;"><span style="display:inline-block;width:120px;color:#1d4ed8;font-weight:700;">Current task</span><span style="color:#172554;">${escapeHtml(taskLabel)}</span></div>
      </div>
      ${subtasksBlock}
      ${taskButton}
    </div>
  `;
};

const getRecipient = (config, role, transfer) => {
  if (role === 'location') {
    return config?.locationRecipients?.[normalizeWorkflowLocation(transfer?.currentLocation)] || '';
  }

  return config?.recipients?.[role] || '';
};

const getCcRecipient = (config, role) => config?.ccRecipients?.[role] || '';

const canSendEmail = (config, role, transfer = {}) => (
  Boolean(getRecipient(config, role, transfer))
);

const sendWorkflowEmail = async (role, transfer, config, taskCount = 1) => {
  if (!canSendEmail(config, role, transfer)) return false;
  const emailTitle = getEmailTitle(role, transfer);
  const workflowUrl = getWorkflowUrl(config, role, transfer);
  const approveLink = role === 'ceo' ? getApproveLink(config, transfer.id) : '';
  const content = buildEmailHtml(role, transfer, workflowUrl);
  const jobId = getEmailJobId(transfer, role);
  const recipient = getRecipient(config, role, transfer);
  await queueEmailJob({
    jobId,
    step: getEmailStep(role, transfer),
    role,
    to: recipient,
    cc: getCcRecipient(config, role),
    title: emailTitle,
    content,
    metadata: {
      transferId: transfer.id,
      taskCount,
      source: 'stock_transfer_workflow',
      workflowUrl,
      approveLink,
      taskTransferId: transfer.id,
      chassis: transfer.chassis || '',
      model: transfer.Model || '',
      currentLocation: transfer.currentLocation || '',
      targetLocation: transfer.targetLocation || '',
      salesOrderDisplay: transfer['Sales Order Display'] || '',
      transferCategory: transfer['Stock Transfer Category'] || '',
    },
  });
  return true;
};

const ConfigEditor = ({ config, onChange, onSave, saving }) => {
  const updateConfig = (path, value) => {
    const [section, key] = path.split('.');
    if (!key) {
      onChange({ ...config, [section]: value });
      return;
    }
    onChange({ ...config, [section]: { ...(config[section] || {}), [key]: value } });
  };

  return (
    <details className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">Backend email recipients and content</summary>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <input
          className="rounded border px-3 py-2 text-sm md:col-span-2"
          placeholder="Public workflow website URL"
          value={config.appBaseUrl || ''}
          onChange={(e) => updateConfig('appBaseUrl', e.target.value)}
        />
        <button type="button" onClick={onSave} disabled={saving} className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400">
          {saving ? 'Saving...' : 'Save email settings'}
        </button>
        <div className="md:col-span-3 mt-2 text-sm font-semibold text-gray-700">Location DMS recipients</div>
        {LOCATION_WORKFLOW_LOCATIONS.map(([locationKey, label]) => (
          <input
            key={locationKey}
            className="rounded border px-3 py-2 text-sm"
            placeholder={`${label} recipient email`}
            value={config.locationRecipients?.[locationKey] || ''}
            onChange={(e) => updateConfig(`locationRecipients.${locationKey}`, e.target.value)}
          />
        ))}
        <div className="md:col-span-3 mt-2 text-sm font-semibold text-gray-700">Role recipients and content</div>
        {Object.keys(roleLabels).filter((role) => role !== 'location').map((role) => (
          <React.Fragment key={role}>
            <input className="rounded border px-3 py-2 text-sm" placeholder={`${roleLabels[role]} recipient email`} value={config.recipients?.[role] || ''} onChange={(e) => updateConfig(`recipients.${role}`, e.target.value)} />
            <input className="rounded border px-3 py-2 text-sm" placeholder={`${roleLabels[role]} CC email`} value={config.ccRecipients?.[role] || ''} onChange={(e) => updateConfig(`ccRecipients.${role}`, e.target.value)} />
            <input className="rounded border px-3 py-2 text-sm" placeholder={`${roleLabels[role]} email subject`} value={config.subjects?.[role] || ''} onChange={(e) => updateConfig(`subjects.${role}`, e.target.value)} />
            <textarea className="rounded border px-3 py-2 text-sm md:col-span-3" rows="2" placeholder={`${roleLabels[role]} email content / note`} value={config.bodyNotes?.[role] || ''} onChange={(e) => updateConfig(`bodyNotes.${role}`, e.target.value)} />
          </React.Fragment>
        ))}
      </div>
    </details>
  );
};

// Kept temporarily to avoid touching older workflow markup while the redesigned panel settles.
// eslint-disable-next-line no-unused-vars
const TaskCard = ({ role, transfer, onComplete }) => {
  const [vendor, setVendor] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [purchasePoNumber, setPurchasePoNumber] = useState('');
  const actionText = {
    ceo: 'Approve',
    location: isExternalTransfer(transfer) ? 'Confirm DMS reverse goods receiving' : 'Confirm DMS transfer done',
    planning: 'Confirm SO BP changed',
    finance: isFinanceFloorplanStep(transfer) ? 'Confirm floorplan check' : 'Confirm reverse invoice and PGI',
    transport: 'Confirm transport booking',
    purchase: 'Confirm Transport PO',
  }[role];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-gray-900">{transfer.chassis || '-'}</div>
          <div className="text-sm text-gray-600">{transfer.Model || '-'} · {transfer.currentLocation || '-'} → {transfer.targetLocation || '-'}</div>
          <div className="mt-2 text-xs font-medium text-indigo-700">{transfer['Stock Transfer Category'] || '-'}</div>
          {role === 'finance' && (
            <div className="mt-1 text-xs font-semibold text-amber-700">
              Step: {getFinanceTaskLabel(transfer)}
            </div>
          )}
        </div>
        <button type="button" onClick={() => onComplete(transfer, { vendor, bookingTime, purchasePoNumber })} className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
          {actionText}
        </button>
      </div>
      {role !== 'ceo' && (
        <div className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-4">
          {[
            ['SO PGI Post Date', transfer['SO PGI Post Date'] || 'nopgi'],
            ['Company Stock Current Location', transfer['Company Stock Current Location']],
            ['Sales Order Display', transfer['Sales Order Display']],
            ['Invoice-to Name', transfer['Invoice-to Name']],
            ['Last Invoice Date', transfer['Last Invoice Date']],
            ['Last Invoice Number', transfer['Last Invoice Number']],
            ['Invoice BP Last Changed By', transfer['Invoice BP Last Changed By']],
            ['Invoice BP Last Change Date', transfer['Invoice BP Last Change Date']],
          ].map(([label, value]) => (
            <div key={label} className="rounded bg-gray-50 p-2">
              <div className="text-xs font-semibold uppercase text-gray-500">{label}</div>
              <div className="text-gray-800">{value || '-'}</div>
            </div>
          ))}
        </div>
      )}
      {role === 'transport' && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className="rounded border px-3 py-2 text-sm" placeholder="Transport vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          <input className="rounded border px-3 py-2 text-sm" type="datetime-local" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} />
        </div>
      )}
      {role === 'purchase' && (
        <div className="mt-4">
          <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Transport PO number" value={purchasePoNumber} onChange={(e) => setPurchasePoNumber(e.target.value)} />
        </div>
      )}
    </div>
  );
};

const TaskCardPanel = ({ role, transfer, onComplete }) => {
  const [vendor, setVendor] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [purchasePoNumber, setPurchasePoNumber] = useState('');
  const actionText = {
    ceo: 'Approve',
    location: isExternalTransfer(transfer) ? 'Confirm DMS reverse goods receiving' : 'Confirm DMS transfer done',
    planning: 'Confirm SO BP changed',
    finance: isFinanceFloorplanStep(transfer) ? 'Confirm floorplan check' : 'Confirm reverse invoice and PGI',
    transport: 'Confirm transport booking',
    purchase: 'Confirm Transport PO',
  }[role];

  const detailRows = [
    ['SO PGI Post Date', transfer['SO PGI Post Date'] || 'nopgi'],
    ['Company Stock Current Location', transfer['Company Stock Current Location']],
    ['Sales Order Display', transfer['Sales Order Display']],
    ['Invoice-to Name', transfer['Invoice-to Name']],
    ['Last Invoice Date', transfer['Last Invoice Date']],
    ['Last Invoice Number', transfer['Last Invoice Number']],
    ['Invoice BP Last Changed By', transfer['Invoice BP Last Changed By']],
    ['Invoice BP Last Change Date', transfer['Invoice BP Last Change Date']],
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-950">{transfer.chassis || '-'}</div>
          <div className="text-sm text-slate-500">{transfer.Model || '-'} / {transfer.currentLocation || '-'} to {transfer.targetLocation || '-'}</div>
          <div className="mt-2 text-xs font-semibold text-slate-500">{transfer['Stock Transfer Category'] || '-'}</div>
          {role === 'finance' && (
            <div className="mt-1 text-xs font-semibold text-amber-700">Step: {getFinanceTaskLabel(transfer)}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onComplete(transfer, { vendor, bookingTime, purchasePoNumber })}
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {actionText}
        </button>
      </div>

      {role !== 'ceo' && (
        <div className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-4">
          {detailRows.map(([label, value]) => (
            <div key={label} className="rounded-md border border-slate-100 bg-slate-50 p-2">
              <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
              <div className="text-slate-800">{value || '-'}</div>
            </div>
          ))}
        </div>
      )}

      {role === 'transport' && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Transport vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          <input className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" type="datetime-local" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} />
        </div>
      )}

      {role === 'purchase' && (
        <div className="mt-4">
          <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" placeholder="Transport PO number" value={purchasePoNumber} onChange={(e) => setPurchasePoNumber(e.target.value)} />
        </div>
      )}
    </div>
  );
};

const StockTransferWorkflow = ({ role = 'ceo', standalone = false }) => {
  const [transfers, setTransfers] = useState({});
  const [config, setConfig] = useState(defaultConfig);
  const [savingConfig, setSavingConfig] = useState(false);
  const [message, setMessage] = useState('');
  const ceoEmailSendLocks = useRef(new Set());
  const ceoEmailQueueRunning = useRef(false);

  useEffect(() => {
    const transfersRef = ref(database, TRANSFERS_PATH);
    const configRef = ref(database, CONFIG_PATH);
    const handleTransfers = (snapshot) => setTransfers(snapshot.exists() ? snapshot.val() || {} : {});
    const handleConfig = (snapshot) => setConfig(normalizeWorkflowConfig(snapshot.exists() ? snapshot.val() || {} : {}));
    onValue(transfersRef, handleTransfers);
    onValue(configRef, handleConfig);
    return () => {
      off(transfersRef, 'value', handleTransfers);
      off(configRef, 'value', handleConfig);
    };
  }, []);

  useEffect(() => {
    if (ceoEmailQueueRunning.current || !canSendEmail(config, 'ceo')) return;
    const pendingTransfer = buildRows(transfers).find((transfer) => {
      const workflow = getWorkflow(transfer);
      return !workflow.ceoEmailSentAt
        && !workflow.ceoEmailQueuedAt
        && !workflow.ceoEmailJobId
        && hasSalesOrder(transfer)
        && !ceoEmailSendLocks.current.has(transfer.id);
    });

    if (!pendingTransfer) return;
    ceoEmailQueueRunning.current = true;
    ceoEmailSendLocks.current.add(pendingTransfer.id);

    const sendTimer = window.setTimeout(async () => {
      const claimTime = new Date().toISOString();
      const workflowRef = ref(database, `${TRANSFERS_PATH}/${pendingTransfer.id}/workflow`);

      try {
        const claimResult = await runTransaction(workflowRef, (workflow = {}) => {
          if (workflow.ceoEmailSentAt) return;
          const sendingAt = workflow.ceoEmailSendingAt ? Date.parse(workflow.ceoEmailSendingAt) : 0;
          const sendingIsFresh = sendingAt && Date.now() - sendingAt < 120000;
          if (sendingIsFresh) return;
          return {
            ...workflow,
            ceoEmailSendingAt: claimTime,
            ceoStatus: 'Queueing NSM approval email',
          };
        });

        if (!claimResult.committed) return;

        await sendWorkflowEmail('ceo', pendingTransfer, config, getTaskList('ceo', transfers).length);
        await update(workflowRef, {
          ceoEmailQueuedAt: new Date().toISOString(),
          ceoEmailJobId: getEmailJobId(pendingTransfer, 'ceo'),
          ceoEmailStep: getEmailStep('ceo', pendingTransfer),
          ceoEmailSendingAt: null,
          ceoEmailError: null,
          ceoStatus: 'Pending NSM approval',
        });
      } catch (error) {
        ceoEmailSendLocks.current.delete(pendingTransfer.id);
        await update(workflowRef, {
          ceoEmailSendingAt: null,
          ceoEmailError: error instanceof Error ? error.message : 'Failed to queue NSM approval email',
        }).catch(() => {});
        console.error('Failed to queue NSM stock transfer email:', error);
      } finally {
        ceoEmailQueueRunning.current = false;
      }
    }, 4000);

    return () => window.clearTimeout(sendTimer);
  }, [transfers, config]);

  const hashQuery = window.location.hash.split('?')[1] || '';
  const queryParams = new URLSearchParams(hashQuery);
  const approveTransferId = queryParams.get('approveTransfer') || '';
  const taskTransferId = queryParams.get('taskTransfer') || '';
  const emailTransferId = approveTransferId || taskTransferId;
  const locationFilter = queryParams.get('location') || '';
  const locationKey = normalizeWorkflowLocation(locationFilter);
  const allRoleTasks = useMemo(() => (
    role === 'settings' ? [] : getTaskList(role, transfers, locationKey)
  ), [role, transfers, locationKey]);
  const tasks = useMemo(() => {
    if (role === 'settings') return [];
    if (emailTransferId) return allRoleTasks.filter((transfer) => transfer.id === emailTransferId);
    return standalone ? [] : allRoleTasks;
  }, [allRoleTasks, emailTransferId, role, standalone]);
  const needsEmailLink = standalone && role !== 'settings' && !emailTransferId;
  const linkedTransferExists = emailTransferId ? Boolean(transfers?.[emailTransferId]) : true;
  const linkedTaskUnavailable = Boolean(
    standalone
    && role !== 'settings'
    && emailTransferId
    && linkedTransferExists
    && tasks.length === 0
  );

  const saveConfig = async () => {
    setSavingConfig(true);
    setMessage('');
    try {
      await update(ref(database, CONFIG_PATH), config);
      setMessage('Email settings saved.');
    } catch (error) {
      console.error('Failed to save stock transfer workflow config:', error);
      setMessage('Failed to save email settings.');
    } finally {
      setSavingConfig(false);
    }
  };

  const completeTask = async (transfer, extra = {}) => {
    const now = new Date().toISOString();
    const updates = {};
    if (role === 'ceo') updates.workflow = { ...getWorkflow(transfer), ceoApprovedAt: now, ceoStatus: 'NSM approved' };
    if (role === 'location') {
      updates.workflow = {
        ...getWorkflow(transfer),
        locationDmsDoneAt: now,
        locationDmsStatus: isExternalTransfer(transfer) ? 'DMS reverse goods receiving done' : 'DMS transfer done',
        locationDmsOwner: getLocationLabel(normalizeWorkflowLocation(transfer.currentLocation)),
      };
    }
    if (role === 'planning') updates.workflow = { ...getWorkflow(transfer), planningBpDoneAt: now, planningBpStatus: 'SO BP changed' };
    if (role === 'finance') {
      const workflow = getWorkflow(transfer);
      updates.workflow = !workflow.redoInvoiceDoneAt
        ? { ...workflow, redoInvoiceDoneAt: now, redoInvoiceStatus: 'Floorplan check confirmed' }
        : { ...workflow, financeDoneAt: now, financeStatus: 'Reverse invoice and PGI confirmed' };
    }
    if (role === 'transport') {
      updates.workflow = { ...getWorkflow(transfer), transportDoneAt: now, transportStatus: 'Transport booked', transportVendor: extra.vendor || '', transportBookingTime: extra.bookingTime || '' };
    }
    if (role === 'purchase') updates.workflow = {
      ...getWorkflow(transfer),
      purchaseDoneAt: now,
      purchaseStatus: 'Transport PO confirmed',
      purchasePoNumber: extra.purchasePoNumber || '',
    };

    try {
      await update(ref(database, `${TRANSFERS_PATH}/${transfer.id}`), updates);
      const updatedTransfer = { ...transfer, ...updates };
      const nextRole = getNextEmailRole(role, updatedTransfer);
      if (nextRole) {
        const nextTransfers = { ...transfers, [transfer.id]: updatedTransfer };
        const nextLocationKey = nextRole === 'location' ? normalizeWorkflowLocation(updatedTransfer.currentLocation) : '';
        const recipient = getRecipient(config, nextRole, updatedTransfer);
        if (canSendEmail(config, nextRole, updatedTransfer)) {
          const emailJobId = getEmailJobId(updatedTransfer, nextRole);
          const emailStep = getEmailStep(nextRole, updatedTransfer);
          await sendWorkflowEmail(nextRole, updatedTransfer, config, getTaskList(nextRole, nextTransfers, nextLocationKey).length);
          await update(ref(database, `${TRANSFERS_PATH}/${transfer.id}/workflow`), {
            [`${nextRole}EmailQueuedAt`]: new Date().toISOString(),
            [`${nextRole}EmailJobId`]: emailJobId,
            [`${nextRole}EmailStep`]: emailStep,
            [`${nextRole}EmailRecipient`]: recipient,
            [`${nextRole}EmailError`]: null,
          });
        } else {
          await update(ref(database, `${TRANSFERS_PATH}/${transfer.id}/workflow`), {
            [`${nextRole}EmailError`]: nextRole === 'location'
              ? `Missing location recipient for ${getLocationLabel(nextLocationKey)} (${nextLocationKey})`
              : `Missing recipient for ${nextRole}`,
          });
        }
      }
      setMessage('Task completed.');
    } catch (error) {
      console.error('Failed to complete stock transfer workflow task:', error);
      setMessage('Failed to complete task.');
    }
  };

  const content = (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 text-slate-900 sm:px-6">
      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock Transfer Workflow</div>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">{role === 'settings' ? 'Email Settings' : role === 'location' ? `${getLocationLabel(locationKey)} DMS Work` : roleLabels[role]}</h2>
          </div>
          {role !== 'settings' && (
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{tasks.length} pending</span>
          )}
        </div>
      </div>
      {role === 'location' && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Internal stock transfer: confirm the DMS transfer is completed. External stock transfer: confirm DMS reverse goods receiving is completed.
        </div>
      )}
      {role === 'settings' && (
        <ConfigEditor config={config} onChange={setConfig} onSave={saveConfig} saving={savingConfig} />
      )}
      {role === 'settings' && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Use one EmailJS template for all workflow emails. In EmailJS, set To Email to <span className="font-semibold">{'{{to_email}}'}</span>, Subject to <span className="font-semibold">{'{{title}}'}</span>, and the email body to <span className="font-semibold">{'{{{content}}}'}</span> (or {'{{content}}'} if your template does not support triple braces). Available variables: <span className="font-semibold">to_email, title, task_count, uncompleted_task_count, approve_link, message_note, content, message_html, workflow_url, chassis, model, current_location, target_location, sales_order_display, transfer_category</span>.
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">{emailJsTemplateExample}</pre>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="font-semibold text-green-800">Internal stock transfer email flow</div>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {workflowFlowSummaries.internal.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
              <div className="font-semibold text-amber-800">External stock transfer email flow</div>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {workflowFlowSummaries.external.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <div className="mt-2 text-xs text-amber-700">Finance receives two separate emails for external transfers: Floorplan Check first, then Reverse Invoice and PGI after Location DMS is done.</div>
            </div>
          </div>
        </div>
      )}
      {message && <div className="mb-4 rounded-lg bg-slate-100 p-3 text-sm font-medium text-slate-700 shadow-sm">{message}</div>}
      {needsEmailLink && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Please open this stock transfer task from the email link.
        </div>
      )}
      {emailTransferId && !linkedTransferExists && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          This stock transfer task link is no longer available.
        </div>
      )}
      {linkedTaskUnavailable && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          This stock transfer task is already completed or is not ready for this step.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        {role !== 'settings' && !needsEmailLink && tasks.map((transfer) => <TaskCardPanel key={transfer.id} role={role} transfer={transfer} onComplete={completeTask} />)}
        {role !== 'settings' && !needsEmailLink && !emailTransferId && tasks.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">No unfinished tasks.</div>}
      </div>
    </div>
  );

  if (standalone) {
    return <div className="min-h-screen bg-slate-50">{content}</div>;
  }

  return content;
};

export default StockTransferWorkflow;

export const StockTransferEmailDispatcher = () => {
  const [transfers, setTransfers] = useState({});
  const [config, setConfig] = useState(defaultConfig);
  const ceoEmailSendLocks = useRef(new Set());
  const ceoEmailQueueRunning = useRef(false);

  useEffect(() => {
    const transfersRef = ref(database, TRANSFERS_PATH);
    const configRef = ref(database, CONFIG_PATH);
    const handleTransfers = (snapshot) => setTransfers(snapshot.exists() ? snapshot.val() || {} : {});
    const handleConfig = (snapshot) => setConfig(normalizeWorkflowConfig(snapshot.exists() ? snapshot.val() || {} : {}));
    onValue(transfersRef, handleTransfers);
    onValue(configRef, handleConfig);
    return () => {
      off(transfersRef, 'value', handleTransfers);
      off(configRef, 'value', handleConfig);
    };
  }, []);

  useEffect(() => {
    if (ceoEmailQueueRunning.current || !canSendEmail(config, 'ceo')) return;
    const pendingTransfer = buildRows(transfers).find((transfer) => {
      const workflow = getWorkflow(transfer);
      return !workflow.ceoEmailSentAt
        && !workflow.ceoEmailQueuedAt
        && !workflow.ceoEmailJobId
        && hasSalesOrder(transfer)
        && !ceoEmailSendLocks.current.has(transfer.id);
    });

    if (!pendingTransfer) return;
    ceoEmailQueueRunning.current = true;
    ceoEmailSendLocks.current.add(pendingTransfer.id);

    const sendTimer = window.setTimeout(async () => {
      const claimTime = new Date().toISOString();
      const workflowRef = ref(database, `${TRANSFERS_PATH}/${pendingTransfer.id}/workflow`);

      try {
        const claimResult = await runTransaction(workflowRef, (workflow = {}) => {
          if (workflow.ceoEmailSentAt) return;
          const sendingAt = workflow.ceoEmailSendingAt ? Date.parse(workflow.ceoEmailSendingAt) : 0;
          const sendingIsFresh = sendingAt && Date.now() - sendingAt < 120000;
          if (sendingIsFresh) return;
          return {
            ...workflow,
            ceoEmailSendingAt: claimTime,
            ceoStatus: 'Queueing NSM approval email',
          };
        });

        if (!claimResult.committed) return;

        await sendWorkflowEmail('ceo', pendingTransfer, config, getTaskList('ceo', transfers).length);
        await update(workflowRef, {
          ceoEmailQueuedAt: new Date().toISOString(),
          ceoEmailJobId: getEmailJobId(pendingTransfer, 'ceo'),
          ceoEmailStep: getEmailStep('ceo', pendingTransfer),
          ceoEmailSendingAt: null,
          ceoEmailError: null,
          ceoStatus: 'Pending NSM approval',
        });
      } catch (error) {
        ceoEmailSendLocks.current.delete(pendingTransfer.id);
        await update(workflowRef, {
          ceoEmailSendingAt: null,
          ceoEmailError: error instanceof Error ? error.message : 'Failed to queue NSM approval email',
        }).catch(() => {});
        console.error('Failed to queue NSM stock transfer email:', error);
      } finally {
        ceoEmailQueueRunning.current = false;
      }
    }, 4000);

    return () => window.clearTimeout(sendTimer);
  }, [transfers, config]);

  return null;
};
