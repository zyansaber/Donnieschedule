import React, { useEffect, useMemo, useRef, useState } from 'react';
import { off, onValue, ref, runTransaction, update } from 'firebase/database';
import { database } from '../utils/firebase';

const TRANSFERS_PATH = 'stock_transfer';
const CONFIG_PATH = 'stockTransferWorkflowConfig';
const EMAIL_JOBS_PATH = 'email_jobs';
const ACTIVE_EMAIL_JOB_STATUSES = ['pending', 'sending', 'sent'];

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
    ceo: 'Stock Transfer CEO Approval Required',
    planning: 'Stock Transfer Planning Task',
    finance: 'Stock Transfer Finance Task',
    transport: 'Stock Transfer Transport Task',
    purchase: 'Stock Transfer Purchase Task',
  },
  bodyNotes: {
    ceo: 'Please review and approve this stock transfer.',
    location: 'Please complete the DMS stock transfer task for your location.',
    planning: 'Please confirm DMS is done for this stock transfer.',
    finance: 'External transfers use Finance twice: first redo the invoice, then after Location DMS reverse goods receiving, reverse PGI.',
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
};

const workflowPaths = {
  ceo: '#/stock-transfer-workflow/ceo',
  planning: '#/stock-transfer-workflow/planning',
  finance: '#/stock-transfer-workflow/finance',
  transport: '#/stock-transfer-workflow/transport',
  purchase: '#/stock-transfer-workflow/purchase',
  settings: '#/stock-transfer-workflow/settings',
};

const roleLabels = {
  ceo: 'CEO Approval',
  location: 'Location DMS Work',
  planning: 'Planning Work',
  finance: 'Finance Work',
  transport: 'Transport Work',
  purchase: 'Purchase Work',
};

