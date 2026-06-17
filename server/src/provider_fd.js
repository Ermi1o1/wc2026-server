/* =============================================================================
   provider_fd.js — football-data.org integration (free World Cup coverage)
   -----------------------------------------------------------------------------
   football-data.org includes the World Cup (competition code "WC") on its FREE
   tier — including the current 2026 tournament. Less live detail than paid
   feeds (no xG, limited in-match events) but full fixtures, scores, results
   and standings.

   Get a free token: football-data.org/client/register  → set:
     export FOOTBALLDATA_KEY=your_token
   Free tier: ~10 requests/minute, current competitions free forever.

   Auth header is X-Auth-Token. Base URL https://api.football-data.org/v4.
   ============================================================================= */

const KEY = process.env.FOOTBALLDATA_KEY || "";
const BASE = "https://api.football-data.org/v4";
const COMP = process.env.FOOTBALLDATA_COMP || "WC"; // World Cup

const FLAGS = {
  Mexico:"🇲🇽","South Africa":"🇿🇦","South Korea":"🇰🇷","Korea Republic":"🇰🇷",Czechia:"🇨🇿","Czech Republic":"🇨🇿",
  France:"🇫🇷",Senegal:"🇸🇳",Iraq:"🇮🇶",Norway:"🇳🇴",Belgium:"🇧🇪",Egypt:"🇪🇬",Iran:"🇮🇷","IR Iran":"🇮🇷",
  "New Zealand":"🇳🇿",USA:"🇺🇸","United States":"🇺🇸",Australia:"🇦🇺",Paraguay:"🇵🇾",
  "Türkiye":"🇹🇷",Turkey:"🇹🇷","Türki`ye":"🇹🇷",England:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",Croatia:"🇭🇷",Ghana:"🇬🇭",Panama:"🇵🇦",
  Argentina:"🇦🇷",Brazil:"🇧🇷",Spain:"🇪🇸",Portugal:"🇵🇹",Germany:"🇩🇪",Netherlands:"🇳🇱",
  Japan:"🇯🇵",Morocco:"🇲🇦",Canada:"🇨🇦",Uruguay:"🇺🇾",Colombia:"🇨🇴",Switzerland:"🇨🇭",
  Denmark:"🇩🇰",Poland:"🇵🇱",Ecuador:"🇪🇨","Saudi Arabia":"🇸🇦",Qatar:"🇶🇦",Tunisia:"🇹🇳",
  "Costa Rica":"🇨🇷",Cameroon:"🇨🇲",Serbia:"🇷🇸",Wales:"🏴󠁧󠁢󠁷󠁬󠁳󠁿",
};
const flag = (t) => FLAGS[t] || "🏳️";

async function fd(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-Auth-Token": KEY } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data ${res.status} on ${path} ${body.slice(0,120)}`);
  }
  return res.json();
}

const STATUS = {
  SCHEDULED:"UPCOMING", TIMED:"UPCOMING",
  IN_PLAY:"LIVE", PAUSED:"HALF TIME",
  FINISHED:"FINISHED", AWARDED:"FINISHED",
  SUSPENDED:"UPCOMING", POSTPONED:"UPCOMING", CANCELLED:"UPCOMING",
};

function mapMatch(m) {
  const status = STATUS[m.status] || "UPCOMING";
  const groupLetter = (m.group || "").replace(/^GROUP_?/i, "").trim().slice(0,1) || "?";
  return {
    id: String(m.id),
    group: groupLetter,
    status,
    minute: m.minute || 0,
    kickoff: status === "UPCOMING" ? new Date(m.utcDate).getTime() : undefined,
    home: m.homeTeam?.name || "TBD",
    away: m.awayTeam?.name || "TBD",
    hs: m.score?.fullTime?.home ?? null,
    as: m.score?.fullTime?.away ?? null,
    homeFlag: flag(m.homeTeam?.name),
    awayFlag: flag(m.awayTeam?.name),
    stadium: m.venue || "TBD",
    city: m.area?.name || "",
    stats: null, // football-data free tier doesn't expose live in-match stats
    events: [],
  };
}

export async function fetchLiveSnapshotFD() {
  // all WC matches; we split into live/upcoming/finished client-side
  const data = await fd(`/competitions/${COMP}/matches`);
  const all = (data.matches || []).map(mapMatch);

  // keep it light: live + finished today + next handful of upcoming
  const live = all.filter((m) => ["LIVE","HALF TIME"].includes(m.status));
  const finished = all.filter((m) => m.status === "FINISHED").slice(-6);
  const upcoming = all
    .filter((m) => m.status === "UPCOMING")
    .sort((a, b) => (a.kickoff || 0) - (b.kickoff || 0))
    .slice(0, 6);

  const matches = [...live, ...finished, ...upcoming];
  return { matches, source: "football-data", at: Date.now() };
}

export async function fetchStandingsFD() {
  const data = await fd(`/competitions/${COMP}/standings`);
  const out = {};
  (data.standings || []).forEach((s) => {
    // group standings have type TOTAL and a "group" like "GROUP_A"
    const g = (s.group || "").replace(/^GROUP_?/i, "").trim().slice(0,1);
    if (!g || s.type !== "TOTAL") return;
    out[g] = (s.table || []).map((r) => ({
      team: r.team?.name || "?",
      p: r.playedGames, w: r.won, d: r.draw, l: r.lost,
      gf: r.goalsFor, ga: r.goalsAgainst, pts: r.points,
    }));
  });
  return out;
}

export const fdReady = () => !!KEY;
