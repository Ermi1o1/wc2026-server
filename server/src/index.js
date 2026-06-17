/* =============================================================================
   index.js — World Cup 2026 backend
   -----------------------------------------------------------------------------
   • Central poller: fetches a snapshot every POLL_MS (default 60s)
   • Diff detector: compares snapshots, emits goal / card / status / start events
   • REST API: /api/matches, /api/matches/:id, /api/standings, /api/follows
   • WebSocket: pushes the full snapshot + discrete events to all clients
   • Notification hooks: notify() is called for every event on a followed entity
     — wire it to Firebase Cloud Messaging / email where marked.

   Run:  npm install && npm start
   Optional env: APIFOOTBALL_KEY, PORT (default 4000), POLL_MS (default 60000)
   ============================================================================= */

import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import http from "http";
import { fetchLiveSnapshot, fetchStandings } from "./provider.js";
import { fetchNews, fetchViral } from "./news.js";
import { initFCM, sendPush, deadTokens, fcmReady } from "./fcm.js";

const PORT = process.env.PORT || 4000;
const POLL_MS = Number(process.env.POLL_MS || 60000); // 60s — fine for football-data.org (10 req/min)

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

/* ---------------- in-memory state (swap for Postgres + Redis in prod) -------- */
let snapshot = { matches: [], standings: {}, news: [], viral: [], source: "init", at: 0 };
let prevById = new Map();
// follows: Map<userId, Set<"team:France" | "match:123" | "player:Mbappé">>
const follows = new Map();
// pushTokens: Map<userId, Set<deviceToken>> — one user can have several devices
const pushTokens = new Map();
// demo single-user id; real app pulls from JWT
const demoUser = () => "demo";

/* tokens for everyone following any entity touched by an event */
function tokensForEvent(ev) {
  const out = new Set();
  for (const [uid, set] of follows) {
    if (set.has(`match:${ev.match.id}`) || set.has(`team:${ev.match.home}`) || set.has(`team:${ev.match.away}`)) {
      (pushTokens.get(uid) || new Set()).forEach((t) => { if (!deadTokens.has(t)) out.add(t); });
    }
  }
  return [...out];
}

/* ---------------- WebSocket fan-out ---------------------------------------- */
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

wss.on("connection", (ws) => {
  // send current snapshot immediately on connect
  ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));
});

/* ---------------- notification hook ---------------------------------------- */
/* Called once per event that touches a followed entity. */
async function notify(event, tokens) {
  const titleMap = { goal:"⚽ GOAL!", start:"🟢 Kickoff", finish:"🏁 Full time", status:"⏸ Half time", card:"🟨 Card" };
  console.log(`🔔 ${event.kind.toUpperCase()}: ${event.detail}  → ${tokens.length} device(s)`);

  // Server push via FCM — arrives even when the app is closed.
  if (fcmReady() && tokens.length) {
    const sent = await sendPush(tokens, {
      title: titleMap[event.kind] || "World Cup 2026",
      body: event.detail,
      data: { matchId: event.match.id, kind: event.kind },
    });
    if (sent) console.log(`   delivered ${sent} push(es)`);
  }
  // In-app realtime is already delivered via the WebSocket "event" broadcast.
  // Email digest: enqueue to your mail provider here if desired.
}

/* ---------------- diff detector -------------------------------------------- */
function diffAndNotify(next) {
  const events = [];
  for (const m of next.matches) {
    const prev = prevById.get(m.id);
    // new live match starting
    if (prev && prev.status === "UPCOMING" && m.status === "LIVE") {
      events.push({ kind:"start", match:m, detail:`${m.home} vs ${m.away} has kicked off` });
    }
    // score change → goal
    if (prev && (prev.hs !== m.hs || prev.as !== m.as) && m.hs != null) {
      events.push({ kind:"goal", match:m,
        detail:`GOAL! ${m.home} ${m.hs}–${m.as} ${m.away} (${m.minute}')` });
    }
    // status transitions
    if (prev && prev.status !== m.status && m.status === "FINISHED") {
      events.push({ kind:"finish", match:m,
        detail:`Full time: ${m.home} ${m.hs}–${m.as} ${m.away}` });
    }
    if (prev && prev.status !== m.status && m.status === "HALF TIME") {
      events.push({ kind:"status", match:m, detail:`Half time: ${m.home} ${m.hs}–${m.as} ${m.away}` });
    }
  }

  // route each event to followers of the involved teams/match
  for (const ev of events) {
    broadcast({ type:"event", data: ev });               // in-app realtime
    notify(ev, tokensForEvent(ev));                      // server push (FCM)
  }
  return events;
}

/* ---------------- poll loop ------------------------------------------------ */
async function poll() {
  try {
    const live = await fetchLiveSnapshot();
    const standings = await fetchStandings();
    const [news, viral] = await Promise.all([fetchNews(), fetchViral()]);
    const next = { ...live, standings, news, viral };
    diffAndNotify(next);
    snapshot = next;
    prevById = new Map(next.matches.map((m) => [m.id, m]));
    broadcast({ type:"snapshot", data: snapshot });
    console.log(`↻ polled (${snapshot.source}) — ${snapshot.matches.length} matches, ${news.length} news, ${viral.length} viral @ ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    console.error("poll error:", e.message);
  }
}

/* ---------------- REST API -------------------------------------------------- */
app.get("/api/health", (_req, res) => res.json({ ok:true, source:snapshot.source, at:snapshot.at }));

app.get("/api/matches", (req, res) => {
  const { status } = req.query;
  let list = snapshot.matches;
  if (status) list = list.filter((m) => m.status === status.toUpperCase());
  res.json(list);
});

app.get("/api/matches/:id", (req, res) => {
  const m = snapshot.matches.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "match not found" });
  res.json(m);
});

app.get("/api/standings", (_req, res) => res.json(snapshot.standings));
app.get("/api/news", (_req, res) => res.json(snapshot.news));
app.get("/api/viral", (_req, res) => res.json(snapshot.viral));

app.get("/api/follows", (req, res) => {
  res.json([...(follows.get(demoUser()) || [])]);
});

app.post("/api/follows", (req, res) => {
  const { entity } = req.body; // e.g. "team:France" or "match:123"
  if (!entity) return res.status(400).json({ error: "entity required" });
  const set = follows.get(demoUser()) || new Set();
  set.has(entity) ? set.delete(entity) : set.add(entity);
  follows.set(demoUser(), set);
  res.json([...set]);
});

// register a device push token (FCM) — stored per user
app.post("/api/push-token", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token required" });
  const set = pushTokens.get(demoUser()) || new Set();
  set.add(token);
  pushTokens.set(demoUser(), set);
  deadTokens.delete(token);
  console.log("registered push token:", token.slice(0, 16) + "…");
  res.json({ ok: true, devices: set.size });
});

/* ---------------- boot ------------------------------------------------------ */
await initFCM();
server.listen(PORT, () => {
  console.log(`\n⚽ WC2026 backend on http://localhost:${PORT}`);
  console.log(`   WebSocket:  ws://localhost:${PORT}/live`);
  console.log(`   Data source: ${process.env.FOOTBALLDATA_KEY ? "football-data.org (live)" : process.env.APIFOOTBALL_KEY ? "API-Football" : "SIMULATOR (set FOOTBALLDATA_KEY for free live World Cup data)"}`);
  console.log(`   Polling every ${POLL_MS/1000}s\n`);
  poll();
  setInterval(poll, POLL_MS);
});
