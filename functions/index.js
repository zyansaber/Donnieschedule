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

const buildEmailJsPayload = (job) => ({
  service_id: process.env.EMAILJS_SERVICE_ID,
  template_id: process.env.EMAILJS_TEMPLATE_ID,
  user_id: process.env.EMAILJS_PUBLIC_KEY,
  accessToken: process.env.EMAILJS_PRIVATE_KEY,
  template_params: {
    to_email: job.to,
    title: job.title,
    content: job.content,
    transfer_id: job.transferId || "",
    workflow_step: job.step || "",
    workflow_role: job.role || "",
  },
});

const claimPendingJob = async (jobRef, job) => {
  if (!job || job.status !== "pending") return null;

  const claimedJob = {
    ...job,
    status: "sending",
    attempts: (Number(job.attempts) || 0) + 1,
    sendingAt: new Date().toISOString(),
    lastError: null,
  };

  await jobRef.update({
    status: claimedJob.status,
    attempts: claimedJob.attempts,
    sendingAt: claimedJob.sendingAt,
    lastError: claimedJob.lastError,
  });

  return claimedJob;
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
      const claimedJob = await claimPendingJob(jobRef, job);
      if (!claimedJob) {
        logger.info("Email job was not claimed", {jobId});
        return;
      }

      try {
        const emailJsResponse = await sendEmailJsEmail(claimedJob);
        await jobRef.update({
          status: "sent",
          sentAt: new Date().toISOString(),
          emailJsResponse,
          lastError: null,
        });
        logger.info("Email job sent", {
          jobId,
          step: claimedJob.step || "",
          to: claimedJob.to,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await jobRef.update({
          status: "failed",
          failedAt: new Date().toISOString(),
          lastError: message,
        });
        logger.error("Email job failed", {jobId, error: message});
      }
    });
