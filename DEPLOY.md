# Deploy & Push Setup — World Cup 2026

Two additions wired in: **FCM server push** (notifications when the app is closed)
and **Railway deployment** for the backend.

---

## A. Deploy the backend to Railway

The backend needs a host that allows a long-running process + WebSockets. Railway does.

1. Push the `server/` folder to a GitHub repo (or use the Railway CLI).
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo, root = `server`.
3. Railway auto-detects Node via Nixpacks and runs `npm start` (set in `railway.json`).
4. Add environment variables under **Variables**:
   - `APIFOOTBALL_KEY` — your API-Football key (live data)
   - `FCM_SERVICE_ACCOUNT` — the Firebase service-account JSON, pasted as one line
   - `POLL_MS` — optional, default `60000`
   - `PORT` — Railway sets this automatically; the server reads it.
5. Deploy. Railway gives you a public URL like `https://wc2026-production.up.railway.app`.

**CLI alternative:**
```bash
npm i -g @railway/cli
cd server
railway login
railway init
railway up
railway variables set APIFOOTBALL_KEY=xxx FCM_SERVICE_ACCOUNT='{...}'
```

Point the app at it: in `app/public/app.js` set `API_BASE` to your Railway URL
**before** `npx cap sync android`. For the PWA, run once in the browser console:
`localStorage.setItem("wc_api","https://wc2026-production.up.railway.app")`.

Render and Fly.io work the same way — all support persistent WebSocket connections.

---

## B. Firebase Cloud Messaging (server push)

This makes goal alerts arrive even when the app is closed or backgrounded.

**1. Create the Firebase project**
- console.firebase.google.com → Add project.
- Add an **Android app** with package name `com.zega.wc2026` (matches
  `capacitor.config.json`). Download `google-services.json`.
- After `npx cap add android`, drop `google-services.json` into
  `android/app/google-services.json`.

**2. Server credentials**
- Firebase → Project settings → **Service accounts → Generate new private key**.
- Set the downloaded JSON as the `FCM_SERVICE_ACCOUNT` env var (entire JSON, one line).
- On boot the server logs `FCM: initialized — server push enabled`.

**3. Client (APK) — add the push plugin**
```bash
cd app
npm install @capacitor/push-notifications
npx cap sync android
```
The client code in `app/public/app.js` (`registerPush()`) already requests
permission, registers the device, and POSTs the token to `/api/push-token`.
The server stores tokens per user and pushes to all followers of a team/match
when a goal/card/status event fires.

**4. Test it**
- Install the APK, open the app, follow a team (e.g. France).
- With the simulator running, goals land every ~minute → you get a push.
- Or with live data + `APIFOOTBALL_KEY`, real goals trigger real pushes.

---

## How push flows end to end

```
poll (60s) → diff detector finds a goal
   → broadcast WS "event"  ........ in-app toast (app open)
   → notify() → sendPush(tokens)  .. FCM → device notification (app closed)
```

Tokens are pruned automatically when FCM reports them dead (uninstalled apps).

## Notes / limits

- **PWA push (iOS/Android browser):** the native APK uses FCM cleanly. Web push
  from the installed PWA needs the Firebase JS SDK + a VAPID key on the client;
  the browser `Notification` fallback already fires while the PWA is open.
- **In-memory state:** follows and tokens currently live in memory (reset on
  redeploy). For production, persist them in Postgres — the maps in `index.js`
  map 1:1 to a `follows` and `push_tokens` table.
- The simulator runs with zero keys so you can deploy and test the whole pipeline
  before adding API-Football or Firebase.
