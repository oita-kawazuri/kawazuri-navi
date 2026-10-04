/**
 * 遊漁規則の変更チェック（自動運営の第1段階）
 * ------------------------------------------------------------
 * data/ に書かれた出典URL（県の遊漁規則ページ・PDF、漁協のページ）を週1回確認し、
 *  - PDF：中身が変わったら
 *  - HTMLページ：載っているPDFへのリンクが増えた・減ったら
 * GitHub の Issue で「確認してください」と知らせます。
 * 結果は data/_state/sources.json に保存します。
 *
 * 将来の拡張：変更を検知したPDFから料金・期間をAIで読み取り、
 *            データ修正案（プルリクエスト）を自動で作る段階へ進めます。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const STATE = path.join(ROOT, "data", "_state", "sources.json");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// ---- チェック対象を data から集める ----
const targets = new Map(); // url -> { label, usedBy:Set }
const add = (url, label, usedBy) => {
  if (!/^https?:\/\//.test(url || "")) return;
  const t = targets.get(url) || { label, usedBy: new Set() };
  t.usedBy.add(usedBy);
  targets.set(url, t);
};
for (const p of read(path.join(ROOT, "data", "prefectures.json"))) {
  if (p.officialRulesUrl) add(p.officialRulesUrl, p.officialRulesLabel || `${p.name}の遊漁規則ページ`, `data/prefectures.json（${p.name}）`);
  for (const x of p.pending || []) add(x.rulesUrl, `${x.name}の遊漁規則`, `data/prefectures.json（${p.name}・準備中）`);
}
const riverDir = path.join(ROOT, "data", "rivers");
for (const pref of fs.readdirSync(riverDir)) {
  const dir = path.join(riverDir, pref);
  if (pref.startsWith("_") || !fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
    const r = read(path.join(dir, f));
    for (const s of r.sources || []) add(s.url, s.title, `data/rivers/${pref}/${f}`);
  }
}
const extra = path.join(ROOT, "data", "watch.json"); // 任意：漁協のホームページなど追加で見張るURL
if (fs.existsSync(extra)) for (const x of read(extra)) add(x.url, x.label, "data/watch.json");

// ---- 取得と比較 ----
async function fetchBuf(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "kawazuri-navi source watcher (weekly)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "" };
  } finally { clearTimeout(t); }
}
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex").slice(0, 16);
function pdfLinks(html, base) {
  const set = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+\.pdf)["']/gi)) {
    try { set.add(new URL(m[1], base).href); } catch (e) {}
  }
  return [...set].sort();
}

async function openIssue(title, body) {
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
  if (!repo || !token) { console.log(`（手元実行のため Issue は作りません）${title}`); return; }
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  console.log(res.ok ? `📮 Issue を作成: ${title}` : `⚠️ Issue を作れませんでした（${res.status}）: ${title}`);
}

(async () => {
  const state = fs.existsSync(STATE) ? read(STATE) : { lastRun: null, sources: {} };
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  let changed = 0, failed = 0;
  for (const [url, t] of targets) {
    const prev = state.sources[url];
    try {
      const { buf, type } = await fetchBuf(url);
      const isPdf = /pdf/i.test(type) || /\.pdf($|\?)/i.test(url);
      const links = isPdf ? null : pdfLinks(buf.toString("utf8"), url);
      const hash = isPdf ? sha(buf) : sha(links.join("\n"));
      if (prev && prev.hash !== hash) {
        changed++;
        const added = links && prev.links ? links.filter((l) => !prev.links.includes(l)) : [];
        const removed = links && prev.links ? prev.links.filter((l) => !links.includes(l)) : [];
        await openIssue(`【要確認】遊漁規則の更新を検知：${t.label}`, [
          `次の公開資料に変更がありました（${today} の自動チェック）。`,
          ``, `- 資料：${url}`, `- このURLを使っているデータ：${[...t.usedBy].join("、")}`,
          added.length ? `\n**新しく載ったPDF**\n${added.map((l) => `- ${l}`).join("\n")}` : "",
          removed.length ? `\n**なくなったPDF**\n${removed.map((l) => `- ${l}`).join("\n")}` : "",
          ``, `### やること`, `- [ ] 資料を開いて、料金・遊漁期間・禁漁区・販売店に変更がないか確認する`,
          `- [ ] 変更があればデータを直し、"lastVerified"（確認日）と "sources" のURLを更新する`,
          `- [ ] 確認が終わったらこの Issue を Close する`,
        ].join("\n"));
      }
      state.sources[url] = { label: t.label, hash, links: links || undefined, checked: today, changed: prev && prev.hash !== hash ? today : (prev && prev.changed) || today };
    } catch (e) {
      failed++;
      console.log(`⚠️ 取得失敗: ${t.label}（${e.message}）`);
      state.sources[url] = { ...(prev || { label: t.label }), error: e.message, checked: today };
    }
  }
  state.lastRun = today;
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  console.log(`✅ チェック完了：${targets.size}件（変更 ${changed}件、取得失敗 ${failed}件）`);
})();
