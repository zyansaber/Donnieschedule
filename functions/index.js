const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp({
  databaseURL: "https://scheduling-dd672-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const EMAILJS_SECRETS = [
  "EMAILJS_SERVICE_ID",
  "EMAILJS_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY",
  "EMAILJS_PRIVATE_KEY",
];

const EMAILJS_SEND_URL = "https://api.emailjs.com/api/v1.0/email/send";
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000];
const STUCK_JOB_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const buildEmailJsPayload = (job) => ({
  service_id: process.env.EMAILJS_SERVICE_ID,
  template_id: process.env.EMAILJS_TEMPLATE_ID,
  user_id: process.env.EMAILJS_PUBLIC_KEY,
  accessToken: process.env.EMAILJS_PRIVATE_KEY,
  template_params: {
    to_email: job.to,
    cc_email: job.cc || "",
    title: job.title,
    content: job.content,
    transfer_id: job.transferId || "",
    workflow_step: job.step || "",
    workflow_role: job.role || "",
  },
});

const claimJobForSend = async (jobRef, expectedStatus = "pending", triggerJob = null) => {
  const sendingAt = new Date().toISOString();
  const statusResult = await jobRef.child("status").transaction((status) => {
    if (status === expectedStatus) return "sending";
    if ((status === null || status === undefined) && triggerJob?.status === expectedStatus) return "sending";
    return;
  }, undefined, false);

  if (!statusResult.committed) return null;

  const snapshot = await jobRef.once("value");
  const job = snapshot.val();
  if (!job || job.status !== "sending") return null;

  const attempts = (Number(job.attempts) || 0) + 1;
  const updates = {
    attempts,
    sendingAt,
    updatedAt: sendingAt,
    lastError: null,
  };
  await jobRef.update(updates);
  return {
    ...job,
    ...updates,
  };
};

const validateJob = (job) => {
  const missing = ["to", "title", "content"].filter((field) => !job[field]);
  if (missing.length) {
    throw new Error(`Missing required email job field(s): ${missing.join(", ")}`);
  }
};

const sendEmailJsEmail = async (job) => {
  validateJob(job);
  logger.info("Sending EmailJS request", {
    serviceId: process.env.EMAILJS_SERVICE_ID || "",
    templateId: process.env.EMAILJS_TEMPLATE_ID || "",
    publicKeyPreview: process.env.EMAILJS_PUBLIC_KEY
      ? `${process.env.EMAILJS_PUBLIC_KEY.slice(0, 4)}...${process.env.EMAILJS_PUBLIC_KEY.slice(-4)}`
      : "",
    publicKeyLength: (process.env.EMAILJS_PUBLIC_KEY || "").length,
    hasPrivateKey: Boolean(process.env.EMAILJS_PRIVATE_KEY),
  });
  const response = await fetch(EMAILJS_SEND_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(buildEmailJsPayload(job)),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`EmailJS responded ${response.status}: ${responseText}`);
  }

  return responseText;
};

const sendEmailWithRetries = async (jobRef, jobId, firstClaimedJob) => {
  let claimedJob = firstClaimedJob;

  while (claimedJob) {
    try {
      const emailJsResponse = await sendEmailJsEmail(claimedJob);
      await jobRef.update({
        status: "sent",
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        emailJsResponse,
        lastError: null,
      });
      logger.info("Email job sent", {
        jobId,
        step: claimedJob.step || "",
        to: claimedJob.to,
        attempts: claimedJob.attempts || 0,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = Number(claimedJob.attempts) || 0;

      if (attempts >= MAX_SEND_ATTEMPTS) {
        await jobRef.update({
          status: "failed",
          failedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastError: message,
        });
        logger.error("Email job failed", {jobId, attempts, error: message});
        return;
      }

      const retryDelay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      const retryAt = new Date(Date.now() + retryDelay).toISOString();
      await jobRef.update({
        status: "retrying",
        retryAt,
        updatedAt: new Date().toISOString(),
        lastError: message,
      });
      logger.warn("Email job retry scheduled", {
        jobId,
        attempts,
        retryDelay,
        error: message,
      });
      await sleep(retryDelay);
      claimedJob = await claimJobForSend(jobRef, "retrying", claimedJob);
    }
  }
};

const getJobId = (context) => {
  if (context.params?.jobId) return context.params.jobId;
  const resourceName = context.resource?.name || "";
  const marker = "/refs/email_jobs/";
  const markerIndex = resourceName.indexOf(marker);
  if (markerIndex === -1) return "";
  return resourceName.slice(markerIndex + marker.length).split("/")[0];
};

exports.sendPendingEmailJob = functions
    .region("asia-southeast1")
    .runWith({maxInstances: 1, secrets: EMAILJS_SECRETS})
    .database
    .instance("scheduling-dd672-default-rtdb")
    .ref("/email_jobs/{jobId}")
    .onWrite(async (change, context) => {
      const job = change.after.val();
      const jobId = getJobId(context);

      logger.info("Email job trigger received", {
        jobId,
        paramJobId: context.params?.jobId || "",
        resourceName: context.resource?.name || "",
        status: job?.status || "",
      });

      if (!job || job.status !== "pending") return;
      if (!jobId) {
        logger.error("Email job trigger missing jobId", {
          resourceName: context.resource?.name || "",
        });
        return;
      }

      const jobRef = change.after.ref;
      const claimedJob = await claimJobForSend(jobRef, "pending", job);
      if (!claimedJob) {
        logger.info("Email job was not claimed", {jobId});
        return;
      }

      await sendEmailWithRetries(jobRef, jobId, claimedJob);
    });

const recoverStuckJobsForStatus = async (status) => {
  const snapshot = await admin.database()
      .ref("/email_jobs")
      .orderByChild("status")
      .equalTo(status)
      .once("value");

  const updates = {};
  const now = Date.now();
  snapshot.forEach((child) => {
    const job = child.val() || {};
    const marker = Date.parse(job.sendingAt || job.retryAt || job.updatedAt || "");
    if (!marker || now - marker < STUCK_JOB_MS) return;

    const attempts = Number(job.attempts) || 0;
    if (attempts >= MAX_SEND_ATTEMPTS) {
      updates[`${child.key}/status`] = "failed";
      updates[`${child.key}/failedAt`] = new Date().toISOString();
      updates[`${child.key}/lastError`] = job.lastError || "Email job exceeded retry limit during recovery";
    } else {
      updates[`${child.key}/status`] = "pending";
      updates[`${child.key}/recoveredAt`] = new Date().toISOString();
      updates[`${child.key}/lastError`] = job.lastError || `Recovered stuck ${status} email job`;
    }
    updates[`${child.key}/updatedAt`] = new Date().toISOString();
  });

  if (Object.keys(updates).length) {
    await admin.database().ref("/email_jobs").update(updates);
  }

  return Object.keys(updates).length;
};

exports.recoverStuckEmailJobs = functions
    .region("asia-southeast1")
    .runWith({maxInstances: 1})
    .pubsub
    .schedule("every 10 minutes")
    .timeZone("Australia/Sydney")
    .onRun(async () => {
      const recoveredSending = await recoverStuckJobsForStatus("sending");
      const recoveredRetrying = await recoverStuckJobsForStatus("retrying");
      logger.info("Recovered stuck email jobs", {
        recoveredSending,
        recoveredRetrying,
      });
    });
