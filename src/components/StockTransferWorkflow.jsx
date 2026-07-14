import React, { useEffect, useMemo, useState } from 'react';
import emailjs from '@emailjs/browser';
import { off, onValue, ref, update } from 'firebase/database';
import { database } from '../utils/firebase';

const TRANSFERS_PATH = 'stock_transfer';
const CONFIG_PATH = 'stockTransferWorkflowConfig';

const defaultConfig = {
  serviceId: '',
  publicKey: '',
  templates: {
    ceo: '',
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
    planning: 'Please confirm DMS is done for this stock transfer.',
    finance: 'Please confirm reverse PGI and redo the invoice.',
    transport: 'Please book transport and enter vendor/time.',
    purchase: 'Please raise and confirm the Transport PO.',
  },
  recipients: {
    ceo: '',
    planning: '',
    finance: '',
    transport: '',
    purchase: '',
  },
};

const workflowPaths = {
  ceo: '/stock-transfer-workflow/ceo',
  planning: '/stock-transfer-workflow/planning',
  finance: '/stock-transfer-workflow/finance',
  transport: '/stock-transfer-workflow/transport',
  purchase: '/stock-transfer-workflow/purchase',
  settings: '/stock-transfer-workflow/settings',
};

const roleLabels = {
  ceo: 'CEO Approval',
  planning: 'Planning Work',
  finance: 'Finance Work',
  transport: 'Transport Work',
  purchase: 'Purchase Work',
};

const getWorkflow = (transfer) => transfer?.workflow || {};
const isExternalTransfer = (transfer) => transfer?.['Stock Transfer Category'] === 'External stock transfer';
const hasSalesOrder = (transfer) => String(transfer?.['Sales Order Display'] || '').trim();

const buildRows = (transfers) => Object.entries(transfers || {})
  .map(([id, transfer]) => ({ id, ...transfer }))
  .filter(hasSalesOrder)
  .sort((a, b) => (b?.savedAt || '').localeCompare(a?.savedAt || ''));

const getTaskList = (role, transfers) => buildRows(transfers).filter((transfer) => {
  const workflow = getWorkflow(transfer);
  if (role === 'ceo') return !workflow.ceoApprovedAt;
  if (!workflow.ceoApprovedAt) return false;
  if (role === 'planning') return !workflow.planningDoneAt;
  if (role === 'finance') return isExternalTransfer(transfer) && workflow.planningDoneAt && !workflow.financeDoneAt;
  if (role === 'transport') {
    if (!workflow.planningDoneAt) return false;
    if (isExternalTransfer(transfer) && !workflow.financeDoneAt) return false;
    return !workflow.transportDoneAt;
  }
  if (role === 'purchase') return workflow.transportDoneAt && !workflow.purchaseDoneAt;
  return false;
});

const getNextEmailRole = (completedRole, transfer) => {
  if (completedRole === 'ceo') return 'planning';
  if (completedRole === 'planning') return isExternalTransfer(transfer) ? 'finance' : 'transport';
  if (completedRole === 'finance') return 'transport';
  if (completedRole === 'transport') return 'purchase';
  return '';
};

