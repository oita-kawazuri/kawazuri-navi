/**
 * 川釣りナビ ページ自動生成スクリプト（v2）
 * ------------------------------------------------------------
 * data/ のJSONと気象庁の最新データから、dist/ にサイト一式を作ります。
 * GitHub では「保存したとき」と「1時間ごと」に自動で実行されます。ふだん触る必要はありません。
 * 手元で試す場合:  node build.js     （気象庁に接続しない場合: SKIP_LIVE=1 node build.js）
 */
const fs = require("fs");
const path = require("path");
const { loadLive } = require("./lib/live");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "dist");
const NOW = new Date(Date.now() + 9 * 3600 * 1000); // 日本時間
const YEAR = NOW.getUTCFullYear();

// ============================================================
// 1. データ読み込み & チェック
// ============================================================
const errors = [];
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`\n❌ ${path.relative(ROOT, file)} の書き方に誤りがあります。\n   ${e.message}\n   → カンマ（,）の付け忘れ・付けすぎ、" の閉じ忘れを確認してください（line = 行番号）。\n`);
    process.exit(1);
  }
}
const site = readJson(path.join(DATA, "site.json"));
site.siteUrl = String(site.siteUrl || "").replace(/\/+$/, "");
const MIN = Number(site.aggregateMinRivers || 3);
const prefectures = readJson(path.join(DATA, "prefectures.json"));
const prefBySlug = Object.fromEntries(prefectures.map((p) => [p.slug, p]));
const { species: speciesList, topics } = readJson(path.join(DATA, "species.json"));
const SP = Object.fromEntries(speciesList.map((s) => [s.id, s]));

const rivers = [];
const riverDir = path.join(DATA, "rivers");
for (const pref of fs.readdirSync(riverDir)) {
  const dir = path.join(riverDir, pref);
  if (pref.startsWith("_") || pref.startsWith(".") || !fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const r = readJson(path.join(dir, f));
    const where = `data/rivers/${pref}/${f}`;
    if (!prefBySlug[r.prefecture]) errors.push(`${where}: "prefecture" の "${r.prefecture}" が prefectures.json にありません`);
    if (r.prefecture !== pref) errors.push(`${where}: フォルダ名 "${pref}" と "prefecture" の値 "${r.prefecture}" が違います`);
    if (!/^[a-z0-9-]+$/.test(r.slug || "")) errors.push(`${where}: "slug" は半角英小文字・数字・ハイフンで書いてください`);
    if (`${r.slug}.json` !== f) errors.push(`${where}: ファイル名と "slug" をそろえてください（"${r.slug}.json"）`);
    for (const k of ["river", "intro"]) if (!r[k]) errors.push(`${where}: "${k}" が空です`);
    if (!(r.cooperatives || []).length) errors.push(`${where}: "cooperatives"（漁協）を1つ以上書いてください`);
    r.species = r.species || [];
    for (const s of r.species) {
      if (!SP[s.id]) errors.push(`${where}: 魚の id "${s.id}" が species.json にありません`);
      for (const rg of s.seasons || []) for (const d of rg) if (!/^\d\d-\d\d$/.test(d)) errors.push(`${where}: 期間 "${d}" は "06-01" の形で書いてください`);
    }
    for (const n of r.news || []) if (!/^\d{4}-\d\d-\d\d$/.test(n.date || "")) errors.push(`${where}: お知らせの日付 "${n.date}" は "2026-10-01" の形で書いてください`);
    r.spots = r.spots || [];
    rivers.push(r);
  }
}
if (errors.length) {
  console.error("\n❌ データに次の問題があります:\n - " + errors.join("\n - ") + "\n");
  process.exit(1);
}

// ============================================================
// 2. 便利関数
// ============================================================
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = (n) => Number(n).toLocaleString("ja-JP") + "円";
const md = (k) => { const [m, d] = k.split("-").map(Number); return `${m}月${d}日`; };
const seasonText = (ss) => (!ss || !ss.length ? "期間の定めなし（通年）" : ss.map(([a, b]) => `${md(a)}〜${b < a ? "翌年" : ""}${md(b)}`).join("、"));
const periodText = (a) => (a.from ? `${md(a.from)}〜${a.to < a.from ? "翌年" : ""}${md(a.to)}` : "通年");
const fmtDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${y}年${m}月${d}日`; };
const minFee = (r) => Math.min(...((r.fees && r.fees.items) || [{ price: 0 }]).map((i) => i.price));
const coop = (r) => r.cooperatives[0];
const coopNames = (r) => r.cooperatives.map((c) => c.name).join("・");
const abs = (p) => `${site.siteUrl}/${p}`;
const telHref = (t) => "tel:" + String(t).replace(/[^0-9+]/g, "");
const mapHref = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const routeHref = (q) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
const plain = (name) => name.replace(/（.*?）/, "");
const lastmodOf = (r) => [r.lastVerified || "2000-01-01", ...(r.news || []).map((n) => n.date)].sort().pop();

const P = {
  river: (r) => `${r.prefecture}/${r.slug}/`,
  species: (r, s) => `${r.prefecture}/${r.slug}/${s.id}/`,
  spot: (r, sp) => `${r.prefecture}/${r.slug}/${sp.slug}/`,
  pref: (p) => `${p.slug}/`,
  topic: (t) => `kaikin/${t.slug}/`,
  topicPref: (t, p) => `kaikin/${t.slug}/${p.slug}/`,
};
// 独自情報がある魚だけ個別ページを作る（内容の薄いページを量産しない）
const hasSpeciesPage = (s) => (s.seasons && s.seasons.length) || s.sizeLimit || (s.notes && s.notes.length);
const riversWith = (ids, prefSlug) => rivers.filter((r) => (!prefSlug || r.prefecture === prefSlug) && r.species.some((s) => ids.includes(s.id)));

function monthCoverage(ss) {
  const res = [];
  for (let m = 1; m <= 12; m++) {
    if (!ss || !ss.length) { res.push(2); continue; }
    const days = new Date(Date.UTC(2025, m, 0)).getUTCDate();
    let open = 0;
    for (let d = 1; d <= days; d++) {
      const k = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (ss.some(([a, b]) => (a <= b ? k >= a && k <= b : k >= a || k <= b))) open++;
    }
    res.push(open === days ? 2 : open > 0 ? 1 : 0);
  }
  return res;
}
const seasonBar = (ss) => `<div class="bar" role="img" aria-label="釣りができる月: ${esc(seasonText(ss))}">${monthCoverage(ss).map((v, i) => `<span class="m m${v}"><i>${i + 1}</i></span>`).join("")}</div>`;
const statusBadge = (ss) => `<span class="badge" data-seasons='${esc(JSON.stringify(ss || []))}'>${ss && ss.length ? "期間あり" : "通年OK"}</span>`;

// ============================================================
// 3. 共通レイアウト
// ============================================================
let usesLive = false;
function layout({ depth, pagePath, title, description, body, breadcrumbs = [], jsonld = [], noindex = false, bottomNav = "" }) {
  const r = "../".repeat(depth);
  const canonical = abs(pagePath);
  const crumbLd = breadcrumbs.length ? [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: breadcrumbs.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, item: abs(b.path) })) }] : [];
  const ld = [...crumbLd, ...jsonld].map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");
  const crumbs = breadcrumbs.length ? `<nav class="crumbs" aria-label="パンくずリスト">${breadcrumbs.map((b, i) => (i === breadcrumbs.length - 1 ? `<span>${esc(b.name)}</span>` : `<a href="${r}${b.path}">${esc(b.name)}</a>`)).join('<span class="sep">›</span>')}</nav>` : "";
  const ga = site.gaMeasurementId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(site.gaMeasurementId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(site.gaMeasurementId)}');</script>` : "";
  const ads = site.adsenseClient ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(site.adsenseClient)}" crossorigin="anonymous"></script>` : "";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ""}
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(abs("assets/ogp.png"))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0d5c63">
${site.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(site.googleSiteVerification)}">` : ""}
<link rel="icon" href="${r}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${r}assets/icon-192.png">
<link rel="manifest" href="${r}manifest.webmanifest">
<link rel="stylesheet" href="${r}assets/style.css">
${ld}
${ga}
${ads}
</head>
<body data-root="${r}">
<header class="site-head"><div class="wrap">
  <a class="logo" href="${r}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 20c4-4 8-4 12 0s8 4 12 0 4-2 4-2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M9 12c3-4 9-4 12 0-3 4-9 4-12 0zm12 0 4-3v6z" fill="currentColor"/></svg>${esc(site.siteName)}</a>
  <nav class="head-nav"><a href="${r}kaikin/">解禁日</a><a href="${r}ryokin/">料金</a><a href="${r}#areas">地域</a></nav>
