/**
 * 気象庁のデータ（アメダス雨量・天気予報）を自動で取り込みます。
 * - 川ごとに data/rivers/*.json の "live.points"（緯度・経度）から一番近い雨量計を自動で選びます。
 * - 取得に失敗してもサイト作成は止めません（その川の「川の状態」だけ非表示になります）。
 * 出典：気象庁ホームページ（政府標準利用規約に基づき出典を明記して利用）
 */
const JMA = "https://www.jma.go.jp/bosai";
const cache = new Map();

async function getJson(url, asText = false) {
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "kawazuri-navi (static site builder)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asText ? (await res.text()).trim() : await res.json();
    } finally {
      clearTimeout(t);
    }
  })();
  cache.set(url, p);
  return p;
}

const toDeg = (a) => (Array.isArray(a) ? a[0] + a[1] / 60 : Number(a));
function distKm(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, R = 6371;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const val = (o, k) => (o && Array.isArray(o[k]) && typeof o[k][0] === "number" ? o[k][0] : null);

async function observe(table, latestIso, pt) {
  // 日本時間の日付・時刻を latest_time の文字列から取り出す（例 2026-09-27T21:50:00+09:00）
  const m = latestIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
  if (!m) throw new Error("latest_time の形式が不明");
  const block = String(Math.floor(Number(m[4]) / 3) * 3).padStart(2, "0");
  const file = `${m[1]}${m[2]}${m[3]}_${block}`;
  const near = Object.entries(table)
    .map(([code, s]) => ({ code, name: s.kjName, d: distKm(pt.lat, pt.lng, toDeg(s.lat), toDeg(s.lon)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6); // 雨量を観測していない所は下で自動的にとばします
  for (const s of near) {
    try {
      const data = await getJson(`${JMA}/amedas/data/point/${s.code}/${file}.json`);
      const keys = Object.keys(data).sort();
      for (let i = keys.length - 1; i >= 0; i--) {
        const o = data[keys[i]];
        const rain24h = val(o, "precipitation24h");
        if (rain24h === null) continue;
        const k = keys[i];
        return {
          label: pt.label, station: s.name, km: Math.round(s.d),
          rain24h, rain1h: val(o, "precipitation1h"), temp: val(o, "temp"),
          obsTime: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}T${k.slice(8, 10)}:${k.slice(10, 12)}:00+09:00`,
        };
      }
    } catch (e) { /* 次に近い観測所を試す */ }
  }
  return null;
}

function judge(points) {
  const r24 = Math.max(...points.map((p) => p.rain24h ?? 0));
  const r1 = Math.max(...points.map((p) => p.rain1h ?? 0));
  if (r24 >= 80 || r1 >= 30) return { code: 3, label: "危険", text: "大雨の後です。増水・急な水位上昇のおそれがあります。川に近づかないでください。" };
  if (r24 >= 30 || r1 >= 10) return { code: 2, label: "増水・濁りに注意", text: "まとまった雨が降っています。増水や濁りが出やすい状態です。水位を確認してください。" };
  if (r24 >= 10) return { code: 1, label: "やや雨あり", text: "少し雨が降っています。上流の雨で水位が上がることがあります。" };
  return { code: 0, label: "平常", text: "この24時間は大きな雨はありません。" };
}

async function forecast(office, areaCode) {
  const data = await getJson(`${JMA}/forecast/data/forecast/${office}.json`);
  const ts = data[0].timeSeries;
  const pick = (series) => series.areas.find((a) => a.area.code === areaCode) || series.areas[0];
  const w = pick(ts[0]);
  const days = ts[0].timeDefines.map((t, i) => ({ date: t.slice(0, 10), weather: String(w.weathers?.[i] || "").replace(/\s+/g, " ").trim() })).filter((d) => d.weather);
  let pops = [];
  if (ts[1]) {
    const p = pick(ts[1]);
    pops = ts[1].timeDefines.map((t, i) => ({ time: t, pop: p.pops?.[i] ?? "" })).filter((x) => x.pop !== "");
  }
  return { areaName: w.area.name, reportTime: data[0].reportDatetime, days: days.slice(0, 3), pops: pops.slice(0, 6) };
}

/** rivers: 川データの配列, prefBySlug: 都道府県データ。戻り値 { 川のslug: live } */
async function loadLive(rivers, prefBySlug) {
  const out = {};
  if (process.env.SKIP_LIVE) return out;
  let table, latest;
  try {
    [table, latest] = await Promise.all([getJson(`${JMA}/amedas/const/amedastable.json`), getJson(`${JMA}/amedas/data/latest_time.txt`, true)]);
  } catch (e) {
    console.log(`ℹ️  気象庁のデータを取得できませんでした（${e.message}）。「川の状態」は表示せずに作成します。`);
    return out;
  }
  await Promise.all(rivers.map(async (r) => {
    const cfg = r.live || {};
    const pts = (cfg.points || []).filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
    if (!pts.length) return;
    const obs = (await Promise.all(pts.map((p) => observe(table, latest, p)))).filter(Boolean);
    let fc = null;
    const office = cfg.jmaOffice || (prefBySlug[r.prefecture] || {}).jmaOffice;
    if (office) { try { fc = await forecast(office, cfg.jmaArea); } catch (e) { /* 予報なしで続行 */ } }
    if (!obs.length && !fc) return;
    out[r.slug + "@" + r.prefecture] = { updated: latest, points: obs, level: obs.length ? judge(obs) : null, forecast: fc };
  }));
  console.log(`🌦  川の状態を取得: ${Object.keys(out).length}/${rivers.length} 河川`);
  return out;
}

module.exports = { loadLive, judge };