const workflowFlowSummaries = {
  internal: [
    'CEO Approval',
    'Current Location confirms DMS transfer done',
    'Transport books transport',
    'Purchase raises Transport PO',
  ],
  external: [
    'CEO Approval',
    'Finance confirms redo invoice',
    'Current Location confirms DMS reverse goods receiving',
    'Finance confirms Reverse PGI',
    'Planning confirms BP changed',
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
    const readyForLocation = isExternalTransfer(transfer) ? workflow.redoInvoiceDoneAt : workflow.ceoApprovedAt;
    return readyForLocation
      && !workflow.locationDmsDoneAt
      && (!locationKey || transferLocationKey === locationKey);
  }
  if (role === 'planning') return isExternalTransfer(transfer) && workflow.financeDoneAt && !workflow.planningBpDoneAt;
  if (role === 'finance') {
    if (!isExternalTransfer(transfer)) return false;
    if (!workflow.redoInvoiceDoneAt) return true;
    return workflow.locationDmsDoneAt && !workflow.financeDoneAt;
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
  if (completedRole === 'ceo') return isExternalTransfer(transfer) ? 'finance' : 'location';
  if (completedRole === 'location') return isExternalTransfer(transfer) ? 'finance' : 'transport';
  if (completedRole === 'finance') return workflow.financeDoneAt ? 'planning' : 'location';
  if (completedRole === 'planning') return 'transport';
  if (completedRole === 'transport') return 'purchase';
  return '';
};

const getEmailStep = (role, transfer = {}) => {
  if (role === 'ceo') return 'ceo_approval';
  if (role === 'location') return 'location_dms';
  if (role === 'planning') return 'planning_bp_change';
  if (role === 'transport') return 'transport_booking';
  if (role === 'purchase') return 'purchase_po';
  if (role === 'finance') {
    return isExternalTransfer(transfer) && !getWorkflow(transfer).redoInvoiceDoneAt
      ? 'finance_redo_invoice'
      : 'finance_reverse_pgi';
  }
  return role || 'unknown';
};

const getSafeFirebaseKey = (value) => String(value || '').replace(/[.#$\[\]/]/g, '_');

const getEmailJobId = (transfer, role) => (
  `${getSafeFirebaseKey(transfer?.id)}_${getEmailStep(role, transfer)}`
);

const getApproveLink = (transferId) => `${window.location.origin}/#/stock-transfer-workflow/ceo?approveTransfer=${encodeURIComponent(transferId)}`;

const emailJsTemplateExample = `<div style="font-family:Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:720px;margin:0 auto;background:white;border-radius:18px;overflow:hidden;">
    <div style="background:#4f46e5;color:white;padding:20px 24px;">
      <h2 style="margin:0;">{{title}}</h2>
      <p style="margin:8px 0 0;">Unfinished tasks: {{task_count}}</p>
    </div>
    <div style="padding:24px;">
      {{{content}}}
      <p style="margin-top:20px;">
        <a href="{{workflow_url}}" style="color:#4f46e5;font-weight:bold;">Open workflow page</a>
      </p>
      <p>CEO approve link, if this email is for CEO: <a href="{{approve_link}}">{{approve_link}}</a></p>
    </div>
  </div>
</div>`;

const buildEmailHtml = (role, transfer, title, note, taskCount) => {
  const details = role === 'ceo'
    ? [
      ['Chassis', transfer.chassis],
      ['Model', transfer.Model],
      ['Current Location', transfer.currentLocation],
      ['Target Location', transfer.targetLocation],
    ]
    : [
      ['Chassis', transfer.chassis],
      ['Model', transfer.Model],
      ['SO PGI Post Date', transfer['SO PGI Post Date'] || 'nopgi'],
      ['Company Stock Current Location', transfer['Company Stock Current Location']],
      ['Sales Order Display', transfer['Sales Order Display']],
      ['Invoice-to Name', transfer['Invoice-to Name']],
      ['Last Invoice Date', transfer['Last Invoice Date']],
      ['Last Invoice Number', transfer['Last Invoice Number']],
      ['Invoice BP Last Changed By', transfer['Invoice BP Last Changed By']],
      ['Invoice BP Last Change Date', transfer['Invoice BP Last Change Date']],
      ['Current Location', transfer.currentLocation],
      ['Target Location', transfer.targetLocation],
    ];

  const rows = details.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827;">${value || '-'}</td>
    </tr>
  `).join('');

  const approveButton = role === 'ceo' ? `
    <div style="margin-top:20px;text-align:center;">
      <a href="${getApproveLink(transfer.id)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;">Approve stock transfer</a>
    </div>
  ` : '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
      <div style="background:#4f46e5;color:#ffffff;padding:22px 26px;">
        <h2 style="margin:0;font-size:22px;">${title}</h2>
        <p style="margin:8px 0 0;opacity:0.9;">${note || 'Stock Transfer Workflow'}</p>
        <p style="margin:12px 0 0;background:rgba(255,255,255,0.16);display:inline-block;padding:6px 10px;border-radius:999px;font-size:13px;">Unfinished tasks: ${taskCount || 0}</p>
      </div>
      <div style="padding:22px 26px;">
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">${rows}</table>
        ${approveButton}
        <p style="margin-top:18px;color:#6b7280;font-size:13px;">Open the scheduling system workflow page to complete this task.</p>
      </div>
    </div>
  `;
};

const getRecipient = (config, role, transfer) => {
  if (role === 'location') {
    return config?.locationRecipients?.[normalizeWorkflowLocation(transfer?.currentLocation)] || '';
  }

  return config?.recipients?.[role] || '';
};

const canSendEmail = (config, role, transfer = {}) => (
  Boolean(getRecipient(config, role, transfer))
);

const getWorkflowUrl = (role, transfer = {}) => {
  const basePath = workflowPaths[role] || '#/stock-transfer-workflow/ceo';
  const locationQuery = role === 'location'
    ? `?location=${encodeURIComponent(normalizeWorkflowLocation(transfer.currentLocation))}`
    : '';
  return `${window.location.origin}/${basePath}${locationQuery}`;
};

const sendWorkflowEmail = async (role, transfer, config, taskCount = 1) => {
  if (!canSendEmail(config, role, transfer)) return false;
  const emailTitle = config.subjects?.[role] || (role === 'ceo' ? 'Stock Transfer CEO Approval Required' : `${roleLabels[role]} Task`);
  const emailNote = config.bodyNotes?.[role] || '';
  const content = buildEmailHtml(role, transfer, emailTitle, emailNote, taskCount);
  const now = new Date().toISOString();
  const jobId = getEmailJobId(transfer, role);
  const jobRef = ref(database, `${EMAIL_JOBS_PATH}/${jobId}`);
  const recipient = getRecipient(config, role, transfer);
  const jobData = {
    status: 'pending',
    transferId: transfer.id,
    step: getEmailStep(role, transfer),
    role,
    to: recipient,
    title: emailTitle,
    content,
    taskCount,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    source: 'stock_transfer_workflow',
    workflowUrl: getWorkflowUrl(role, transfer),
    approveLink: role === 'ceo' ? getApproveLink(transfer.id) : '',
    chassis: transfer.chassis || '',
    model: transfer.Model || '',
    currentLocation: transfer.currentLocation || '',
    targetLocation: transfer.targetLocation || '',
    salesOrderDisplay: transfer['Sales Order Display'] || '',
    transferCategory: transfer['Stock Transfer Category'] || '',
  };

  const result = await runTransaction(jobRef, (existingJob) => {
    if (existingJob && ACTIVE_EMAIL_JOB_STATUSES.includes(existingJob.status)) return;
    return {
      ...(existingJob || {}),
      ...jobData,
      attempts: Number(existingJob?.attempts) || 0,
      lastError: null,
      failedAt: null,
    };
  });

  if (result.committed) return true;
  const existingJob = result.snapshot.val();
  return Boolean(existingJob && ACTIVE_EMAIL_JOB_STATUSES.includes(existingJob.status));
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
            <input className="rounded border px-3 py-2 text-sm md:col-span-2" placeholder={`${roleLabels[role]} email subject`} value={config.subjects?.[role] || ''} onChange={(e) => updateConfig(`subjects.${role}`, e.target.value)} />
            <textarea className="rounded border px-3 py-2 text-sm md:col-span-3" rows="2" placeholder={`${roleLabels[role]} email content / note`} value={config.bodyNotes?.[role] || ''} onChange={(e) => updateConfig(`bodyNotes.${role}`, e.target.value)} />
          </React.Fragment>
        ))}
      </div>
    </details>
  );
};