</div></header>
<main class="wrap">
${crumbs}
${body}
</main>
${bottomNav}
<footer class="site-foot"><div class="wrap">
  <p><strong>${esc(site.siteName)}</strong> — ${esc(site.tagline)}</p>
  <nav class="foot-nav"><a href="${r}kaikin/">解禁日一覧</a><a href="${r}ryokin/">遊漁券の料金一覧</a><a href="${r}guide/yugyoken/">遊漁券ガイド</a><a href="${r}about/">運営者情報・掲載方針</a><a href="${r}policy/">プライバシーポリシー・免責事項</a>${site.contactUrl ? `<a href="${esc(site.contactUrl)}">お問い合わせ・情報提供</a>` : ""}</nav>
  <p class="small">掲載情報は各漁協の遊漁規則などの公開資料をもとにしています。規則は変更されることがあるため、釣行前に漁協・販売店の最新情報を確認してください。雨量・天気は気象庁ホームページのデータを加工して作成しています。</p>
  <p class="small">© ${YEAR} ${esc(site.operator || site.siteName)}</p>
</div></footer>
<script src="${r}assets/app.js" defer></script>
</body>
</html>`;
}

// ============================================================
// 4. 部品
// ============================================================
function shareButtons(url, text) {
  const u = encodeURIComponent(url), t = encodeURIComponent(text);
  return `<div class="share"><span>シェア</span>
  <a href="https://social-plugins.line.me/lineit/share?url=${u}" target="_blank" rel="noopener">LINE</a>
  <a href="https://twitter.com/intent/tweet?url=${u}&text=${t}" target="_blank" rel="noopener">X</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener">Facebook</a>
  <button type="button" data-copy="${esc(url)}">リンクをコピー</button></div>`;
}
const adSlot = () => (site.adsenseClient ? `<div class="ad"><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(site.adsenseClient)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>` : "");

function speciesCard(r, s, rel) {
  const m = SP[s.id];
  const inner = `<div class="sp-top"><span class="sp-name">${esc(m.name)}</span>${statusBadge(s.seasons)}</div>
  ${seasonBar(s.seasons)}
  <p class="small">${s.seasons && s.seasons.length ? `<span class="status-text strong" data-seasons='${esc(JSON.stringify(s.seasons))}'></span><br>` : ""}期間：${esc(seasonText(s.seasons))}<br>釣り方：${esc(s.methods)}${s.sizeLimit ? `<br><b>${esc(s.sizeLimit)}</b>` : ""}</p>`;
  return hasSpeciesPage(s) ? `<a class="card sp" href="${rel}${P.species(r, s)}">${inner}</a>` : `<div class="card sp">${inner}</div>`;
}

function feeBlock(r) {
  if (!r.fees) return "";
  return `<section id="fee"><h2>遊漁券の料金</h2>
<p class="small">対象：${esc(r.fees.target)}</p>
<div class="fees">${r.fees.items.map((i) => `<div class="fee"><span>${esc(i.label)}</span><strong>${yen(i.price)}</strong><em>${esc(i.detail || "")}</em></div>`).join("")}</div>
${(r.freeFor || []).length ? `<div class="free"><strong>無料になる人</strong><ul>${r.freeFor.map((f) => `<li>${esc(f.who)}${f.note ? `<span class="small">（${esc(f.note)}）</span>` : ""}</li>`).join("")}</ul></div>` : ""}
${(r.onlineTickets || []).length ? `<p class="online">スマホで買える：${r.onlineTickets.map((o) => `<a class="btn" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.label)}</a>`).join(" ")}</p>` : ""}
<ul class="notes">${(r.fees.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
</section>`;
}

function closedBlock(r, filterRiver) {
  const list = (r.closedAreas || []).filter((a) => !filterRiver || a.river === filterRiver);
  if (!list.length) return "";
  return `<section id="closed"><h2>禁漁区（採捕禁止区域）${filterRiver ? `：${esc(filterRiver)}` : ""}</h2>
<p class="small">次の区域では、期間中すべての魚の採捕が禁止されています。</p>
<div class="table-wrap"><table><thead><tr><th>川</th><th>区域</th><th>期間</th></tr></thead><tbody>
${list.map((a) => `<tr><td>${esc(a.river)}</td><td>${esc(a.place)}</td><td class="nowrap">${a.from ? `<span class="closed-now" data-from="${a.from}" data-to="${a.to}"></span>` : ""}${esc(periodText(a))}</td></tr>`).join("")}
</tbody></table></div></section>`;
}

function shopsBlock(r, areas) {
  const list = (r.shops || []).filter((s) => !areas || areas.includes(s.area));
  if (!list.length) return "";
  const groups = [...new Set(list.map((s) => s.area))];
  return `<section id="shops"><h2>遊漁券が買える場所</h2>
${groups.map((ar) => `<h3>${esc(ar)}</h3><ul class="shops">${list.filter((s) => s.area === ar).map((s) => `<li><strong>${esc(s.name)}</strong><span class="small">${esc(s.address)}</span><span class="acts"><a href="${telHref(s.tel)}">📞 電話</a><a href="${routeHref(s.address)}" target="_blank" rel="noopener">🚗 ルート</a><a href="${mapHref(s.address + " " + s.name)}" target="_blank" rel="noopener">🗺 地図</a></span></li>`).join("")}</ul>`).join("")}
${areas && areas.length ? `<p><a href="../#shops">すべての販売店を見る</a></p>` : ""}
${r.shopNote ? `<p class="small">${esc(r.shopNote)}</p>` : ""}
</section>`;
}

function liveBlock(r, live) {
  const links = (r.links || []).filter((l) => l.kind === "water" || l.kind === "camera");
  const pref = prefBySlug[r.prefecture];
  const warnUrl = pref.jmaOffice ? `https://www.jma.go.jp/bosai/warning/#area_type=offices&area_code=${pref.jmaOffice}` : "";
  if (!live && !links.length) return "";
  if (live) usesLive = true;
  const lv = live && live.level;
  return `<section id="live"><h2>今の${esc(r.river)}の状態</h2>
${lv ? `<div class="level lv${lv.code}"><span class="lv-badge">${esc(lv.label)}</span><p>${esc(lv.text)}</p></div>` : ""}
${live && live.points.length ? `<div class="table-wrap"><table class="rain"><thead><tr><th>場所</th><th>24時間雨量</th><th>1時間雨量</th><th>気温</th></tr></thead><tbody>
${live.points.map((p) => `<tr><td>${esc(p.label)}<br><span class="small">${esc(p.station)}観測所</span></td><td><b>${p.rain24h}mm</b></td><td>${p.rain1h ?? "-"}mm</td><td>${p.temp ?? "-"}℃</td></tr>`).join("")}
</tbody></table></div>` : ""}
${live && live.forecast ? `<div class="fc"><h3>天気予報（${esc(live.forecast.areaName)}）</h3><ul class="fc-days">${live.forecast.days.map((d) => `<li><span>${fmtDate(d.date).replace(/^\d+年/, "")}</span>${esc(d.weather)}</li>`).join("")}</ul>
${live.forecast.pops.length ? `<p class="small">降水確率：${live.forecast.pops.map((p) => `${Number(p.time.slice(11, 13))}時〜 ${esc(p.pop)}%`).join("／")}</p>` : ""}</div>` : ""}
${live ? `<p class="small">更新：<time data-rel="${esc(live.updated)}">${esc(live.updated.slice(0, 16).replace("T", " "))}</time>（1時間ごとに自動更新）。判定は雨量から機械的に出した目安です。出典：気象庁ホームページ（アメダス・天気予報）を加工して作成</p>` : ""}
<ul class="live-links">${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${l.kind === "camera" ? "📹" : "📈"} ${esc(l.label)}</a></li>`).join("")}${warnUrl ? `<li><a href="${warnUrl}" target="_blank" rel="noopener">⚠️ 警報・注意報（気象庁）</a></li>` : ""}</ul>
</section>`;
}

function sourcesBlock(r) {
  return `<section class="sources"><h2>情報の出典・確認日</h2>
