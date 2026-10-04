/* TallmanGames — the little bits every page shares. Nothing here is needed to read a page. */
(function () {
  "use strict";
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The year in the footer, so it never goes stale.
  Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (el) {
    el.textContent = new Date().getFullYear();
  });

  // Copy buttons: the email address, one tap.
  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (b) {
    b.addEventListener("click", function () {
      var text = b.getAttribute("data-copy");
      var done = function () {
        b.textContent = "Copied!";
        b.classList.add("done");
        setTimeout(function () { b.textContent = "Copy"; b.classList.remove("done"); }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { location.href = "mailto:" + text; });
      } else {
        location.href = "mailto:" + text;
      }
    });
  });

  // A store link that isn't live yet says so instead of going anywhere.
  var soon = null;
  Array.prototype.forEach.call(document.querySelectorAll("[data-soon]"), function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      if (!window.HTMLDialogElement) { alert("Coming soon"); return; }
      if (!soon) {
        soon = document.createElement("dialog");
        soon.className = "soon";
        soon.setAttribute("aria-labelledby", "soon-title");
        soon.innerHTML = '<h2 id="soon-title">Coming soon</h2><p>Box Stack is on its way to the App Store</p>' +
          '<form method="dialog"><button class="btn primary">OK</button></form>';
        soon.addEventListener("click", function (ev) { if (ev.target === soon) soon.close(); });
        document.body.appendChild(soon);
      }
      soon.showModal();
    });
  });

  // Sections rise into place as they arrive.
  var rising = document.querySelectorAll("[data-reveal]");
  if (still || !("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(rising, function (el) { el.classList.add("shown"); });
  } else {
    var watch = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("shown"); watch.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(rising, function (el) { watch.observe(el); });
  }

  // Over the homepage's night hero the top bar is clear; past it, solid.
  var bar = document.querySelector(".topbar"), hero = document.getElementById("hero");
  if (bar && hero) {
    var set = function () { bar.classList.toggle("clear", hero.getBoundingClientRect().bottom > bar.offsetHeight + 8); };
    addEventListener("scroll", set, { passive: true });
    addEventListener("resize", set);
    set();
  }
})();
