/* TallmanGames homepage: the crane in the hero.
 *
 * The hero is a picture of the game rather than a recording of it. A crane lowers the game's own
 * pieces onto a little boat, dealt three at a time from the game's bag, and rows that fill up lock
 * in the colour of the box that finished them. The frame is about as many rows as a phone shows,
 * and once the tower nears the top the view climbs with it, as the game's does. It builds until
 * somebody taps it: then the view pulls back to the whole tower, it rolls over into the harbour,
 * and a new boat comes in. Every boat is dealt one of the game's own palettes, and the sky behind
 * it is that palette's background, just as a tower in the game climbs through its bands.
 */
(function () {
  "use strict";

  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ the palettes
  // Every palette in the game whose background is dark enough to be a night sky: background first,
  // then its ten crate slots, each colour as many times as it has slots, so a boat's boxes come in
  // the same proportions as the game's. Dark enough means the hero's body text keeps 7:1 on it and
  // the amber eyebrow 4.5:1. From tools/kept-palettes.json in the Boxstack repository.
  var SKIES = [
    "0D14211FC8DE8AD93A3F92F59B6BF2DE6FD61FC8DE8AD93A3F92F59B6BF2DE6FD6",
    "433705FFD83DFFD83DFFD83DE0B230E0B230E0B230825D16825D16D39632FDFF76",
    "1A1A2EE53935F4511EFB8C00FDD8357CB34243A04700ACC11E88E55E35B18E24AA",
    "2D1B4EFF71CEFF71CEFF71CE01CDFE01CDFE01CDFEB967FFB967FF05FFA1FFFB96",
    "161616E6E6E6D0D0D0BBBBBBA6A6A69191917C7C7C686868555555C4C4C49C9C9C",
    "490405FF8A80FF5252F44336E53935D32F2FC62828B71C1CEF5350E57373FFCDD2",
    "3B24186F4E376F4E378B5A2BB5763AB5763AC8A27AC8A27AD9B58CEAE0CEEAE0CE",
  ];

  function deal(not) {
    var p;
    do { p = SKIES[Math.floor(Math.random() * SKIES.length)]; } while (SKIES.length > 1 && p === not);
    return p;
  }
  function hexes(p) { return p.match(/.{6}/g).map(function (h) { return "#" + h; }); }

  // ------------------------------------------------------------------ the dock
  var canvas = document.getElementById("dock");
  var hero = document.getElementById("hero");
  var bar = document.querySelector(".topbar");
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  if (canvas && canvas.getContext) dock();

  function dock() {
    var ctx = canvas.getContext("2d");
    var COLS = 8, LOADED = 3;
    var HEADROOM = 5;        // rows kept clear over the tower, so the tallest piece on the crane clears it
    var REVEAL_AIR = 2;      // rows of sky over the tower when the view pulls back, as in the game

    // The game's pieces, cells as [x, y] with y upward, in its families. A family's share is how
    // much of the bag it is worth, and which way up it comes is the free choice, as in the game.
    var FAMILIES = [
      [1, [[[0, 0]]]],
      [2, [[[0, 0], [1, 0]], [[0, 0], [0, 1]]]],
      [1, [[[0, 0], [1, 0], [0, 1], [1, 1]]]],
      [2, [[[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]]]],
      [4, [[[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1]], [[1, 0], [0, 1], [1, 1]]]],
      [1, [[[0, 0], [1, 0], [1, 1], [2, 1]], [[1, 0], [0, 1], [1, 1], [0, 2]]]],
      [1, [[[1, 0], [2, 0], [0, 1], [1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]]]],
      [2, [[[0, 0], [1, 0], [2, 0], [1, 1]], [[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [0, 1], [1, 1], [1, 2]], [[0, 0], [0, 1], [1, 1], [0, 2]]]],
      [1, [[[0, 0], [1, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0], [2, 1]], [[1, 0], [1, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [2, 1]]]],
      [1, [[[0, 0], [1, 0], [1, 1], [1, 2]], [[2, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [0, 1], [0, 2], [1, 2]], [[0, 0], [1, 0], [2, 0], [0, 1]]]],
    ];
    var BAG = FAMILIES.reduce(function (n, f) { return n + f[0]; }, 0);

    var W, H, c, dpr, deckY, railY, x0, rows;   // layout, in CSS pixels; rows of tower under the crane
    var palette, colours, grid, heights, setRows, top, hand;
    var piece = null, trolleyX = 0, phase = null, splash = [];
    var cam = 0, knockLater = false, reveal = null;
    var running = false, last = 0, clock = 0;

    function layout() {
      W = canvas.clientWidth || 300;
      c = W / 10;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      railY = 0.35 * c;
      // About as many rows as a phone shows, fewer only where the window is too short for the
      // whole crane: beside the words on a wide screen, the hero is one screen tall.
      var beside = !matchMedia("(max-width: 52rem)").matches;
      var room = beside ? window.innerHeight - 61 - 40 : Infinity;
      rows = Math.max(9, Math.min(13, Math.floor((room - 0.9 * c - 1.25 * c - 30) / c)));
      // The rail, the rows under it, and the hull standing out of the water.
      H = Math.round(0.9 * c + rows * c + 1.25 * c + 30);
      canvas.style.height = H + "px";
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      x0 = c;                                       // the board's left edge
      deckY = H - 30 - 1.25 * c;                    // the boat's deck: the first row sits on it
    }

    // --- the tower's own rules, in miniature: land at the lowest row that fits
    function width(shape) { return 1 + Math.max.apply(null, shape.map(function (d) { return d[0]; })); }
    function tall(shape) { return 1 + Math.max.apply(null, shape.map(function (d) { return d[1]; })); }
    function landing(shape, x) {
      var y = 0;
      shape.forEach(function (d) { y = Math.max(y, heights[x + d[0]] - d[1]); });
      return y;
    }
    function draw1() {
      var r = Math.random() * BAG;
      for (var i = 0; i < FAMILIES.length; i++) {
        if ((r -= FAMILIES[i][0]) < 0) break;
      }
      var ways = FAMILIES[Math.min(i, FAMILIES.length - 1)][1];
      return ways[Math.floor(Math.random() * ways.length)];
    }
    // How a placement leaves the tower: gaps it seals under itself, how ragged the top is, how
    // high it reaches, and rows it finishes. Lower is better.
    function judge(shape, x, y) {
      var h = heights.slice(), low = {}, add = {}, holes = 0, finished = 0, bump = 0;
      shape.forEach(function (d) {
        var col = x + d[0], row = y + d[1];
        low[col] = Math.min(low[col] === undefined ? 1e9 : low[col], row);
        h[col] = Math.max(h[col], row + 1);
        add[row] = (add[row] || 0) + 1;
      });
      for (var k in low) holes += low[k] - heights[k];
      for (var r in add) if (!setRows[r] && filled(r) + add[r] === COLS) finished++;
      for (var i = 1; i < COLS; i++) bump += Math.abs(h[i] - h[i - 1]);
      return holes * 8 + bump * 0.7 + (y + tall(shape)) * 1.1 - finished * 6 + Math.random() * 1.8;
    }
    function filled(row) {
      var n = 0, g = grid[row];
      if (g) for (var i = 0; i < COLS; i++) if (g[i]) n++;
      return n;
    }
    // The bot plays the hand it is dealt: the best of the three pieces, until all three are down.
    function choose() {
      if (!hand.length) hand = [draw1(), draw1(), draw1()];
      var best = null;
      hand.forEach(function (shape, i) {
        var w = width(shape);
        for (var x = 0; x + w <= COLS; x++) {
          var y = landing(shape, x), score = judge(shape, x, y);
          if (!best || score < best.score) best = { shape: shape, i: i, x: x, y: y, w: w, score: score };
        }
      });
      hand.splice(best.i, 1);
      best.colour = 1 + Math.floor(Math.random() * (colours.length - 1));
      return best;
    }
    function place(p) {
      var closed = [];
      p.shape.forEach(function (d) {
        var row = p.y + d[1], col = p.x + d[0];
        grid[row] = grid[row] || [];
        grid[row][col] = p.colour;
        heights[col] = Math.max(heights[col], row + 1);
        top = Math.max(top, row + 1);
      });
      p.shape.forEach(function (d) {
        var row = p.y + d[1];
        if (closed.indexOf(row) < 0 && !setRows[row] && filled(row) === COLS) closed.push(row);
      });
      // A finished row takes the colour of the box that finished it, as in the game.
      closed.forEach(function (row) {
        for (var i = 0; i < COLS; i++) grid[row][i] = p.colour;
        setRows[row] = { at: clock };
      });
      return closed.length;
    }
    // The view climbs with the tower and keeps HEADROOM rows clear over it, as the game's camera does.
    function camFor() { return Math.max(0, top + HEADROOM - rows); }

    function newBoat(loaded) {
      palette = deal(palette);
      colours = hexes(palette);
      hero.style.setProperty("--field", colours[0]);
      if (bar) bar.style.setProperty("--field", colours[0]);   // the top bar wears the same sky
      if (themeMeta) themeMeta.setAttribute("content", colours[0]);
      grid = []; heights = [0, 0, 0, 0, 0, 0, 0, 0]; setRows = {}; top = 0; hand = [];
      // It comes in with a little cargo already aboard, so the interesting part starts sooner.
      var guard = 0;
      while (top < loaded && guard++ < 200) place(choose());
      for (var r in setRows) setRows[r].at = -9;
      cam = camFor();
    }

    // --- drawing
    function box(x, y, size, colour, alpha, shown) {
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.fillStyle = colour;
      if (shown < 5) {                              // pulled back on a tall tower: too small for detail
        ctx.fillRect(x + size * 0.05, y + size * 0.05, size * 0.9, size * 0.9);
        ctx.globalAlpha = 1;
        return;
      }
      var inset = size * 0.05, s = size - inset * 2, r = size * 0.14;
      rounded(x + inset, y + inset, s, s, r); ctx.fill();
      ctx.save(); rounded(x + inset, y + inset, s, s, r); ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(x, y + inset, size, size * 0.11);
      ctx.fillStyle = "rgba(0,0,0,0.26)"; ctx.fillRect(x, y + size - inset - size * 0.15, size, size * 0.15);
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fillRect(x + size * 0.36, y + size * 0.2, Math.max(1, size * 0.03), size * 0.55);
      ctx.fillRect(x + size * 0.61, y + size * 0.2, Math.max(1, size * 0.03), size * 0.55);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    function rounded(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function rail() {
      var h = 0.55 * c, g = ctx.createLinearGradient(0, railY, 0, railY + h);
      g.addColorStop(0, "#F3C877"); g.addColorStop(0.45, "#E0A83C"); g.addColorStop(1, "#8A6420");
      ctx.fillStyle = g; rounded(0.15 * c, railY, W - 0.3 * c, h, h * 0.3); ctx.fill();
      ctx.save(); rounded(0.15 * c, railY, W - 0.3 * c, h, h * 0.3); ctx.clip();
      ctx.fillStyle = "rgba(20,24,31,0.85)";
      [0.15 * c, W - 1.75 * c].forEach(function (start) {
        for (var i = 0; i < 4; i++) {
          var sx = start + i * 0.42 * c;
          ctx.beginPath(); ctx.moveTo(sx, railY + h); ctx.lineTo(sx + 0.2 * c, railY + h);
          ctx.lineTo(sx + 0.42 * c, railY); ctx.lineTo(sx + 0.22 * c, railY); ctx.closePath(); ctx.fill();
        }
      });
      ctx.restore();
    }
    // The gantry's two legs, down into the water either side of the boat.
    function legs() {
      var w = 0.34 * c, from = railY + 0.4 * c, bottom = H;
      [0.3 * c, W - 0.3 * c - w].forEach(function (x) {
        var g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, "#8A6420"); g.addColorStop(0.5, "#C98F2C"); g.addColorStop(1, "#8A6420");
        ctx.fillStyle = g;
        ctx.fillRect(x, from, w, bottom - from);
        ctx.strokeStyle = "rgba(20,24,31,0.55)"; ctx.lineWidth = Math.max(1, c * 0.035);
        for (var y = from + 0.3 * c; y < bottom; y += 0.9 * c) {
          ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + w - 1, y + 0.45 * c);
          ctx.moveTo(x + w - 1, y); ctx.lineTo(x + 1, y + 0.45 * c); ctx.stroke();
        }
      });
    }
    function trolley(x, cableTo) {
      var w = 1.1 * c, h = 0.42 * c, y = railY + 0.5 * c;
      if (cableTo !== undefined) {
        ctx.strokeStyle = "#C8CFDC"; ctx.lineWidth = Math.max(1.2, c * 0.05);
        ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, cableTo); ctx.stroke();
      }
      ctx.fillStyle = "#C98F2C"; rounded(x - w / 2, y, w, h, h * 0.3); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.fillRect(x - w / 2 + 2, y + 1, w - 4, Math.max(1, h * 0.18));
    }
    function hull() {
      var courses = [8, 6, 4], ch = 0.78 * c;
      courses.forEach(function (n, i) {
        var w = n * c, x = x0 + (COLS * c - w) / 2, y = deckY + i * ch;
        ctx.fillStyle = i === 0 ? "#6B7B8C" : i === 1 ? "#586778" : "#46535F";
        rounded(x + 1, y, w - 2, ch - 2, ch * 0.18); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(x + 3, y, w - 6, Math.max(1, ch * 0.12));
        if (i === 1) {
          ctx.fillStyle = "#F1C268";
          for (var k = 0; k < 3; k++) {
            ctx.beginPath(); ctx.arc(x + w * (0.25 + k * 0.25), y + ch * 0.45, Math.max(1.5, c * 0.07), 0, Math.PI * 2); ctx.fill();
          }
        }
      });
    }
    // The rows from..to, in the boat's own frame; scale is how big a cell is drawn, in cells.
    function tower(t, from, to, scale) {
      for (var row = Math.max(0, from); row < Math.min(grid.length, to); row++) {
        if (!grid[row]) continue;
        var y = deckY - (row + 1) * c;
        for (var col = 0; col < COLS; col++) {
          var v = grid[row][col];
          if (v) box(x0 + col * c, y, c, colours[v], 1, c * scale);
        }
        var s = setRows[row];
        if (s && t - s.at < 0.5) {                 // a finished row flashes as it locks in
          ctx.fillStyle = "rgba(255,255,255," + (0.55 * (1 - (t - s.at) / 0.5)) + ")";
          rounded(x0 + 1, y + 1, COLS * c - 2, c - 2, c * 0.14); ctx.fill();
        }
      }
    }

    // --- the story, one beat at a time
    function nextPiece() {
      piece = choose();
      piece.hang = railY + 1.3 * c;                         // top of the hanging piece
      piece.cx = x0 + (piece.x + piece.w / 2) * c;
      phase = { name: "move", t: 0, from: trolleyX, to: piece.cx, dur: 0.28 + Math.abs(piece.cx - trolleyX) / (c * 14) };
    }
    function drawPiece(p, y, alpha) {
      var ph = tall(p.shape);
      var left = trolleyX - (p.w * c) / 2;
      p.shape.forEach(function (d) { box(left + d[0] * c, y + (ph - 1 - d[1]) * c, c, colours[p.colour], alpha, c); });
    }
    function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    // How small the boat is drawn to get the whole tower, with a little sky, between the water
    // and the crane. The game's pull-back does the same: the frame stays, the tower shrinks.
    function pulledBack() {
      var room = H - 30 - 1.1 * c;
      var need = 1.25 * c + (top + REVEAL_AIR) * c;
      return Math.min(1, room / need);
    }
    // Over it goes: the view pulls back to the whole tower first if any of it is out of sight, as
    // the game's does at the end of a run, then it holds a beat, wobbles, and rolls.
    function knock() {
      reveal = { from: cam, to: pulledBack(), dir: lean() };
      if (piece) piece.leaving = 0;                   // the box on the crane is let go of
      phase = cam > 0.05 || reveal.to < 0.999
        ? { name: "reveal", t: 0, dur: 0.62 }
        : { name: "hold", t: 0, dur: 0.6 };
    }

    function step(dt) {
      clock += dt;
      if (!phase) { nextPiece(); }
      phase.t += dt;
      var k = Math.min(1, phase.t / phase.dur);
      if (piece && piece.leaving !== undefined) {
        piece.leaving += dt;
        if (piece.leaving > 0.4) piece = null;
      }
      if (phase.name === "move") {
        trolleyX = phase.from + (phase.to - phase.from) * ease(k);
        if (k >= 1) phase = { name: "drop", t: 0, dur: 0.34 };
      } else if (phase.name === "drop") {
        if (k >= 1) {
          place(piece);
          piece = null;
          if (knockLater) { knockLater = false; knock(); }
          else phase = { name: "rest", t: 0, dur: 0.3 };
        }
      } else if (phase.name === "rest") {
        if (k >= 1) phase = null;
      } else if (phase.name === "reveal") {
        if (k >= 1) phase = { name: "hold", t: 0, dur: 0.6 };
      } else if (phase.name === "hold") {
        if (k >= 1) phase = { name: "topple", t: 0, dur: 1.6 };
      } else if (phase.name === "topple") {
        if (phase.t > 0.68 && !phase.splashed) { phase.splashed = true; spray(reveal.dir); }
        if (k >= 1) phase = { name: "empty", t: 0, dur: 0.5 };
      } else if (phase.name === "empty") {
        if (k >= 1) { reveal = null; newBoat(LOADED); phase = { name: "arrive", t: 0, dur: 1.1 }; }
      } else if (phase.name === "arrive") {
        if (k >= 1) phase = null;
      }
      if (!reveal) cam += (camFor() - cam) * (1 - Math.exp(-dt * 5));
      splash = splash.filter(function (s) { s.t += dt; return s.t < s.life; });
    }
    // Which way it goes over: toward the heavier side of whatever is not locked into a row.
    function lean() {
      var m = 0, n = 0;
      for (var row = 0; row < grid.length; row++) {
        if (!grid[row] || setRows[row]) continue;
        for (var col = 0; col < COLS; col++) if (grid[row][col]) { m += col - 3.5; n++; }
      }
      return n && m !== 0 ? Math.sign(m) : (Math.random() < 0.5 ? -1 : 1);
    }
    function spray(dir) {
      var waterY = H - 34;
      for (var i = 0; i < 16; i++) {
        splash.push({
          x: W / 2 + dir * W * (0.15 + Math.random() * 0.3), y: waterY,
          vx: (Math.random() - 0.5) * c * 3, vy: -c * (3 + Math.random() * 4), t: 0, life: 0.7 + Math.random() * 0.3,
        });
      }
    }

    // Where the boat is drawn now: how far the view has climbed, in rows, and how big it is drawn.
    function view() {
      if (!reveal) return { lift: cam, scale: 1 };
      if (phase.name === "reveal") {
        var v = ease(Math.min(1, phase.t / phase.dur));
        return { lift: reveal.from * (1 - v), scale: 1 + (reveal.to - 1) * v };
      }
      return { lift: 0, scale: reveal.to };
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      legs();
      rail();

      var p = phase ? phase.name : "";
      var k = phase ? Math.min(1, phase.t / phase.dur) : 0;
      var v = view();
      var bob = still ? 0 : Math.sin(clock * 1.1) * c * 0.04 * v.scale;
      var tilt = still ? 0 : Math.sin(clock * 0.7) * 0.006;
      var dx = 0, dy = bob, angle = tilt;
      if (p === "hold") angle += Math.sin(k * Math.PI * 3) * 0.035 * k * reveal.dir;
      if (p === "topple") {
        var a = Math.pow(k, 1.8), q = Math.max(0, k - 0.35) / 0.65;
        angle += reveal.dir * (0.1 + a * 1.25);
        dy += Math.pow(q, 1.6) * (H + 2 * c);
        dx += reveal.dir * a * c * 1.2;
      }
      if (p === "empty") dy = H * 2;
      if (p === "arrive") dy += (1 - easeOut(k)) * c * 4;

      // Crane and cargo in the air stay put; the boat and its tower roll together about the waterline.
      if (piece) {
        var ph = tall(piece.shape);
        var landTop = deckY - (piece.y + ph - cam) * c + bob;
        var hangTop = p === "drop" ? piece.hang + (landTop - piece.hang) * Math.pow(k, 2) : piece.hang;
        trolley(trolleyX, hangTop);
        drawPiece(piece, hangTop, piece.leaving === undefined ? 1 : Math.max(0, 1 - piece.leaving / 0.4));
      } else {
        trolley(trolleyX);
      }

      ctx.save();
      var pivotX = x0 + (COLS * c) / 2, pivotY = H - 30;
      ctx.translate(pivotX + dx, pivotY + dy);
      ctx.rotate(angle);
      ctx.scale(v.scale, v.scale);
      ctx.translate(-pivotX, -pivotY + v.lift * c);
      hull();
      // Only the rows in sight, unless the view has pulled back to all of them.
      var whole = v.scale < 1 || p === "topple";
      tower(clock, whole ? 0 : Math.floor(v.lift) - 2, whole ? grid.length : Math.ceil(v.lift) + rows + 3, v.scale);
      ctx.restore();

      splash.forEach(function (s) {
        var t = s.t, x = s.x + s.vx * t, y = s.y + s.vy * t + 9 * c * t * t;
        ctx.fillStyle = "rgba(190,230,240," + (1 - t / s.life) + ")";
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, c * 0.08), 0, Math.PI * 2); ctx.fill();
      });
    }

    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      step(dt);
      draw();
      requestAnimationFrame(frame);
    }
    function run(on) {
      if (on === running || still) return;
      running = on;
      last = 0;
      if (on) requestAnimationFrame(frame);
    }

    // It builds until somebody taps it, then over it goes and the next boat is dealt new colours.
    // With motion reduced, the new colours arrive without the capsize.
    canvas.addEventListener("click", tap);
    canvas.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(); }
    });
    var hint = document.querySelector(".hero-hint");
    function tap() {
      if (hint) hint.style.opacity = "0";                        // they've found it
      if (still) { stillPicture(); return; }
      if (reveal || (phase && phase.name === "arrive")) return;  // already going over
      if (phase && phase.name === "drop") { knockLater = true; return; }   // let the falling box land
      knock();
      if (!running) run(true);
    }
    // One still picture: a tower most of the way up the frame, with a box waiting on the crane.
    function stillPicture() {
      newBoat(rows - HEADROOM);
      piece = choose(); phase = { name: "move", t: 0, dur: 1 };
      piece.hang = railY + 1.3 * c;
      trolleyX = x0 + (piece.x + piece.w / 2) * c;
      draw();
    }

    layout();
    trolleyX = x0 + COLS * c * 0.5;
    if (still) {
      stillPicture();
    } else {
      newBoat(LOADED);
      draw();
      // Only while anyone can see it: off screen or in a background tab, nothing runs.
      var visible = true, shown = !document.hidden;
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (e) { visible = e[0].isIntersecting; run(visible && shown); }).observe(canvas);
      }
      document.addEventListener("visibilitychange", function () { shown = !document.hidden; run(visible && shown); });
      run(true);
    }
    var resizing;
    addEventListener("resize", function () {
      clearTimeout(resizing);
      resizing = setTimeout(function () {
        var was = trolleyX / c;
        layout(); trolleyX = was * c;
        if (piece) { piece.hang = railY + 1.3 * c; piece.cx = x0 + (piece.x + piece.w / 2) * c; }
        if (!reveal) cam = camFor();
        draw();
      }, 120);
    });
  }
})();
