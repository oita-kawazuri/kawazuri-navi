/* 川釣りナビ：今日の解禁状況・マイ川・もうすぐ解禁・検索 */
(function () {
  var root = document.body.getAttribute("data-root") || "";
  var now = new Date(Date.now() + (new Date().getTimezoneOffset() + 540) * 60000); // 日本時間
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var today = pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var escH = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  function inRange(k, a, b) { return a <= b ? k >= a && k <= b : k >= a || k <= b; }
  function isOpen(ss) { return !ss || !ss.length || ss.some(function (r) { return inRange(today, r[0], r[1]); }); }
  function md(k) { var p = k.split("-"); return +p[0] + "月" + +p[1] + "日"; }
  function daysTo(k) {
    var y = now.getFullYear(), a = new Date(y, now.getMonth(), now.getDate()), b = new Date(y, +k.slice(0, 2) - 1, +k.slice(3));
    if (b < a) b.setFullYear(y + 1);
    return Math.round((b - a) / 86400000);
  }
  function describe(ss) {
    if (!ss || !ss.length) return "期間の定めはありません";
    var open = ss.filter(function (r) { return inRange(today, r[0], r[1]); })[0];
    if (open) { var left = daysTo(open[1]); return md(open[1]) + "まで" + (left <= 14 ? "（あと" + left + "日）" : ""); }
    var next = ss.map(function (r) { return [daysTo(r[0]), r[0]]; }).sort(function (a, b) { return a[0] - b[0]; })[0];
    return "解禁まであと" + next[0] + "日（" + md(next[1]) + "〜）";
  }
  function parse(el, a) { try { return JSON.parse(el.getAttribute(a)); } catch (e) { return []; } }

  $$(".badge[data-seasons]").forEach(function (el) {
    var s = parse(el, "data-seasons"), ok = isOpen(s);
    el.classList.add(ok ? "ok" : "ng");
    el.textContent = !s.length ? "通年OK" : ok ? "解禁中" : "禁漁中";
    el.title = describe(s);
  });
  $$(".status-text[data-seasons]").forEach(function (el) { el.textContent = describe(parse(el, "data-seasons")); });
  $$("[data-today-date]").forEach(function (el) { el.textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日"; });
  $$("[data-today-list]").forEach(function (box) {
    box.querySelector(".today-body").innerHTML = parse(box, "data-today-list").map(function (x) {
      var ok = isOpen(x.s);
      return '<span class="chip ' + (ok ? "ok" : "ng") + '" title="' + escH(describe(x.s)) + '">' + (ok ? "○ " : "× ") + escH(x.n) + "</span>";
    }).join("");
  });
  $$("[data-open-count]").forEach(function (el) {
    var list = parse(el, "data-open-count"), n = list.filter(isOpen).length;
    el.textContent = n + " / " + list.length + "種";
  });
  $$("[data-closed-count]").forEach(function (el) {
    var n = parse(el, "data-closed-count").filter(function (p) { return !p[0] || inRange(today, p[0], p[1]); }).length;
    el.textContent = "今日 " + n + "か所";
  });
  $$(".closed-now[data-from]").forEach(function (el) { if (inRange(today, el.getAttribute("data-from"), el.getAttribute("data-to"))) el.classList.add("on"); });
  $$(".bar").forEach(function (bar) { var m = bar.children[now.getMonth()]; if (m) m.classList.add("now"); });
  $$("time[data-rel]").forEach(function (el) {
    var t = new Date(el.getAttribute("data-rel")), min = Math.round((Date.now() - t) / 60000);
    if (!isNaN(min) && min >= 0) el.textContent += min < 90 ? "（" + min + "分前）" : "（" + Math.round(min / 60) + "時間前）";
    if (min > 360) el.parentNode.classList.add("stale");
  });

  // リンクをコピー
  $$("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function () { b.textContent = "コピーしました"; });
    });
  });

  // マイ川（このブラウザだけに保存）
  function loadFav() { try { return JSON.parse(localStorage.getItem("kn-fav") || "[]"); } catch (e) { return []; } }
  function saveFav(v) { try { localStorage.setItem("kn-fav", JSON.stringify(v)); } catch (e) {} }
  $$("[data-fav]").forEach(function (b) {
    var id = b.getAttribute("data-fav"), name = b.getAttribute("data-fav-name");
    var paint = function () {
      var on = loadFav().some(function (f) { return f.id === id; });
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.textContent = on ? "★ マイ川に登録済み" : "☆ マイ川に登録";
    };
    paint();
    b.addEventListener("click", function () {
      var list = loadFav(), i = list.findIndex(function (f) { return f.id === id; });
      if (i >= 0) list.splice(i, 1); else list.unshift({ id: id, name: name });
      saveFav(list.slice(0, 20)); paint();
    });
  });
  var my = document.getElementById("mylist");
  if (my) {
    var favs = loadFav();
    if (favs.length) {
      document.getElementById("mylist-body").innerHTML = favs.map(function (f) {
        return '<a class="card" href="' + root + escH(f.id) + '/"><strong class="card-title">★ ' + escH(f.name) + "</strong><span class=\"small\">今日の川の状態・解禁日を見る</span></a>";
      }).join("");
      my.hidden = false;
    }
  }

  // もうすぐ解禁・もうすぐ終了（30日以内）
  var sd = document.getElementById("season-data"), ub = document.getElementById("upcoming-body");
  if (sd && ub) {
    var items = [];
    try {
      JSON.parse(sd.textContent).forEach(function (r) {
        r.sp.forEach(function (s) {
          s.s.forEach(function (rg) {
            var open = inRange(today, rg[0], rg[1]);
            var d = daysTo(open ? rg[1] : rg[0]);
            if (d <= 30) items.push({ d: d, open: open, html: '<a href="' + root + s.u + '"><strong>' + escH(r.n) + "の" + escH(s.n) + "</strong></a>" });
          });
        });
      });
    } catch (e) {}
    items.sort(function (a, b) { return a.d - b.d; });
    ub.innerHTML = items.length ? items.slice(0, 10).map(function (x) {
      return "<li>" + '<span class="badge ' + (x.open ? "ng" : "ok") + '">' + (x.open ? (x.d === 0 ? "今日で終了" : "あと" + x.d + "日で終了") : (x.d === 0 ? "今日解禁" : "あと" + x.d + "日で解禁")) + "</span> " + x.html + "</li>";
    }).join("") : '<li class="small">30日以内に解禁・終了する魚はありません。</li>';
  }

  // 検索
  var q = document.getElementById("q"), box = document.getElementById("results");
  if (q && box) {
    var index = null;
    var load = function () {
      if (index) return Promise.resolve(index);
      return fetch(root + "search-index.json").then(function (r) { return r.json(); }).then(function (d) { index = d; return d; });
    };
    q.addEventListener("focus", load);
    q.addEventListener("input", function () {
      var v = q.value.trim();
      if (!v) { box.hidden = true; return; }
      load().then(function (idx) {
        var hits = idx.filter(function (x) { return (x.t + x.k).indexOf(v) >= 0; });
        box.innerHTML = hits.length ? hits.slice(0, 12).map(function (h) { return '<a href="' + root + h.p + '">' + escH(h.t) + "</a>"; }).join("")
          : '<div class="none">見つかりませんでした。都道府県から探してください。</div>';
        box.hidden = false;
      });
    });
  }
})();
