/* The Play page: Box Stack's playable ad in website mode (no store button of its own, and BUILD
 * AGAIN deals a new tower). The demo tells the page how a run went; it is on this same site, so
 * the page can listen, and answers under the game. */
(function () {
  "use strict";
  var frame = document.getElementById("demo");
  var said = document.getElementById("demo-said");
  if (!frame || !said) return;

  function say(text) { said.textContent = text; }

  function listen() {
    try {
      frame.contentWindow.addEventListener("boxstack:playable", function (e) {
        var name = e.detail && e.detail.name;
        if (name === "loss") say("Toppled! It happens to the best of us.");
        // The demo ends at its last piece, and from there the building carries on in the app.
        else if (name === "survived" && e.detail.reason === "crate_limit") {
          say("That's the end of the demo: all " + e.detail.placements + " pieces placed. Keep building in the app.");
        }
        else if (name === "survived") say("Still standing. Nicely done!");
        else if (name === "replay") say("");
      });
    } catch (err) { /* a different origin, as when opened from a file: the demo still plays */ }
  }
  frame.addEventListener("load", listen);
  // The frame may have finished loading before this script ran.
  try { if (frame.contentDocument && frame.contentDocument.readyState === "complete") listen(); } catch (err) {}
})();
