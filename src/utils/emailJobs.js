import { push, ref, runTransaction, set } from 'firebase/database';
import { database } from './firebase';

const EMAIL_JOBS_PATH = 'email_jobs';
const ACTIVE_EMAIL_JOB_STATUSES = ['pending', 'sending', 'retrying', 'sent'];

export const getSafeFirebaseKey = (value) => String(value || '').replace(/[.#$\[\]/]/g, '_');

export const queueEmailJob = async ({
  jobId = '',
  step,
  role,
  to,
  cc = '',
  title,
  content,
  metadata = {},
}) => {
  if (!to || !title || !content) {
    throw new Error('Missing required email job field(s): to, title, or content');
  }

  const now = new Date().toISOString();
  const jobData = {
    status: 'pending',
    step: step || '',
    role: role || '',
    to,
    cc,
    title,
    content,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null,
    failedAt: null,
    ...metadata,
  };

  if (!jobId) {
    const jobRef = push(ref(database, EMAIL_JOBS_PATH));
    await set(jobRef, jobData);
    return { jobId: jobRef.key, queued: true };
  }

  const jobRef = ref(database, `${EMAIL_JOBS_PATH}/${jobId}`);
  const result = await runTransaction(jobRef, (existingJob) => {
    if (existingJob && ACTIVE_EMAIL_JOB_STATUSES.includes(existingJob.status)) return;
    return {
      ...(existingJob || {}),
      ...jobData,
      attempts: Number(existingJob?.attempts) || 0,
    };
  });

  if (result.committed) return { jobId, queued: true };
  const existingJob = result.snapshot.val();
  return {
    jobId,
    queued: Boolean(existingJob && ACTIVE_EMAIL_JOB_STATUSES.includes(existingJob.status)),
    existingStatus: existingJob?.status || '',
  };
};
