/* TallmanGames homepage: the crane in the hero, and the Box Stack demo.
 *
 * The hero is a picture of the game rather than a recording of it. A crane lowers boxes onto a
 * little boat, rows that fill up lock in the colour of the box that finished them, and when the
 * tower gets too tall it rolls over into the harbour and a new boat comes in. Every boat is dealt
 * one of the game's own palettes, and the sky behind it is that palette's background, just as a
 * tower in the game climbs through its bands.
 */
(function () {
  "use strict";

  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ the palettes
  // Every palette in the game whose background is dark enough to be a night sky. Background first,
  // then its three box colours. Generated from palettes.json; see the site README.
  var SKIES = "160512B6D94587D99AF3C9E9,01051EC1B87BD7DDFED87DB7,140236DECEFD49C5B3A8CA68,20040AFBDFE5F5A5B7DB9275,0600422BCA399288FEC3BDFF,190507E68891F6D5D89297CE,420519FCD9E55ADDB2C3D666,1E062D51C89CC682EEEBD2F9,230101FECECD30B0324FAEB0,032544ABD57B97CBFACEE7FD,121731E9D8E9AFF8F099B4C2,221B1CA2F6C446C8A9ABC1F8,12132BCBF6D49AB1ACCEC6C0,191128E9CDE0E6DCEA79A1E2,100439ACC9B077A68DF3AC90,261F37C0C5CEF4D4A4BFC1DF,260209FCCFD7F9A2B2F12248,120A295FD87DAE60C7E1DBF6,0D0C4698F0C6BC73D4E699E4,2112162CBA95EBDBDFD378BD,08033BDBD8FDC2BCFCA858DF,3D1B1AB5AAF382DB43EBC7F9,102328B0B9F7BDD0D0ABB9C9,05174351B74EC0F0F172CAA0,1B0132BD7B7A7CC4C5E9D2FE,150D0AB5775FECDBD5C9AD4A,332414D4B5CAD9E2DC93F0E6,1A1320CBBCD974A942E8E2EE,2C121149C4CA87D98BC69458,1E0231D8AB69ECD4FD2C9FAA,02192CCFE8FC78BF73D149DA,271911E5D9E75FB91DBC9F38,150E114A87DE2EAD79E5D7DD,1D1B227DDE9995AB5F43B69E,2D1754D4AADFE0DED7D3E6CC,1C2513E1EAD6BCD1A479B2E6,042F43C4B8D57EF7BBEFBAB3,281016B2CB729CDDAA6CA15E,2E1505FAE4D686CF7DA58AD0,230D303BA4B5C592E22DCD93,2A040AF9C3CBA5C369687AD9,2F091AC0CA2BB573B1E05A95,1E101531BF90B37388DD69C9,36020C51A53BFED7DFF8224D,0E11157785A2CBA043D284C3,360720ECA55595A786B4BC9F,1F0F11CA949B6EC662C26F3D,071C27BB6CCBD8EDF860A352,03141B1CA4E432911DD2EDF9,430F0FB4A8A2C5D3C5DDEFA4,231A10DC60DAD6BDA3AA74DC,2B043AC07CB067A8BCF3D9FD,300D2ECBB290D361CBF5DBF3,26192EC6918B4ABBC9E5DBEB,1B0D2177CA53ECDEF22689A1,1111507AA88FC4B8EAADC497,281301C7666BDC6705FBA156,3A2C2DDCA7BFF3CE82F4B3F0,2D1129BEDACB88A58FC6AE86,2E1D2FAFD0AFE3BFD88CB380,201B049E8615B9D8795FC881,220C3137A074E8D6F54AACB5,0028025BC896029E0802EC0C,2B1712DDE7CA8F7EC488F2CA,0B2337B6B8424AB57B56AE4C,191F43B998A4E2E0E6F2ABAB,252218E57BE0F0C1B7D37886,2F1A04D57614C06DC0FBE6D0,032B2168F6D1CB72899BC026,290A26DB72D2339099F5D6F2,0C131170843E6AA29673BF89,0F2938BAE17A3FC92C499CCE,2B1056D4F2DAE260B0D77FA0,211F1239AC656FB3ABBBB483,311725BF759DEFDDE7C4BF5A,3F1155A4E5B7A8EBC8DF868E,3C0840D1C5DD18BEE7B9929E,1D2003B8CC148981CAAC813E,430442F779F4FDD9FC5F97D3,212C2BE1CABC56CD91C69A53,0B2C37738EDE83DC65BBD373,122F3AC3E3BAD3C0CE4CBD7A,242D1B51C8ADD4CBB58EAF93,241F2DEFDFBDC896DF998D33,450146DFDE58A779D873A7D9".split(",");

  function deal(not) {
    var p;
    do { p = SKIES[Math.floor(Math.random() * SKIES.length)]; } while (SKIES.length > 1 && p === not);
    return p;
  }
  function hexes(p) { return ["#" + p.slice(0, 6), "#" + p.slice(6, 12), "#" + p.slice(12, 18), "#" + p.slice(18, 24)]; }

  // ------------------------------------------------------------------ the dock
  var canvas = document.getElementById("dock");
  var hero = document.getElementById("hero");
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  if (canvas && canvas.getContext) dock();

  function dock() {
    var ctx = canvas.getContext("2d");
    var COLS = 8, TOPPLE_AT = 7, LOADED = 3;
    var SHAPES = [
      [[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]],
    ];
    var W, H, c, dpr, deckY, railY, x0;         // layout, in CSS pixels
    var palette, colours, grid, heights, setRows;
    var piece = null, trolleyX = 0, phase = null, boat = null, splash = [];
    var running = false, last = 0, clock = 0;

    function layout() {
      W = canvas.clientWidth || 300;
      c = W / 10;
      TOPPLE_AT = W < 340 ? 5 : 7;                  // a phone gets a shorter tower, and a shorter hero
      // Rail, air for a hanging piece, the tower, and the hull standing out of the water.
      H = Math.round(0.35 * c + 0.6 * c + 2.2 * c + TOPPLE_AT * c + 1.25 * c + 30);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.height = H + "px";
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      x0 = c;                                       // the board's left edge
      deckY = H - 30 - 1.25 * c;                    // the boat's deck: the first row sits on it
      railY = 0.35 * c;
    }

    // --- the tower's own rules, in miniature: land at the lowest row that fits
    function landing(shape, x) {
      var y = 0;
      shape.forEach(function (d) { y = Math.max(y, heights[x + d[0]] - d[1]); });
      return y;
    }
    function holes(shape, x, y) {
      var n = 0, low = {};
      shape.forEach(function (d) { low[d[0]] = Math.min(low[d[0]] === undefined ? 99 : low[d[0]], d[1]); });
      for (var k in low) n += (y + low[k]) - heights[x + Number(k)];
      return n;
    }
    function choose() {
      var best = null;
      SHAPES.forEach(function (shape) {
        var w = 1 + Math.max.apply(null, shape.map(function (d) { return d[0]; }));
        for (var x = 0; x + w <= COLS; x++) {
          var y = landing(shape, x);
          var score = holes(shape, x, y) * 10 + y * 1.5 + Math.random() * 2.2;
          if (!best || score < best.score) best = { shape: shape, x: x, y: y, w: w, score: score };
        }
      });
      best.colour = 1 + Math.floor(Math.random() * 3);
      return best;
    }
    function place(p) {
      var closed = [];
      p.shape.forEach(function (d) {
        var row = p.y + d[1], col = p.x + d[0];
        grid[row] = grid[row] || [];
        grid[row][col] = p.colour;
        heights[col] = Math.max(heights[col], row + 1);
      });
      p.shape.forEach(function (d) {
        var row = p.y + d[1];
        if (closed.indexOf(row) < 0 && grid[row].filter(function (v) { return v; }).length === COLS && !setRows[row]) closed.push(row);
      });
      // A finished row takes the colour of the box that finished it, as in the game.
      closed.forEach(function (row) {
        for (var i = 0; i < COLS; i++) grid[row][i] = p.colour;
        setRows[row] = { at: clock };
      });
      return closed.length;
    }
    function tallest() { return Math.max.apply(null, heights); }

    function newBoat(loaded) {
      palette = deal(palette);
      colours = hexes(palette);
      hero.style.setProperty("--field", colours[0]);
      if (themeMeta) themeMeta.setAttribute("content", colours[0]);
      grid = []; heights = [0, 0, 0, 0, 0, 0, 0, 0]; setRows = {};
      // It comes in with a little cargo already aboard, so the interesting part starts sooner.
      var guard = 0;
      while (tallest() < loaded && guard++ < 60) place(choose());
      for (var r in setRows) setRows[r].at = -9;
    }

    // --- drawing
    function box(x, y, size, colour, alpha) {
      var inset = size * 0.05, s = size - inset * 2, r = size * 0.14;
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.fillStyle = colour;
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
      var w = 0.34 * c, top = railY + 0.4 * c, bottom = H;
      [0.3 * c, W - 0.3 * c - w].forEach(function (x) {
        var g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, "#8A6420"); g.addColorStop(0.5, "#C98F2C"); g.addColorStop(1, "#8A6420");
        ctx.fillStyle = g;
        ctx.fillRect(x, top, w, bottom - top);
        ctx.strokeStyle = "rgba(20,24,31,0.55)"; ctx.lineWidth = Math.max(1, c * 0.035);
        for (var y = top + 0.3 * c; y < bottom; y += 0.9 * c) {
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
    function tower(t) {
      for (var row = 0; row < grid.length; row++) {
        if (!grid[row]) continue;
        var y = deckY - (row + 1) * c;
        for (var col = 0; col < COLS; col++) {
          var v = grid[row][col];
          if (v) box(x0 + col * c, y, c, colours[v]);
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
    function drawPiece(p, top, alpha) {
      var ph = 1 + Math.max.apply(null, p.shape.map(function (d) { return d[1]; }));
      var left = trolleyX - (p.w * c) / 2;
      p.shape.forEach(function (d) { box(left + d[0] * c, top + (ph - 1 - d[1]) * c, c, colours[p.colour], alpha); });
      return ph;
    }
    function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    function step(dt) {
      clock += dt;
      if (!phase) { nextPiece(); }
      phase.t += dt;
      var k = Math.min(1, phase.t / phase.dur);
      if (phase.name === "move") {
        trolleyX = phase.from + (phase.to - phase.from) * ease(k);
        if (k >= 1) phase = { name: "drop", t: 0, dur: 0.34 };
      } else if (phase.name === "drop") {
        if (k >= 1) {
          place(piece);
          piece = null;
          phase = tallest() >= TOPPLE_AT
            ? { name: "wobble", t: 0, dur: 0.9, dir: lean() }
            : { name: "rest", t: 0, dur: 0.32 };
        }
      } else if (phase.name === "rest") {
        if (k >= 1) phase = null;
      } else if (phase.name === "wobble") {
        if (k >= 1) phase = { name: "topple", t: 0, dur: 1.5, dir: phase.dir };
      } else if (phase.name === "topple") {
        if (phase.t > 0.62 && !phase.splashed) { phase.splashed = true; spray(phase.dir); }
        if (k >= 1) phase = { name: "empty", t: 0, dur: 0.5 };
      } else if (phase.name === "empty") {
        if (k >= 1) { newBoat(LOADED); phase = { name: "arrive", t: 0, dur: 1.1 }; }
      } else if (phase.name === "arrive") {
        if (k >= 1) phase = null;
      }
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
      for (var i = 0; i < 14; i++) {
        splash.push({
          x: W / 2 + dir * c * (2 + Math.random() * 3), y: waterY,
          vx: (Math.random() - 0.5) * c * 3, vy: -c * (3 + Math.random() * 4), t: 0, life: 0.7 + Math.random() * 0.3,
        });
      }
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      legs();
      rail();

      var p = phase ? phase.name : "";
      var k = phase ? Math.min(1, phase.t / phase.dur) : 0;
      var bob = still ? 0 : Math.sin(clock * 1.1) * c * 0.04;
      var tilt = still ? 0 : Math.sin(clock * 0.7) * 0.006;
      var dx = 0, dy = bob, angle = tilt;
      if (p === "wobble") angle += Math.sin(k * Math.PI * 3) * 0.035 * k * phase.dir;
      if (p === "topple") {
        var a = Math.pow(k, 1.8);
        angle += phase.dir * (0.1 + a * 1.25);
        dy += Math.max(0, k - 0.35) / 0.65 * (TOPPLE_AT + 5) * c * Math.pow(Math.max(0, k - 0.35) / 0.65, 0.6);
        dx += phase.dir * a * c * 1.2;
      }
      if (p === "empty") dy = H;
      if (p === "arrive") dy += (1 - easeOut(k)) * c * 4;

      // Crane and cargo in the air stay put; the boat and its tower roll together about the waterline.
      var hanging = piece && (p === "move" || p === "drop");
      if (hanging) {
        var ph = 1 + Math.max.apply(null, piece.shape.map(function (d) { return d[1]; }));
        var landTop = deckY - (piece.y + ph) * c + bob;
        var top = p === "drop" ? piece.hang + (landTop - piece.hang) * Math.pow(k, 2) : piece.hang;
        trolley(trolleyX, top);
        drawPiece(piece, top);
      } else {
        trolley(trolleyX);
      }

      ctx.save();
      var pivotX = x0 + (COLS * c) / 2, pivotY = H - 30;
      ctx.translate(pivotX + dx, pivotY + dy);
      ctx.rotate(angle);
      ctx.translate(-pivotX, -pivotY);
      hull();
      tower(clock);
      ctx.restore();

      splash.forEach(function (s) {
        var t = s.t, x = s.x + s.vx * t, y = s.y + s.vy * t + 9 * c * t * t;
        ctx.fillStyle = "rgba(190,230,240," + (1 - t / s.life) + ")";
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, c * 0.08), 0, Math.PI * 2); ctx.fill();
      });
    }
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

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

    // Tap the boat and over it goes; the next one is dealt new colours. With motion reduced, the
    // new colours arrive without the capsize.
    canvas.addEventListener("click", knock);
    canvas.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); knock(); }
    });
    var hint = document.querySelector(".hero-hint");
    function knock() {
      if (hint) hint.style.opacity = "0";                        // they've found it
      if (still) { newBoat(5); draw(); return; }
      var busy = phase && ["wobble", "topple", "empty", "arrive"].indexOf(phase.name) >= 0;
      if (busy) return;
      if (piece && phase && phase.name === "drop") return;      // let the box that is falling land
      piece = null;
      phase = { name: "wobble", t: 0, dur: 0.5, dir: lean() };
      if (!running) run(true);
    }

    layout();
    newBoat(still ? 5 : LOADED);
    trolleyX = x0 + COLS * c * 0.5;
    if (still) {
      // One still picture: a tower mid-build, with a box waiting on the crane.
      piece = choose(); phase = { name: "move", t: 0, dur: 1 };
      trolleyX = x0 + (piece.x + piece.w / 2) * c;
      draw();
    } else {
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
        draw();
      }, 120);
    });
  }

  // ------------------------------------------------------------------ the demo
  // The real game, from Box Stack's playable ad, in website mode: no store button of its own, and
  // BUILD AGAIN deals a new tower. On a big screen it runs inside the phone as soon as you scroll
  // to it; on a phone it opens over the whole screen when you tap, which is the only size it plays
  // well at there.
  var screen = document.getElementById("demo-screen");
  var start = document.getElementById("demo-start");
  var after = document.getElementById("demo-after");
  var sheet = document.getElementById("demo-sheet");
  var closeBtn = document.getElementById("demo-close");
  if (!screen || !start) return;

  var SRC = "demo.html?host=web";
  var STORE = "https://play.google.com/store/apps/details?id=com.boxstacker.app";
  var roomy = matchMedia("(min-width: 52.01rem) and (min-height: 620px)");

  function game(where) {
    var f = document.createElement("iframe");
    f.src = SRC;
    f.title = "Box Stack demo";
    f.setAttribute("allow", "autoplay");
    f.addEventListener("load", function () { listen(f); });
    where.appendChild(f);
    return f;
  }

  // The demo tells the page how a run went. It is on this same site, so the page can listen.
  function listen(f) {
    try {
      f.contentWindow.addEventListener("boxstack:playable", function (e) {
        var name = e.detail && e.detail.name;
        if (name === "loss") say("Toppled! It happens to the best of us.");
        else if (name === "survived") say("Still standing. Nicely done!");
        else if (name === "replay") say("");
      });
    } catch (err) { /* a different origin, as when opened from a file: the demo still plays */ }
  }
  function say(text) {
    if (!after) return;
    after.innerHTML = "";
    if (!text) return;
    var p = document.createElement("div");
    p.textContent = text + " There's a lot more where that came from.";
    var a = document.createElement("a");
    a.className = "btn primary";
    a.href = STORE;
    a.rel = "noopener";
    a.textContent = "Get the full game, free";
    after.appendChild(p);
    after.appendChild(a);
  }

  // Big screens: live in the phone, loaded as it comes into view.
  var inline = null;
  function goInline() {
    if (inline) return;
    start.remove();
    inline = game(screen);
  }
  if (roomy.matches && "IntersectionObserver" in window) {
    var near = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { near.disconnect(); goInline(); }
    }, { rootMargin: "250px 0px" });
    near.observe(screen);
  }

  // Phones: over the whole screen, and the back button closes it.
  var sheetGame = null, opener = null;
  function open() {
    if (roomy.matches) { goInline(); return; }
    opener = document.activeElement;
    sheet.hidden = false;
    document.documentElement.classList.add("sheet-open");
    sheetGame = game(sheet);
    closeBtn.focus();
    history.pushState({ demo: true }, "");
  }
  function close(fromHistory) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    document.documentElement.classList.remove("sheet-open");
    if (sheetGame) { sheetGame.remove(); sheetGame = null; }
    if (opener && opener.focus) opener.focus();
    if (!fromHistory && history.state && history.state.demo) history.back();
  }
  start.addEventListener("click", open);
  closeBtn.addEventListener("click", function () { close(false); });
  addEventListener("popstate", function () { close(true); });
  addEventListener("keydown", function (e) { if (e.key === "Escape") close(false); });
})();