const TaskCard = ({ role, transfer, onComplete }) => {
  const [vendor, setVendor] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [purchasePoNumber, setPurchasePoNumber] = useState('');
  const actionText = {
    ceo: 'Approve',
    location: isExternalTransfer(transfer) ? 'Confirm DMS reverse goods receiving' : 'Confirm DMS transfer done',
    planning: 'Confirm BP changed',
    finance: isExternalTransfer(transfer) && !getWorkflow(transfer).redoInvoiceDoneAt ? 'Confirm redo invoice' : 'Confirm reverse PGI',
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
          {role === 'finance' && isExternalTransfer(transfer) && (
            <div className="mt-1 text-xs font-semibold text-amber-700">
              {!getWorkflow(transfer).redoInvoiceDoneAt ? 'Step: Redo Invoice' : 'Step: Reverse PGI'}
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
    const handleConfig = (snapshot) => setConfig({ ...defaultConfig, ...(snapshot.exists() ? snapshot.val() || {} : {}) });
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
            ceoStatus: 'Queueing CEO email',
          };
        });

        if (!claimResult.committed) return;

        await sendWorkflowEmail('ceo', pendingTransfer, config, getTaskList('ceo', transfers).length);
        await update(workflowRef, {
          ceoEmailSentAt: new Date().toISOString(),
          ceoEmailQueuedAt: new Date().toISOString(),
          ceoEmailJobId: getEmailJobId(pendingTransfer, 'ceo'),
          ceoEmailStep: getEmailStep('ceo', pendingTransfer),
          ceoEmailSendingAt: null,
          ceoEmailError: null,
          ceoStatus: 'Pending approval',
        });
      } catch (error) {
        ceoEmailSendLocks.current.delete(pendingTransfer.id);
        await update(workflowRef, {
          ceoEmailSendingAt: null,
          ceoEmailError: error instanceof Error ? error.message : 'Failed to queue CEO email',
        }).catch(() => {});
        console.error('Failed to queue CEO stock transfer email:', error);
      } finally {
        ceoEmailQueueRunning.current = false;
      }
    }, 4000);

    return () => window.clearTimeout(sendTimer);
  }, [transfers, config]);

  const hashQuery = window.location.hash.split('?')[1] || '';
  const locationFilter = new URLSearchParams(hashQuery).get('location') || '';
  const locationKey = normalizeWorkflowLocation(locationFilter);
  const tasks = useMemo(() => (role === 'settings' ? [] : getTaskList(role, transfers, locationKey)), [role, transfers, locationKey]);

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
    if (role === 'ceo') updates.workflow = { ...getWorkflow(transfer), ceoApprovedAt: now, ceoStatus: 'CEO approved' };
    if (role === 'location') {
      updates.workflow = {
        ...getWorkflow(transfer),
        locationDmsDoneAt: now,
        locationDmsStatus: isExternalTransfer(transfer) ? 'DMS reverse goods receiving done' : 'DMS transfer done',
        locationDmsOwner: getLocationLabel(normalizeWorkflowLocation(transfer.currentLocation)),
      };
    }
    if (role === 'planning') updates.workflow = { ...getWorkflow(transfer), planningBpDoneAt: now, planningBpStatus: 'BP changed' };
    if (role === 'finance') {
      const workflow = getWorkflow(transfer);
      updates.workflow = isExternalTransfer(transfer) && !workflow.redoInvoiceDoneAt
        ? { ...workflow, redoInvoiceDoneAt: now, redoInvoiceStatus: 'Redo invoice confirmed' }
        : { ...workflow, financeDoneAt: now, financeStatus: 'Reverse PGI confirmed' };
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
            [`${nextRole}EmailSentAt`]: new Date().toISOString(),
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


  useEffect(() => {
    if (role !== 'ceo') return;
    const hashQuery = window.location.hash.split('?')[1] || '';
    const approveTransferId = new URLSearchParams(hashQuery).get('approveTransfer');
    if (!approveTransferId || !transfers?.[approveTransferId]) return;
    const transfer = { id: approveTransferId, ...transfers[approveTransferId] };
    if (getWorkflow(transfer).ceoApprovedAt) return;
    completeTask(transfer);
  }, [role, transfers]);

  const content = (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      <div className="mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 p-5 text-white shadow-xl sm:p-7">
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-100">Stock Transfer Workflow</div>
        <h2 className="mt-2 text-3xl font-bold sm:text-4xl">{role === 'settings' ? 'Email Settings' : role === 'location' ? `${getLocationLabel(locationKey)} DMS Work` : roleLabels[role]}</h2>
        <p className="mt-2 max-w-2xl text-sm text-blue-50 sm:text-base">{role === 'settings' ? 'Edit backend email recipients, subjects, and role-specific content for every workflow email.' : 'Standalone mobile task page for unfinished stock transfer workflow actions.'}</p>
        {role === 'settings' && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {[...Object.entries(roleLabels), ['settings', 'Email Settings']].map(([key, label]) => (
              <a
                key={key}
                href={workflowPaths[key]}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${key === role ? 'bg-white text-indigo-700' : 'bg-white/15 text-white ring-1 ring-white/30'}`}
              >
                {label}
              </a>
            ))}
          </div>
        )}
      </div>
      {role === 'location' && (
        <div className="mb-4 rounded-2xl border border-blue-100 bg-white p-4 text-sm text-gray-600 shadow-sm">
          Internal stock transfer: confirm the DMS transfer is completed. External stock transfer: confirm DMS reverse goods receiving is completed.
        </div>
      )}
      {role === 'settings' && (
        <ConfigEditor config={config} onChange={setConfig} onSave={saveConfig} saving={savingConfig} />
      )}
      {role === 'settings' && (
        <div className="mb-4 rounded-2xl border border-indigo-100 bg-white p-4 text-sm text-gray-600 shadow-sm">
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
              <div className="mt-2 text-xs text-amber-700">Finance receives two separate emails for external transfers: Redo Invoice first, then Reverse PGI after Location DMS is done.</div>
            </div>
          </div>
        </div>
      )}
      {message && <div className="mb-4 rounded-2xl bg-blue-50 p-3 text-sm text-blue-700 shadow-sm">{message}</div>}
      <div className="grid grid-cols-1 gap-4">
        {role !== 'settings' && tasks.map((transfer) => <TaskCard key={transfer.id} role={role} transfer={transfer} onComplete={completeTask} />)}
        {role !== 'settings' && tasks.length === 0 && <div className="rounded-2xl border border-dashed border-blue-200 bg-white/90 p-8 text-center text-sm text-gray-500 shadow-sm">No unfinished tasks.</div>}
      </div>
    </div>
  );

  if (standalone) {
    return <div className="min-h-screen bg-gradient-to-b from-slate-100 via-blue-50 to-white">{content}</div>;
  }

  return content;
};

export default StockTransferWorkflow;
