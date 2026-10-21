/* Fuel Watch TV — app logic. ES5 only, so it runs on older Tizen TVs too. */
(function () {
  "use strict";

  var CFG = window.FUELWATCH_CONFIG || {};
  var SAMPLE_URL = CFG.SAMPLE_URL || "data/fuel.sample.json";
  var CACHE_KEY = "fuelwatch.lastFeed";
  var PAGE_COUNT = 4;
  var page = 0;
  var data = null;
  var loading = false;

  var CHANGELOG = [
    { v: "2.1.2", d: "21 Oct 2026", t: "Checks GitHub for a new version every 5 minutes (set in the manifest) and switches over when the remote has been idle for 5 minutes." },
    { v: "2.1.1", d: "21 Oct 2026", t: "Fix: trend charts and gauge now draw on the 2016 TV browser (SVG built inside a container instead of injected into an empty SVG)." },
    { v: "2.1.0", d: "21 Oct 2026", t: "Burn-in: the header mirrors on every other page, swapping the title and the clock/pills from side to side." },
    { v: "2.0.0", d: "21 Oct 2026", t: "Remote-managed: the app now loads from GitHub, so updates need no reinstall. Burn-in protection: dimmer static header and footer, pixel drift every minute, near-black ambient view overnight." },
    { v: "1.2.0", d: "21 Oct 2026", t: "Pages auto-cycle every 30 seconds; any remote press pauses cycling until 5 minutes without input." },
    { v: "1.1.0", d: "21 Oct 2026", t: "Reads the daily feed from GitHub; app name fixed for the TV's app list; leaner package." },
    { v: "1.0.0", d: "21 Oct 2026", t: "First TV release: Today, Stations, Market and About pages; remote control navigation; offline fallback to the last good feed." }
  ];

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function p1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function delta(d, unit) {
    unit = unit || "p";
    if (d == null || isNaN(d)) return "";
    if (Math.abs(d) < 0.05) return '<span class="delta flat">–</span>';
    if (d > 0) return '<span class="delta up">▲ +' + p1(d) + unit + "</span>";
    return '<span class="delta down">▼ −' + p1(Math.abs(d)) + unit + "</span>";
  }
  function pct(d) {
    if (d == null || isNaN(d)) return "—";
    return (d > 0 ? "+" : d < 0 ? "−" : "") + p1(Math.abs(d)) + "%";
  }
  function store(key, val) { try { window.localStorage.setItem(key, val); } catch (e) {} }
  function load(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }

  function xhrJSON(url, timeoutMs, ok, fail) {
    var x = new XMLHttpRequest();
    var done = false;
    x.open("GET", url, true);
    x.timeout = timeoutMs;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || done) return;
      done = true;
      // status 0 is what local package files return on Tizen
      if ((x.status >= 200 && x.status < 300) || (x.status === 0 && x.responseText)) {
        try { ok(JSON.parse(x.responseText)); } catch (e) { fail("Feed isn't valid JSON"); }
      } else {
        fail("HTTP " + x.status);
      }
    };
    x.ontimeout = function () { if (!done) { done = true; fail("Timed out"); } };
    try { x.send(); } catch (e) { done = true; fail(e.message); }
  }

  // ---------- loading ----------
  function setStatus(text, tone) {
    var s = $("status");
    s.textContent = text;
    s.className = tone || "";
  }

  function refresh() {
    if (loading) return;
    loading = true;
    setStatus("Refreshing…");
    var url = CFG.FEED_URL;
    if (!url) {
      xhrJSON(SAMPLE_URL, 5000, function (d) {
        loading = false; render(d, "sample");
      }, function () { loading = false; setStatus("No feed configured and the bundled sample couldn't load.", "bad"); });
      return;
    }
    var sep = url.indexOf("?") < 0 ? "?" : "&";
    xhrJSON(url + sep + "t=" + new Date().getTime(), 12000, function (d) {
      loading = false;
      store(CACHE_KEY, JSON.stringify(d));
      render(d, "live");
    }, function (err) {
      loading = false;
      var cached = load(CACHE_KEY);
      if (cached) {
        try { render(JSON.parse(cached), "cached", err); return; } catch (e) {}
      }
      xhrJSON(SAMPLE_URL, 5000, function (d) { render(d, "sample", err); },
        function () { setStatus("Couldn't reach the feed (" + err + ") and nothing is saved yet.", "bad"); });
    });
  }

  // ---------- rendering ----------
  function render(d, mode, err) {
    data = d;
    var pill = $("refreshPill");
    pill.textContent = "Updated " + (d.updatedLabel || "—");
    pill.className = "pill pill-refresh";
    var age = d.updatedAt ? (new Date().getTime() - new Date(d.updatedAt).getTime()) / 3600000 : 0;
    if (mode === "live") {
      if (age > 30) { pill.className += " stale"; setStatus("Live feed, but it hasn't refreshed for over a day — check the scheduled task.", "warn"); }
      else setStatus("Live feed · checked " + timeNow());
    } else if (mode === "cached") {
      pill.className += " offline";
      setStatus("Offline (" + err + ") — showing the last saved data.", "warn");
    } else {
      pill.className += " stale";
      setStatus(CFG.FEED_URL ? "Feed unreachable (" + err + ") — showing the bundled sample." : "No feed set yet — showing the bundled sample from " + (d.updatedLabel || "build time") + ".", "warn");
    }
    renderToday(d);
    if (ambientOn) moveAmbient();
    renderStations(d);
    renderMarket(d);
    renderAbout(d);
  }

  function verdictClass(label) {
    var l = (label || "").toLowerCase();
    if (l.indexOf("now") >= 0) return "up";
    if (l.indexOf("soon") >= 0) return "mid";
    return "down";
  }

  function svgWrap(vw, vh, w, h, inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + vw + " " + vh + '" width="' + w + '" height="' + h + '" style="display:block;overflow:visible">' + inner + "</svg>";
  }

  function drawGauge(conf) {
    var cx = 160, cy = 170, r = 130;
    function pt(deg, rad) {
      var a = (deg - 90) * Math.PI / 180;
      return (cx + rad * Math.cos(a)).toFixed(1) + " " + (cy + rad * Math.sin(a)).toFixed(1);
    }
    function arc(a0, a1, color) {
      return '<path d="M ' + pt(a0, r) + " A " + r + " " + r + " 0 0 1 " + pt(a1, r) + '" stroke="' + color + '" stroke-width="22" fill="none" stroke-linecap="butt"/>';
    }
    var angle = -90 + Math.max(0, Math.min(100, conf)) * 1.8;
    var svg = arc(-90, -31, "#3ddb98") + arc(-29, 29, "#f0bd52") + arc(31, 90, "#ff8478");
    svg += '<text x="22" y="188" fill="#95a1b0" font-size="15" font-weight="700" font-family="Plus Jakarta Sans,sans-serif">FALLING</text>';
    svg += '<text x="298" y="188" text-anchor="end" fill="#95a1b0" font-size="15" font-weight="700" font-family="Plus Jakarta Sans,sans-serif">SURGING</text>';
    svg += '<g transform="rotate(' + angle.toFixed(1) + " " + cx + " " + cy + ')">' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + (cy - r + 18) + '" stroke="#eef2f8" stroke-width="6" stroke-linecap="round"/></g>';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="#eef2f8"/>';
    $("gauge").innerHTML = svgWrap(320, 190, 380, 226, svg);
  }

  function tile(label, f, nat) {
    if (!f) return "";
    var diff = f.vsNational;
    var cmp = diff == null ? "" : (diff > 0
      ? '<b class="bad">' + p1(diff) + "p above</b> national avg (" + p1(nat) + "p)"
      : '<b class="good">' + p1(Math.abs(diff)) + "p below</b> national avg (" + p1(nat) + "p)");
    return '<div class="label">' + esc(label) + "</div>" +
      '<div class="value">' + p1(f.price) + "<span>p/L</span>" + delta(f.delta) + "</div>" +
      '<div class="where">' + esc((f.stations || []).join(" & ")) + "</div>" +
      '<div class="compare">' + cmp + (f.note ? " · " + esc(f.note) : "") + "</div>";
  }

  function renderToday(d) {
    var v = d.verdict || {};
    drawGauge(v.confidence || 0);
    var ve = $("verdict");
    ve.textContent = v.label || "—";
    ve.className = "gauge-verdict " + verdictClass(v.label);
    $("verdictSub").textContent = v.previous && v.previous !== v.label ? "Was " + v.previous + " yesterday" : "Unchanged from yesterday";
    $("confPct").textContent = (v.confidence || 0) + "%";
    $("confFill").style.width = (v.confidence || 0) + "%";
    $("headline").textContent = v.headline || "";
    $("summary").textContent = v.summary || "";
    var c = d.cheapest || {}, n = d.national || {};
    $("tilePetrol").innerHTML = tile("Cheapest local unleaded", c.petrol, n.petrol);
    $("tileDiesel").innerHTML = tile("Cheapest local diesel", c.diesel, n.diesel);
    var a = d.advice || {};
    $("advice").innerHTML = "<b>" + esc(a.text) + "</b>" + (a.caveat ? '<span class="caveat">' + esc(a.caveat) + "</span>" : "");
    var b = d.brent || {};
    $("strip").innerHTML =
      stat("UK petrol avg", p1(n.petrol) + "p" + delta(n.petrolDelta)) +
      stat("UK diesel avg", p1(n.diesel) + "p" + delta(n.dieselDelta)) +
      stat("Brent crude", "$" + (b.price != null ? b.price.toFixed(2) : "—") + '<span class="delta ' + (b.day > 0 ? "up" : b.day < 0 ? "down" : "flat") + '">' + pct(b.day) + "</span>") +
      stat("GBP / USD", d.gbpusd ? d.gbpusd.toFixed(4) : "—") +
      stat("Diesel, " + ((d.forecast && d.forecast.horizon) || "2 weeks"), (d.forecast && d.forecast.dieselRange) || "—");
  }
  function stat(k, v) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + v + "</div></div>"; }

  function tagTone(t) {
    var l = t.toLowerCase();
    if (l.indexOf("priciest") >= 0) return "bad";
    if (l.indexOf("cheapest") >= 0) return "good";
    return "info";
  }

  function table(rows, compact) {
    var h = '<div class="trow head"><div class="rank">#</div><div class="name">Station</div><div class="num">Unleaded</div><div class="num">Diesel</div></div>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], tags = "";
      for (var j = 0; j < (r.tags || []).length; j++) tags += '<span class="tag ' + tagTone(r.tags[j]) + '">' + esc(r.tags[j]) + "</span>";
      if (r.stale) tags += '<span class="tag warn">⚠ ' + esc(r.stale) + "</span>";
      h += '<div class="trow' + (i === 0 ? " best" : "") + '">' +
        '<div class="rank">' + esc(r.rank) + "</div>" +
        '<div class="name"><b>' + esc(r.name) + '</b><span class="area">' + esc(r.area) + "</span>" +
        (tags ? '<div class="tags">' + tags + "</div>" : "") + "</div>" +
        '<div class="num">' + p1(r.petrol) + "p" + (compact ? "" : delta(r.petrolDelta)) + "</div>" +
        '<div class="num">' + p1(r.diesel) + "p" + (compact ? "" : delta(r.dieselDelta)) + "</div></div>";
    }
    return '<div class="scroll"><div class="scroll-inner">' + h + "</div></div>";
  }

  function renderStations(d) {
    var s = d.stations || {};
    $("maccTable").innerHTML = table(s.macclesfield || [], false);
    $("angTable").innerHTML = table(s.anglesey || [], true);
    var g = d.regionalDiesel;
    if (g) {
      var mac = (s.macclesfield || [])[0], ang = (s.anglesey || [])[0];
      $("regional").innerHTML =
        '<div class="rt"><div class="label">Macclesfield</div><div class="value">' + p1(g.macclesfield) + '<span>p/L</span></div><div class="where">' + esc(mac ? cheapestNames(s.macclesfield, "diesel") : "") + "</div></div>" +
        '<div class="rt"><div class="label">Anglesey</div><div class="value">' + p1(g.anglesey) + '<span>p/L</span></div><div class="where">' + esc(ang ? cheapestNames(s.anglesey, "diesel") : "") + "</div></div>" +
        "<p>" + (g.gap > 0
          ? esc(g.cheaperArea) + " is <b>" + p1(g.gap) + "p/L</b> cheaper — £" + g.saving50L.toFixed(2) + " on a 50-litre fill."
          : "No difference between the two areas today.") + "</p>";
    }
  }
  function cheapestNames(rows, fuel) {
    var min = Infinity, names = [], i;
    for (i = 0; i < rows.length; i++) if (rows[i][fuel] < min) min = rows[i][fuel];
    for (i = 0; i < rows.length; i++) if (rows[i][fuel] === min) names.push(rows[i].name);
    return names.join(" & ");
  }

  function renderMarket(d) {
    var ev = d.events || [], h = "";
    for (var i = 0; i < ev.length && i < 6; i++) {
      h += '<div class="event"><div class="etop"><div class="etitle">' + esc(ev[i].title) + '</div><span class="tag ' + esc(ev[i].tone || "info") + '">' + esc(ev[i].tag) + "</span></div><p>" + esc(ev[i].text) + "</p></div>";
    }
    $("events").innerHTML = h;
    drawTrend(d.trend || []);
    var b = d.brent || {}, n = d.national || {};
    $("stats").innerHTML =
      line("Brent, week", pct(b.week), b.week) +
      line("Brent, month", pct(b.month), b.month) +
      line("Brent, year", pct(b.year), b.year) +
      line("National avg as of", esc(n.asOf || "—"));
  }
  function line(k, v, signed) {
    var cls = signed == null ? "" : signed > 0 ? " up" : signed < 0 ? " down" : "";
    return '<div class="stat-line"><span class="k">' + esc(k) + '</span><span class="v' + cls + '">' + v + "</span></div>";
  }

  function drawTrend(t) {
    t = t.slice(-21);
    if (t.length < 2) return;
    var P = "#3987e5", D = "#d95926", G = "#199e70";
    $("legend").innerHTML =
      '<span class="key"><span class="line" style="border-top-color:#95a1b0"></span>UK average</span>' +
      '<span class="key"><span class="line dashed" style="border-top-color:#95a1b0"></span>Cheapest local</span>' +
      '<span class="key"><span class="line" style="border-top-color:' + P + '"></span>Petrol</span>' +
      '<span class="key"><span class="line" style="border-top-color:' + D + '"></span>Diesel</span>' +
      '<span class="key"><span class="line" style="border-top-color:' + G + '"></span>Brent</span>';
    $("trendPetrol").innerHTML = svgWrap(640, 118, 660, 122, panel(t, [{ k: "petrol", c: P }, { k: "localPetrol", c: P, dash: true }], 640, 118, "p", false));
    $("trendDiesel").innerHTML = svgWrap(640, 118, 660, 122, panel(t, [{ k: "diesel", c: D }, { k: "localDiesel", c: D, dash: true }], 640, 118, "p", false));
    $("trendBrent").innerHTML = svgWrap(640, 132, 660, 136, panel(t, [{ k: "brent", c: G }], 640, 132, "$", true));
  }

  function panel(t, series, W, H, unit, dates) {
    var L = 64, R = 12, T = 10, B = dates ? 30 : 8;
    var min = Infinity, max = -Infinity, i, s;
    for (s = 0; s < series.length; s++) for (i = 0; i < t.length; i++) {
      var v = t[i][series[s].k];
      if (v == null) continue;
      if (v < min) min = v; if (v > max) max = v;
    }
    var pad = (max - min) * 0.08 || 1; min -= pad; max += pad;
    function x(i) { return L + (W - L - R) * i / (t.length - 1); }
    function y(v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); }
    var out = "", ticks = 2;
    for (i = 0; i <= ticks; i++) {
      var tv = min + (max - min) * i / ticks, yy = y(tv).toFixed(1);
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#283142" stroke-width="1.5"/>';
      out += '<text x="' + (L - 10) + '" y="' + (+yy + 5) + '" text-anchor="end" fill="#95a1b0" font-size="14" font-family="JetBrains Mono,monospace">' + (unit === "$" ? "$" + Math.round(tv) : tv.toFixed(1)) + "</text>";
    }
    if (dates) {
      var idx = [0, Math.floor((t.length - 1) / 2), t.length - 1];
      for (i = 0; i < idx.length; i++) {
        var dt = new Date(t[idx[i]].date + "T12:00:00");
        out += '<text x="' + x(idx[i]).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? "start" : i === 2 ? "end" : "middle") + '" fill="#95a1b0" font-size="14" font-family="Plus Jakarta Sans,sans-serif">' + dt.getDate() + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()] + "</text>";
      }
    }
    for (s = 0; s < series.length; s++) {
      var d = "", started = false;
      for (i = 0; i < t.length; i++) {
        var val = t[i][series[s].k];
        if (val == null) { started = false; continue; }
        d += (started ? " L " : "M ") + x(i).toFixed(1) + " " + y(val).toFixed(1);
        started = true;
      }
      out += '<path d="' + d + '" fill="none" stroke="' + series[s].c + '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"' + (series[s].dash ? ' stroke-dasharray="8 7"' : "") + "/>";
      var last = t[t.length - 1][series[s].k];
      if (last != null) out += '<circle cx="' + x(t.length - 1).toFixed(1) + '" cy="' + y(last).toFixed(1) + '" r="5" fill="' + series[s].c + '"/>';
    }
    return out;
  }

  function renderAbout(d) {
    var src = d.sources || [], h = "", i;
    for (i = 0; i < src.length; i++) h += '<div class="row"><div class="t">' + esc(src[i].name) + '</div><div class="d">' + esc(src[i].detail) + "</div></div>";
    h += '<div class="row"><div class="t">Feed</div><div class="d">' + esc(CFG.FEED_URL || "Not set — bundled sample") + " · " + esc(d.sourceVersion || "") + "</div></div>";
    $("sources").innerHTML = h;
    h = "";
    for (i = 0; i < CHANGELOG.length; i++) h += '<div class="row"><span class="ver">v' + CHANGELOG[i].v + '</span><span class="t">' + CHANGELOG[i].d + '</span><div class="d">' + esc(CHANGELOG[i].t) + "</div></div>";
    $("changelog").innerHTML = h;
    var L = window.FW_LOADER || {};
    $("versions").innerHTML =
      '<div class="row"><div class="t">App v' + esc(CFG.APP_VERSION || CHANGELOG[0].v) + '</div><div class="d">Loaded from ' + esc(L.source || "package") + (L.loadedAt ? " · " + esc(L.loadedAt) : "") + '</div></div>' +
      '<div class="row"><div class="t">Loader v' + esc(L.version || "—") + '</div><div class="d">Installed on the TV; checks GitHub for app updates every ' + (CFG.UPDATE_CHECK_MINUTES || 30) + ' minutes</div></div>';
  }

  // ---------- navigation ----------
  function showPage(n) {
    page = (n + PAGE_COUNT) % PAGE_COUNT;
    var tabs = document.querySelectorAll(".tab"), pages = document.querySelectorAll(".page"), i;
    for (i = 0; i < tabs.length; i++) tabs[i].className = "tab" + (i === page ? " active" : "");
    for (i = 0; i < pages.length; i++) pages[i].className = "page" + (i === page ? " active" : "");
    // burn-in: mirror the header on every other page so its items swap sides
    var hd = document.querySelector("header.top");
    if (hd) hd.className = "top" + (page % 2 === 1 ? " flip" : "");
  }

  function scrollActive(dir) {
    var boxes = document.querySelectorAll(".page.active .scroll");
    for (var i = 0; i < boxes.length; i++) {
      var inner = boxes[i].firstChild;
      var maxOff = Math.max(0, inner.offsetHeight - boxes[i].clientHeight);
      var cur = +(inner.getAttribute("data-off") || 0);
      cur = Math.max(0, Math.min(maxOff, cur + dir * 160));
      inner.setAttribute("data-off", cur);
      inner.style.transform = "translateY(" + (-cur) + "px)";
      inner.style.webkitTransform = "translateY(" + (-cur) + "px)";
    }
  }

  function exitApp() {
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  // ---------- auto page rotation ----------
  var ROTATE_MS = (CFG.ROTATE_SECONDS || 30) * 1000;
  var IDLE_MS = (CFG.IDLE_MINUTES || 5) * 60000;
  var lastInteraction = -Infinity;
  var lastRotate = new Date().getTime();

  function fmtLeft(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return s >= 60 ? Math.floor(s / 60) + ":" + pad2(s % 60) : s + "s";
  }

  function autoTick() {
    var now = new Date().getTime();
    var idleFor = now - lastInteraction;
    var el = $("autoState");
    if (idleFor < IDLE_MS) {
      lastRotate = now;
      el.textContent = "\u23F8 Auto-cycle paused \u00B7 resumes in " + fmtLeft(IDLE_MS - idleFor);
      el.className = "auto paused";
      return;
    }
    if (ambientOn) { lastRotate = now; el.textContent = ""; return; }
    if (now - lastRotate >= ROTATE_MS) {
      lastRotate = now;
      showPage(page + 1);
    }
    el.textContent = "\u25B6 Auto-cycle \u00B7 next page in " + fmtLeft(ROTATE_MS - (now - lastRotate));
    el.className = "auto";
  }

  document.addEventListener("keydown", function (e) {
    lastInteraction = new Date().getTime();
    if (ambientOn) { setAmbient(false); autoTick(); e.preventDefault(); return; }
    autoTick();
    switch (e.keyCode) {
      case 37: showPage(page - 1); break;        // left
      case 39: showPage(page + 1); break;        // right
      case 38: scrollActive(-1); break;          // up
      case 40: scrollActive(1); break;           // down
      case 13: refresh(); break;                 // OK / Enter
      case 403: showPage(0); break;              // red
      case 404: showPage(1); break;              // green
      case 405: showPage(2); break;              // yellow
      case 406: showPage(3); break;              // blue
      case 10009: exitApp(); break;              // BACK
      default: return;
    }
    e.preventDefault();
  });

  function registerKeys() {
    try {
      var keys = ["ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue"];
      for (var i = 0; i < keys.length; i++) window.tizen.tvinputdevice.registerKey(keys[i]);
    } catch (e) {}
  }

  // ---------- clock, scaling, timers ----------
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function timeNow() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function tick() { $("clock").textContent = timeNow(); }

  // ---------- scaling + burn-in protection ----------
  var scale = 1, driftX = 0, driftY = 0, driftStep = 0;
  // a slow loop of small offsets so static edges never sit on the same pixels for long
  var DRIFT = [[0,0],[6,3],[10,8],[6,12],[0,14],[-6,12],[-10,8],[-6,3],[0,-4],[6,-8],[0,-10],[-6,-8]];
  function applyTransform() {
    var t = "translate(" + driftX + "px," + driftY + "px)" + (Math.abs(scale - 1) > 0.01 ? " scale(" + scale + ")" : "");
    var st = $("stage");
    st.style.transform = t;
    st.style.webkitTransform = t;
  }
  function fit() {
    scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    applyTransform();
  }
  function drift() {
    driftStep = (driftStep + 1) % DRIFT.length;
    driftX = DRIFT[driftStep][0]; driftY = DRIFT[driftStep][1];
    applyTransform();
  }

  var ambientOn = false;
  function nightNow() {
    var a = CFG.NIGHT_START, b = CFG.NIGHT_END;
    if (a == null || b == null || a === b) return false;
    var h = new Date().getHours();
    return a < b ? (h >= a && h < b) : (h >= a || h < b);
  }
  function setAmbient(on) {
    ambientOn = on;
    $("ambient").className = on ? "on" : "";
    if (on) moveAmbient();
  }
  function moveAmbient() {
    var c = $("ambCard"), d = data || {}, v = d.verdict || {}, ch = d.cheapest || {};
    c.innerHTML = '<div class="t">Fuel Watch · ' + timeNow() + '</div>' +
      '<div class="v ' + verdictClass(v.label) + '">' + esc(v.label || "—") + '</div>' +
      '<div class="row"><span>Unleaded</span><span>' + (ch.petrol ? p1(ch.petrol.price) + "p" : "—") + '</span></div>' +
      '<div class="row"><span>Diesel</span><span>' + (ch.diesel ? p1(ch.diesel.price) + "p" : "—") + '</span></div>' +
      '<div class="foot">Press any button to wake</div>';
    c.style.left = Math.round(60 + Math.random() * (1920 - 520 - 120)) + "px";
    c.style.top = Math.round(60 + Math.random() * (1080 - 340 - 120)) + "px";
  }
  function ambientTick() {
    var idleFor = new Date().getTime() - lastInteraction;
    var idleMin = CFG.AMBIENT_AFTER_MINUTES || 0;
    var want = (nightNow() || (idleMin > 0 && idleFor >= idleMin * 60000)) && idleFor >= IDLE_MS;
    if (want && !ambientOn) setAmbient(true);
    else if (!want && ambientOn) setAmbient(false);
    else if (ambientOn) moveAmbient();
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  window.addEventListener("resize", fit);

  $("versionPill").textContent = "v" + (CFG.APP_VERSION || CHANGELOG[0].v);
  fit();
  registerKeys();
  tick();
  setInterval(tick, 15000);
  refresh();
  setInterval(refresh, (CFG.REFRESH_MINUTES || 30) * 60000);
  autoTick();
  setInterval(autoTick, 1000);
  setInterval(drift, (CFG.DRIFT_SECONDS || 60) * 1000);

  // ---------- remote updates (faster than the loader's fixed 30-minute check) ----------
  var MANIFEST_URL = CFG.MANIFEST_URL || "https://raw.githubusercontent.com/TommyTwist/fuel-watch-feed/main/app/manifest.json";
  var updateTo = null;
  function checkUpdate() {
    xhrJSON(MANIFEST_URL + "?t=" + new Date().getTime(), 10000, function (m) {
      if (m && m.version && m.version !== CFG.APP_VERSION) updateTo = m.version;
    }, function () {});
  }
  setInterval(function () {
    if (updateTo && new Date().getTime() - lastInteraction >= IDLE_MS) window.location.reload();
  }, 15000);
  setInterval(checkUpdate, (CFG.UPDATE_CHECK_MINUTES || 5) * 60000);
  ambientTick();
  setInterval(ambientTick, 20000);
})();
