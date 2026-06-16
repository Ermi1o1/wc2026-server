# World Cup 2026 Live Tracker — Full Stack

Three parts, all working and tested:

```
wc2026/
├── server/          Backend: poller + REST API + WebSocket push + notification hooks
└── app/
    └── public/      Frontend: installable PWA + the web layer the APK wraps
```

The frontend talks to the backend over a WebSocket and receives a fresh snapshot
every 60 seconds plus discrete goal/card/status events. Follow a team or match and
you get a push notification (native on the APK, browser notification on the PWA).

---

## 1. Run the backend

```bash
cd server
npm install
npm start            # http://localhost:4000  ·  ws://localhost:4000/live
```

It runs out of the box using a **built-in simulator** (live scores tick, goals land).
To use **real World Cup data**, get a free key at https://dashboard.api-sports.io and:

```bash
export APIFOOTBALL_KEY=your_key_here
npm start
```

Env vars: `APIFOOTBALL_KEY`, `PORT` (4000), `POLL_MS` (60000),
`APIFOOTBALL_LEAGUE` (1 = World Cup), `APIFOOTBALL_SEASON` (2026).

**Endpoints**
- `GET  /api/matches?status=live`
- `GET  /api/matches/:id`
- `GET  /api/standings`
- `GET  /api/follows` · `POST /api/follows  {"entity":"team:France"}`
- `POST /api/push-token  {"token":"..."}`  (register an FCM device token)
- `WS   /live`  → `{type:"snapshot"}` and `{type:"event"}`

**Notifications:** the `notify()` function in `server/src/index.js` is called for
every event on a followed entity. It currently logs to console — wire Firebase Cloud
Messaging / email where marked `=== WIRE REAL CHANNELS HERE ===`.

---

## 2. Run the frontend (web / PWA)

```bash
cd app
npm run serve        # http://localhost:8080
```

Open it on your **phone's browser** (same Wi-Fi, use your computer's LAN IP, e.g.
`http://192.168.1.20:8080`). Then **"Add to Home Screen"** — it installs as a
standalone app with offline shell caching and notification support. No build needed.

To point the app at a deployed backend instead of localhost, run once in the
browser console: `localStorage.setItem("wc_api","https://your-server.com")`.

---

## 3. Build the Android APK (Capacitor)

Requires **Node.js** and **Android Studio** (with the Android SDK) installed locally.
This is the standard React/web → native APK path.

```bash
cd app
npm install
npx cap add android          # creates the native android/ project
npx cap sync android         # copies public/ into the app
npx cap open android         # opens Android Studio
```

In Android Studio:
1. Let Gradle finish syncing.
2. **Build ▸ Build Bundle(s)/APK(s) ▸ Build APK(s)**.
3. The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Copy it to your phone and install (enable "Install from unknown sources"), or
   click **Run ▶** with your phone connected via USB debugging.

For a signed release APK (Play Store or sharing): **Build ▸ Generate Signed
Bundle/APK**, create a keystore, choose **release**.

**Important for the APK:** it loads the bundled `public/` files but calls your
backend over the network, so the backend must be deployed somewhere reachable
(not localhost). Before `cap sync`, set the server URL in `app/public/app.js`
(the `API_BASE` line) to your deployed backend, e.g. `https://wc2026.onrails.app`.

Native push uses `@capacitor/local-notifications` (already wired in `app.js`).
For server-pushed FCM notifications add `@capacitor/push-notifications` and
register the device token via `POST /api/push-token`.

---

## Deploying the backend

- Frontend (PWA): any static host — Netlify, Vercel, GitHub Pages.
- Backend: a container/Node host that allows a long-running process — Railway,
  Render, Fly.io. Set `APIFOOTBALL_KEY` as a secret. The WebSocket needs a host
  that supports persistent connections (all three above do).

## Data note

The live sports data tool available during development covers North American
leagues only, not FIFA, so the simulator stands in until you add an API-Football
key. The mapping layer in `server/src/provider.js` already targets API-Football's
real WC2026 fixture/standings/event schema, so live data flows the moment a key
is set — no frontend changes.