const buildEmailHtml = (role, transfer, title, note) => {
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

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
      <div style="background:#4f46e5;color:#ffffff;padding:22px 26px;">
        <h2 style="margin:0;font-size:22px;">${title}</h2>
        <p style="margin:8px 0 0;opacity:0.9;">${note || 'Stock Transfer Workflow'}</p>
      </div>
      <div style="padding:22px 26px;">
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">${rows}</table>
        <p style="margin-top:18px;color:#6b7280;font-size:13px;">Open the scheduling system workflow page to complete this task.</p>
      </div>
    </div>
  `;
};

const canSendEmail = (config, role) => (
  config?.serviceId && config?.publicKey && config?.templates?.[role] && config?.recipients?.[role]
);

const getWorkflowUrl = (role) => `${window.location.origin}${workflowPaths[role] || '/stock-transfer-workflow/ceo'}`;

const sendWorkflowEmail = async (role, transfer, config) => {
  if (!canSendEmail(config, role)) return false;
  const emailTitle = config.subjects?.[role] || (role === 'ceo' ? 'Stock Transfer CEO Approval Required' : `${roleLabels[role]} Task`);
  const emailNote = config.bodyNotes?.[role] || '';
  await emailjs.send(
    config.serviceId,
    config.templates[role],
    {
      to_email: config.recipients[role],
      title: emailTitle,
      chassis: transfer.chassis || '',
      model: transfer.Model || '',
      current_location: transfer.currentLocation || '',
      target_location: transfer.targetLocation || '',
      sales_order_display: transfer['Sales Order Display'] || '',
      transfer_category: transfer['Stock Transfer Category'] || '',
      message_note: emailNote,
      message_html: buildEmailHtml(role, transfer, emailTitle, emailNote),
      workflow_url: getWorkflowUrl(role),
    },
    config.publicKey,
  );
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
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">EmailJS and recipient settings</summary>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <input className="rounded border px-3 py-2 text-sm" placeholder="EmailJS Service ID" value={config.serviceId || ''} onChange={(e) => updateConfig('serviceId', e.target.value)} />
        <input className="rounded border px-3 py-2 text-sm" placeholder="EmailJS Public Key" value={config.publicKey || ''} onChange={(e) => updateConfig('publicKey', e.target.value)} />
        <button type="button" onClick={onSave} disabled={saving} className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400">
          {saving ? 'Saving...' : 'Save email settings'}
        </button>
        {Object.keys(roleLabels).map((role) => (
          <React.Fragment key={role}>
            <input className="rounded border px-3 py-2 text-sm" placeholder={`${roleLabels[role]} recipient email`} value={config.recipients?.[role] || ''} onChange={(e) => updateConfig(`recipients.${role}`, e.target.value)} />
            <input className="rounded border px-3 py-2 text-sm" placeholder={`${roleLabels[role]} template ID`} value={config.templates?.[role] || ''} onChange={(e) => updateConfig(`templates.${role}`, e.target.value)} />
            <input className="rounded border px-3 py-2 text-sm" placeholder={`${roleLabels[role]} email subject`} value={config.subjects?.[role] || ''} onChange={(e) => updateConfig(`subjects.${role}`, e.target.value)} />
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
  const actionText = {
    ceo: 'Approve',
    planning: 'Confirm DMS done',
    finance: 'Confirm reverse PGI and redo invoice',
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
        </div>
        <button type="button" onClick={() => onComplete(transfer, { vendor, bookingTime })} className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
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
    </div>
  );
};

const StockTransferWorkflow = ({ role = 'ceo', standalone = false }) => {
  const [transfers, setTransfers] = useState({});
  const [config, setConfig] = useState(defaultConfig);
  const [savingConfig, setSavingConfig] = useState(false);
  const [message, setMessage] = useState('');

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
    buildRows(transfers).forEach(async (transfer) => {
      const workflow = getWorkflow(transfer);
      if (workflow.ceoEmailSentAt || !hasSalesOrder(transfer) || !canSendEmail(config, 'ceo')) return;
      try {
        await sendWorkflowEmail('ceo', transfer, config);
        await update(ref(database, `${TRANSFERS_PATH}/${transfer.id}/workflow`), {
          ceoEmailSentAt: new Date().toISOString(),
          ceoStatus: 'Pending approval',
        });
      } catch (error) {
        console.error('Failed to send CEO stock transfer email:', error);
      }
    });
  }, [transfers, config]);

  const tasks = useMemo(() => (role === 'settings' ? [] : getTaskList(role, transfers)), [role, transfers]);

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
    if (role === 'planning') updates.workflow = { ...getWorkflow(transfer), planningDoneAt: now, planningStatus: 'DMS done' };
    if (role === 'finance') updates.workflow = { ...getWorkflow(transfer), financeDoneAt: now, financeStatus: 'Reverse PGI and invoice redo confirmed' };
    if (role === 'transport') {
      updates.workflow = { ...getWorkflow(transfer), transportDoneAt: now, transportStatus: 'Transport booked', transportVendor: extra.vendor || '', transportBookingTime: extra.bookingTime || '' };
    }
    if (role === 'purchase') updates.workflow = { ...getWorkflow(transfer), purchaseDoneAt: now, purchaseStatus: 'Transport PO confirmed' };

    try {
      await update(ref(database, `${TRANSFERS_PATH}/${transfer.id}`), updates);
      const updatedTransfer = { ...transfer, ...updates };
      const nextRole = getNextEmailRole(role, updatedTransfer);
      if (nextRole && canSendEmail(config, nextRole)) {
        await sendWorkflowEmail(nextRole, updatedTransfer, config);
        await update(ref(database, `${TRANSFERS_PATH}/${transfer.id}/workflow`), {
          [`${nextRole}EmailSentAt`]: new Date().toISOString(),
        });
      }
      setMessage('Task completed.');
    } catch (error) {
      console.error('Failed to complete stock transfer workflow task:', error);
      setMessage('Failed to complete task.');
    }
  };

  const content = (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      <div className="mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 p-5 text-white shadow-xl sm:p-7">
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-100">Stock Transfer Workflow</div>
        <h2 className="mt-2 text-3xl font-bold sm:text-4xl">{role === 'settings' ? 'Email Settings' : roleLabels[role]}</h2>
        <p className="mt-2 max-w-2xl text-sm text-blue-50 sm:text-base">{role === 'settings' ? 'Edit EmailJS service, template IDs, recipients, subjects, and email content for every workflow email.' : 'Standalone mobile task page for unfinished stock transfer workflow actions.'}</p>
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
      </div>
      <ConfigEditor config={config} onChange={setConfig} onSave={saveConfig} saving={savingConfig} />
      {role === 'settings' && (
        <div className="mb-4 rounded-2xl border border-indigo-100 bg-white p-4 text-sm text-gray-600 shadow-sm">
          Set recipients, EmailJS template IDs, subjects, and the short email content/note here. EmailJS templates can use: <span className="font-semibold">to_email, title, message_note, message_html, workflow_url, chassis, model, current_location, target_location, sales_order_display, transfer_category</span>.
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
