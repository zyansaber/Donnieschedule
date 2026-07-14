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
  recipients: {
    ceo: '',
    planning: '',
    finance: '',
    transport: '',
    purchase: '',
  },
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

const buildEmailHtml = (role, transfer) => {
  const title = role === 'ceo' ? 'Stock Transfer Approval Required' : `${roleLabels[role]} Task`;
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
        <p style="margin:8px 0 0;opacity:0.9;">Stock Transfer Workflow</p>
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

const sendWorkflowEmail = async (role, transfer, config) => {
  if (!canSendEmail(config, role)) return false;
  await emailjs.send(
    config.serviceId,
    config.templates[role],
    {
      to_email: config.recipients[role],
      title: role === 'ceo' ? 'Stock Transfer CEO Approval Required' : `${roleLabels[role]} Task`,
      chassis: transfer.chassis || '',
      model: transfer.Model || '',
      current_location: transfer.currentLocation || '',
      target_location: transfer.targetLocation || '',
      sales_order_display: transfer['Sales Order Display'] || '',
      transfer_category: transfer['Stock Transfer Category'] || '',
      message_html: buildEmailHtml(role, transfer),
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
            <input className="rounded border px-3 py-2 text-sm" placeholder={`${roleLabels[role]} recipient`} value={config.recipients?.[role] || ''} onChange={(e) => updateConfig(`recipients.${role}`, e.target.value)} />
            <input className="rounded border px-3 py-2 text-sm md:col-span-2" placeholder={`${roleLabels[role]} template ID`} value={config.templates?.[role] || ''} onChange={(e) => updateConfig(`templates.${role}`, e.target.value)} />
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

const StockTransferWorkflow = ({ role = 'ceo' }) => {
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

  const tasks = useMemo(() => getTaskList(role, transfers), [role, transfers]);

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

  return (
    <div className="w-full p-4">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold text-gray-800">{roleLabels[role]}</h2>
        <p className="mt-1 text-sm text-gray-500">Mobile-friendly unfinished stock transfer workflow tasks.</p>
      </div>
      <ConfigEditor config={config} onChange={setConfig} onSave={saveConfig} saving={savingConfig} />
      {message && <div className="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-700">{message}</div>}
      <div className="grid grid-cols-1 gap-4">
        {tasks.map((transfer) => <TaskCard key={transfer.id} role={role} transfer={transfer} onComplete={completeTask} />)}
        {tasks.length === 0 && <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">No unfinished tasks.</div>}
      </div>
    </div>
  );
};

export default StockTransferWorkflow;
