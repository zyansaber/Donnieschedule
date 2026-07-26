"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const salesforceClientId = defineSecret("SALESFORCE_CLIENT_ID");
const salesforceClientSecret = defineSecret("SALESFORCE_CLIENT_SECRET");
const salesforceUsername = defineSecret("SALESFORCE_USERNAME");
const salesforcePassword = defineSecret("SALESFORCE_PASSWORD");
const salesforceSecurityToken = defineSecret("SALESFORCE_SECURITY_TOKEN");

const SF_AUTH_URL = "https://login.salesforce.com/services/oauth2/token";
const SF_API_VERSION = "v62.0";

function encodeForm(data) {
  return Object.entries(data)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value || "")}`)
      .join("&");
}

async function getSalesforceToken() {
  const body = encodeForm({
    grant_type: "password",
    client_id: salesforceClientId.value(),
    client_secret: salesforceClientSecret.value(),
    username: salesforceUsername.value(),
    password: `${salesforcePassword.value()}${salesforceSecurityToken.value()}`,
  });

  const response = await fetch(SF_AUTH_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    logger.error("Salesforce auth error", {
      status: response.status,
      error: data.error || "",
      errorDescription: data.error_description || "",
    });
    throw new Error("Salesforce authentication failed");
  }

  return {
    accessToken: data.access_token,
    instanceUrl: data.instance_url,
  };
}

exports.submitProductRegistration = onCall({
  region: "us-central1",
  secrets: [
    salesforceClientId,
    salesforceClientSecret,
    salesforceUsername,
    salesforcePassword,
    salesforceSecurityToken,
  ],
}, async (request) => {
  const data = request.data || {};
  const email = String(data.email || "").trim();
  const chassisNumber = String(data.chassisNumber || "").trim();

  if (!email || !chassisNumber) {
    throw new HttpsError("invalid-argument", "missing fields");
  }

  const {accessToken, instanceUrl} = await getSalesforceToken();
  const response = await fetch(
      `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/Product_Registered__c`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Email__c: email,
          Chassis_Number__c: chassisNumber,
          Sync_with_SAP__c: "true",
        }),
      },
  );

  const responseBody = await response.json().catch(() => ({}));
  const responseErrors = Array.isArray(responseBody.errors) ? responseBody.errors : [];
  if (!response.ok || responseErrors.length > 0) {
    logger.error("Salesforce product registration error", {
      status: response.status,
      errors: responseErrors,
    });
    throw new HttpsError("internal", "Salesforce product registration failed");
  }

  return {success: true, id: responseBody.id || ""};
});
