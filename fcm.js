/* =============================================================================
   fcm.js — Firebase Cloud Messaging server push
   -----------------------------------------------------------------------------
   Sends real push notifications to devices even when the app is closed.

   SETUP (one time):
   1. Firebase console → Project settings → Service accounts →
      "Generate new private key". You get a JSON file.
   2. Provide it to the server as an env var (works on Railway/Render/Fly):
        export FCM_SERVICE_ACCOUNT='<paste the entire JSON on one line>'
      (Locally you can instead point to a file: FCM_SERVICE_ACCOUNT_FILE=./sa.json)

   If neither is set, push is disabled gracefully and the rest of the stack
   (WebSocket in-app alerts) keeps working.
   ============================================================================= */

import fs from "fs";

let messaging = null;
let ready = false;

export async function initFCM() {
  let creds = null;
  if (process.env.FCM_SERVICE_ACCOUNT) {
    try { creds = JSON.parse(process.env.FCM_SERVICE_ACCOUNT); }
    catch { console.warn("FCM_SERVICE_ACCOUNT is not valid JSON — push disabled"); }
  } else if (process.env.FCM_SERVICE_ACCOUNT_FILE) {
    try { creds = JSON.parse(fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, "utf8")); }
    catch { console.warn("FCM service account file unreadable — push disabled"); }
  }
  if (!creds) { console.log("FCM: no service account set — server push disabled (in-app WS alerts still work)"); return; }

  try {
    const admin = (await import("firebase-admin")).default;
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(creds) });
    messaging = admin.messaging();
    ready = true;
    console.log("FCM: initialized — server push enabled");
  } catch (e) {
    console.warn("FCM init failed:", e.message);
  }
}

/* Send to a set of device tokens. Returns count delivered. */
export async function sendPush(tokens, { title, body, data = {} }) {
  if (!ready || !tokens.length) return 0;
  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: "high", notification: { color: "#C6FF3D", channelId: "wc2026" } },
      apns: { payload: { aps: { sound: "default" } } },
    });
    // prune dead tokens
    res.responses.forEach((r, i) => {
      if (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || "")) {
        deadTokens.add(tokens[i]);
      }
    });
    return res.successCount;
  } catch (e) {
    console.warn("sendPush error:", e.message);
    return 0;
  }
}

export const deadTokens = new Set();
export const fcmReady = () => ready;
