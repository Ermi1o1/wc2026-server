/* =============================================================================
   news.js — News Center + Viral/Trending Hub
   -----------------------------------------------------------------------------
   NEWS:   NewsAPI.org (free key, 100 req/day). Set NEWSAPI_KEY.
   VIRAL:  Reddit public JSON from r/soccer (NO key needed, free, public).
   Both degrade to built-in demo content if unavailable, so the app always
   has something to show.

   News refreshes on the same slow cadence as scores to respect free limits.
   ============================================================================= */

const NEWSAPI_KEY = process.env.NEWSAPI_KEY || "";

const DEMO_NEWS = [
  { id:"n1", tag:"BREAKING", title:"Mbappé brace fires France ahead of Senegal in New Jersey thriller", source:"Demo", time:Date.now()-120000, url:"#", trend:98 },
  { id:"n2", tag:"INJURY", title:"England monitoring Bellingham knock ahead of Croatia clash", source:"Demo", time:Date.now()-840000, url:"#", trend:81 },
  { id:"n3", tag:"REPORT", title:"Haaland's double seals statement Norway win over Iraq", source:"Demo", time:Date.now()-2100000, url:"#", trend:90 },
  { id:"n4", tag:"LINEUPS", title:"USA name attacking XI to face Australia at SoFi", source:"Demo", time:Date.now()-2880000, url:"#", trend:73 },
];
const DEMO_VIRAL = [
  { id:"v1", src:"Reddit", title:"Match thread: France vs Senegal hits 60K comments", score:88, shares:"61K", url:"#" },
  { id:"v2", src:"Reddit", title:"[Highlights] Haaland 30-yard rocket vs Iraq", score:84, shares:"2.1K", url:"#" },
  { id:"v3", src:"Reddit", title:"Azteca crowd tifo before kickoff is unreal", score:79, shares:"4.3K", url:"#" },
];

function tagFor(title="") {
  const t = title.toLowerCase();
  if (/injur|doubt|knock|out for/.test(t)) return "INJURY";
  if (/line-?up|starting xi|team news/.test(t)) return "LINEUPS";
  if (/win|beat|defeat|draw|held|thrash|result/.test(t)) return "REPORT";
  if (/break|confirm|official/.test(t)) return "BREAKING";
  return "TRENDING";
}

/* ---------------- NEWS via NewsAPI.org ---------------- */
export async function fetchNews() {
  if (!NEWSAPI_KEY) return DEMO_NEWS;
  try {
    const url = `https://newsapi.org/v2/everything?q=%22World%20Cup%202026%22&language=en&sortBy=publishedAt&pageSize=20&apiKey=${NEWSAPI_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("newsapi " + res.status);
    const json = await res.json();
    return (json.articles || []).slice(0, 15).map((a, i) => ({
      id: "n" + i,
      tag: tagFor(a.title),
      title: a.title,
      source: a.source?.name || "News",
      time: new Date(a.publishedAt).getTime(),
      url: a.url,
      trend: Math.max(60, 99 - i * 2),
    }));
  } catch (e) {
    console.warn("news fetch failed:", e.message);
    return DEMO_NEWS;
  }
}

/* ---------------- VIRAL via Reddit r/soccer (public, no key) ---------------- */
export async function fetchViral() {
  try {
    const res = await fetch("https://www.reddit.com/r/soccer/hot.json?limit=25", {
      headers: { "User-Agent": "wc2026-tracker/1.0" },
    });
    if (!res.ok) throw new Error("reddit " + res.status);
    const json = await res.json();
    const posts = (json.data?.children || [])
      .map((c) => c.data)
      .filter((p) => !p.stickied)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    const max = posts[0]?.score || 1;
    return posts.map((p, i) => ({
      id: "v" + p.id,
      src: "Reddit",
      title: p.title,
      score: Math.round((p.score / max) * 100),
      shares: p.num_comments >= 1000 ? (p.num_comments/1000).toFixed(1)+"K" : String(p.num_comments),
      url: "https://reddit.com" + p.permalink,
    }));
  } catch (e) {
    console.warn("viral fetch failed:", e.message);
    return DEMO_VIRAL;
  }
}