<ul>${(r.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>
<p class="small">${r.rulesEffective ? `遊漁規則の認可日：${fmtDate(r.rulesEffective)}／` : ""}最終確認日：${fmtDate(r.lastVerified || "2000-01-01")}${r.status === "draft" ? "／<b>漁協による確認前の情報です</b>" : ""}</p>
</section>`;
}

const faqBlock = (faq) => (faq && faq.length ? `<section id="faq"><h2>よくある質問</h2>${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>` : "");
const faqLd = (faq) => (faq && faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []);
const favButton = (r) => `<button type="button" class="fav" data-fav="${esc(r.prefecture + "/" + r.slug)}" data-fav-name="${esc(r.river)}" aria-pressed="false">☆ マイ川に登録</button>`;

// ============================================================
// 5. ページ
// ============================================================
function riverPage(r, live) {
  const pref = prefBySlug[r.prefecture];
  const rel = "../../";
  const pagePath = P.river(r);
  const names = r.species.map((s) => plain(SP[s.id].name));
  const hasSeasonalClosed = (r.closedAreas || []).some((a) => a.from);
  const title = `${r.river}の釣り情報｜遊漁券・解禁日・今日の川の状態【${YEAR}年】`;
  const description = `${r.river}（${pref.name}）で釣りをする前に。今日の雨量・天気と増水の目安、遊漁券（日券${yen(minFee(r))}〜）と買える場所、${names.slice(0, 4).join("・")}などの解禁日、禁漁区をまとめています。`;
  const news = [...(r.news || [])].sort((a, b) => b.date.localeCompare(a.date));
  const lv = live && live.level;
  const body = `
<section class="hero">
  <p class="kicker">${esc(pref.name)}｜${esc(coopNames(r))}</p>
  <div class="title-row"><h1>${esc(r.river)}の釣り情報</h1>${favButton(r)}</div>
  <p class="lead">${esc(r.catchphrase || "")}</p>
  <div class="tiles">
    <a class="tile" href="#live"><span>川の状態</span>${lv ? `<strong class="lvtext lv${lv.code}">${esc(lv.label)}</strong><em>24h雨量 最大${Math.max(...live.points.map((p) => p.rain24h))}mm</em>` : `<strong>水位・カメラ</strong><em>公式情報へ</em>`}</a>
    <a class="tile" href="#fee"><span>遊漁券</span><strong>日券 ${yen(minFee(r))}</strong><em>${(r.freeFor || []).length ? `${esc(r.freeFor[0].who)}は無料` : "買える場所を見る"}</em></a>
    <a class="tile" href="#species"><span>今日釣れる魚</span><strong data-open-count='${esc(JSON.stringify(r.species.map((s) => s.seasons)))}'>${r.species.length}種</strong><em>解禁日を見る</em></a>
    <a class="tile" href="#closed"><span>禁漁区</span><strong data-closed-count='${esc(JSON.stringify((r.closedAreas || []).map((a) => [a.from, a.to])))}'>${(r.closedAreas || []).length}か所</strong><em>${hasSeasonalClosed ? "期間限定あり" : "場所を確認"}</em></a>
  </div>
  <div class="today" data-today-list='${esc(JSON.stringify(r.species.map((s) => ({ n: SP[s.id].name, s: s.seasons }))))}'>
    <p class="today-title">今日（<span data-today-date></span>）釣れる魚</p><div class="today-body"></div>
  </div>
</section>

${liveBlock(r, live)}

${news.length ? `<section id="news"><h2>お知らせ・漁況</h2><ul class="news">${news.slice(0, 10).map((n) => `<li><time datetime="${n.date}">${fmtDate(n.date)}</time><strong>${esc(n.title)}</strong>${n.body ? `<p>${esc(n.body)}</p>` : ""}</li>`).join("")}</ul></section>` : ""}

${feeBlock(r)}
${shopsBlock(r)}
${adSlot()}

<section id="species"><h2>釣れる魚と遊漁期間</h2>
<p class="small">色の濃い月が釣りのできる月、薄い月は一部だけ釣りができる月です。</p>
<div class="grid">${r.species.map((s) => speciesCard(r, s, rel)).join("")}</div></section>

${r.spots.length ? `<section id="spots"><h2>${esc(r.river)}水系の釣り場</h2><div class="grid">${r.spots.map((sp) => `<a class="card" href="${rel}${P.spot(r, sp)}"><strong class="card-title">${esc(sp.name)}</strong><span class="small">${esc(sp.kind)}｜${esc(sp.place)}</span><span class="small">${sp.species.map((id) => plain(SP[id].name)).join("・")}</span></a>`).join("")}</div></section>` : ""}

${closedBlock(r)}

${r.bannedMethods && r.bannedMethods.length ? `<section id="banned"><h2>禁止されている漁具・漁法</h2><ul class="cols">${r.bannedMethods.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></section>` : ""}
${r.manners && r.manners.length ? `<section id="manners"><h2>釣りをするときのきまり</h2><ul class="notes">${r.manners.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></section>` : ""}

<section id="office"><h2>漁協の連絡先</h2>
${r.cooperatives.map((c) => `<div class="office"><p><strong>${esc(c.name)}</strong><br>${esc(c.address)}<br><a href="${telHref(c.tel)}">📞 ${esc(c.tel)}</a></p><a class="btn" href="${mapHref(c.address)}" target="_blank" rel="noopener">地図で見る</a></div>`).join("")}
</section>

${faqBlock(r.faq)}
${shareButtons(abs(pagePath), `${r.river}の遊漁券・解禁日・今日の川の状態`)}
<section class="related"><h2>あわせて見る</h2><ul class="links">
<li><a href="${rel}${P.pref(pref)}">${esc(pref.name)}の川釣り情報</a></li>
${topics.filter((t) => r.species.some((s) => t.species.includes(s.id))).map((t) => `<li><a href="${rel}${P.topicPref(t, pref)}">${esc(pref.name)}の${esc(t.short)} 解禁日一覧</a></li>`).join("")}
<li><a href="${rel}guide/yugyoken/">遊漁券の買い方・料金・いらないケース</a></li></ul></section>
${sourcesBlock(r)}`;
  const c = coop(r);
  const jsonld = [
    { "@context": "https://schema.org", "@type": "Organization", name: c.name, telephone: c.tel, address: { "@type": "PostalAddress", streetAddress: c.address, addressCountry: "JP" } },
    ...faqLd(r.faq),
  ];
  const bottomNav = `<nav class="bottom-nav" aria-label="このページの主な項目"><a href="#live">🌧<span>川の状態</span></a><a href="#fee">💴<span>料金</span></a><a href="#shops">🎫<span>買える店</span></a><a href="#species">🐟<span>解禁日</span></a><a href="#closed">⛔<span>禁漁区</span></a></nav>`;
  return { depth: 2, pagePath, title, description, body, jsonld, bottomNav, lastmod: lastmodOf(r),
    breadcrumbs: [{ name: "トップ", path: "" }, { name: pref.name, path: P.pref(pref) }, { name: r.river, path: pagePath }] };
}

function speciesPage(r, s) {
  const pref = prefBySlug[r.prefecture];
  const m = SP[s.id];
  const rel = "../../../";
  const pagePath = P.species(r, s);
  const short = plain(m.title);
  const topic = topics.find((t) => t.species.includes(s.id));
  const title = `${r.river}の${short}釣り｜解禁日・遊漁券・ルール【${YEAR}年】`;
  const description = `${r.river}（${pref.name}）の${m.name}釣り。遊漁期間は${seasonText(s.seasons)}。認められた釣り方、遊漁券の料金（日券${yen(minFee(r))}）と買える場所、禁漁区を確認できます。`;
  const others = r.species.filter((x) => x.id !== s.id && hasSpeciesPage(x));
  const spots = r.spots.filter((sp) => sp.species.includes(s.id));
  const faq = [
    { q: `${r.river}の${short}釣りはいつからいつまでできますか？`, a: `${coopNames(r)}の遊漁規則では、${m.name}の遊漁期間は${seasonText(s.seasons)}です。` },
    { q: `${r.river}で${short}を釣るのに遊漁券はいくらですか？`, a: `${r.fees ? r.fees.items.map((i) => `${i.label}${yen(i.price)}`).join("、") : "漁協にお問い合わせください"}です。${(r.freeFor || []).length ? `${r.freeFor.map((f) => f.who).join("・")}は無料です。` : ""}` },
    { q: `${r.river}の${short}はどんな釣り方ができますか？`, a: `${s.methods}が認められています。${s.sizeLimit ? s.sizeLimit + "です。" : ""}` },
  ];
  const body = `
<section class="hero">
  <p class="kicker">${esc(pref.name)}｜${esc(r.river)}</p>
  <h1>${esc(r.river)}の${esc(short)}釣り</h1>
  <p class="status-line">${statusBadge(s.seasons)} <span class="status-text" data-seasons='${esc(JSON.stringify(s.seasons || []))}'></span></p>
  ${seasonBar(s.seasons)}
</section>
<section><div class="facts">
  <div><span>遊漁期間</span><strong>${esc(seasonText(s.seasons))}</strong></div>
  <div><span>認められた釣り方</span><strong>${esc(s.methods)}</strong></div>
  ${s.sizeLimit ? `<div><span>サイズ制限</span><strong>${esc(s.sizeLimit)}</strong></div>` : ""}
  <div><span>遊漁券</span><strong>日券 ${yen(minFee(r))}〜</strong></div>
</div>
${s.notes && s.notes.length ? `<ul class="notes warn">${s.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<p>${esc(m.about)}</p>
<p><a class="btn" href="${rel}${P.river(r)}#live">今日の${esc(r.river)}の状態（雨量・天気）を見る</a></p></section>
${spots.length ? `<section><h2>${esc(short)}が釣れる主な釣り場</h2><div class="grid">${spots.map((sp) => `<a class="card" href="${rel}${P.spot(r, sp)}"><strong class="card-title">${esc(sp.name)}</strong><span class="small">${esc(sp.kind)}｜${esc(sp.place)}</span></a>`).join("")}</div></section>` : ""}
${feeBlock(r)}
${adSlot()}
${closedBlock(r)}
${shopsBlock(r)}
${faqBlock(faq)}
${others.length ? `<section><h2>${esc(r.river)}のほかの魚</h2><div class="grid">${others.map((x) => speciesCard(r, x, rel)).join("")}</div></section>` : ""}
<section class="related"><h2>あわせて見る</h2><ul class="links"><li><a href="${rel}${P.river(r)}">${esc(r.river)}の釣り情報トップ</a></li>${topic ? `<li><a href="${rel}${P.topicPref(topic, pref)}">${esc(pref.name)}の${esc(topic.short)} 解禁日一覧</a></li><li><a href="${rel}${P.topic(topic)}">全国の${esc(topic.short)} 解禁日一覧</a></li>` : ""}</ul></section>
${shareButtons(abs(pagePath), `${r.river}の${short}釣り 解禁日・遊漁券`)}
${sourcesBlock(r)}`;
  return { depth: 3, pagePath, title, description, body, jsonld: faqLd(faq), lastmod: lastmodOf(r),
    breadcrumbs: [{ name: "トップ", path: "" }, { name: pref.name, path: P.pref(pref) }, { name: r.river, path: P.river(r) }, { name: short, path: pagePath }] };
}

function spotPage(r, sp) {
  const pref = prefBySlug[r.prefecture];
  const rel = "../../../";
  const pagePath = P.spot(r, sp);
  const sps = r.species.filter((s) => sp.species.includes(s.id));
  const names = sps.map((s) => plain(SP[s.id].name));
  const title = `${sp.name}の${names.join("・")}釣り｜遊漁券・料金・期間【${YEAR}年】`;
  const description = `${sp.name}（${pref.name}${sp.place}）で${names.join("・")}を釣る前に。遊漁券は${coop(r).shortName || coop(r).name}の日券${yen(minFee(r))}、釣りができる期間、買える場所、ルールをまとめています。`;
  const faq = [
    { q: `${sp.name}で釣りをするのに遊漁券は必要ですか？`, a: `${sp.name}は${coopNames(r)}の漁場です。${names.join("・")}を釣るには遊漁券が必要で、日券は${yen(minFee(r))}です。${(r.freeFor || []).length ? `${r.freeFor.map((f) => f.who).join("・")}は無料です。` : ""}` },
    ...sps.map((s) => ({ q: `${sp.name}の${plain(SP[s.id].name)}釣りはいつできますか？`, a: `${seasonText(s.seasons)}です（${coopNames(r)}の遊漁規則）。` })),
  ];
  const body = `
<section class="hero">
  <p class="kicker">${esc(pref.name)}｜${esc(sp.place)}｜${esc(r.river)}水系</p>
  <h1>${esc(sp.name)}の${esc(names.join("・"))}釣り</h1>
  <p class="lead">${esc(sp.about)}</p>
  <p><a class="btn" href="${mapHref(sp.name + " " + sp.place)}" target="_blank" rel="noopener">🗺 地図で見る</a> <a class="btn ghost" href="${routeHref(sp.name + " " + sp.place)}" target="_blank" rel="noopener">🚗 ルート</a></p>
</section>
<section><h2>釣れる魚と期間</h2><div class="grid">${sps.map((s) => speciesCard(r, s, rel)).join("")}</div></section>
${feeBlock(r)}
${shopsBlock(r, sp.shopAreas)}
${adSlot()}
${closedBlock(r, sp.river)}
<section><p><a class="btn" href="${rel}${P.river(r)}#live">今日の${esc(r.river)}水系の雨量・天気を見る</a></p></section>
${faqBlock(faq)}
<section class="related"><h2>あわせて見る</h2><ul class="links"><li><a href="${rel}${P.river(r)}">${esc(r.river)}の釣り情報トップ</a></li>${r.spots.filter((x) => x !== sp).map((x) => `<li><a href="${rel}${P.spot(r, x)}">${esc(x.name)}</a></li>`).join("")}</ul></section>
${shareButtons(abs(pagePath), `${sp.name}の釣り 遊漁券・期間`)}
${sourcesBlock(r)}`;
  return { depth: 3, pagePath, title, description, body, jsonld: faqLd(faq), lastmod: lastmodOf(r),
    breadcrumbs: [{ name: "トップ", path: "" }, { name: pref.name, path: P.pref(pref) }, { name: r.river, path: P.river(r) }, { name: sp.name, path: pagePath }] };
}

// 解禁日の一覧表（横断ページ・県ページで共通）
function seasonTable(list, ids, rel, showPref) {
  const rows = [];
  for (const r of list) for (const s of r.species.filter((x) => ids.includes(x.id))) rows.push({ r, s });
  if (!rows.length) return "<p>掲載中の川はまだありません。</p>";
  return `<div class="table-wrap"><table class="season-table"><thead><tr>${showPref ? "<th>県</th>" : ""}<th>川</th><th>魚</th><th>遊漁期間</th><th>今日</th><th>日券</th></tr></thead><tbody>
${rows.map(({ r, s }) => `<tr>${showPref ? `<td>${esc(prefBySlug[r.prefecture].name)}</td>` : ""}<td><a href="${rel}${P.river(r)}">${esc(r.river)}</a></td><td>${hasSpeciesPage(s) ? `<a href="${rel}${P.species(r, s)}">${esc(SP[s.id].name)}</a>` : esc(SP[s.id].name)}</td><td>${esc(seasonText(s.seasons))}</td><td>${statusBadge(s.seasons)}</td><td class="nowrap">${yen(minFee(r))}</td></tr>`).join("")}
</tbody></table></div>`;
}

function topicPage(t, pref) {
  const list = riversWith(t.species, pref && pref.slug);
  const rel = pref ? "../../../" : "../../";
  const pagePath = pref ? P.topicPref(t, pref) : P.topic(t);
  const where = pref ? pref.name : "全国";
  const title = `${where}の${t.short}解禁日・遊漁期間 ${YEAR}年｜いつからいつまで【川別一覧】`;
  const description = `${where}の${t.title}の解禁日と禁漁期間（いつからいつまで釣れるか）を川ごとに一覧にしました。遊漁券の料金、今日釣りができるかも確認できます。`;
  const prefsWith = prefectures.filter((p) => riversWith(t.species, p.slug).length);
  const body = `
<section class="hero"><p class="kicker">解禁日一覧｜${esc(t.title)}</p><h1>${esc(where)}の${esc(t.short)} 解禁日一覧【${YEAR}年】</h1>
<p class="lead">${esc(t.lead)}</p><p class="small">掲載 ${list.length}河川。解禁日は漁協の遊漁規則にもとづきます。区間ごとの例外や臨時の変更は各河川のページと漁協の告知を確認してください。</p></section>
<section><h2>川別の解禁日・遊漁期間</h2>${seasonTable(list, t.species, rel, !pref)}</section>
${adSlot()}
${!pref && prefsWith.length ? `<section><h2>都道府県別に見る</h2><div class="prefs">${prefsWith.map((p) => `<a href="${rel}${P.topicPref(t, p)}">${esc(p.name)}<b>${riversWith(t.species, p.slug).length}</b></a>`).join("")}</div></section>` : ""}
${pref ? `<section><p><a href="${rel}${P.topic(t)}">全国の${esc(t.short)} 解禁日一覧へ</a>｜<a href="${rel}${P.pref(pref)}">${esc(pref.name)}の川釣り情報へ</a></p></section>` : ""}
<section class="related"><h2>ほかの解禁日一覧</h2><div class="prefs">${topics.filter((x) => x !== t).map((x) => `<a href="${rel}${pref ? P.topicPref(x, pref) : P.topic(x)}">${esc(x.short)}</a>`).join("")}</div></section>`;
  const crumbs = [{ name: "トップ", path: "" }, { name: "解禁日一覧", path: "kaikin/" }, { name: t.short, path: P.topic(t) }];
  if (pref) crumbs.push({ name: pref.name, path: pagePath });
  return { depth: pref ? 3 : 2, pagePath, title, description, body, breadcrumbs: crumbs, noindex: list.length < MIN,
    lastmod: list.map(lastmodOf).sort().pop(),
    jsonld: [{ "@context": "https://schema.org", "@type": "ItemList", name: title, itemListElement: list.map((r, i) => ({ "@type": "ListItem", position: i + 1, url: abs(P.river(r)), name: r.river })) }] };
}

function kaikinIndex() {
  const body = `<section class="hero"><h1>解禁日一覧【${YEAR}年】</h1><p class="lead">魚ごと・都道府県ごとに、川の解禁日と遊漁期間を一覧で確認できます。</p></section>
<section><div class="grid">${topics.map((t) => `<a class="card" href="${P.topic(t).replace("kaikin/", "")}"><strong class="card-title">${esc(t.title)}</strong><span class="small">${riversWith(t.species).length}河川</span><span class="small">${esc(t.lead)}</span></a>`).join("")}</div></section>`;
  return { depth: 1, pagePath: "kaikin/", title: `川釣りの解禁日一覧 ${YEAR}年｜鮎・渓流・ワカサギ`, description: `鮎（アユ）、渓流（ヤマメ・アマゴ・イワナ）、ワカサギなどの解禁日と遊漁期間を全国の川ごとに一覧にしています。`, body,
    breadcrumbs: [{ name: "トップ", path: "" }, { name: "解禁日一覧", path: "kaikin/" }], noindex: rivers.length < MIN };
}

function feePage() {
  const list = [...rivers].sort((a, b) => minFee(a) - minFee(b));
  const body = `<section class="hero"><h1>遊漁券の料金一覧【${YEAR}年】</h1><p class="lead">川ごとの遊漁券（日券・年券）の料金と、無料になる人の条件を一覧にしました。安い順に並んでいます。</p></section>
<section><div class="table-wrap"><table><thead><tr><th>川</th><th>県</th><th>日券</th><th>年券など</th><th>無料になる人</th></tr></thead><tbody>
${list.map((r) => `<tr><td><a href="../${P.river(r)}#fee">${esc(r.river)}</a></td><td>${esc(prefBySlug[r.prefecture].name)}</td><td class="nowrap"><b>${yen(minFee(r))}</b></td><td>${(r.fees ? r.fees.items : []).filter((i) => i.price !== minFee(r)).map((i) => `${esc(i.label)} ${yen(i.price)}`).join("<br>")}</td><td>${(r.freeFor || []).map((f) => esc(f.who)).join("・") || "-"}</td></tr>`).join("")}
</tbody></table></div><p class="small">料金は魚種によって異なる場合があります。詳しくは各河川のページで確認してください。</p></section>
${adSlot()}
<section><p><a href="../guide/yugyoken/">遊漁券の買い方・料金の決まり方・いらないケースを見る</a></p></section>`;
  return { depth: 1, pagePath: "ryokin/", title: `遊漁券の値段・料金一覧 ${YEAR}年｜川別の日券・年券と無料になる条件`, description: "川釣りの遊漁券の値段（日券・年券）を川ごとに比較。子どもなど無料になる条件もまとめています。", body,
    breadcrumbs: [{ name: "トップ", path: "" }, { name: "遊漁券の料金一覧", path: "ryokin/" }], noindex: rivers.length < MIN };
}

function guidePage() {
  const free = rivers.filter((r) => (r.freeFor || []).length);
  const faq = [
    { q: "遊漁券とは何ですか？", a: "漁業権が設定された川や湖で、漁協の組合員以外の人が釣りをするときに漁協へ納める遊漁料の証明です。漁協は魚の放流など増殖の義務を負っており、遊漁料はその費用にあてられます。" },
    { q: "遊漁券がいらないのはどんな場合ですか？", a: "遊漁券が必要なのは、漁業権のある区域で、その漁業権の対象となっている魚を釣る場合です。対象外の魚だけを釣る場合や、漁業権が設定されていない区域では必要ないことがありますが、判断は漁協ごとに違うため、必ず漁協に確認してください。都道府県の漁業調整規則は遊漁券の有無に関係なく守る必要があります。" },
    { q: "遊漁券はどこで買えますか？", a: "漁協の事務所、川の近くの釣具店・商店・コンビニなどの販売店で買えます。川で漁場監視員から買える漁協や、スマホで買える漁協もあります。" },
    { q: "子どもも遊漁券が必要ですか？", a: "中学生以下などを無料にしている漁協が多くあります。条件は漁協ごとに違うので、各河川のページで確認してください。" },
    { q: "遊漁券を持たずに釣りをするとどうなりますか？", a: "漁場監視員から遊漁料を請求されます。現場で買うと割高になる漁協もあります。遊漁規則に違反すると釣りを断られることがあります。" },
  ];
  const body = `<section class="hero"><h1>遊漁券ガイド：買い方・料金・いらないケース</h1><p class="lead">川釣りに必要な遊漁券のしくみを、はじめての人にもわかるようにまとめました。</p></section>
<section><h2>遊漁券が必要な理由</h2><p>川や湖の多くには漁業権が設定されていて、漁業権を持つ漁協は魚を増やす（放流などの）義務を負っています。漁協は「遊漁規則」を定めて、組合員以外の人の釣りのルールと遊漁料を決めています。遊漁規則は漁協の総会で決められ、都道府県の認可を受けて効力が生まれます。</p></section>
<section><h2>遊漁券の種類</h2><ul class="notes"><li><b>日券</b>：その日1日だけ有効。ときどき釣りをする人向け。</li><li><b>年券</b>：その年の漁期中ずっと有効。何度も行くなら割安。</li><li><b>現場券</b>：川で監視員から買う券。事前購入より高い漁協もあります。</li><li>魚種ごとに分かれている漁協（アユ券・雑魚券など）と、全魚種共通の漁協があります。</li></ul></section>
${adSlot()}
<section><h2>無料になる人の条件（掲載河川）</h2>${free.length ? `<div class="table-wrap"><table><thead><tr><th>川</th><th>無料になる人</th></tr></thead><tbody>${free.map((r) => `<tr><td><a href="../../${P.river(r)}#fee">${esc(r.river)}（${esc(prefBySlug[r.prefecture].name)}）</a></td><td>${r.freeFor.map((f) => esc(f.who) + (f.note ? `<br><span class="small">${esc(f.note)}</span>` : "")).join("<br>")}</td></tr>`).join("")}</tbody></table></div>` : "<p>準備中です。</p>"}</section>
${faqBlock(faq)}
<section class="related"><h2>あわせて見る</h2><ul class="links"><li><a href="../../ryokin/">遊漁券の料金一覧</a></li><li><a href="../../kaikin/">解禁日一覧</a></li></ul></section>
<p class="small">参考：<a href="https://www.pref.oita.jp/soshiki/16350/09.html" target="_blank" rel="noopener">大分県「内水面における遊漁規則」</a></p>`;
  return { depth: 2, pagePath: "guide/yugyoken/", title: "遊漁券とは？買い方・値段・いらない川と子ども無料の条件【川釣り】", description: "川釣りの遊漁券のしくみ、買える場所、日券と年券の違い、遊漁券がいらないケース、子どもが無料になる条件をわかりやすく解説します。", body, jsonld: faqLd(faq),
    breadcrumbs: [{ name: "トップ", path: "" }, { name: "遊漁券ガイド", path: "guide/yugyoken/" }] };
}

function prefPage(p, liveMap) {
  const list = rivers.filter((r) => r.prefecture === p.slug);
  const rel = "../";
  const pagePath = P.pref(p);
  const spots = list.flatMap((r) => r.spots.map((sp) => ({ r, sp })));
  const title = `${p.name}の川釣り情報｜遊漁券・解禁日・釣り場【${YEAR}年】`;
  const description = `${p.name}の川釣りスポットと漁協ごとの遊漁券の料金・買える場所、鮎や渓流魚の解禁日、今日の川の状態をまとめています。`;
  const body = `
<section class="hero"><p class="kicker">${esc(p.region)}</p><h1>${esc(p.name)}の川釣り情報</h1>
${p.intro ? `<p class="lead">${esc(p.intro)}</p>` : ""}</section>
<section><h2>川・漁協から探す</h2>
${list.length ? `<div class="grid">${list.map((r) => { const lv = (liveMap[r.slug + "@" + r.prefecture] || {}).level; return `<a class="card" href="${rel}${P.river(r)}"><div class="sp-top"><strong class="card-title">${esc(r.river)}</strong>${lv ? `<span class="badge lvb${lv.code}">${esc(lv.label)}</span>` : ""}</div><span class="small">${esc(coopNames(r))}</span><span class="small">${r.species.map((s) => plain(SP[s.id].name)).join("・")}</span><span class="small">日券 ${yen(minFee(r))}〜</span></a>`; }).join("")}</div>` : `<p>この地域の情報は準備中です。</p>`}
</section>
${spots.length ? `<section><h2>${esc(p.name)}の釣り場（ダム湖など）</h2><div class="grid">${spots.map(({ r, sp }) => `<a class="card" href="${rel}${P.spot(r, sp)}"><strong class="card-title">${esc(sp.name)}</strong><span class="small">${esc(sp.kind)}｜${esc(sp.place)}</span><span class="small">${sp.species.map((id) => plain(SP[id].name)).join("・")}</span></a>`).join("")}</div></section>` : ""}
${list.length ? `<section><h2>${esc(p.name)}の解禁日一覧</h2>${seasonTable(list, topics.flatMap((t) => t.species), rel, false)}
<div class="prefs">${topics.filter((t) => riversWith(t.species, p.slug).length).map((t) => `<a href="${rel}${P.topicPref(t, p)}">${esc(t.short)}の解禁日</a>`).join("")}</div></section>` : ""}
${adSlot()}
${p.pending && p.pending.length ? `<section><h2>準備中の漁協（公式の遊漁規則はこちら）</h2><ul class="pending">${p.pending.map((x) => `<li><strong>${esc(x.name)}</strong><span>${esc(x.area)}</span><a href="${esc(x.rulesUrl)}" target="_blank" rel="noopener">遊漁規則を見る ↗</a></li>`).join("")}</ul></section>` : ""}
${p.officialRulesUrl ? `<p class="small">出典：<a href="${esc(p.officialRulesUrl)}" target="_blank" rel="noopener">${esc(p.officialRulesLabel || p.officialRulesUrl)}</a></p>` : ""}`;
  return { depth: 1, pagePath, title, description, body, noindex: !list.length, lastmod: list.map(lastmodOf).sort().pop(),
    breadcrumbs: [{ name: "トップ", path: "" }, { name: p.name, path: pagePath }] };
}

function indexPage(liveMap) {
  const regions = [...new Set(prefectures.map((p) => p.region))];
  const count = (slug) => rivers.filter((r) => r.prefecture === slug).length;
  const allNews = rivers.flatMap((r) => (r.news || []).map((n) => ({ ...n, r }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const alerts = rivers.map((r) => ({ r, lv: (liveMap[r.slug + "@" + r.prefecture] || {}).level })).filter((x) => x.lv && x.lv.code >= 1).sort((a, b) => b.lv.code - a.lv.code);
  const compact = rivers.map((r) => ({ n: r.river, p: P.river(r), pref: prefBySlug[r.prefecture].name, sp: r.species.filter((s) => s.seasons.length).map((s) => ({ n: plain(SP[s.id].name), s: s.seasons, u: hasSpeciesPage(s) ? P.species(r, s) : P.river(r) })) }));
  const body = `
<section class="hero home-hero">
  <h1>${esc(site.tagline)}</h1>
  <p class="lead">${esc(site.description)}</p>
  <form class="search" role="search" onsubmit="return false"><label for="q" class="vh">川・釣り場・魚の名前で探す</label>
  <input id="q" type="search" placeholder="川・ダム・魚の名前で探す（例：大分川、芹川ダム、鮎）" autocomplete="off"><div id="results" class="results" hidden></div></form>
</section>
<section id="mylist" hidden><h2>マイ川</h2><div class="grid" id="mylist-body"></div></section>
${alerts.length ? `<section><h2>雨の影響に注意が必要な川</h2><ul class="alerts">${alerts.map(({ r, lv }) => `<li><a href="${P.river(r)}#live"><span class="badge lvb${lv.code}">${esc(lv.label)}</span> ${esc(r.river)}（${esc(prefBySlug[r.prefecture].name)}）</a></li>`).join("")}</ul><p class="small">気象庁の雨量から自動判定（1時間ごと更新）</p></section>` : ""}
<section id="upcoming"><h2>もうすぐ解禁・もうすぐ終了</h2><script type="application/json" id="season-data">${JSON.stringify(compact).replace(/</g, "\\u003c")}</script><ul class="news" id="upcoming-body"><li class="small">読み込み中…</li></ul></section>
<section><h2>解禁日・料金を一覧で見る</h2><div class="prefs">${topics.map((t) => `<a href="${P.topic(t)}">${esc(t.short)}の解禁日</a>`).join("")}<a href="ryokin/">遊漁券の料金一覧</a><a href="guide/yugyoken/">遊漁券ガイド</a></div></section>
${allNews.length ? `<section><h2>新着のお知らせ</h2><ul class="news">${allNews.map((n) => `<li><time datetime="${n.date}">${fmtDate(n.date)}</time><a href="${P.river(n.r)}#news"><strong>${esc(n.r.river)}：${esc(n.title)}</strong></a></li>`).join("")}</ul></section>` : ""}
<section><h2>掲載中の川</h2><div class="grid">${rivers.map((r) => `<a class="card" href="${P.river(r)}"><strong class="card-title">${esc(r.river)}</strong><span>${esc(prefBySlug[r.prefecture].name)}｜${esc(coopNames(r))}</span><span class="small">${r.species.map((s) => plain(SP[s.id].name)).join("・")}</span></a>`).join("")}</div></section>
<section id="areas"><h2>都道府県から探す</h2>
${regions.map((rg) => `<h3>${esc(rg)}</h3><div class="prefs">${prefectures.filter((p) => p.region === rg).map((p) => (count(p.slug) || (p.pending || []).length ? `<a href="${P.pref(p)}">${esc(p.name)}${count(p.slug) ? `<b>${count(p.slug)}</b>` : ""}</a>` : `<span class="off">${esc(p.name)}</span>`)).join("")}</div>`).join("")}
</section>`;
  const jsonld = [{ "@context": "https://schema.org", "@type": "WebSite", name: site.siteName, url: abs(""), description: site.description }];
  return { depth: 0, pagePath: "", title: `${site.siteName}｜${site.tagline}`, description: site.description, body, jsonld };
}

function staticPage(pagePath, title, description, html) {
  return { depth: pagePath.split("/").filter(Boolean).length, pagePath, title: `${title}｜${site.siteName}`, description, body: `<section class="hero"><h1>${esc(title)}</h1></section><section class="prose">${html}</section>`,
    breadcrumbs: [{ name: "トップ", path: "" }, { name: title, path: pagePath }] };
}

// ============================================================
// 6. 書き出し
// ============================================================
(async () => {
  const liveMap = await loadLive(rivers, prefBySlug);
  fs.rmSync(OUT, { recursive: true, force: true });
  const sitemap = [];
  const write = (p) => {
    const file = path.join(OUT, p.pagePath, "index.html");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, layout(p));
    if (!p.noindex) sitemap.push({ loc: abs(p.pagePath), lastmod: p.lastmod });
  };

  for (const r of rivers) {
    write(riverPage(r, liveMap[r.slug + "@" + r.prefecture]));
    for (const s of r.species.filter(hasSpeciesPage)) write(speciesPage(r, s));
    for (const sp of r.spots) write(spotPage(r, sp));
  }
  for (const p of prefectures) if (rivers.some((r) => r.prefecture === p.slug) || (p.pending || []).length) write(prefPage(p, liveMap));
  write(kaikinIndex());
  for (const t of topics) {
    if (!riversWith(t.species).length) continue;
    write(topicPage(t));
    for (const p of prefectures) if (riversWith(t.species, p.slug).length) write(topicPage(t, p));
  }
  write(feePage());
  write(guidePage());
  write(staticPage("about/", "運営者情報・掲載方針", `${site.siteName}の運営者と、情報の集め方・確認の方針です。`, `
<h2>運営者</h2><p>${esc(site.operator || site.siteName)}</p>${site.contactUrl ? `<p><a href="${esc(site.contactUrl)}">お問い合わせ・情報提供フォーム</a></p>` : ""}
<h2>このサイトについて</h2><p>${esc(site.siteName)}は、川釣りをする人が「今日その川で釣りができるか」「遊漁券はいくらでどこで買えるか」をすぐに確認できるようにするための情報サイトです。</p>
<h2>掲載方針</h2><ul><li>料金・遊漁期間・禁漁区などは、都道府県が公開している遊漁規則や漁協の公式情報をもとに掲載します。各ページに出典と最終確認日を記載します。</li><li>漁協による確認前の情報には、その旨を表示します。</li><li>雨量・天気は気象庁のデータを自動で取り込み、1時間ごとに更新します。「川の状態」は雨量から機械的に判定した目安です。</li><li>誤りのご指摘、漁協からの掲載・修正のご依頼を歓迎します。</li></ul>`));
  write(staticPage("policy/", "プライバシーポリシー・免責事項", `${site.siteName}のプライバシーポリシーと免責事項です。`, `
<h2>アクセス解析について</h2><p>当サイトでは、利用状況を把握するためにGoogle アナリティクスを使用する場合があります。Google アナリティクスはCookieを使用してデータを収集しますが、個人を特定する情報は含まれません。Cookieはブラウザの設定で無効にできます。</p>
<h2>広告について</h2><p>当サイトでは、第三者配信の広告サービス（Google アドセンスなど）を利用する場合があります。広告配信事業者は、利用者の興味に応じた広告を表示するためにCookieを使用することがあります。パーソナライズ広告は<a href="https://adssettings.google.com/" target="_blank" rel="noopener">Googleの広告設定</a>で無効にできます。</p>
<h2>お気に入り（マイ川）について</h2><p>「マイ川」の登録内容はお使いのブラウザ内にのみ保存され、当サイトに送信されることはありません。</p>
<h2>免責事項</h2><p>掲載情報の正確性には注意を払っていますが、遊漁規則は改正されることがあり、臨時の禁漁や区間ごとの例外もあります。釣行前には必ず漁協・販売店の最新情報を確認してください。「川の状態」は目安であり、安全を保証するものではありません。増水時や警報発表時は川に近づかないでください。当サイトの情報を利用して生じた損害について、運営者は責任を負いません。</p>
<h2>出典</h2><p>雨量・天気：気象庁ホームページ（アメダス・天気予報）のデータを加工して作成。</p>`));
  write(indexPage(liveMap));

  // 404（どの階層でも表示が崩れないよう絶対パスに置きかえ）
  const nf = layout({ depth: 0, pagePath: "404.html", title: `ページが見つかりません｜${site.siteName}`, description: site.description, noindex: true, body: `<section class="hero"><h1>ページが見つかりません</h1><p><a class="btn" href="${site.siteUrl}/">トップページへ</a></p></section>` });
  fs.writeFileSync(path.join(OUT, "404.html"), nf.replace(/(href|src)="(assets\/|manifest)/g, `$1="${site.siteUrl}/$2`).replace(/href="(kaikin\/|ryokin\/|guide\/|about\/|policy\/|#areas|)"/g, `href="${site.siteUrl}/$1"`));

  // 検索用データ
  fs.writeFileSync(path.join(OUT, "search-index.json"), JSON.stringify(rivers.flatMap((r) => {
    const pref = prefBySlug[r.prefecture].name;
    return [
      { t: `${r.river}（${pref}）`, p: P.river(r), k: [r.river, pref, coopNames(r), ...(r.rivers || []), ...r.species.map((s) => SP[s.id].name + SP[s.id].kana)].join(" ") },
      ...r.species.filter(hasSpeciesPage).map((s) => ({ t: `${r.river}の${plain(SP[s.id].title)}`, p: P.species(r, s), k: r.river + SP[s.id].name + SP[s.id].kana })),
      ...r.spots.map((sp) => ({ t: `${sp.name}（${sp.place}）`, p: P.spot(r, sp), k: sp.name + sp.place + sp.river + sp.species.map((id) => SP[id].name + SP[id].kana).join("") })),
    ];
  }).concat(topics.map((t) => ({ t: `${t.title}の解禁日一覧`, p: P.topic(t), k: t.title + t.species.map((id) => SP[id].kana).join("") + "解禁" })))));

  // サイトマップ・robots・マニフェスト・ads.txt
  fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${abs("sitemap.xml")}\n`);
  fs.writeFileSync(path.join(OUT, "manifest.webmanifest"), JSON.stringify({ name: site.siteName, short_name: site.siteName, start_url: "./", display: "standalone", background_color: "#f6f8f7", theme_color: "#0d5c63", lang: "ja", icons: [{ src: "assets/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "assets/icon-512.png", sizes: "512x512", type: "image/png" }] }));
  if (site.adsenseClient) fs.writeFileSync(path.join(OUT, "ads.txt"), `google.com, ${site.adsenseClient.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`);
  fs.cpSync(path.join(ROOT, "src", "assets"), path.join(OUT, "assets"), { recursive: true });
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

  const pages = sitemap.length;
  console.log(`✅ 完成！ 検索対象 ${pages} ページを作成しました（河川 ${rivers.length} 件、釣り場 ${rivers.reduce((n, r) => n + r.spots.length, 0)} 件）`);
  if (site.siteUrl.includes("YOUR-GITHUB-NAME")) console.log("⚠️  data/site.json の siteUrl をあなたのサイトのURLに書きかえてください。");
})().catch((e) => { console.error("❌ ページ作成中にエラー:", e); process.exit(1); });
