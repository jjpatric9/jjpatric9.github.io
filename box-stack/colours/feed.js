/* Box Stack colours: box-stack/colours/.
 *
 * **One feed of every palette, a screen each, swiped like a reel.** The ones in the game and the
 * new ones players made are one list; a tag on each says which it is. Every palette is Box Stack
 * itself — the playable, as demo.html?host=palette&bot=1 — played by the game's own bot at a
 * steady pace on a tower that shows every colour in its share, and beside it are a thumbs up and a
 * thumbs down, each with how many people gave it.
 *
 * Three frames serve the whole feed: the palette on screen and the one either side, so a swipe
 * shows the next one already playing. Only the one on screen plays (`boxstack:awake`); the others
 * hold their palette still. A frame is moved, never re-parented, because moving an iframe in the
 * document reloads it.
 *
 * The page reads palettes.json (the palettes in the game, and any candidates) and talks to one
 * small Cloudflare Worker for everything shared between visitors: player-made palettes, the votes
 * and their tally. Its source lives in the Boxstack repository, tools/palette-votes/. Nothing here
 * waits on the Worker: a vote made offline waits on this device and is sent when it can be.
 *
 * Making a palette is its own page, make/ (make/maker.js), which shares this page's memory.
 */
(function () {
  "use strict";

  /** Where the Worker lives; tools/palette-votes/local.mjs points a local copy of the page elsewhere. */
  var API = window.PALETTE_VOTE_API || "https://palette-votes.joshua-e59.workers.dev";

  var ROOT = "../../";
  /** The game, wearing the palette this page sends it, played by its own bot and taking no input. */
  var GAME_URL = ROOT + "demo.html?host=palette&bot=1";
  /** Messages go to this site only; a page opened from a file has no origin to name. */
  var HERE = location.origin === "null" ? "*" : location.origin;

  /** The names the Worker has to take before a vote made here is sent: see `names` in worker.js. */
  var NAMES = 2;
  /** The same key as the maker and the pages before this one, so a returning voter keeps what they said. */
  var STORE = "tg-palettes-v1";
  /** Frames: the palette on screen and one either side. */
  var POOL = 3;
  /** How long the first screen waits on the Worker's palettes and tally before it is built without them. */
  var WAIT_MS = 2500;
  var TALLY_EVERY_MS = 60000;
  /**
   * **A palette this far under water is not shown.** When its thumbs down outnumber its thumbs up
   * by this many, the voters have answered it, and it leaves the feed for everyone, the game's own
   * included. Read off the tally when the feed is built, so nothing vanishes while it is on screen.
   * The Worker keeps every vote, so `pull.py` still sees it.
   */
  var HIDE_AT = 5;

  function $(id) { return document.getElementById(id); }
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ palettes

  /** A palette as palettes.json packs it: its background, then its crates, as six-digit hex. */
  function unpack(s) {
    var all = s.match(/[0-9A-F]{6}/g);
    return { field: all[0], crates: all.slice(1) };
  }
  /** Its name, exactly as the Worker checks it: the background, then the crates sorted. */
  function nameOf(p) {
    return p.field + ":" + p.crates.slice().sort().join("-");
  }
  /** A name back into a palette, or null if it is not one this page makes. */
  function fromName(name) {
    var m = /^([0-9A-F]{6}):([0-9A-F]{6}(?:-[0-9A-F]{6}){0,9})$/.exec(name);
    return m ? { field: m[1], crates: m[2].split("-") } : null;
  }
  function distinct(list) {
    return list.filter(function (c, i) { return list.indexOf(c) === i; });
  }

  /*
   * A small tower on the palette's own background, shown under the frame until the game has it:
   * loose crates in their piece's colour and two finished rows. Digits are crate slots, taken round
   * the palette's crates; a, b are finished rows; dots are air. The maker draws the same one.
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
    var cells = [];
    SHAPE.forEach(function (row) {
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch === ".") { cells.push('<i class="gap"></i>'); continue; }
        var slot = ch === "a" ? 0 : ch === "b" ? 3 : Number(ch);
        cells.push('<i style="background-color:#' + p.crates[slot % p.crates.length] + '"></i>');
      }
    });
    el.innerHTML = cells.join("");
  }

  // ------------------------------------------------------------------ what this browser remembers

  /*
   * The maker reads and writes the same record, so whatever this page does not use itself — the
   * maker's draft, its options — is carried through untouched.
   */
  var memory = { visitor: null, votes: {}, dislikes: {}, judged: {}, outbox: [], introduced: false, keepsSent: false };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") {
      for (var key in saved) if (Object.prototype.hasOwnProperty.call(saved, key)) memory[key] = saved[key];
      ["votes", "dislikes", "judged"].forEach(function (k) {
        if (!memory[k] || typeof memory[k] !== "object") memory[k] = {};
      });
      if (!Array.isArray(memory.outbox)) memory.outbox = [];
      memory.introduced = memory.introduced === true || Boolean(saved.visitor);
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
   * would be gone. Until the Worker says it takes this page's names, votes wait on this device; and
   * until it says it keeps a tally, the counts are not shown and a vote cannot be taken back.
   */
  var health = null;
  async function workerReady() {
    if (!health || !health.ok) health = (await getJSON("/health")) || { ok: false };
    return health.ok === true && health.names >= NAMES;
  }
  function tallies() { return Boolean(health && health.tally); }

  /*
   * Keeps said before the Worker recorded them are sent once it does: every answer this browser
   * holds on the game's palettes, once. The Worker keeps the newest answer, so one it already has
   * is harmless. The maker does the same; `keepsSent` is shared, so it happens once between them.
   */
  async function catchUpKeeps() {
    if (memory.keepsSent || !(await workerReady()) || !health.keeps) return;
    Object.keys(memory.judged).forEach(function (name) {
      if (!fromName(name)) return;
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
        syncEl.textContent = "The vote box is being updated. Your votes are saved and will be sent soon";
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
          syncEl.textContent = "Can't reach the vote box. Your votes are saved and will be sent later";
          return;
        }
        if (res.status === 429 || res.status >= 500) {
          syncEl.textContent = "The vote box is busy. Your votes are saved and will be sent soon";
          return;
        }
        // Anything else is settled, sent or refused, and waiting would not change the answer.
        memory.outbox.shift();
        remember();
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
      var res = await fetch(API + path, { signal: ctl.signal, cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ votes and their counts

  /** This browser's answer on the palette called [name] as a [kind]: "up", "down", or null. */
  function answerAs(kind, name) {
    if (kind === "game") return name in memory.judged ? (memory.dislikes[name] ? "down" : "up") : null;
    return name in memory.votes ? (memory.votes[name] ? "up" : "down") : null;
  }
  /** This browser's answer on [item]; on a game palette that was a player's, the one given there counts until it has one of its own. */
  function answerOf(item) {
    return answerAs(item.kind, item.name) || (item.was ? answerAs("new", item.was) : null);
  }

  /*
   * **The counts are the Worker's, with this browser's own answer as it is now.** When the tally
   * is read, what this browser had already sent is in it; `counted` is that answer, so changing it
   * afterwards moves the counts by exactly one each way rather than by however stale the tally is.
   * A vote still waiting to be sent when the tally was read is not in it, and counts as not yet.
   */
  var tally = null;         // {game: {name: [up, down]}, new: {...}} once the Worker has said
  var counted = {};         // kind + name: this browser's answer that the tally already holds
  function readTally() {
    return getJSON("/tally").then(function (t) {
      if (!t || !t.game || !t.new) return;
      var pending = {};
      memory.outbox.forEach(function (o) { if (o.body && o.body.palette) pending[o.body.palette] = true; });
      counted = {};
      [["game", memory.judged], ["new", memory.votes]].forEach(function (k) {
        Object.keys(k[1]).forEach(function (name) {
          if (!pending[name]) counted[k[0] + name] = answerAs(k[0], name);
        });
      });
      tally = t;
      items.forEach(paintVotes);
    });
  }
  /**
   * On a game palette that was a player's, the counts are both names' together, and this browser's
   * answer is taken out of the player's name and counted once, on the game's.
   */
  function countsOf(item) {
    var t = raw(item);
    var up = t[0], down = t[1];
    var was = counted[item.kind + item.name], now = answerOf(item);
    if (was === "up") up--; else if (was === "down") down--;
    if (item.was) {
      var wasNew = counted["new" + item.was];
      if (wasNew === "up") up--; else if (wasNew === "down") down--;
    }
    if (now === "up") up++; else if (now === "down") down++;
    return [Math.max(0, up), Math.max(0, down)];
  }
  /** The Worker's [up, down] on [item], with the player's palette it was, if any. */
  function raw(item) {
    var a = (tally && tally[item.kind][item.name]) || [0, 0];
    var b = (item.was && tally && tally.new[item.was]) || [0, 0];
    return [a[0] + b[0], a[1] + b[1]];
  }

  /** Thumbs [which] on [item]. The thumb already given, tapped again, takes it back. */
  function vote(item, which) {
    var now = answerOf(item);
    if (now === which && !tallies()) { nudge(item, which); return; }
    var next = now === which ? null : which;
    var name = item.name;
    if (item.kind === "game") {
      if (next === null) { delete memory.judged[name]; delete memory.dislikes[name]; }
      else {
        memory.judged[name] = 1;
        if (next === "down") memory.dislikes[name] = 1; else delete memory.dislikes[name];
      }
      send("/dislike", { palette: name, dislike: next === null ? null : next === "down", visitor: memory.visitor });
      // An answer given on the player's palette it was moves here, so it is never counted twice.
      if (item.was && item.was in memory.votes) {
        delete memory.votes[item.was];
        send("/vote", { palette: item.was, keep: null, visitor: memory.visitor });
      }
    } else {
      if (next === null) delete memory.votes[name]; else memory.votes[name] = next === "up" ? 1 : 0;
      send("/vote", { palette: name, keep: next === null ? null : next === "up", visitor: memory.visitor });
    }
    paintVotes(item);
    if (next) nudge(item, next);
  }
  function nudge(item, which) {
    var b = which === "up" ? item.upB : item.downB;
    b.classList.remove("pop");
    void b.offsetWidth;
    b.classList.add("pop");
  }

  function paintVotes(item) {
    if (!item.upB) return;
    var now = answerOf(item), c = countsOf(item), shown = Boolean(tally);
    [[item.upB, "up", "Thumbs up", c[0]], [item.downB, "down", "Thumbs down", c[1]]].forEach(function (v) {
      var on = now === v[1];
      v[0].setAttribute("aria-pressed", on ? "true" : "false");
      v[0].querySelector(".n").textContent = shown ? String(v[3]) : "";
      v[0].setAttribute("aria-label", v[2] + (shown ? ", " + v[3] : ""));
    });
  }

  // ------------------------------------------------------------------ the feed

  var feed = $("feed");
  var items = [];           // every palette, in feed order: {p, name, kind, reel, screen, upB, downB}
  var reels = [];           // every screen in the feed, palettes and the caught-up card, in order
  var active = -1;

  var THUMB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10.5v9.5H4.2a1.2 1.2 0 01-1.2-1.2v-7.1a1.2 1.2 0 011.2-1.2H7zm2 9.5h7.7a2.4 2.4 0 002.35-1.9l1.25-6a2.4 2.4 0 00-2.35-2.9H13.5l.7-3.4a1.9 1.9 0 00-3.4-1.5L9 9.9V20z"/></svg>';

  function reelFor(item, index, count) {
    var reel = document.createElement("section");
    reel.className = "reel";
    reel.setAttribute("aria-roledescription", "palette");
    reel.setAttribute("aria-label", "Palette " + (index + 1) + " of " + count + ", " +
      (item.kind === "game" ? "in the game" : "new") + ": background #" + item.p.field +
      ", crates #" + distinct(item.p.crates).join(", #"));
    item.reel = reel;
    reel.item = item;
    return reel;
  }
  /**
   * What is on a palette's screen, made when it comes near the one on show (`dress`). Every screen
   * is an empty section of the right height until then: with thousands of palettes, building every
   * screen's game, thumbs and buttons up front kept the feed from appearing for seconds.
   */
  function fill(item) {
    if (item.screen) return;
    var reel = item.reel;
    var screen = document.createElement("div");
    screen.className = "screen";
    screen.style.background = "#" + item.p.field;
    var poster = document.createElement("div");
    poster.className = "tower poster";
    poster.setAttribute("aria-hidden", "true");
    screen.appendChild(poster);
    item.poster = poster;
    var tag = document.createElement("span");
    tag.className = "tag " + item.kind;
    tag.textContent = item.kind === "game" ? "In the game" : "New";
    screen.appendChild(tag);
    reel.appendChild(screen);

    var rail = document.createElement("div");
    rail.className = "rail";
    var thumb = function (which) {
      var b = document.createElement("button");
      b.className = "thumb " + which;
      b.innerHTML = '<span class="disc">' + THUMB + '</span><span class="n"></span>';
      b.addEventListener("click", function () { vote(item, which); });
      rail.appendChild(b);
      return b;
    };
    item.upB = thumb("up");
    item.downB = thumb("down");
    var spacer = document.createElement("span");
    spacer.className = "spacer";
    rail.appendChild(spacer);
    rail.appendChild(makeLink());
    rail.appendChild(infoButton());
    reel.appendChild(rail);

    item.screen = screen;
    paintVotes(item);
  }
  function makeLink() {
    var a = document.createElement("a");
    a.className = "round make";
    a.href = "make/";
    a.setAttribute("aria-label", "Make your own palette");
    a.title = "Make your own";
    a.innerHTML = '<span aria-hidden="true">+</span>';
    return a;
  }
  function infoButton() {
    var b = document.createElement("button");
    b.className = "round info";
    b.setAttribute("aria-label", "About this page");
    b.setAttribute("aria-haspopup", "dialog");
    b.innerHTML = '<span aria-hidden="true">?</span>';
    b.addEventListener("click", function () { about.showModal(); });
    return b;
  }
  /**
   * A card in the feed: [more] is the one between the palettes not yet voted on and the ones that
   * have been; otherwise it is the one at the end, which every feed has, so the last swipe always
   * says there is nothing further.
   */
  function caughtUpReel(more, none) {
    var reel = document.createElement("section");
    reel.className = "reel caught-up";
    reel.setAttribute("aria-roledescription", "message");
    var card = document.createElement("div");
    card.className = "screen";
    var h = document.createElement("h2");
    h.textContent = none ? "There are no palettes to vote on yet"
      : more ? "That's every palette you haven't voted on" : "You're all caught up";
    var p = document.createElement("p");
    p.textContent = more
      ? "Keep swiping to go back over the ones you've voted on, or make one of your own"
      : "That's every palette there is. Why not make one of your own?";
    var make = document.createElement("a");
    make.className = "btn primary";
    make.href = "make/";
    make.textContent = "Make your own";
    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(make);
    reel.appendChild(card);
    // An empty rail where the thumbs are on every other screen, so the card lines up with them.
    var rail = document.createElement("div");
    rail.className = "rail";
    rail.setAttribute("aria-hidden", "true");
    reel.appendChild(rail);
    return reel;
  }

  /*
   * **The order.** Palettes this browser has not voted on come first, then a card saying so, then
   * the ones it has, so a returning voter starts on something new and can still go back over their
   * votes; the caught-up card is always last. Within each, every palette is there exactly once, so scrolling for ever reaches them
   * all, in **a shuffle of each visit's own that favours the palettes with fewest votes**
   * (`favouringFew`). Each visitor sees a different order, so people looking at once spread over
   * the whole list instead of all starting on the same few; and the favouring is what spreads
   * the votes, so a palette nobody has judged yet comes up early for almost everyone. The game's
   * own and the new are dealt together in proportion, so neither waits behind the other. A link to
   * one palette (`#p=`, which the maker gives after adding one) puts that one first, voted down or
   * not. Any other voted down by `HIDE_AT` is left out.
   */
  function order(all) {
    var deal = function (list) {
      var game = favouringFew(list.filter(function (i) { return i.kind === "game"; }));
      var fresh = favouringFew(list.filter(function (i) { return i.kind === "new"; }));
      var out = [], g = 0, n = 0;
      while (g < game.length || n < fresh.length) {
        var takeGame = n >= fresh.length ||
          (g < game.length && (g + 0.5) / game.length <= (n + 0.5) / fresh.length);
        out.push(takeGame ? game[g++] : fresh[n++]);
      }
      return out;
    };
    var shown = all.filter(function (i) { return !votedOut(i); });
    var unseen = deal(shown.filter(function (i) { return !answerOf(i); }));
    var seen = deal(shown.filter(function (i) { return answerOf(i); }));
    var wanted = /^#p=(.+)$/.exec(location.hash);
    var pinned = null;
    if (wanted) {
      var n = decodeURIComponent(wanted[1]);
      pinned = all.filter(function (i) { return i.name === n; })[0] || null;
      if (pinned) {
        unseen = unseen.filter(function (i) { return i !== pinned; });
        seen = seen.filter(function (i) { return i !== pinned; });
      }
    }
    return { pinned: pinned, unseen: unseen, seen: seen };
  }
  /** Thumbs down ahead of thumbs up by `HIDE_AT` or more, by the Worker's count. */
  function votedOut(item) {
    var t = raw(item);
    return t[1] - t[0] >= HIDE_AT;
  }
  function total(item) {
    var t = raw(item);
    return t[0] + t[1];
  }
  /*
   * A random order, new on every visit, in which a palette with fewer votes tends to come sooner: a
   * weighted shuffle (Efraimidis-Spirakis) with weight e^-votes, so of two palettes one vote apart
   * the emptier comes first about three times in four, three apart nineteen in twenty. Kept in log
   * space (log(-ln u) + votes, smallest first) so no count is ever too big for it. Nothing is ever
   * left out. Simulated over 2000 palettes and 2000 visitors arriving twenty at a time, it spread
   * the votes 3.6 times more evenly than strictly least-voted first, which sent every visitor who
   * arrived together to the same few. Read off the tally when the feed is built; without one it is
   * a plain shuffle.
   */
  function favouringFew(list) {
    var u = new Uint32Array(Math.max(1, list.length));
    crypto.getRandomValues(u);
    return list.map(function (item, i) {
      return { item: item, key: Math.log(-Math.log((u[i] + 1) / 4294967297)) + total(item) };
    }).sort(function (a, b) { return a.key - b.key; })
      .map(function (k) { return k.item; });
  }

  function build(all) {
    var o = order(all);
    var first = (o.pinned ? [o.pinned] : []).concat(o.unseen);
    items = first.concat(o.seen);
    var loading = $("feed-loading");
    if (loading) loading.remove();
    reels = [];
    var count = items.length;
    first.forEach(function (item, i) { reels.push(reelFor(item, i, count)); });
    if (first.length && o.seen.length) reels.push(caughtUpReel(true));
    o.seen.forEach(function (item, i) { reels.push(reelFor(item, first.length + i, count)); });
    reels.push(caughtUpReel(false, !count));
    // Ahead of the frames, which stay where they are: an iframe moved in the document reloads.
    reels.forEach(function (r) { feed.insertBefore(r, frames.length ? frames[0].el : null); });
    feed.removeAttribute("aria-busy");
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    settle();
  }

  // ------------------------------------------------------------------ the frames

  var frames = [];
  function makeFrame() {
    var el = document.createElement("iframe");
    el.className = "player";
    el.title = "Box Stack, played on the palette";
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-hidden", "true");
    var f = { el: el, item: null, ready: false, shown: null };
    frames.push(f);
    feed.appendChild(el);
    el.src = GAME_URL;
    return f;
  }

  /** Lays [f] over its palette's screen. */
  function lay(f) {
    if (!f.item) { f.el.classList.remove("live"); return; }
    fill(f.item);
    var s = f.item.screen, r = f.item.reel;
    f.el.style.top = (r.offsetTop + s.offsetTop) + "px";
    f.el.style.left = (r.offsetLeft + s.offsetLeft) + "px";
    f.el.style.width = s.offsetWidth + "px";
    f.el.style.height = s.offsetHeight + "px";
  }
  /** Tells [f]'s game what to wear and whether it is the one on screen. */
  function tell(f) {
    if (!f.ready || !f.item || !f.el.contentWindow) return;
    var w = f.el.contentWindow;
    if (f.shown !== f.item) {
      w.postMessage({ type: "boxstack:palette", field: f.item.p.field, crates: f.item.p.crates.slice(), fresh: true }, HERE);
      f.shown = f.item;
      // Shown once it has painted the new palette rather than the last one for a frame.
      var mine = f.item;
      setTimeout(function () { if (f.item === mine) f.el.classList.add("live"); }, 90);
    }
    w.postMessage({ type: "boxstack:awake", awake: !document.hidden && reels[active] === f.item.reel }, HERE);
  }

  addEventListener("message", function (e) {
    if (HERE !== "*" && e.origin !== location.origin) return;
    var f = frames.filter(function (x) { return x.el.contentWindow === e.source; })[0];
    if (!f || !e.data || e.data.type !== "boxstack:ready") return;
    // Also after a fallen tower starts the frame again: it has forgotten what it wore.
    f.ready = true;
    f.shown = null;
    tell(f);
    // The first frame is the one on screen; the other two load once it is up.
    while (frames.length < POOL) makeFrame();
    settle();
  });

  /**
   * Gives the palette on screen, and one either side, a frame each, reusing whichever frames
   * already hold them, and wakes the one on screen.
   */
  function assign() {
    var want = [active, active + 1, active - 1]
      .map(function (i) { return reels[i] && reels[i].item; })
      .filter(Boolean);
    var free = frames.filter(function (f) { return want.indexOf(f.item) < 0; });
    want.forEach(function (item) {
      if (frames.some(function (f) { return f.item === item; })) return;
      var f = free.shift();
      if (!f) return;
      f.el.classList.remove("live");
      f.item = item;
    });
    free.forEach(function (f) { if (want.indexOf(f.item) < 0) { f.item = null; f.el.classList.remove("live"); } });
    frames.forEach(function (f) { lay(f); tell(f); });
  }

  // ------------------------------------------------------------------ moving through it

  function heightOf() { return feed.clientHeight || 1; }
  /** Fills the screens near the one on show, and draws the little tower under each frame. */
  function dress(from, to) {
    for (var i = Math.max(0, from); i <= Math.min(reels.length - 1, to); i++) {
      var item = reels[i].item;
      if (!item) continue;
      fill(item);
      if (!item.poster.firstChild) drawTower(item.poster, item.p);
    }
  }
  function settle() {
    var i = Math.max(0, Math.min(reels.length - 1, Math.round(feed.scrollTop / heightOf())));
    if (i !== active) {
      active = i;
      document.body.classList.toggle("at-start", i === 0);
      document.body.classList.toggle("at-end", i === reels.length - 1);
    }
    dress(active - 2, active + 3);
    assign();
  }
  var pending = false;
  feed.addEventListener("scroll", function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; settle(); });
  }, { passive: true });

  function go(step) {
    var i = Math.max(0, Math.min(reels.length - 1, active + step));
    feed.scrollTo({ top: i * heightOf(), behavior: still ? "auto" : "smooth" });
  }

  /*
   * **Whenever the feed changes size, the same palette stays on screen and the frames follow
   * their screens**, in the same frame. A window resize is only one of the ways it changes: a
   * phone's toolbar coming back after a switch of apps, the bar's font arriving late, anything
   * above the feed growing. On the first screen none of those scrolls the feed, so nothing else
   * re-lays the frames, and the game was left the old size, hanging off the foot of its screen.
   * So the feed itself is watched, not the window.
   */
  function relayout() {
    if (active >= 0 && reels.length) feed.scrollTop = active * heightOf();
    frames.forEach(lay);
  }
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(feed);
  else addEventListener("resize", relayout);
  document.addEventListener("visibilitychange", function () { frames.forEach(tell); });
  // Back to the page from the maker or elsewhere, kept whole by the browser: lay and wake again.
  addEventListener("pageshow", function (e) { if (e.persisted) { relayout(); settle(); } });

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || about.open) return;
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    var item = reels[active] && reels[active].item;
    var k = e.key;
    if (k === "ArrowDown" || k === "PageDown" || k === "j" || (k === " " && !e.shiftKey)) { e.preventDefault(); go(1); }
    else if (k === "ArrowUp" || k === "PageUp" || k === "k" || (k === " " && e.shiftKey)) { e.preventDefault(); go(-1); }
    else if (k === "Home") { e.preventDefault(); feed.scrollTo({ top: 0 }); }
    else if (k === "End") { e.preventDefault(); feed.scrollTo({ top: (reels.length - 1) * heightOf() }); }
    else if (item && k === "ArrowRight") { e.preventDefault(); vote(item, "up"); }
    else if (item && k === "ArrowLeft") { e.preventDefault(); vote(item, "down"); }
  }
  addEventListener("keydown", onKey);

  /** On a computer, buttons to the next and the last palette, as a phone has its swipe. */
  function navButtons() {
    var nav = document.createElement("div");
    nav.className = "feed-nav";
    [["prev", "Previous palette", "M6 15l6-6 6 6", -1], ["next", "Next palette", "M6 9l6 6 6-6", 1]].forEach(function (b) {
      var btn = document.createElement("button");
      btn.className = "round " + b[0];
      btn.setAttribute("aria-label", b[1]);
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + b[2] + '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      btn.addEventListener("click", function () { go(b[3]); });
      nav.appendChild(btn);
    });
    feed.parentNode.appendChild(nav);
  }

  // ------------------------------------------------------------------ about

  var about = $("about");
  about.addEventListener("close", function () {
    if (!memory.introduced) { memory.introduced = true; remember(); }
    feed.focus({ preventScroll: true });
  });
  about.addEventListener("click", function (e) { if (e.target === about) about.close(); });

  // ------------------------------------------------------------------ start

  (async function start() {
    makeFrame();
    navButtons();
    var data;
    try {
      data = await (await fetch(ROOT + "palettes.json")).json();
    } catch (e) {
      $("feed-loading").textContent = "The palettes didn't load. Try refreshing the page";
      return;
    }
    var have = {}, all = [];
    var add = function (p, kind) {
      var name = nameOf(p);
      if (have[name]) return;
      have[name] = true;
      var game = kind === "new" && gameFrom(p);
      // Already in the feed as the game's: that one is shown, with this one's votes.
      if (game) { game.was = name; return; }
      all.push({ p: p, name: name, kind: kind });
    };
    /*
     * **A player's palette the game took is one palette, not two.** The game deals ten crate
     * slots, so it gives each colour its share of them, and it may drop one; that makes a
     * different name for what voters see as the same palette, and the feed showed both, the
     * game's with no votes and the player's with them. A player's palette is the game's when its
     * background is the same and it has every colour the game kept.
     */
    var gameFrom = function (p) {
      return all.filter(function (i) {
        return i.kind === "game" && !i.was && i.p.field === p.field &&
          distinct(i.p.crates).every(function (c) { return p.crates.indexOf(c) >= 0; });
      })[0] || null;
    };
    data.game.map(unpack).forEach(function (p) { add(p, "game"); });
    data.candidates.map(unpack).forEach(function (p) { add(p, "new"); });

    // Players' palettes join the feed and the tally orders it. Worth a moment's wait, never more:
    // the tally is read again whenever it arrives, and a palette that comes later is there next time.
    var players = getJSON("/submissions").then(function (list) {
      (list || []).forEach(function (s) {
        var p = typeof s.palette === "string" && fromName(s.palette);
        if (p) add(p, "new");
      });
    });
    var shared = Promise.all([players, workerReady().then(function () { if (tallies()) return readTally(); })]);
    await Promise.race([shared, new Promise(function (r) { setTimeout(r, WAIT_MS); })]);

    build(all);
    shared.then(function () { if (tallies() && !tally) readTally(); });
    setInterval(function () { if (!document.hidden && tallies()) readTally(); }, TALLY_EVERY_MS);
    if (!memory.introduced) about.showModal();
    else feed.focus({ preventScroll: true });
    flush();
    catchUpKeeps();
  })();
})();
