/* Box Stack colours: box-stack/colours/.
 *
 * One page with three things to do, a tab each: go through the palettes **in the game** now and
 * keep or remove each, vote on **new palettes** other players made, and **make your own**. All
 * three happen on the same stage: Box Stack itself running in the frame — the playable, as
 * demo.html?host=palette — wearing the palette being decided, on a tower that shows every colour
 * in its share, with a hand to play from so a crate can be seen on the crane and over its landing
 * outline. Nothing on the page says which palettes are good or would be used; that is the vote.
 *
 * The page reads palettes.json (the new palettes on offer, and the ones already in the game) and
 * talks to one small Cloudflare Worker for everything shared between visitors. Its source and the
 * steps to set it up live in the Boxstack repository, tools/palette-votes/. Nothing here depends
 * on the Worker being reachable: a vote made offline waits on this device and is sent when it can
 * be. A picture opened to take colours from is read in the browser and never leaves it.
 */
(function () {
  "use strict";

  /** Where the Worker lives; tools/palette-votes/local.mjs points a local copy of the page elsewhere. */
  var API = window.PALETTE_VOTE_API || "https://palette-votes.joshua-e59.workers.dev";

  var ROOT = "../../";
  /** The game, in the mode that takes a palette from this page and says what was tapped. */
  var GAME_URL = ROOT + "demo.html?host=palette&pick=1";
  /** Messages go to this site only; a page opened from a file has no origin to name. */
  var HERE = location.origin === "null" ? "*" : location.origin;

  /** A palette someone makes starts with three crate colours and can have up to ten, as the game's. */
  var MIN_CRATES = 3, MAX_CRATES = 10;
  /** The names the Worker has to take before a vote made here is sent: see `names` in worker.js. */
  var NAMES = 2;
  /** The same key as the page before this one, so a returning voter keeps what they have said. */
  var STORE = "tg-palettes-v1";
  var CLEANSE_MS = 800;
  /** The most of a long list of new palettes the review shows: the latest decided. */
  var REVIEW_MAX = 120;

  var MODES = ["current", "new", "make"];

  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------------ colour

  function rgb(hex) {
    var n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(r, g, b) {
    return [r, g, b].map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    }).join("").toUpperCase();
  }
  function hsl(hex) {
    var c = rgb(hex).map(function (v) { return v / 255; });
    var max = Math.max.apply(null, c), min = Math.min.apply(null, c), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === c[0]) h = (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0);
      else if (max === c[1]) h = (c[2] - c[0]) / d + 2;
      else h = (c[0] - c[1]) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function fromHsl(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  function randomHex() {
    var b = new Uint8Array(3);
    crypto.getRandomValues(b);
    return toHex(b[0], b[1], b[2]);
  }
  /** Whatever a browser's colour tools hand back — "#rrggbb", "#rgb" or "rgb(…)" — as six hex digits. */
  function parseColour(text) {
    var v = String(text || "").trim();
    var m = /^#?([0-9a-f]{6})$/i.exec(v);
    if (m) return m[1].toUpperCase();
    m = /^#?([0-9a-f]{3})$/i.exec(v);
    if (m) return m[1].split("").map(function (c) { return c + c; }).join("").toUpperCase();
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
    if (m) return toHex(+m[1], +m[2], +m[3]);
    return null;
  }

  // ------------------------------------------------------------------ palettes

  /** A palette as palettes.json packs it: its background, then its crates, as six-digit hex. */
  function unpack(s) {
    var all = s.match(/[0-9A-F]{6}/g);
    return { field: all[0], crates: all.slice(1) };
  }
  /**
   * Its name, exactly as the Worker checks it: the background, then the crates sorted, so the same
   * crates in another order are the same palette. The game's own keep their repeats: a colour has
   * as many of their ten slots as it covers of the thing the palette is of.
   */
  function nameOf(p) {
    return p.field + ":" + p.crates.slice().sort().join("-");
  }
  /** A name back into a palette, or null if it is not one this page makes. */
  function fromName(name) {
    var m = /^([0-9A-F]{6}):([0-9A-F]{6}(?:-[0-9A-F]{6}){0,9})$/.exec(name);
    return m ? { field: m[1], crates: m[2].split("-") } : null;
  }
  /** Each colour once, in the order it first appears. */
  function distinct(list) {
    return list.filter(function (c, i) { return list.indexOf(c) === i; });
  }
  /** A random order that is the same every time for the same [seed]: mulberry32 over a hash. */
  function seededShuffle(list, seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    var next = function () {
      h = (h + 0x6D2B79F5) | 0;
      var t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    var out = list.slice();
    for (var j = out.length - 1; j > 0; j--) {
      var k = Math.floor(next() * (j + 1)), x = out[j];
      out[j] = out[k]; out[k] = x;
    }
    return out;
  }

  /*
   * A small tower on the palette's own background, for the summaries: loose crates in their
   * piece's colour, and two finished rows, each entirely the colour of the piece that closed it.
   * Top row first. Digits are crate slots, taken round the palette's crates the way the game deals
   * them, so a palette of three shows three and the game's ten-slot ones show their proportions;
   * a, b are finished rows; dots are air.
   */
  var SHAPE = [
    "...66...",
    ".555.77.",
    ".4448899",
    "bbbbbbbb",
    "01.12233",
    "aaaaaaaa",
  ];

  function drawTower(el, p) {
    el.style.background = "#" + p.field;
    var cells = [];
    SHAPE.forEach(function (row) {
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch === ".") { cells.push('<i class="gap"></i>'); continue; }
        var slot = ch === "a" ? 0 : ch === "b" ? 3 : Number(ch);
        cells.push('<i style="background:#' + p.crates[slot % p.crates.length] + '"></i>');
      }
    });
    el.innerHTML = cells.join("");
  }

  function miniTower(p) {
    var el = document.createElement("div");
    el.className = "tower mini";
    el.setAttribute("aria-hidden", "true");
    drawTower(el, p);
    return el;
  }
  function describe(p) {
    return "background #" + p.field + ", crates #" + distinct(p.crates).join(", #");
  }

  // ------------------------------------------------------------------ what this browser remembers

  var memory = {
    visitor: null, votes: {}, dislikes: {}, judged: {}, outbox: [], draft: null,
    cleanser: false, introduced: false, keepsSent: false,
  };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") {
      memory.visitor = saved.visitor || null;
      memory.votes = saved.votes || {};
      memory.dislikes = saved.dislikes || {};
      memory.judged = saved.judged || {};
      memory.outbox = Array.isArray(saved.outbox) ? saved.outbox : [];
      memory.cleanser = saved.cleanser === true;
      memory.keepsSent = saved.keepsSent === true;
      // Somebody who used the page before it was one page has already met it.
      memory.introduced = saved.introduced === true || Boolean(saved.visitor);
      var d = saved.draft;
      memory.draft = Array.isArray(d) && d.length >= 1 + MIN_CRATES && d.length <= 1 + MAX_CRATES &&
        d.every(function (c) { return /^[0-9A-F]{6}$/.test(c); }) ? d : null;
    }
  } catch (e) { /* private window or blocked storage: start fresh, which is fine */ }

  if (!memory.visitor) memory.visitor = newVisitor();

  function newVisitor() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function remember() {
    try {
      localStorage.setItem(STORE, JSON.stringify(memory, function (k, v) { return k === "onDone" ? undefined : v; }));
    } catch (e) { /* nothing worth failing over */ }
  }

  // ------------------------------------------------------------------ talking to the Worker

  var syncEl = $("sync");

  function send(path, body) {
    memory.outbox.push({ path: path, body: body });
    remember();
    return flush();
  }

  /*
   * **Nothing is sent to a Worker that would refuse it.** The page is published by a push and the
   * Worker by a paste, so for a while one can be newer than the other; a vote refused in that time
   * would be gone. Until the Worker says it takes this page's names, votes wait on this device.
   */
  var workerTakes = false, workerKeeps = false;
  async function workerReady() {
    if (!workerTakes) {
      var h = await getJSON("/health");
      workerTakes = Boolean(h && h.names >= NAMES);
      workerKeeps = Boolean(h && h.keeps);
    }
    return workerTakes;
  }

  /*
   * **Keeps said before the Worker recorded them are sent once it does.** A keep on a palette in
   * the game used to reach the Worker only as a removal taken back, so one with no removal before
   * it left no trace, and a palette kept looked the same as one never seen. Once the Worker says it
   * records keeps, every answer this browser holds on the game's palettes is sent again, once: the
   * Worker keeps the newest answer, so sending one it has already is harmless.
   */
  async function catchUpKeeps() {
    if (memory.keepsSent || !(await workerReady()) || !workerKeeps) return;
    Object.keys(memory.judged).forEach(function (name) {
      if (!fromName(name)) return;     // a name from before palettes had ten slots
      memory.outbox.push({ path: "/dislike", body: { palette: name, dislike: Boolean(memory.dislikes[name]), visitor: memory.visitor } });
    });
    memory.keepsSent = true;
    remember();
    flush();
  }

  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (async function () {
      if (memory.outbox.length && !(await workerReady())) {
        syncEl.textContent = "The vote box is being updated. Your choices are saved here and will be sent when it's ready";
        return;
      }
      while (memory.outbox.length) {
        var next = memory.outbox[0];
        var res;
        try {
          res = await fetch(API + next.path, {
            method: "POST",
            // text/plain keeps this a simple request: no preflight, one round trip.
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(next.body),
          });
        } catch (e) {
          syncEl.textContent = "Can't reach the vote box right now. Your choices are saved here and will be sent when it's back";
          return;
        }
        if (res.status === 429 || res.status >= 500) {
          syncEl.textContent = "The vote box is busy. Your choices are saved here and will be sent shortly";
          return;
        }
        // Anything else is settled, sent or refused, and waiting would not change the answer.
        memory.outbox.shift();
        remember();
        if (next.onDone) next.onDone(res);
      }
      syncEl.textContent = "";
    })().finally(function () { flushing = null; });
    return flushing;
  }

  setInterval(function () { if (memory.outbox.length) flush(); }, 30000);
  addEventListener("online", flush);

  async function getJSON(path) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 8000);
    try {
      var res = await fetch(API + path, { signal: ctl.signal });
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ the game

  var frame = $("game");
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var gameReady = false;
  var shown = null;         // the palette the game is wearing
  var shownFresh = false;   // whether it should start again on its own tower when it is next sent

  /**
   * Dress the game in [p]. [fresh] starts it on that palette's own tower, as a new palette in the
   * vote should be; without it the tower stays and is repainted, as an edit in the maker should
   * be. It is kept, and sent again whenever the game says it is ready.
   */
  function wear(p, fresh) {
    shown = { field: p.field, crates: p.crates.slice() };
    if (fresh) shownFresh = true;
    post();
  }
  function post() {
    if (!shown || !gameReady || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: "boxstack:palette", field: shown.field, crates: shown.crates.slice(), fresh: shownFresh }, HERE);
    shownFresh = false;
  }

  addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow || (HERE !== "*" && e.origin !== location.origin)) return;
    var d = e.data || {};
    if (d.type === "boxstack:ready") {
      // Also after the tower goes over and the game starts again.
      gameReady = true;
      $("stage-loading").hidden = true;
      shownFresh = false;
      post();
      // Keys, a pasted picture and a dropped one mean the same over the game as beside it.
      try {
        var w = frame.contentWindow;
        w.addEventListener("keydown", onKey);
        w.addEventListener("paste", onPaste);
        w.addEventListener("dragover", onDragOver);
        w.addEventListener("dragleave", onDragLeave);
        w.addEventListener("drop", onDrop);
      } catch (err) { /* they stay on the page */ }
    } else if (d.type === "boxstack:pick" && mode === "make" && d.slot >= 0 && d.slot < made.colours.length) {
      made.slot = d.slot;
      openEditor();
      paintMaker(true);
    }
  });

  // ------------------------------------------------------------------ tabs

  var loaded = false;
  var mode = null;
  var tabs = MODES.map(function (m) { return $("tab-" + m); });
  var ASK = {
    current: { ask: "Keep this one in the game?", no: "Remove", yes: "Keep" },
    new: { ask: "Want this one in the game?", no: "No", yes: "Yes" },
  };

  function modeFromHash() {
    var id = location.hash.slice(1);
    // The addresses the page had before it was one page still arrive at the right place.
    if (id === "game") return "current";
    if (id === "vote") return "new";
    return MODES.indexOf(id) >= 0 ? id : null;
  }

  function show(next, focusTab) {
    if (!loaded) return;
    var changed = next !== mode;
    mode = next;
    document.body.dataset.mode = next;
    tabs.forEach(function (t) {
      var on = t.dataset.mode === next;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focusTab) t.focus();
    });
    $("panel").setAttribute("aria-labelledby", "tab-" + next);
    if (location.hash.slice(1) !== next) history.replaceState(null, "", "#" + next);
    menu(false);
    $("cleanser").hidden = true;
    locked = false;
    $("bar-decide").hidden = next === "make";
    $("bar-make").hidden = next !== "make";
    $("stage-undo").hidden = next === "make";
    $("opt-review").hidden = next === "make";
    $("opt-tweak").hidden = next === "make";
    $("stage-menu").hidden = next === "make";
    if (next !== "make") closePicker();
    if (next === "make") {
      $("stage-count").textContent = "";
      $("stage-done").hidden = true;
      $("stage-tag").hidden = true;
      paintMaker(true, changed);
    } else {
      $("ask-text").textContent = ASK[next].ask;
      $("no-text").textContent = ASK[next].no;
      $("yes-text").textContent = ASK[next].yes;
      paintRun(lists[next], changed);
    }
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { show(t.dataset.mode); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (e.key === "Home") d = -i; else if (e.key === "End") d = tabs.length - 1 - i;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      show(tabs[(i + d + tabs.length) % tabs.length].dataset.mode, true);
    });
  });
  addEventListener("hashchange", function () {
    var m = modeFromHash();
    if (m && m !== mode) show(m);
  });

  // ------------------------------------------------------------------ the options

  function menu(open) {
    $("stage-options").hidden = !open;
    $("stage-menu").setAttribute("aria-expanded", open ? "true" : "false");
  }
  $("stage-menu").addEventListener("click", function () { menu($("stage-options").hidden); });
  var cleanserBox = $("opt-cleanser");
  cleanserBox.checked = memory.cleanser;
  cleanserBox.addEventListener("change", function () { memory.cleanser = cleanserBox.checked; remember(); });
  $("opt-tweak").addEventListener("click", function () {
    menu(false);
    if (!shown) return;
    loadMaker(shown);
    show("make");
  });
  $("opt-review").addEventListener("click", function () {
    menu(false);
    if (mode !== "make") review(lists[mode], false);
  });
  document.addEventListener("click", function (e) {
    if (!$("stage-options").hidden && !e.target.closest("#stage-options, #stage-menu")) menu(false);
  });

  /*
   * **The palette cleanser, if asked for, and never unless asked.** A plain mid-grey screen for a
   * moment between palettes, so the next one is not seen through the afterimage of the last. The
   * next palette is already on the game underneath it, and a tap lifts it early.
   */
  var locked = false;       // while the palette cleanser is up, nothing can be decided
  function advance(paint) {
    if (!memory.cleanser) { paint(); return; }
    var veil = $("cleanser");
    locked = true;
    veil.classList.remove("out");
    veil.hidden = false;
    paint();
    var lifted = false, timer = null;
    var lift = function () {
      if (lifted) return;
      lifted = true;
      clearTimeout(timer);
      veil.classList.add("out");
      setTimeout(function () { veil.hidden = true; locked = false; }, still ? 0 : 200);
    };
    timer = setTimeout(lift, CLEANSE_MS);
    veil.onclick = lift;
  }

  // ------------------------------------------------------------------ going through a list
  /*
   * **Both votes go through their whole list, one palette at a time, never one twice.** A list is
   * an order fixed when it is first opened — the ones this browser has already answered are left
   * out — and the page walks it from the start to the end. There are no batches: the count says
   * how far through the whole list you are, and you can stop anywhere and carry on next time from
   * where you left off.
   *
   * The game's own come in an order of this visitor's own, the same on every visit, so a visitor
   * who stops early has still covered palettes that others who stopped early may not have. New
   * palettes come least-voted first, so every one gets its turn.
   */

  function List(kind) {
    this.kind = kind;
    this.all = [];        // every palette there is on this list
    this.queue = null;    // the order being walked, built when the list is first opened
    this.at = 0;
    this.trail = [];      // positions decided, newest last, for undo
  }
  /** Whether this browser has already answered [p] on this list. */
  List.prototype.answered = function (p) {
    return this.kind === "current" ? nameOf(p) in memory.judged : nameOf(p) in memory.votes;
  };
  /** Whether the answer was yes: keep it in the game, or put it in. */
  List.prototype.yes = function (p) {
    return this.kind === "current" ? !memory.dislikes[nameOf(p)] : memory.votes[nameOf(p)] === 1;
  };
  List.prototype.build = function (again) {
    var self = this;
    var order = this.kind === "current"
      ? seededShuffle(this.all, memory.visitor)
      : seededShuffle(this.all, memory.visitor).sort(function (a, b) {
          return (counts[nameOf(a)] || 0) - (counts[nameOf(b)] || 0);   // stable, so ties keep the shuffle
        });
    this.queue = again ? order : order.filter(function (p) { return !self.answered(p); });
    this.at = 0;
    this.trail = [];
  };
  /** How many of the whole list have been answered before the one on the game now. */
  List.prototype.before = function () {
    return this.all.length - this.queue.length + this.at;
  };
  List.prototype.current = function () {
    return this.queue && this.at < this.queue.length ? this.queue[this.at] : null;
  };

  var lists = { current: new List("current"), new: new List("new") };
  var counts = {};        // votes each new palette has had, from the Worker; never how many yeses

  function paintCounts() {
    ["current", "new"].forEach(function (k) {
      var l = lists[k];
      var done = l.all.filter(function (p) { return l.answered(p); }).length;
      $("count-" + k).textContent = l.all.length ? done + "/" + l.all.length : "";
    });
  }

  /** Put the list's palette on the game, or say the list is done. [fresh]: a new palette on show. */
  function paintRun(list, fresh) {
    if (mode !== list.kind) return;
    if (!list.queue) list.build(false);
    paintCounts();
    $("stage-undo").disabled = list.trail.length === 0;
    var p = list.current();
    if (!p) { finish(list); return; }
    $("stage-done").hidden = true;
    $("bar-decide").classList.remove("idle");
    var before = shown && nameOf(shown);
    wear(p, fresh || before !== nameOf(p));
    $("stage-tag").hidden = !p.player;
    $("stage-count").textContent = (list.before() + 1) + " of " + list.all.length;
    $("opt-review").disabled = list.all.every(function (q) { return !list.answered(q); });
  }

  function answer(list, yes) {
    var p = list.current();
    if (!p) return;
    var name = nameOf(p);
    if (list.kind === "current") {
      if (yes) delete memory.dislikes[name]; else memory.dislikes[name] = 1;
      memory.judged[name] = 1;
      send("/dislike", { palette: name, dislike: !yes, visitor: memory.visitor });
    } else {
      memory.votes[name] = yes ? 1 : 0;
      send("/vote", { palette: name, keep: yes, visitor: memory.visitor });
    }
    list.trail.push(list.at);
    list.at++;
    if (list.current()) advance(function () { paintRun(list, true); }); else paintRun(list, true);
  }

  /** The last one comes back to be answered again; the next answer replaces the old one. */
  function undo() {
    if (locked || mode === "make") return;
    var list = lists[mode];
    if (!list.trail.length) return;
    list.at = list.trail.pop();
    paintRun(list, true);
  }

  // ------------------------------------------------------------------ the summary

  /** The end of a list: what was said, and what next. */
  function finish(list) {
    $("stage-count").textContent = "";
    $("stage-tag").hidden = true;
    if (list.kind === "current") {
      var out = list.all.filter(function (p) { return list.answered(p) && !list.yes(p); }).length;
      summary(list, list.all.length
        ? "That's all " + list.all.length + " in the game. Thank you!"
        : "There's nothing in the game to vote on right now",
        out ? "You'd take out " + out + ". Tap one to change your mind" : "You'd keep every one. Tap one to change your mind",
        { label: "Go again", act: function () { list.build(true); paintRun(list, true); } },
        { label: "New palettes", act: function () { show("new"); } });
    } else {
      var yes = list.all.filter(function (p) { return list.answered(p) && list.yes(p); }).length;
      summary(list, list.all.length
        ? "You've seen every new palette there is. Thank you!"
        : "There are no new palettes to vote on yet",
        list.all.length ? "Yes to " + yes + ". Tap one to change your mind" : "Why not make the first?",
        { label: "Make your own", act: function () { show("make"); } },
        list.all.length ? { label: "Go again", act: function () { list.build(true); paintRun(list, true); } } : null);
    }
  }

  /** Your choices so far, from the menu: the same summary, and back to where you were. */
  function review(list) {
    var left = list.queue ? list.queue.length - list.at : 0;
    summary(list, "Your choices so far",
      "Tap one to change your mind. " + left + " still to go",
      { label: "Carry on", act: function () { $("stage-done").hidden = true; paintRun(list, false); } }, null, true);
  }

  /**
   * The summary over the game: every palette answered on this list as a little tower, marked with
   * the answer, which a tap changes. Then [more], the main way on, and [other].
   */
  function summary(list, text, note, other, more, reviewing) {
    $("stage-done").hidden = false;
    $("bar-decide").classList.add("idle");
    $("done-text").textContent = text;
    $("done-note").hidden = !note;
    $("done-note").textContent = note || "";
    var grid = $("done-grid");
    grid.innerHTML = "";
    var answered = list.all.filter(function (p) { return list.answered(p); });
    if (list.kind === "new") answered = answered.slice(-REVIEW_MAX);
    grid.hidden = !answered.length;
    answered.forEach(function (p) { grid.appendChild(answerTile(list, p)); });
    var otherB = $("done-other"), moreB = $("done-more");
    otherB.hidden = !other;
    moreB.hidden = !more;
    if (other) { otherB.textContent = other.label; otherB.onclick = other.act; }
    if (more) { moreB.textContent = more.label; moreB.onclick = more.act; }
    otherB.classList.toggle("primary", !more);
    (more ? moreB : otherB).focus({ preventScroll: true });
    if (!reviewing && mode === list.kind) $("stage-undo").disabled = list.trail.length === 0;
  }

  /** One answered palette, marked with its answer; tapping it changes it, on the Worker too. */
  function answerTile(list, p) {
    var b = document.createElement("button");
    b.className = "pick";
    var label = list.kind === "current" ? ["Remove", "Keep"] : ["No", "Yes"];
    var paint = function () {
      var yes = list.yes(p);
      b.classList.toggle("no", !yes);
      b.setAttribute("aria-pressed", yes ? "true" : "false");
      b.setAttribute("aria-label", (list.kind === "current" ? "Keep " : "Yes to ") + describe(p));
      badge.textContent = label[yes ? 1 : 0];
    };
    b.appendChild(miniTower(p));
    var badge = document.createElement("span");
    badge.className = "badge";
    b.appendChild(badge);
    b.addEventListener("click", function () {
      var name = nameOf(p), yes = !list.yes(p);
      if (list.kind === "current") {
        if (yes) delete memory.dislikes[name]; else memory.dislikes[name] = 1;
        send("/dislike", { palette: name, dislike: !yes, visitor: memory.visitor });
      } else {
        memory.votes[name] = yes ? 1 : 0;
        send("/vote", { palette: name, keep: yes, visitor: memory.visitor });
      }
      paint();
    });
    paint();
    return b;
  }

  // ------------------------------------------------------------------ deciding, whichever way

  function decide(yes) {
    if (locked || mode === "make" || !$("stage-done").hidden) return;
    answer(lists[mode], yes);
  }
  $("decide-yes").addEventListener("click", function () { decide(true); });
  $("decide-no").addEventListener("click", function () { decide(false); });
  $("stage-undo").addEventListener("click", undo);

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ($("about").open) return;
    if (e.key === "Escape") {
      if (!$("stage-options").hidden) { e.preventDefault(); menu(false); }
      else if (!$("picker").hidden) { e.preventDefault(); closePicker(); }
      return;
    }
    if (mode === "make" || (e.target.closest && e.target.closest("input, textarea, [role=tab]"))) return;
    if (e.key === "ArrowRight") { e.preventDefault(); decide(true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); decide(false); }
    else if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
  }
  addEventListener("keydown", onKey);

  // ------------------------------------------------------------------ making one

  var made = { colours: [], slot: 0 };
  var slotsEl = $("make-slots");
  var picker = $("make-picker");
  var hexIn = $("make-hex");
  var hIn = $("make-h"), sIn = $("make-s"), lIn = $("make-l");

  function makerPalette() {
    return { field: made.colours[0], crates: made.colours.slice(1) };
  }
  function slotName(i) { return i === 0 ? "the background" : "crate " + i; }

  /**
   * Starts the maker on [p]: its background and each of its crate colours once — the game's own
   * give a colour several slots, and a palette made here is each colour once — at least three, and
   * no more than [crates] when a fresh start asks for fewer. A draft comes back [exactly] as it was
   * left, repeats and all, since it is still being made.
   */
  function loadMaker(p, crates, exactly) {
    var own = exactly ? p.crates.slice() : distinct(p.crates).slice(0, crates || MAX_CRATES);
    while (own.length < MIN_CRATES) own.push(randomHex());
    made.colours = [p.field].concat(own);
    made.slot = 0;
    $("make-status").textContent = "";
    if (mode === "make") paintMaker(true, true);
  }

  function paintMaker(syncSliders, fresh) {
    slotsEl.innerHTML = "";
    made.colours.forEach(function (c, i) {
      var b = document.createElement("button");
      b.className = "chip";
      b.style.background = "#" + c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", i === made.slot ? "true" : "false");
      b.setAttribute("aria-label", (i === 0 ? "Background" : "Crate " + i) + ", #" + c);
      b.tabIndex = i === made.slot ? 0 : -1;
      b.addEventListener("click", function () { made.slot = i; openEditor(); paintMaker(true); });
      b.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        made.slot = (made.slot + d + made.colours.length) % made.colours.length;
        paintMaker(true);
        slotsEl.querySelectorAll('[role="radio"]')[made.slot].focus();
      });
      var label = document.createElement("span");
      label.textContent = i === 0 ? "Background" : String(i);
      label.setAttribute("aria-hidden", "true");
      var cell = document.createElement("span");
      cell.className = "chip-cell" + (i === 0 ? " field" : "");
      cell.appendChild(b);
      cell.appendChild(label);
      slotsEl.appendChild(cell);
    });
    // Three crate colours to start, and room for more up to the game's ten.
    if (made.colours.length - 1 < MAX_CRATES) {
      var add = document.createElement("button");
      add.className = "chip add";
      add.setAttribute("aria-label", "Add a crate colour");
      add.innerHTML = '<span aria-hidden="true">+</span>';
      add.addEventListener("click", addCrate);
      var addLabel = document.createElement("span");
      addLabel.textContent = "Add";
      addLabel.setAttribute("aria-hidden", "true");
      var addCell = document.createElement("span");
      addCell.className = "chip-cell";
      addCell.appendChild(add);
      addCell.appendChild(addLabel);
      slotsEl.appendChild(addCell);
    }
    var hex = made.colours[made.slot];
    picker.value = "#" + hex.toLowerCase();
    if (document.activeElement !== hexIn) hexIn.value = "#" + hex;
    if (syncSliders) {
      var v = hsl(hex);
      hIn.value = Math.round(v[0]); sIn.value = Math.round(v[1]); lIn.value = Math.round(v[2]);
    }
    paintTracks(hex);
    $("make-as-field").hidden = made.slot === 0;
    $("make-remove").hidden = made.slot === 0 || made.colours.length - 1 <= MIN_CRATES;
    $("picker-hint").textContent = "Tap the picture to set " + slotName(made.slot);
    // Every colour different is the one thing a palette has to be.
    var same = new Set(made.colours).size < made.colours.length;
    var submit = $("make-submit");
    submit.disabled = same;
    submit.textContent = same ? "Two of the colours are the same" : "Add it to the vote";
    if (mode === "make") wear(makerPalette(), fresh);
    keepDraft();
  }

  /* Each slider's track shows what it reaches from here: every hue, grey to full colour, black to
   * white through this one. The thumb wears the colour itself. */
  function paintTracks(hex) {
    var h = +hIn.value, s = +sIn.value, l = +lIn.value;
    var hues = [0, 60, 120, 180, 240, 300, 360].map(function (x) { return "hsl(" + x + ",90%,55%)"; });
    hIn.style.setProperty("--track", "linear-gradient(to right," + hues.join(",") + ")");
    sIn.style.setProperty("--track", "linear-gradient(to right,hsl(" + h + ",0%," + l + "%),hsl(" + h + ",100%," + l + "%))");
    lIn.style.setProperty("--track", "linear-gradient(to right,#000,hsl(" + h + "," + s + "%,50%),#fff)");
    [hIn, sIn, lIn].forEach(function (r) { r.style.setProperty("--thumb", "#" + hex); });
  }

  function setSlot(hex, syncSliders) {
    made.colours[made.slot] = hex.toUpperCase();
    $("make-status").textContent = "";
    paintMaker(syncSliders);
  }

  /** The editor folds away so the game can have the screen, and opens when a colour is chosen. */
  function fold(folded) {
    $("make-body").hidden = folded;
    $("make-fold").textContent = folded ? "Show" : "Hide";
    $("make-fold").setAttribute("aria-expanded", folded ? "false" : "true");
  }
  $("make-fold").addEventListener("click", function () { fold(!$("make-body").hidden); });
  /** Choosing a colour opens the editor on it, except while a picture is open: then the next tap
   *  on the picture is what changes it, and the picture keeps the room. */
  function openEditor() { if (pickerEl.hidden || roomy.matches) fold(false); }
  /** Where the maker's sheet has a column of its own (style.css), and folding it would gain nothing. */
  var roomy = matchMedia("(min-width: 56rem) and (min-aspect-ratio: 5/4)");

  // What is being made survives a reload, so a slip of the thumb costs nothing. Saved as it
  // settles rather than on every step of a slider.
  var drafting = null;
  function keepDraft() {
    clearTimeout(drafting);
    drafting = setTimeout(function () { memory.draft = made.colours.slice(); remember(); }, 400);
  }

  picker.addEventListener("input", function () { setSlot(picker.value.slice(1), true); });
  hexIn.addEventListener("input", function () {
    var v = parseColour(hexIn.value);
    if (v && /^#?[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(hexIn.value.trim())) setSlot(v, true);
  });
  hexIn.addEventListener("blur", function () { hexIn.value = "#" + made.colours[made.slot]; });
  [hIn, sIn, lIn].forEach(function (r) {
    r.addEventListener("input", function () { setSlot(fromHsl(+hIn.value, +sIn.value, +lIn.value), false); });
  });
  $("make-as-field").addEventListener("click", function () {
    var c = made.colours;
    var t = c[0]; c[0] = c[made.slot]; c[made.slot] = t;
    made.slot = 0;
    paintMaker(true);
  });
  $("make-random-one").addEventListener("click", function () { setSlot(randomHex(), true); });
  $("make-random-all").addEventListener("click", function () {
    var crates = [];
    for (var i = 1; i < made.colours.length; i++) crates.push(randomHex());
    loadMaker({ field: randomHex(), crates: crates });
  });

  /** A new crate colour, chosen at random and ready to change: the editor opens on it. */
  function addCrate() {
    if (made.colours.length - 1 >= MAX_CRATES) return;
    made.colours.push(randomHex());
    made.slot = made.colours.length - 1;
    $("make-status").textContent = "";
    openEditor();
    paintMaker(true);
    var chips = slotsEl.querySelectorAll('[role="radio"]');
    chips[made.slot].focus({ preventScroll: true });
  }
  $("make-remove").addEventListener("click", function () {
    if (made.slot === 0 || made.colours.length - 1 <= MIN_CRATES) return;
    made.colours.splice(made.slot, 1);
    made.slot = Math.min(made.slot, made.colours.length - 1);
    $("make-status").textContent = "";
    paintMaker(true);
  });

  $("make-submit").addEventListener("click", function () {
    var p = makerPalette();
    var name = nameOf(p);
    var status = $("make-status");
    memory.votes[name] = 1;     // making it is its maker's yes, on the Worker too
    status.textContent = "Sending…";
    memory.outbox.push({ path: "/submit", body: { palette: name, visitor: memory.visitor } });
    remember();
    var sent = memory.outbox[memory.outbox.length - 1];
    sent.onDone = async function (res) {
      if (res.ok) {
        var body = await res.json().catch(function () { return {}; });
        status.textContent = body.duplicate
          ? "Someone already made exactly this one. It's in the vote"
          : "Added! It's in the vote now, for everyone";
        if (!lists.new.all.some(function (q) { return nameOf(q) === name; })) {
          lists.new.all.push({ field: p.field, crates: p.crates.slice(), player: true });
          paintCounts();
        }
      } else {
        status.textContent = "That one couldn't be added. Try changing a colour";
      }
    };
    flush().then(function () {
      if (memory.outbox.indexOf(sent) >= 0) {
        status.textContent = "Saved on this device. It will be added when the vote box is reachable";
      }
    });
  });

  // ------------------------------------------------------------------ the eyedropper
  /*
   * **Two ways to take a colour from something you can see.** Where the browser has one (Chrome
   * and Edge on a computer), its own eyedropper takes a colour from anywhere on the screen, other
   * windows included. Everywhere, a picture can be opened on the stage — chosen, pasted or dropped
   * — and a tap or a drag on it takes the colour under the finger, with a loupe above it so the
   * finger does not hide what it is choosing. The picture is drawn into a canvas in this tab and
   * goes nowhere: it is not uploaded, sent or saved, and it is gone when the page is.
   */

  var dropperBtn = $("make-dropper");
  if ("EyeDropper" in window) dropperBtn.hidden = false;
  dropperBtn.addEventListener("click", function () {
    var slot = made.slot;
    new window.EyeDropper().open().then(function (r) {
      var hex = parseColour(r && r.sRGBHex);
      if (!hex) return;
      made.slot = slot;
      setSlot(hex, true);
    }, function () { /* closed without choosing */ });
  });

  var pickerEl = $("picker"), canvas = $("picker-canvas"), loupe = $("loupe");
  var source = null;        // the picture at its own size (capped), to read colours from
  var view = null;          // where the picture is drawn in the canvas, in CSS pixels

  function openPicker() {
    // With no picture yet it says what happens to one, in full, so it has the room for that.
    pickerEl.classList.toggle("empty", !source);
    document.body.classList.toggle("picking-empty", !source);
    pickerEl.hidden = false;
    document.body.classList.add("picking");
    $("make-image").setAttribute("aria-pressed", "true");
    // On a phone the editor folds so the picture and the game have the room; the colours stay in
    // reach. Beside the stage, it stays as it was.
    if (!roomy.matches) fold(true);
    $(source ? "picker-close" : "picker-file").focus({ preventScroll: true });
  }
  function closePicker() {
    if (pickerEl.hidden) return;
    pickerEl.hidden = true;
    loupe.hidden = true;
    document.body.classList.remove("picking", "picking-empty");
    $("make-image").setAttribute("aria-pressed", "false");
  }
  $("make-image").addEventListener("click", function () { if (pickerEl.hidden) openPicker(); else closePicker(); });
  $("picker-close").addEventListener("click", closePicker);
  $("picker-other").addEventListener("click", function () { $("picker-file").click(); });
  $("picker-file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) loadPicture(f);
    e.target.value = "";
  });

  var pasteBtn = $("picker-paste");
  if (navigator.clipboard && navigator.clipboard.read) pasteBtn.hidden = false;
  pasteBtn.addEventListener("click", async function () {
    try {
      var items = await navigator.clipboard.read();
      for (var i = 0; i < items.length; i++) {
        var type = items[i].types.find(function (t) { return t.indexOf("image/") === 0; });
        if (type) { loadPicture(await items[i].getType(type)); return; }
      }
      pickerStatus("There's no picture on your clipboard. Copy one first, then paste");
    } catch (err) {
      pickerStatus("Your browser didn't let the page read the clipboard. Try Ctrl+V, or choose a picture");
    }
  });
  function pickerStatus(text) { $("picker-status").textContent = text; }

  /** A picture pasted anywhere on the page, in the maker, opens on the stage. */
  function onPaste(e) {
    if (mode !== "make" || !e.clipboardData) return;
    var items = e.clipboardData.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
        var f = items[i].getAsFile();
        if (f) { e.preventDefault(); loadPicture(f); return; }
      }
    }
  }
  document.addEventListener("paste", onPaste);

  // Dropped anywhere on the page, in the maker. Anywhere else a dropped file is refused, rather
  // than left to the browser, which would open it in place of the page.
  function onDragOver(e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, "Files") < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = mode === "make" ? "copy" : "none";
    if (mode === "make") document.body.classList.add("dropping");
  }
  function onDragLeave(e) { if (!e.relatedTarget) document.body.classList.remove("dropping"); }
  function onDrop(e) {
    document.body.classList.remove("dropping");
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    if (mode !== "make") return;
    var f = Array.prototype.find.call(e.dataTransfer.files, function (x) { return x.type.indexOf("image/") === 0; });
    if (f) loadPicture(f); else { openPicker(); pickerStatus("That isn't a picture this page can open"); }
  }
  addEventListener("dragover", onDragOver);
  addEventListener("dragleave", onDragLeave);
  addEventListener("drop", onDrop);

  /** The largest side a picture is kept at: plenty to choose from, and never a phone's memory. */
  var PICTURE_MAX = 2048;

  function loadPicture(blob) {
    if (!blob || (blob.type && blob.type.indexOf("image/") !== 0)) {
      pickerStatus("That isn't a picture this page can open");
      return;
    }
    pickerStatus("Opening…");
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, PICTURE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      var g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      source = { canvas: c, ctx: g, data: g.getImageData(0, 0, c.width, c.height).data };
      pickerStatus("");
      $("picker-empty").hidden = true;
      $("picker-view").hidden = false;
      pickerEl.classList.remove("empty");
      document.body.classList.remove("picking-empty");
      $("picker-other").hidden = false;
      $("picker-suggest").disabled = false;
      if (pickerEl.hidden) openPicker();
      fitPicture();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      pickerStatus("That picture couldn't be opened. Try another");
    };
    img.src = url;
  }

  /** Draws the picture as large as it fits, centred. */
  function fitPicture() {
    if (!source) return;
    var box = $("picker-view").getBoundingClientRect();
    if (!box.width || !box.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    var s = Math.min(box.width / source.canvas.width, box.height / source.canvas.height);
    var w = source.canvas.width * s, h = source.canvas.height * s;
    view = { x: (box.width - w) / 2, y: (box.height - h) / 2, w: w, h: h, s: s };
    var g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, box.width, box.height);
    g.imageSmoothingQuality = "high";
    g.drawImage(source.canvas, view.x, view.y, w, h);
  }
  // The picture shares the stage with the game while it is open, so it is fitted again whenever
  // its room changes: opening, turning the phone, the editor folding.
  if ("ResizeObserver" in window) new ResizeObserver(fitPicture).observe($("picker-view"));
  else addEventListener("resize", fitPicture);

  /** The picture's own pixel under ([x], [y]) in the canvas, or null off the picture. */
  function pixelAt(x, y) {
    if (!view) return null;
    var px = Math.floor((x - view.x) / view.s), py = Math.floor((y - view.y) / view.s);
    if (px < 0 || py < 0 || px >= source.canvas.width || py >= source.canvas.height) return null;
    return { x: px, y: py };
  }
  function colourAt(px) {
    var i = (px.y * source.canvas.width + px.x) * 4, d = source.data;
    // A see-through pixel is seen over the stage's black, so take it as that.
    var a = d[i + 3] / 255;
    return toHex(d[i] * a, d[i + 1] * a, d[i + 2] * a);
  }

  /** The loupe: the pixels round the finger, large, with the one being taken framed. */
  var LOUPE_CELLS = 11;
  function drawLoupe(x, y, px, hex) {
    var size = loupe.width, cell = size / LOUPE_CELLS, half = (LOUPE_CELLS - 1) / 2;
    var g = loupe.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#000";
    g.fillRect(0, 0, size, size);
    g.drawImage(source.canvas, px.x - half, px.y - half, LOUPE_CELLS, LOUPE_CELLS, 0, 0, size, size);
    g.lineWidth = 2;
    g.strokeStyle = "#fff";
    g.strokeRect(half * cell, half * cell, cell, cell);
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.strokeRect(half * cell - 2, half * cell - 2, cell + 4, cell + 4);
    loupe.style.setProperty("--picked", "#" + hex);
    // Above the finger, kept inside the picture's box.
    var box = $("picker-view").getBoundingClientRect(), r = loupe.offsetWidth || 120;
    var lx = Math.max(4, Math.min(box.width - r - 4, x - r / 2));
    var ly = y - r - 36;
    if (ly < 4) ly = Math.min(box.height - r - 4, y + 36);
    loupe.style.transform = "translate(" + lx + "px," + ly + "px)";
  }

  var sampling = false;
  function sampleAt(e, commit) {
    var box = canvas.getBoundingClientRect();
    var x = e.clientX - box.left, y = e.clientY - box.top;
    var px = pixelAt(x, y);
    if (!px) { loupe.hidden = true; return; }
    var hex = colourAt(px);
    loupe.hidden = false;
    drawLoupe(x, y, px, hex);
    // The game wears it as the finger moves, so the choice is made on the game, not the picture.
    if (made.colours[made.slot] !== hex) setSlot(hex, true);
    if (commit) loupe.hidden = true;
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (!source) return;
    e.preventDefault();
    sampling = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ }
    sampleAt(e, false);
  });
  canvas.addEventListener("pointermove", function (e) { if (sampling) sampleAt(e, false); });
  canvas.addEventListener("pointerup", function (e) { if (!sampling) return; sampling = false; sampleAt(e, true); });
  canvas.addEventListener("pointercancel", function () { sampling = false; loupe.hidden = true; });

  /*
   * **A palette from the picture**, for when you would rather start from what it is made of than
   * take each colour by hand: its main colours by k-means over a small copy of it. The copy is
   * taken pixel for pixel rather than smoothed, so every colour offered is one the picture really
   * has rather than a blend along an edge. It offers as many colours as the palette has now, fewer
   * where the picture has fewer worth having — a cluster under [MINOR] of the picture, or too like
   * a bigger one, is left out unless a palette would be short of its four without it. The one
   * covering the most is the background, as in the game's own, and the rest are the crates, most
   * first. Everything after that is yours to change.
   */
  var MINOR = 0.015;
  function paletteFromPicture(k) {
    var c = source.canvas, s = Math.min(1, 120 / Math.max(c.width, c.height));
    var w = Math.max(1, Math.round(c.width * s)), h = Math.max(1, Math.round(c.height * s));
    var small = document.createElement("canvas");
    small.width = w; small.height = h;
    var g = small.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, pts = [];
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      pts.push([d[i], d[i + 1], d[i + 2]]);
    }
    if (!pts.length) return null;
    var dist = function (a, b) { var r = a[0] - b[0], gg = a[1] - b[1], bb = a[2] - b[2]; return r * r * 0.3 + gg * gg * 0.59 + bb * bb * 0.11; };
    // k-means++ seeding, from a fixed start so the same picture gives the same palette. A picture
    // with fewer colours than asked for runs out of new ones to seed, and has fewer centres.
    var centres = [pts[Math.floor(pts.length / 2)].slice()];
    var near = pts.map(function (p) { return dist(p, centres[0]); });
    var rand = 0.5;
    while (centres.length < k) {
      var total = near.reduce(function (a, b) { return a + b; }, 0);
      if (!total) break;
      rand = (rand * 9301 + 49297) % 233280 / 233280;
      var target = rand * total, at = 0;
      while (at < pts.length - 1 && (target -= near[at]) > 0) at++;
      centres.push(pts[at].slice());
      for (var j = 0; j < pts.length; j++) near[j] = Math.min(near[j], dist(pts[j], centres[centres.length - 1]));
    }
    var sizes = [];
    for (var round = 0; round < 12; round++) {
      var sums = centres.map(function () { return [0, 0, 0, 0]; });
      pts.forEach(function (p) {
        var best = 0, bd = Infinity;
        for (var q = 0; q < centres.length; q++) { var v = dist(p, centres[q]); if (v < bd) { bd = v; best = q; } }
        var t = sums[best]; t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; t[3]++;
      });
      centres = sums.map(function (t, q) { return t[3] ? [t[0] / t[3], t[1] / t[3], t[2] / t[3]] : centres[q]; });
      sizes = sums.map(function (t) { return t[3]; });
    }
    var ranked = centres.map(function (c2, q) { return { rgb: c2, hex: toHex(c2[0], c2[1], c2[2]), n: sizes[q] }; })
      .filter(function (r) { return r.n > 0; })
      .sort(function (a, b) { return b.n - a.n; });
    var want = 1 + MIN_CRATES, kept = [], spare = [];
    ranked.forEach(function (r) {
      var alike = kept.some(function (q) { return q.hex === r.hex || dist(q.rgb, r.rgb) < 120; });
      (r.n >= pts.length * MINOR && !alike ? kept : spare).push(r);
    });
    while (kept.length < want && spare.length) kept.push(spare.shift());
    var hexes = distinct(kept.map(function (r) { return r.hex; })).slice(0, k);
    while (hexes.length < want) hexes.push(randomHex());
    return { field: hexes[0], crates: hexes.slice(1) };
  }
  $("picker-suggest").addEventListener("click", function () {
    if (!source) return;
    var p = paletteFromPicture(Math.max(1 + MIN_CRATES, made.colours.length));
    if (!p) return;
    made.colours = [p.field].concat(p.crates);
    made.slot = 0;
    $("make-status").textContent = "";
    paintMaker(true);
    pickerStatus("");
  });

  // ------------------------------------------------------------------ about

  var about = $("about");
  $("info").addEventListener("click", function () { about.showModal(); });
  about.addEventListener("close", function () {
    if (!memory.introduced) { memory.introduced = true; remember(); }
  });
  about.addEventListener("click", function (e) { if (e.target === about) about.close(); });

  // ------------------------------------------------------------------ start

  /** The game's own original palette, for when there is nothing else to start the maker on. */
  var ORIGINAL = { field: "0D1421", crates: ["1FC8DE", "8AD93A", "3F92F5", "9B6BF2", "DE6FD6"] };

  (async function start() {
    frame.setAttribute("src", GAME_URL);
    var data;
    try {
      data = await (await fetch(ROOT + "palettes.json")).json();
    } catch (e) {
      $("stage-loading").textContent = "The palettes didn't load. Try refreshing the page";
      return;
    }
    var have = {};
    var once = function (p) { var n = nameOf(p); if (have[n]) return false; have[n] = true; return true; };
    lists.current.all = data.game.map(unpack).filter(once);
    lists.new.all = data.candidates.map(unpack).filter(once);

    // How often each new palette has been voted on orders that list, and players' palettes join
    // it. Worth a moment's wait, never more: whatever arrives later still counts next time.
    var shared = Promise.all([
      getJSON("/counts").then(function (c) { if (c) counts = c; }),
      getJSON("/submissions").then(function (list) {
        (list || []).forEach(function (s) {
          var p = typeof s.palette === "string" && fromName(s.palette);
          if (!p || !once(p)) return;
          p.player = true;
          lists.new.all.push(p);
        });
      }),
    ]);
    await Promise.race([shared, new Promise(function (r) { setTimeout(r, 1500); })]);

    loaded = true;
    // A fresh start is three crate colours; more are a tap away.
    if (memory.draft) loadMaker({ field: memory.draft[0], crates: memory.draft.slice(1) }, MAX_CRATES, true);
    else if (lists.new.all.length) loadMaker(lists.new.all[Math.floor(Math.random() * lists.new.all.length)], MIN_CRATES);
    else loadMaker(ORIGINAL, MIN_CRATES);
    // Folded on a phone, so the first thing seen is the palette on the game; beside the stage on a
    // wide screen there is room for all of it.
    fold(!roomy.matches);
    show(modeFromHash() || "current");
    if (!memory.introduced) about.showModal();
    flush();
    catchUpKeeps();
  })();
})();
