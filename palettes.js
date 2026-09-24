/* Box Stack palette votes: palettes.html.
 *
 * The page reads palettes.json (every harvested palette, and the ones already in the game), and
 * talks to one small Cloudflare Worker for everything that has to be shared between visitors. Its
 * source and the steps to set it up live in the Boxstack repository, tools/palette-votes/.
 *
 * Nothing here depends on the Worker being reachable: a vote made offline waits on this device and
 * is sent when it can be.
 */
(function () {
  "use strict";

  /** Where the Worker lives; tools/palette-votes/local.mjs points a local copy of the page elsewhere. */
  var API = window.PALETTE_VOTE_API || "https://palette-votes.joshua-e59.workers.dev";

  var BATCH = 20;
  var STORE = "tg-palettes-v1";

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
  function luminance(hex) {
    var c = rgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  /** WCAG contrast. 3:1 is the line the game draws cargo against its background by. */
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
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

  /*
   * A small tower on the palette's own background, drawn the way the game draws one: loose crates
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
        cells.push('<i data-slot="' + (crate + 1) + '" style="background:#' + p.crates[crate] + '"></i>');
      }
    });
    el.innerHTML = cells.join("");
    el.setAttribute("aria-label", "Background #" + p.field + " with crates #" + p.crates.join(", #"));
  }

  function miniTower(p, extraClass) {
    var el = document.createElement("div");
    el.className = "tower mini" + (extraClass ? " " + extraClass : "");
    drawTower(el, p);
    return el;
  }

  // ------------------------------------------------------------------ what this browser remembers

  var memory = { visitor: null, votes: {}, dislikes: {}, outbox: [], draft: null };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") {
      memory.visitor = saved.visitor || null;
      memory.votes = saved.votes || {};
      memory.dislikes = saved.dislikes || {};
      memory.outbox = Array.isArray(saved.outbox) ? saved.outbox : [];
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

  var syncEl = document.getElementById("sync");

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

  // ------------------------------------------------------------------ tabs

  // A tab's name is its address, #vote, #make or #game. The panels are "panel-" + name rather
  // than the name itself, or opening the address would scroll the page past the tabs to the panel.
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function nameOfTab(t) { return t.getAttribute("aria-controls").slice(6); }
  function show(id, focus) {
    tabs.forEach(function (t) {
      var on = nameOfTab(t) === id;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      if (on && focus) t.focus();
    });
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { show(nameOfTab(t)); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      show(nameOfTab(tabs[(i + d + tabs.length) % tabs.length]), true);
    });
  });
  function fromHash() {
    var id = location.hash.slice(1);
    if (id === "vote" || id === "make" || id === "game") show(id);
  }
  addEventListener("hashchange", fromHash);

  // ------------------------------------------------------------------ vote

  var pool = [];       // every palette open to a vote: harvested, then player-made
  var counts = {};     // votes each has had, from the Worker; never how many keeps
  var batch = [], at = 0, history_ = [];
  var voteTower = document.getElementById("vote-tower");
  var swipeEl = document.getElementById("vote-swipe");
  var deckEl = document.getElementById("vote-deck"), doneEl = document.getElementById("vote-done");
  var statusEl = document.getElementById("vote-status");
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    if (!batch.length) {
      deckEl.hidden = doneEl.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = "You've seen every palette there is. Thank you! Why not make one of your own?";
      return;
    }
    if (at >= batch.length) return finishBatch();
    statusEl.hidden = doneEl.hidden = true;
    deckEl.hidden = false;
    var p = batch[at];
    drawTower(voteTower, p);
    document.getElementById("vote-tag").hidden = !p.player;
    document.getElementById("vote-progress").textContent = (at + 1) + " of " + batch.length;
    document.getElementById("vote-undo").disabled = history_.length === 0;
  }

  /* The decided card flies off the way it was voted, over the next one already in its place. Only
   * a picture: the vote and the next card do not wait for it, so voting fast is never slowed. */
  function flyOff(keep, dx) {
    if (still || !swipeEl.animate) return;
    var ghost = swipeEl.cloneNode(true);
    ghost.removeAttribute("id");
    Array.prototype.forEach.call(ghost.querySelectorAll("[id]"), function (el) { el.removeAttribute("id"); });
    ghost.setAttribute("aria-hidden", "true");
    ghost.classList.remove("dragging");
    ghost.classList.add("ghost");
    ghost.dataset.lean = keep ? "keep" : "skip";
    var home = swipeEl.parentNode.getBoundingClientRect();    // where the card sits when not dragged
    ghost.style.left = home.left + "px";
    ghost.style.top = home.top + "px";
    ghost.style.width = home.width + "px";
    document.body.appendChild(ghost);
    var way = keep ? 1 : -1, far = swipeEl.offsetWidth + 60;
    ghost.animate([
      { transform: "translateX(" + dx + "px) rotate(" + dx / 25 + "deg)", opacity: 1 },
      { transform: "translateX(" + way * far + "px) rotate(" + way * 14 + "deg)", opacity: 0 },
    ], { duration: 260, easing: "cubic-bezier(.4,0,1,1)" }).onfinish = function () { ghost.remove(); };
    swipeEl.animate([{ transform: "scale(.95)", opacity: 0.4 }, { transform: "none", opacity: 1 }],
      { duration: 200, easing: "ease-out" });
  }

  function decide(keep, dx) {
    if (deckEl.hidden || at >= batch.length) return;
    var p = batch[at];
    var name = nameOf(p);
    memory.votes[name] = keep ? 1 : 0;
    history_.push(at);
    at++;
    send("/vote", { palette: name, keep: keep, visitor: memory.visitor });
    if (at < batch.length) flyOff(keep, dx || 0);
    paintVote();
  }

  function undo() {
    if (!history_.length) return;
    at = history_.pop();
    // The palette comes back to be decided again; the next decision replaces the vote.
    paintVote();
  }

  function finishBatch() {
    var kept = batch.filter(function (p) { return memory.votes[nameOf(p)] === 1; });
    deckEl.hidden = true;
    doneEl.hidden = false;
    document.getElementById("vote-done-text").textContent = kept.length
      ? "Yes to " + kept.length + " of " + batch.length + ". Thank you!"
      : "No to all " + batch.length + ". That helps too, thank you!";
    var grid = document.getElementById("vote-kept");
    grid.innerHTML = "";
    grid.hidden = !kept.length;
    kept.forEach(function (p) { grid.appendChild(miniTower(p)); });
  }

  document.getElementById("vote-keep").addEventListener("click", function () { decide(true); });
  document.getElementById("vote-skip").addEventListener("click", function () { decide(false); });
  document.getElementById("vote-undo").addEventListener("click", undo);
  document.getElementById("vote-undo-last").addEventListener("click", undo);
  document.getElementById("vote-more").addEventListener("click", nextBatch);
  document.getElementById("vote-remix").addEventListener("click", function () {
    if (at < batch.length) { loadMaker(batch[at]); show("make"); }
  });

  addEventListener("keydown", function (e) {
    if (document.getElementById("panel-vote").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, textarea, [role=tab]")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); decide(true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); decide(false); }
    else if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
  });

  // The swipe: the card follows the finger and says which way it is leaning.
  (function () {
    var x0 = null, dx = 0, id = null;
    swipeEl.addEventListener("pointerdown", function (e) {
      x0 = e.clientX; dx = 0; id = e.pointerId;
      swipeEl.setPointerCapture(id);
      swipeEl.classList.add("dragging");
    });
    swipeEl.addEventListener("pointermove", function (e) {
      if (x0 === null || e.pointerId !== id) return;
      dx = e.clientX - x0;
      if (!still) swipeEl.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 25) + "deg)";
      swipeEl.dataset.lean = dx > 30 ? "keep" : dx < -30 ? "skip" : "";
    });
    function end() {
      if (x0 === null) return;
      var decided = Math.abs(dx) > 80;
      var way = dx > 0, from = dx;
      x0 = null; id = null;
      swipeEl.classList.remove("dragging");
      swipeEl.style.transform = "";
      swipeEl.dataset.lean = "";
      if (decided) decide(way, still ? 0 : from);
    }
    swipeEl.addEventListener("pointerup", end);
    swipeEl.addEventListener("pointercancel", end);
  })();

  // ------------------------------------------------------------------ make

  var made = { colours: [], slot: 0 };
  var SLOT_NAMES = ["Background", "Crate 1", "Crate 2", "Crate 3"];
  var slotsEl = document.getElementById("make-slots");
  var fieldRow = document.getElementById("make-slot-field"), crateRow = document.getElementById("make-slot-crates");
  var ORDINAL = ["", "first", "second", "third"];
  var picker = document.getElementById("make-picker");
  var hexIn = document.getElementById("make-hex");
  var hIn = document.getElementById("make-h"), sIn = document.getElementById("make-s"), lIn = document.getElementById("make-l");

  function makerPalette() {
    return { field: made.colours[0], crates: made.colours.slice(1) };
  }

  function loadMaker(p) {
    made.colours = [p.field].concat(p.crates);
    made.slot = 0;
    paintMaker(true);
    document.getElementById("make-status").textContent = "";
  }

  /** The crates, by slot number, that the game could not draw legibly on this background. */
  function faintSlots() {
    var faint = [];
    for (var i = 1; i < 4; i++) if (contrast(made.colours[i], made.colours[0]) < 3) faint.push(i);
    return faint;
  }

  function paintMaker(syncSliders) {
    var p = makerPalette();
    var faint = faintSlots();
    drawTower(document.getElementById("make-tower"), p);
    fieldRow.innerHTML = crateRow.innerHTML = "";
    made.colours.forEach(function (c, i) {
      var b = document.createElement("button");
      var weak = faint.indexOf(i) >= 0;
      b.className = "slot" + (weak ? " faint" : "");
      b.style.background = "#" + c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", i === made.slot ? "true" : "false");
      b.setAttribute("aria-label", SLOT_NAMES[i] + ", #" + c + (weak ? ", hard to see" : ""));
      b.tabIndex = i === made.slot ? 0 : -1;
      b.addEventListener("click", function () { made.slot = i; paintMaker(true); });
      b.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        made.slot = (made.slot + d + 4) % 4;
        paintMaker(true);
        slotsEl.querySelectorAll('[role="radio"]')[made.slot].focus();
      });
      (i ? crateRow : fieldRow).appendChild(b);
    });
    var hex = made.colours[made.slot];
    picker.value = "#" + hex.toLowerCase();
    if (document.activeElement !== hexIn) hexIn.value = "#" + hex;
    if (syncSliders) {
      var v = hsl(hex);
      hIn.value = Math.round(v[0]); sIn.value = Math.round(v[1]); lIn.value = Math.round(v[2]);
    }
    paintTracks(hex);
    document.getElementById("make-as-field").hidden = made.slot === 0;
    judge(faint);
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
    document.getElementById("make-status").textContent = "";
    paintMaker(syncSliders);
  }

  // What is being made survives a reload, so a slip of the thumb costs nothing. Saved as it
  // settles rather than on every step of a slider.
  var drafting = null;
  function keepDraft() {
    clearTimeout(drafting);
    drafting = setTimeout(function () { memory.draft = made.colours.slice(); remember(); }, 400);
  }

  function judge(faint) {
    var out = document.getElementById("make-readable");
    var submit = document.getElementById("make-submit");
    if (new Set(made.colours).size < 4) {
      out.textContent = "Each of the four colours has to be different.";
      out.className = "readable warn";
      submit.disabled = true;
      return;
    }
    submit.disabled = false;
    if (!faint.length) {
      out.textContent = "Every crate stands out from the background.";
      out.className = "readable ok";
      return;
    }
    var which = faint.length === 3 ? "None of the crates stand out"
      : "The " + faint.map(function (i) { return ORDINAL[i]; }).join(" and ") +
        (faint.length > 1 ? " crates are" : " crate is") + " hard to see";
    out.textContent = which + " on this background. You can still add it, but the game only uses " +
      "palettes where every crate stands out.";
    out.className = "readable warn";
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
  // The tower is a picker too: tap a crate for its colour, the background for the background.
  document.getElementById("make-tower").addEventListener("click", function (e) {
    var cell = e.target.closest("i[data-slot]");
    made.slot = cell ? Number(cell.dataset.slot) : 0;
    paintMaker(true);
  });
  document.getElementById("make-as-field").addEventListener("click", function () {
    var c = made.colours;
    var t = c[0]; c[0] = c[made.slot]; c[made.slot] = t;
    made.slot = 0;
    paintMaker(true);
  });
  document.getElementById("make-random-one").addEventListener("click", function () { setSlot(randomHex(), true); });
  document.getElementById("make-random-all").addEventListener("click", function () {
    if (pool.length) loadMaker(pool[Math.floor(Math.random() * pool.length)]);
  });

  document.getElementById("make-submit").addEventListener("click", function () {
    var p = makerPalette();
    var name = nameOf(p);
    var status = document.getElementById("make-status");
    memory.votes[name] = 1;     // making it is its maker's keep, on the Worker too
    remember();
    status.textContent = "Sending…";
    memory.outbox.push({ path: "/submit", body: { palette: name, field: p.field, visitor: memory.visitor } });
    remember();
    var sent = memory.outbox[memory.outbox.length - 1];
    sent.onDone = async function (res) {
      if (res.ok) {
        var body = await res.json().catch(function () { return {}; });
        status.textContent = body.duplicate
          ? "Someone already made exactly this one. It's in the vote."
          : "Added! It's in the vote now, for everyone.";
        if (!body.duplicate && !pool.some(function (q) { return nameOf(q) === name; })) {
          pool.push({ field: p.field, crates: p.crates.slice(), player: true });
        }
      } else {
        status.textContent = "That one couldn't be added. Try changing a colour.";
      }
    };
    flush().then(function () {
      if (memory.outbox.indexOf(sent) >= 0) {
        status.textContent = "Saved on this device. It will be added when the vote box is reachable.";
      }
    });
  });

  // ------------------------------------------------------------------ in the game now

  var game = [];

  function paintGame() {
    var grid = document.getElementById("game-grid");
    grid.innerHTML = "";
    game.forEach(function (p) {
      var name = nameOf(p);
      var b = document.createElement("button");
      b.className = "pick";
      var off = !!memory.dislikes[name];
      b.setAttribute("aria-pressed", off ? "true" : "false");
      b.setAttribute("aria-label", "Not for me: background #" + p.field + ", crates #" + p.crates.join(", #"));
      b.appendChild(miniTower(p));
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Not for me";
      b.appendChild(badge);
      b.addEventListener("click", function () {
        var now = !memory.dislikes[name];
        if (now) memory.dislikes[name] = 1; else delete memory.dislikes[name];
        b.setAttribute("aria-pressed", now ? "true" : "false");
        send("/dislike", { palette: name, dislike: now, visitor: memory.visitor });
        countGame();
      });
      grid.appendChild(b);
    });
    countGame();
  }

  function countGame() {
    var n = game.filter(function (p) { return memory.dislikes[nameOf(p)]; }).length;
    document.getElementById("game-count").textContent = n
      ? "You've marked " + n + " of " + game.length + "."
      : game.length + " palettes. You haven't marked any.";
  }

  // ------------------------------------------------------------------ start

  (async function start() {
    var data;
    try {
      data = await (await fetch("palettes.json")).json();
    } catch (e) {
      statusEl.textContent = "The palettes didn't load. Try refreshing the page.";
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

    nextBatch();
    if (memory.draft) loadMaker({ field: memory.draft[0], crates: memory.draft.slice(1) });
    else loadMaker(pool[Math.floor(Math.random() * pool.length)]);
    paintGame();
    fromHash();
    flush();
  })();
})();
