/* Box Stack palette votes: palettes.html.
 *
 * The page reads palettes.json (every harvested palette, and the ones already in the game), and
 * talks to one small Cloudflare Worker for everything that has to be shared between visitors. Its
 * source and the steps to set it up live in the Boxstack repository, tools/palette-votes/.
 *
 * **A palette is judged on the game, not on a swatch.** Voting, voting one out and making one all
 * happen on the stage: the whole screen, with Box Stack itself running in it — the playable, as
 * demo.html?host=palette — wearing the palette being decided, and the choice where the game's
 * banner sits. Nothing on the page says which palettes are good or would be used; that is what the
 * vote is for.
 *
 * Nothing here depends on the Worker being reachable: a vote made offline waits on this device and
 * is sent when it can be.
 */
(function () {
  "use strict";

  /** Where the Worker lives; tools/palette-votes/local.mjs points a local copy of the page elsewhere. */
  var API = window.PALETTE_VOTE_API || "https://palette-votes.joshua-e59.workers.dev";

  /** The game, in the mode that takes a palette from this page and says what was tapped. */
  var GAME_URL = "demo.html?host=palette&pick=1";
  /** Messages go to this site only; a page opened from a file has no origin to name. */
  var HERE = location.origin === "null" ? "*" : location.origin;

  var BATCH = 20;
  var STORE = "tg-palettes-v1";
  var CLEANSE_MS = 800;

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

  // ------------------------------------------------------------------ palettes

  /** A palette: its background and three crates, as six-digit hex. */
  function unpack(s) {
    return { field: s.slice(0, 6), crates: [s.slice(6, 12), s.slice(12, 18), s.slice(18, 24)] };
  }
  /** Its name: the four colours sorted, exactly as the Worker checks it. */
  function nameOf(p) {
    return [p.field].concat(p.crates).slice().sort().join("-");
  }
  function shuffled(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = out[i];
      out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /*
   * A small tower on the palette's own background, for the summaries and the ways in: loose crates
   * in their piece's colour, and two finished rows, each entirely the colour of the piece that
   * closed it. Top row first. Digits are crate colours; a, b are finished rows; dots are air.
   */
  var SHAPE = [
    "...22...",
    ".111....",
    ".00022..",
    "bbbbbbbb",
    "01.12200",
    "aaaaaaaa",
  ];

  function drawTower(el, p) {
    el.style.background = "#" + p.field;
    var cells = [];
    SHAPE.forEach(function (row) {
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch === ".") { cells.push('<i class="gap"></i>'); continue; }
        var crate = ch === "a" ? 0 : ch === "b" ? 1 : Number(ch);
        cells.push('<i style="background:#' + p.crates[crate] + '"></i>');
      }
    });
    el.innerHTML = cells.join("");
    el.setAttribute("aria-label", "Background #" + p.field + " with crates #" + p.crates.join(", #"));
  }

  function miniTower(p) {
    var el = document.createElement("div");
    el.className = "tower mini";
    el.setAttribute("role", "img");
    drawTower(el, p);
    return el;
  }

  // ------------------------------------------------------------------ what this browser remembers

  var memory = { visitor: null, votes: {}, dislikes: {}, judged: {}, outbox: [], draft: null, cleanser: false };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") {
      memory.visitor = saved.visitor || null;
      memory.votes = saved.votes || {};
      memory.dislikes = saved.dislikes || {};
      memory.judged = saved.judged || {};
      memory.outbox = Array.isArray(saved.outbox) ? saved.outbox : [];
      memory.cleanser = saved.cleanser === true;
      var d = saved.draft;
      memory.draft = Array.isArray(d) && d.length === 4 && d.every(function (c) { return /^[0-9A-F]{6}$/.test(c); }) ? d : null;
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
    try { localStorage.setItem(STORE, JSON.stringify(memory)); } catch (e) { /* nothing worth failing over */ }
  }

  // ------------------------------------------------------------------ talking to the Worker

  var syncEl = $("sync");

  function send(path, body) {
    memory.outbox.push({ path: path, body: body });
    remember();
    return flush();
  }

  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (async function () {
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
          syncEl.textContent = "Can't reach the vote box right now. Your choices are saved here and will be sent when it's back.";
          return;
        }
        if (res.status === 429 || res.status >= 500) {
          syncEl.textContent = "The vote box is busy. Your choices are saved here and will be sent shortly.";
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

  // ------------------------------------------------------------------ the stage

  var stage = $("stage"), frame = $("game");
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var loaded = false;
  var mode = null;          // "vote", "game" (voting ones out) or "make"
  var lastMode = "vote";    // which way in to hand focus back to
  var shown = null;         // the palette the game is wearing
  var gameReady = false;
  var locked = false;       // while the palette cleanser is up, nothing can be decided
  var pushed = false;       // whether opening the stage added a history entry to go back over

  /** Dress the game in [p]. It is kept, and sent again whenever the game says it is ready. */
  function wear(p) {
    shown = p;
    if (gameReady && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "boxstack:palette", field: p.field, crates: p.crates.slice() }, HERE);
    }
  }

  addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow || (HERE !== "*" && e.origin !== location.origin)) return;
    var d = e.data || {};
    if (d.type === "boxstack:ready") {
      // Also after BUILD AGAIN, which loads the game afresh.
      gameReady = true;
      $("stage-loading").hidden = true;
      if (shown) wear(shown);
      try { frame.contentWindow.addEventListener("keydown", onKey); } catch (err) { /* keys stay on the page */ }
    } else if (d.type === "boxstack:pick" && mode === "make" && d.slot >= 0 && d.slot <= 3) {
      made.slot = d.slot;
      fold(false);
      paintMaker(true);
    }
  });

  var TITLES = { vote: "Vote on new palettes", game: "Vote palettes out of the game", make: "Make your own palette" };

  function openStage(next, fromHistory) {
    if (!loaded) return;
    mode = next;
    stage.hidden = false;
    stage.className = "stage " + next;
    document.documentElement.classList.add("staged");
    $("stage-title").textContent = TITLES[next];
    if (!frame.getAttribute("src")) frame.setAttribute("src", GAME_URL);
    $("bar-decide").hidden = next === "make";
    $("bar-make").hidden = next !== "make";
    $("stage-menu").hidden = next === "make";
    menu(false);
    if (next === "vote") {
      $("ask-text").textContent = "Want this in the game?";
      $("no-text").textContent = "No";
      $("yes-text").textContent = "Yes";
      if (at >= batch.length) nextBatch(); else paintVote();
    } else if (next === "game") {
      $("ask-text").textContent = "Keep this one in the game?";
      $("no-text").textContent = "Remove";
      $("yes-text").textContent = "Keep";
      if (rAt >= rBatch.length) nextRemoveBatch(); else paintRemove();
    } else {
      $("stage-count").textContent = "";
      $("stage-done").hidden = true;
      // Folded, so the first thing seen is the palette filling the screen; choosing a colour,
      // here or on the game, opens the editor.
      fold(true);
      paintMaker(true);
    }
    if (!fromHistory) {
      history.pushState({ stage: next }, "", "#" + next);
      pushed = true;
    }
    $("stage-close").focus({ preventScroll: true });
  }

  function hideStage() {
    if (stage.hidden) return;
    stage.hidden = true;
    mode = null;
    document.documentElement.classList.remove("staged");
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    var way = document.querySelector('.way[data-mode="' + lastMode + '"]');
    if (way) way.focus({ preventScroll: true });
  }

  function closeStage() {
    if (pushed) { pushed = false; history.back(); }     // popstate hides it
    else {
      hideStage();
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function modeFromHash() {
    var id = location.hash.slice(1);
    return id === "vote" || id === "make" || id === "game" ? id : null;
  }
  addEventListener("popstate", function () {
    var m = modeFromHash();
    if (m) openStage(m, true); else { pushed = false; hideStage(); }
  });

  Array.prototype.forEach.call(document.querySelectorAll(".way"), function (b) {
    b.addEventListener("click", function () {
      lastMode = b.dataset.mode;
      // The whole screen, where the browser allows it: the game is the size it is on a phone,
      // with nothing of the browser around it. Where it does not, the stage still fills the page.
      var root = document.documentElement;
      if (root.requestFullscreen && !document.fullscreenElement) {
        root.requestFullscreen({ navigationUI: "hide" }).catch(function () {});
      }
      openStage(b.dataset.mode);
    });
  });
  $("stage-close").addEventListener("click", closeStage);

  // The options: the palette cleanser, undo, and taking what is on screen into the maker.
  function menu(open) {
    $("stage-options").hidden = !open;
    $("stage-menu").setAttribute("aria-expanded", open ? "true" : "false");
  }
  $("stage-menu").addEventListener("click", function () { menu($("stage-options").hidden); });
  var cleanserBox = $("opt-cleanser");
  cleanserBox.checked = memory.cleanser;
  cleanserBox.addEventListener("change", function () { memory.cleanser = cleanserBox.checked; remember(); });
  $("opt-undo").addEventListener("click", function () { menu(false); undoCurrent(); });
  $("opt-tweak").addEventListener("click", function () {
    menu(false);
    if (!shown) return;
    loadMaker(shown);
    history.replaceState({ stage: "make" }, "", "#make");
    openStage("make", true);
  });
  stage.addEventListener("click", function (e) {
    if (!$("stage-options").hidden && !e.target.closest("#stage-options, #stage-menu")) menu(false);
  });

  /*
   * **The palette cleanser, if asked for, and never unless asked.** A plain mid-grey screen for a
   * moment between palettes, so the next one is not seen through the afterimage of the last. The
   * next palette is already on the game underneath it, and a tap lifts it early.
   */
  function advance(show) {
    if (!memory.cleanser) { show(); return; }
    var veil = $("cleanser");
    locked = true;
    veil.classList.remove("out");
    veil.hidden = false;
    show();
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

  // ------------------------------------------------------------------ voting on new palettes

  var pool = [];       // every palette open to a vote: harvested, then player-made
  var counts = {};     // votes each has had, from the Worker; never how many keeps
  var batch = [], at = 0, history_ = [];

  function nextBatch() {
    var fresh = pool.filter(function (p) { return !(nameOf(p) in memory.votes); });
    // Least-voted first, so every palette gets its turn; shuffled among equals so two visitors
    // arriving together are not shown the same twenty.
    fresh.forEach(function (p) { p._r = Math.random(); });
    fresh.sort(function (a, b) {
      return ((counts[nameOf(a)] || 0) - (counts[nameOf(b)] || 0)) || (a._r - b._r);
    });
    batch = fresh.slice(0, BATCH);
    at = 0;
    history_ = [];
    paintVote();
  }

  function paintVote() {
    if (mode !== "vote") return;
    if (!batch.length) {
      done("You've seen every palette there is. Thank you!", "Why not make one of your own?", [], null);
      return;
    }
    if (at >= batch.length) return finishBatch();
    $("stage-done").hidden = true;
    var p = batch[at];
    wear(p);
    $("stage-tag").hidden = !p.player;
    $("stage-count").textContent = (at + 1) + " of " + batch.length;
    $("opt-undo").disabled = history_.length === 0;
  }

  function decide(keep) {
    if (at >= batch.length) return;
    var p = batch[at];
    memory.votes[nameOf(p)] = keep ? 1 : 0;
    history_.push(at);
    at++;
    send("/vote", { palette: nameOf(p), keep: keep, visitor: memory.visitor });
    if (at < batch.length) advance(paintVote); else paintVote();
  }

  function finishBatch() {
    var kept = batch.filter(function (p) { return memory.votes[nameOf(p)] === 1; });
    done(kept.length
      ? "Yes to " + kept.length + " of " + batch.length + ". Thank you!"
      : "No to all " + batch.length + ". That helps too, thank you!", null, kept, "vote");
  }

  // ------------------------------------------------------------------ voting palettes out of the game

  var game = [];
  var rBatch = [], rAt = 0, rHistory = [];

  /* The ones this browser has not judged yet come first, in an order of their own, so a visitor
   * who stops after twenty has still said something about twenty different palettes. */
  function nextRemoveBatch() {
    var fresh = shuffled(game.filter(function (p) { return !(nameOf(p) in memory.judged); }));
    var again = shuffled(game.filter(function (p) { return nameOf(p) in memory.judged; }));
    rBatch = (fresh.length ? fresh : again).slice(0, BATCH);
    rAt = 0;
    rHistory = [];
    paintRemove();
  }

  function paintRemove() {
    if (mode !== "game") return;
    if (rAt >= rBatch.length) return finishRemove();
    $("stage-done").hidden = true;
    var p = rBatch[rAt];
    wear(p);
    $("stage-tag").hidden = true;
    $("stage-count").textContent = (rAt + 1) + " of " + rBatch.length;
    $("opt-undo").disabled = rHistory.length === 0;
  }

  function judge(keep) {
    if (rAt >= rBatch.length) return;
    var name = nameOf(rBatch[rAt]);
    if (keep) delete memory.dislikes[name]; else memory.dislikes[name] = 1;
    memory.judged[name] = 1;
    rHistory.push(rAt);
    rAt++;
    send("/dislike", { palette: name, dislike: !keep, visitor: memory.visitor });
    if (rAt < rBatch.length) advance(paintRemove); else paintRemove();
  }

  function finishRemove() {
    var out = rBatch.filter(function (p) { return memory.dislikes[nameOf(p)]; });
    var left = game.filter(function (p) { return !(nameOf(p) in memory.judged); }).length;
    done(out.length
      ? "You'd take out " + out.length + " of " + rBatch.length + ". Thank you!"
      : "You'd keep all " + rBatch.length + ". Thank you!",
      out.length ? "Changed your mind? Tap one to keep it after all" : null, out, "game", left);
  }

  // ------------------------------------------------------------------ between batches

  /** The summary over the game: what was said, what it was said about, and what next. */
  function done(text, note, palettes, kind, left) {
    $("stage-done").hidden = false;
    $("stage-count").textContent = "";
    $("stage-tag").hidden = true;
    $("done-text").textContent = text;
    $("done-note").hidden = !note;
    $("done-note").textContent = note || "";
    var grid = $("done-grid");
    grid.innerHTML = "";
    grid.hidden = !palettes.length;
    palettes.forEach(function (p) {
      if (kind !== "game") { grid.appendChild(miniTower(p)); return; }
      // Voted out: tapping one takes it back.
      var b = document.createElement("button");
      b.className = "pick";
      b.setAttribute("aria-pressed", "true");
      b.setAttribute("aria-label", "Take out: background #" + p.field + ", crates #" + p.crates.join(", #"));
      b.appendChild(miniTower(p));
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Out";
      b.appendChild(badge);
      b.addEventListener("click", function () {
        var name = nameOf(p), now = !memory.dislikes[name];
        if (now) memory.dislikes[name] = 1; else delete memory.dislikes[name];
        b.setAttribute("aria-pressed", now ? "true" : "false");
        send("/dislike", { palette: name, dislike: now, visitor: memory.visitor });
      });
      grid.appendChild(b);
    });
    var more = $("done-more");
    more.hidden = !kind;
    more.textContent = kind === "game" && left === 0 ? "Go through them again" : "Next 20";
    $("done-undo").parentNode.hidden = !kind;
    (kind ? more : $("done-close")).focus({ preventScroll: true });
  }

  $("done-more").addEventListener("click", function () {
    if (mode === "vote") nextBatch(); else if (mode === "game") nextRemoveBatch();
  });
  $("done-close").addEventListener("click", closeStage);
  $("done-undo").addEventListener("click", undoCurrent);

  // ------------------------------------------------------------------ deciding, whichever way

  function decideCurrent(yes) {
    if (locked || mode === "make" || !$("stage-done").hidden) return;
    if (mode === "vote") decide(yes); else if (mode === "game") judge(yes);
  }

  /** The last one comes back to be decided again; the next decision replaces the old one. */
  function undoCurrent() {
    if (locked) return;
    if (mode === "vote" && history_.length) { at = history_.pop(); paintVote(); }
    else if (mode === "game" && rHistory.length) { rAt = rHistory.pop(); paintRemove(); }
  }

  $("decide-yes").addEventListener("click", function () { decideCurrent(true); });
  $("decide-no").addEventListener("click", function () { decideCurrent(false); });

  function onKey(e) {
    if (stage.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (!$("stage-options").hidden) menu(false); else closeStage();
      return;
    }
    if (mode === "make" || (e.target.closest && e.target.closest("input, textarea"))) return;
    if (e.key === "ArrowRight") { e.preventDefault(); decideCurrent(true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); decideCurrent(false); }
    else if (e.key === "z" || e.key === "Z") { e.preventDefault(); undoCurrent(); }
  }
  addEventListener("keydown", onKey);

  // ------------------------------------------------------------------ making one

  var made = { colours: [], slot: 0 };
  var SLOT_NAMES = ["Background", "Crate 1", "Crate 2", "Crate 3"];
  var slotsEl = $("make-slots");
  var picker = $("make-picker");
  var hexIn = $("make-hex");
  var hIn = $("make-h"), sIn = $("make-s"), lIn = $("make-l");

  function makerPalette() {
    return { field: made.colours[0], crates: made.colours.slice(1) };
  }

  function loadMaker(p) {
    made.colours = [p.field].concat(p.crates);
    made.slot = 0;
    $("make-status").textContent = "";
    paintMaker(true);
  }

  function paintMaker(syncSliders) {
    slotsEl.innerHTML = "";
    made.colours.forEach(function (c, i) {
      var b = document.createElement("button");
      b.className = "chip";
      b.style.background = "#" + c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", i === made.slot ? "true" : "false");
      b.setAttribute("aria-label", SLOT_NAMES[i] + ", #" + c);
      b.tabIndex = i === made.slot ? 0 : -1;
      b.addEventListener("click", function () { made.slot = i; fold(false); paintMaker(true); });
      b.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        made.slot = (made.slot + d + 4) % 4;
        paintMaker(true);
        slotsEl.querySelectorAll('[role="radio"]')[made.slot].focus();
      });
      var label = document.createElement("span");
      label.textContent = i === 0 ? "Background" : "Crate " + i;
      label.setAttribute("aria-hidden", "true");
      var cell = document.createElement("span");
      cell.className = "chip-cell" + (i === 0 ? " field" : "");
      cell.appendChild(b);
      cell.appendChild(label);
      slotsEl.appendChild(cell);
    });
    var hex = made.colours[made.slot];
    picker.value = "#" + hex.toLowerCase();
    if (document.activeElement !== hexIn) hexIn.value = "#" + hex;
    if (syncSliders) {
      var v = hsl(hex);
      hIn.value = Math.round(v[0]); sIn.value = Math.round(v[1]); lIn.value = Math.round(v[2]);
    }
    paintTracks(hex);
    $("make-as-field").hidden = made.slot === 0;
    // Four colours, all different, is what a palette is: the one thing that has to be true.
    var same = new Set(made.colours).size < 4;
    var submit = $("make-submit");
    submit.disabled = same;
    submit.textContent = same ? "Two of the colours are the same" : "Add it to the vote";
    if (mode === "make") wear(makerPalette());
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

  // What is being made survives a reload, so a slip of the thumb costs nothing. Saved as it
  // settles rather than on every step of a slider.
  var drafting = null;
  function keepDraft() {
    clearTimeout(drafting);
    drafting = setTimeout(function () { memory.draft = made.colours.slice(); remember(); }, 400);
  }

  picker.addEventListener("input", function () { setSlot(picker.value.slice(1), true); });
  hexIn.addEventListener("input", function () {
    var v = hexIn.value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(v)) v = v.split("").map(function (c) { return c + c; }).join("");
    if (/^[0-9a-fA-F]{6}$/.test(v)) setSlot(v, true);
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
    loadMaker({ field: randomHex(), crates: [randomHex(), randomHex(), randomHex()] });
  });

  $("make-submit").addEventListener("click", function () {
    var p = makerPalette();
    var name = nameOf(p);
    var status = $("make-status");
    memory.votes[name] = 1;     // making it is its maker's keep, on the Worker too
    status.textContent = "Sending…";
    memory.outbox.push({ path: "/submit", body: { palette: name, field: p.field, visitor: memory.visitor } });
    remember();
    var sent = memory.outbox[memory.outbox.length - 1];
    sent.onDone = async function (res) {
      if (res.ok) {
        var body = await res.json().catch(function () { return {}; });
        status.textContent = body.duplicate
          ? "Someone already made exactly this one. It's in the vote"
          : "Added! It's in the vote now, for everyone";
        if (!body.duplicate && !pool.some(function (q) { return nameOf(q) === name; })) {
          pool.push({ field: p.field, crates: p.crates.slice(), player: true });
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

  // ------------------------------------------------------------------ start

  /** The game's own original palette, for pictures when there is nothing else to show. */
  var ORIGINAL = { field: "0D1421", crates: ["1FC8DE", "8AD93A", "3F92F5"] };

  /** A way in shows one of its palettes, or says there is nothing there yet and stays shut. */
  function offer(kind, list, empty) {
    var way = $("go-" + kind);
    drawTower($("art-" + kind), list.length ? list[Math.floor(Math.random() * list.length)] : ORIGINAL);
    if (list.length) return;
    way.disabled = true;
    way.querySelector(".way-text span").textContent = empty;
  }

  (async function start() {
    var data;
    try {
      data = await (await fetch("palettes.json")).json();
    } catch (e) {
      $("load-status").textContent = "The palettes didn't load. Try refreshing the page.";
      return;
    }
    pool = data.candidates.map(unpack);
    game = data.game.map(unpack);
    var have = {};
    pool.concat(game).forEach(function (p) { have[nameOf(p)] = true; });

    // How often each palette has been voted on orders the first batch, and players' palettes join
    // the pool. Worth a moment's wait, never more: whatever arrives later still counts from the
    // next batch on.
    var shared = Promise.all([
      getJSON("/counts").then(function (c) { if (c) counts = c; }),
      getJSON("/submissions").then(function (list) {
        (list || []).forEach(function (s) {
          if (have[s.palette] || !/^[0-9A-F]{6}$/.test(s.field)) return;
          var four = s.palette.split("-");
          if (four.indexOf(s.field) < 0) return;
          have[s.palette] = true;
          pool.push({ field: s.field, crates: four.filter(function (c) { return c !== s.field; }), player: true });
        });
      }),
    ]);
    await Promise.race([shared, new Promise(function (r) { setTimeout(r, 1500); })]);

    loaded = true;
    $("load-status").hidden = true;
    $("ways").hidden = false;
    if (memory.draft) loadMaker({ field: memory.draft[0], crates: memory.draft.slice(1) });
    else if (pool.length) loadMaker(pool[Math.floor(Math.random() * pool.length)]);
    else loadMaker(ORIGINAL);
    offer("vote", pool, "Nothing to vote on right now. New palettes are on the way");
    offer("game", game, "Nothing to vote out right now");
    drawTower($("art-make"), makerPalette());
    var m = modeFromHash();
    if (m && !$("go-" + m).disabled) { lastMode = m; openStage(m, true); }
    else if (m) history.replaceState(null, "", location.pathname + location.search);
    flush();
  })();
})();
