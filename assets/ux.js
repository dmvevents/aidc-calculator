// ux.js — DSX-17 visual-audit fixes that need a measurement, not a media query.
// Truth document: workstations/site-ux/audit-findings.md (DSX-16).
//
// Two jobs, both of which CSS cannot do on its own:
//
//   1. D2 — publish each diagram SVG's authored viewBox width as --ux-vbw, so
//      the mobile rule can size the diagram to what it was drawn at instead of
//      a flat 560/640px guess that left labels at 5.7–7.1px.
//   2. D2 + D4 — toggle .ux-ovf-l / .ux-ovf-r on horizontally scrollable
//      containers that are ACTUALLY overflowing. site.css:582 records why this
//      is measured rather than declared: a static mask erased the last nav
//      link's glyphs on wide screens with nothing to scroll.
//
// Vanilla, no libraries, no network. Idempotent and safe to run repeatedly.
"use strict";
(function () {
  // the diagram mounts, the site-plan / hall-plan stages, and the table scrollers
  const SCROLLERS = ".matrix-scroll, .plan-stage, .siteplan, .nav-inner";
  const SVG_SEL = "svg.dg, svg.hp, svg.sp";
  const EPS = 4; // sub-pixel layout noise, not real overflow

  function isDiagramMount(el) {
    const svg = el.firstElementChild;
    return !!svg && svg.tagName.toLowerCase() === "svg" &&
      /\b(dg|hp|sp)\b/.test(svg.getAttribute("class") || "");
  }

  function scrollers() {
    const out = [];
    for (const el of document.querySelectorAll(SCROLLERS)) out.push(el);
    // diagram mounts are anonymous <div>s around the SVG (#power-oneline, …);
    // :has() is not used here so the set is identical on older engines
    for (const svg of document.querySelectorAll(SVG_SEL)) {
      const p = svg.parentElement;
      if (p && p.tagName.toLowerCase() === "div" && isDiagramMount(p) &&
          out.indexOf(p) === -1) out.push(p);
    }
    return out;
  }

  // D2 — each SVG carries its own authored width; nothing else knows it
  function publishViewBox() {
    for (const svg of document.querySelectorAll(SVG_SEL)) {
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width) continue;
      svg.style.setProperty("--ux-vbw", Math.round(vb.width) + "px");
    }
  }

  // D2 + D4 — honest overflow state
  function measure() {
    for (const el of scrollers()) {
      const hidden = el.scrollWidth - el.clientWidth;
      if (hidden <= EPS) {
        el.classList.remove("ux-ovf-l", "ux-ovf-r");
        continue;
      }
      const left = el.scrollLeft;
      el.classList.toggle("ux-ovf-l", left > EPS);
      el.classList.toggle("ux-ovf-r", left < hidden - EPS);
      if (!el.dataset.uxScroll) {
        el.dataset.uxScroll = "1";
        el.addEventListener("scroll", schedule, { passive: true });
      }
    }
  }

  // D5 — nav.js PREPENDS the drawer overlay + aside to <body>, which pushed the
  // statically-inserted skip link to third child and made the drawer's close
  // button the first focusable element (measured: firstFocusableIsSkip false
  // with the anchor present). Re-assert first position after nav.js has run,
  // and on every later measure, so nothing can get in front of it.
  function ensureSkipFirst() {
    const a = document.querySelector("a.skip-link");
    if (a && document.body.firstElementChild !== a) document.body.prepend(a);
  }

  let queued = false;
  function run() {
    if (!queued) return;
    queued = false;
    ensureSkipFirst();
    publishViewBox();
    measure();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    // rAF alone is not enough: in a hidden or occluded tab it never fires, and
    // the diagrams would keep the flat 560px fallback with no affordance. The
    // page's own progressive boot loader backs rAF the same way.
    requestAnimationFrame(run);
    setTimeout(run, 120);
  }

  function start() {
    queued = true;
    run(); // synchronous first pass: correct on the very first paint
    schedule();
    addEventListener("resize", schedule, { passive: true });
    // the calculators re-render their diagrams and tables on every input, and
    // <details> disclosure changes what is measurable
    new MutationObserver(schedule).observe(document.body,
      { childList: true, subtree: true, attributeFilter: ["open"] });
    // web fonts land after first paint and change every text advance
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }

  if (document.readyState === "loading") {
    addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
