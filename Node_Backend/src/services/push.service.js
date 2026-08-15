const path = require("path");
const DeviceToken = require("../models/DeviceToken");

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);
const PUSH_CHANNELS = Object.freeze({
  urgent: "urgent_alerts_v2",
  community: "community_updates_v2",
  helper: "helper_requests_v2",
});
const CHANNEL_ALIASES = Object.freeze({
  urgent_alerts: PUSH_CHANNELS.urgent,
  community_updates: PUSH_CHANNELS.community,
  helper_requests: PUSH_CHANNELS.helper,
});

let firebaseReady = false;
let firebaseInitAttempted = false;
let firebaseAdmin = null;
let firebaseAdminLoadAttempted = false;

function getFirebaseAdmin() {
  if (firebaseAdminLoadAttempted) return firebaseAdmin;

  firebaseAdminLoadAttempted = true;

  try {
    firebaseAdmin = {
      ...require("firebase-admin/app"),
      ...require("firebase-admin/messaging"),
    };
  } catch (err) {
    console.warn(
      "firebase-admin package is not installed in this runtime; push notifications will be stored but not sent."
    );
  }

  return firebaseAdmin;
}

function getCredential(admin) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const serviceAccountPath = path.resolve(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    );
    return admin.cert(require(serviceAccountPath));
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.applicationDefault();
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return admin.cert({
      projectId: process.env.FIREBASE_PROJECT_ID.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }

  return null;
}

function ensureFirebase() {
  if (firebaseReady) return true;
  if (firebaseInitAttempted) return false;

  firebaseInitAttempted = true;

  try {
    const admin = getFirebaseAdmin();
    if (!admin) return false;

    const credential = getCredential(admin);
    if (!credential) {
      console.warn(
        "Firebase Admin is not configured; push notifications will be stored but not sent."
      );
      return false;
    }

    if (!admin.getApps().length) {
      admin.initializeApp({
        credential,
        ...(process.env.FIREBASE_PROJECT_ID
          ? { projectId: process.env.FIREBASE_PROJECT_ID.trim() }
          : {}),
      });
    }

    firebaseReady = true;
    return true;
  } catch (err) {
    console.error("Firebase Admin initialization failed:", err.message);
    return false;
  }
}

function stringifyData(data = {}) {
  return Object.entries(data).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) return acc;
    acc[key] = typeof value === "string" ? value : JSON.stringify(value);
    return acc;
  }, {});
}

function buildMessage(tokens, payload, options = {}) {
  const requestedChannel = options.channelId || PUSH_CHANNELS.community;
  const channelId = CHANNEL_ALIASES[requestedChannel] || requestedChannel;
  const type = payload.type || options.type || "General";

  return {
    tokens,
    notification: {
      title: payload.title,
      body: payload.message,
    },
    data: stringifyData({
      ...(payload.data || {}),
      notification_id: payload.notification_id,
      type,
      channel_id: channelId,
    }),
    android: {
      priority: options.priority || "high",
      notification: {
        channelId,
        sound: "default",
        defaultSound: true,
        defaultVibrateTimings: true,
        priority: options.androidPriority || "high",
        visibility: "private",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  };
}

async function sendPushToTokens(tokens, payload, options = {}) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];

  if (!uniqueTokens.length) {
    return { success: false, skipped: true, reason: "no-device-tokens" };
  }

  if (!ensureFirebase()) {
    return { success: false, skipped: true, reason: "firebase-not-configured" };
  }

  try {
    const admin = getFirebaseAdmin();
    if (!admin) {
      return {
        success: false,
        skipped: true,
        reason: "firebase-admin-missing",
      };
    }

    const response = await admin
      .getMessaging()
      .sendEachForMulticast(buildMessage(uniqueTokens, payload, options));

    const invalidTokens = [];
    response.responses.forEach((item, index) => {
      if (!item.success && INVALID_TOKEN_CODES.has(item.error?.code)) {
        invalidTokens.push(uniqueTokens[index]);
      }
    });

    if (invalidTokens.length) {
      await DeviceToken.deleteMany({ token: { $in: invalidTokens } });
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokensRemoved: invalidTokens.length,
    };
  } catch (err) {
    console.error("FCM send failed:", err.message);
    return { success: false, error: err.message };
  }
}

async function sendPushToUser(userId, payload, options = {}) {
  const tokens = await DeviceToken.distinct("token", { user_id: userId });
  return sendPushToTokens(tokens, payload, options);
}

async function sendPushToUsers(userIds, payload, options = {}) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) {
    return { success: false, skipped: true, reason: "no-users" };
  }

  const tokens = await DeviceToken.distinct("token", { user_id: { $in: ids } });
  return sendPushToTokens(tokens, payload, options);
}

module.exports = {
  PUSH_CHANNELS,
  buildMessage,
  sendPushToTokens,
  sendPushToUser,
  sendPushToUsers,
};
