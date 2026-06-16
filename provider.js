/* =============================================================================
   provider.js — API-Football integration
   -----------------------------------------------------------------------------
   Talks to API-Football (https://dashboard.api-sports.io). Fetches live and
   scheduled fixtures, standings, and events, then maps them to the EXACT shape
   the frontend already expects (same fields as the prototype SEED object).

   Set your key once:  export APIFOOTBALL_KEY=xxxxxxxx
   Free tier (~100 req/day) is fine for development. A single central poll every
   30–60s across the whole tournament stays well within paid limits.

   If no key is present, the module falls back to a built-in simulator so the
   whole stack runs end-to-end with zero setup.
   ============================================================================= */

const KEY = process.env.APIFOOTBALL_KEY || "";
const BASE = "https://v3.football.api-sports.io";

// 2026 World Cup league id in API-Football is 1 (World Cup). Season = 2026.
const LEAGUE = process.env.APIFOOTBALL_LEAGUE || "1";
const SEASON = process.env.APIFOOTBALL_SEASON || "2026";

const FLAGS = {
  Mexico:"🇲🇽","South Africa":"🇿🇦","South Korea":"🇰🇷",Czechia:"🇨🇿","Czech Republic":"🇨🇿",
  France:"🇫🇷",Senegal:"🇸🇳",Iraq:"🇮🇶",Norway:"🇳🇴",Belgium:"🇧🇪",Egypt:"🇪🇬",Iran:"🇮🇷",
  "New Zealand":"🇳🇿",USA:"🇺🇸","United States":"🇺🇸",Australia:"🇦🇺",Paraguay:"🇵🇾",
  "Türkiye":"🇹🇷",Turkey:"🇹🇷",England:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",Croatia:"🇭🇷",Ghana:"🇬🇭",Panama:"🇵🇦",
  Argentina:"🇦🇷",Brazil:"🇧🇷",Spain:"🇪🇸",Portugal:"🇵🇹",
};
const flag = (t) => FLAGS[t] || "🏳️";

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": KEY },
  });
  if (!res.ok) throw new Error(`API-Football ${res.status} on ${path}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error("API-Football errors: " + JSON.stringify(json.errors));
  }
  return json.response;
}

/* Map one API-Football fixture object → internal match shape */
function mapFixture(f) {
  const shortStatus = f.fixture.status.short; // 1H,HT,2H,ET,P,FT,NS,...
  const statusMap = {
    "1H":"LIVE","2H":"LIVE","ET":"EXTRA TIME","P":"PENALTIES","BT":"LIVE",
    "HT":"HALF TIME","FT":"FINISHED","AET":"FINISHED","PEN":"FINISHED","NS":"UPCOMING",
    "TBD":"UPCOMING","PST":"UPCOMING",
  };
  const status = statusMap[shortStatus] || "UPCOMING";

  const events = (f.events || []).map((e) => ({
    m: e.time.elapsed + (e.time.extra || 0),
    type: e.type === "Goal" ? "goal"
        : e.type === "Card" ? (e.detail === "Red Card" ? "red" : "yellow")
        : e.type === "subst" ? "sub" : "other",
    team: e.team.id === f.teams.home.id ? "home" : "away",
    who: e.player?.name || e.assist?.name || "—",
    note: e.detail || undefined,
  }));

  // statistics (only present on live/finished when ?statistics is included)
  let stats = null;
  if (f.statistics && f.statistics.length === 2) {
    const grab = (side, key) => {
      const row = side.statistics.find((s) => s.type === key);
      const v = row?.value;
      if (v == null) return 0;
      return typeof v === "string" ? parseFloat(v) || 0 : v;
    };
    const [h, a] = f.statistics;
    stats = {
      poss:    [grab(h,"Ball Possession"), grab(a,"Ball Possession")],
      shots:   [grab(h,"Total Shots"), grab(a,"Total Shots")],
      sot:     [grab(h,"Shots on Goal"), grab(a,"Shots on Goal")],
      xg:      [grab(h,"expected_goals"), grab(a,"expected_goals")],
      fouls:   [grab(h,"Fouls"), grab(a,"Fouls")],
      corners: [grab(h,"Corner Kicks"), grab(a,"Corner Kicks")],
      cards:   [grab(h,"Yellow Cards"), grab(a,"Yellow Cards")],
    };
  }

  return {
    id: String(f.fixture.id),
    group: (f.league.round || "").replace(/^.*Group /, "").slice(0,1) || "?",
    status,
    minute: f.fixture.status.elapsed || 0,
    kickoff: status === "UPCOMING" ? new Date(f.fixture.date).getTime() : undefined,
    home: f.teams.home.name,
    away: f.teams.away.name,
    hs: f.goals.home,
    as: f.goals.away,
    homeFlag: flag(f.teams.home.name),
    awayFlag: flag(f.teams.away.name),
    stadium: f.fixture.venue?.name || "TBD",
    city: f.fixture.venue?.city || "",
    stats,
    events,
  };
}

/* Public: fetch a full snapshot (live + today's fixtures) */
export async function fetchLiveSnapshot() {
  if (!KEY) return simulate();   // zero-config fallback
  // live fixtures (with events + stats)
  const live = await api(`/fixtures?live=all&league=${LEAGUE}&season=${SEASON}`);
  // next scheduled fixtures
  const next = await api(`/fixtures?league=${LEAGUE}&season=${SEASON}&next=10`);
  const matches = [...live, ...next].map(mapFixture);
  return { matches, source: "api-football", at: Date.now() };
}

export async function fetchStandings() {
  if (!KEY) return simulate().standings;
  const res = await api(`/standings?league=${LEAGUE}&season=${SEASON}`);
  const out = {};
  (res[0]?.league?.standings || []).forEach((groupRows) => {
    groupRows.forEach((r) => {
      const g = (r.group || "").replace(/^.*Group /, "").slice(0,1) || "?";
      (out[g] ||= []).push({
        team: r.team.name, p:r.all.played, w:r.all.win, d:r.all.draw, l:r.all.lose,
        gf:r.all.goals.for, ga:r.all.goals.against, pts:r.points,
      });
    });
  });
  return out;
}

/* ---------- zero-config simulator (used when no API key set) ---------- */
let SIM = null;
function simulate() {
  if (!SIM) SIM = {
    matches: [
      { id:"m1", group:"I", status:"LIVE", minute:67, home:"France", away:"Senegal", hs:2, as:1,
        homeFlag:"🇫🇷", awayFlag:"🇸🇳", stadium:"MetLife Stadium", city:"New York/New Jersey",
        stats:{poss:[58,42],shots:[11,6],sot:[5,3],xg:[1.9,0.8],fouls:[7,10],corners:[5,3],cards:[1,2]},
        events:[{m:12,type:"goal",team:"home",who:"Mbappé"},{m:45,type:"goal",team:"away",who:"Sarr"},
                {m:58,type:"goal",team:"home",who:"Dembélé"}] },
      { id:"m2", group:"L", status:"LIVE", minute:23, home:"England", away:"Croatia", hs:0, as:0,
        homeFlag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", awayFlag:"🇭🇷", stadium:"AT&T Stadium", city:"Dallas",
        stats:{poss:[61,39],shots:[7,2],sot:[2,0],xg:[0.6,0.1],fouls:[4,6],corners:[4,1],cards:[0,1]},
        events:[{m:18,type:"yellow",team:"away",who:"Modrić"}] },
      { id:"m4", group:"G", status:"UPCOMING", kickoff:Date.now()+1000*60*42, home:"Belgium", away:"Egypt",
        hs:null, as:null, homeFlag:"🇧🇪", awayFlag:"🇪🇬", stadium:"Mercedes-Benz Stadium", city:"Atlanta" },
    ],
    standings: {
      I:[{team:"France",p:1,w:1,d:0,l:0,gf:3,ga:1,pts:3},{team:"Norway",p:1,w:1,d:0,l:0,gf:3,ga:1,pts:3},
         {team:"Senegal",p:1,w:0,d:0,l:1,gf:1,ga:2,pts:0},{team:"Iraq",p:1,w:0,d:0,l:1,gf:1,ga:3,pts:0}],
      L:[{team:"England",p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0},{team:"Croatia",p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0},
         {team:"Ghana",p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0},{team:"Panama",p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}],
    },
  };
  // advance the simulation a little each call
  SIM.matches.forEach((m) => {
    if (m.status === "LIVE") {
      m.minute = Math.min(90, m.minute + 1);
      if (Math.random() < 0.15) {
        const home = Math.random() < 0.5;
        if (home) m.hs++; else m.as++;
        m.events.push({ m:m.minute, type:"goal", team:home?"home":"away",
          who:["Kane","Vinicius","Osimhen","Foden"][Math.floor(Math.random()*4)] });
      }
      if (m.minute >= 90) m.status = "FINISHED";
    }
  });
  return { matches: structuredClone(SIM.matches), standings: structuredClone(SIM.standings),
           source:"simulator", at: Date.now() };
}
