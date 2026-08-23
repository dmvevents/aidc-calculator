// Rack detail studio (v3.1) — page glue. Static-first: poster + spec rows
// (chips resolve to sources.html) render with NO 3D; the three.js viewer
// module (vendored, import-map resolved) dynamic-imports ONLY on the explicit
// button click. State in the shared page hash via AIDC3D helpers:
//   #detail=<variant>&dx=&fl=&pn=&lb=   (explode / flow / panel / labels)
// Import-map support is feature-detected; without it the studio stays a
// readable poster + spec table (progressive enhancement, no breakage).
"use strict";
(function () {
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function init() {
    const D = globalThis.DETAILRACKS;
    const sel = document.getElementById("detail-variant");
    const stage = document.getElementById("detail-stage");
    const btn = document.getElementById("load-detail");
    const bar = document.getElementById("detail-anims");
    const specs = document.getElementById("detail-specs");
    if (!D || !sel || !stage || !btn || !bar || !specs || !globalThis.AIDC3D) return;

    const CHIPNAME = { S: "stated", D: "derived", A: "assumed" };
    let viewer = null;
    let variant = AIDC3D.hashGet("detail");
    if (!variant || !D[variant]) variant = "gb200-nvl72";
    sel.value = variant;

    const T = { dx: 0, fl: 0, pn: 0, lb: 1 };
    for (const k of Object.keys(T)) {
      const h = AIDC3D.hashGet(k);
      if (h !== null) T[k] = h === "1" ? 1 : 0;
    }

    function poster() {
      const img = document.getElementById("detail-hero-img");
      if (!img) return;
      img.src = D[variant].poster;
      if (D[variant].alt) img.alt = D[variant].alt;   // per-variant description
    }

    function renderSpecs() {
      specs.replaceChildren();
      const dl = document.createElement("dl");
      dl.className = "hs-rows";
      for (const r of D[variant].rows) {
        const dt = document.createElement("dt");
        dt.textContent = r.k;
        const dd = document.createElement("dd");
        const chip = document.createElement("a");
        chip.className = "chip chip-" + r.chip.toLowerCase();
        chip.href = "sources.html#" + r.cite;
        chip.title = CHIPNAME[r.chip] + " — see source entry";
        chip.textContent = r.chip;
        dd.append(r.v + " ", chip);
        dl.append(dt, dd);
      }
      specs.appendChild(dl);
    }

    // animation toggle buttons — stamped, bound here; disabled until loaded
    const toggles = {};
    for (const b of bar.querySelectorAll("[data-anim]")) {
      const k = b.dataset.anim;
      toggles[k] = b;
      b.disabled = true;
      b.setAttribute("aria-pressed", String(!!T[k]));
      b.addEventListener("click", () => {
        T[k] = T[k] ? 0 : 1;
        b.setAttribute("aria-pressed", String(!!T[k]));
        if (viewer) viewer.set(k, T[k]);
        AIDC3D.hashSet({ [k]: T[k] ? "1" : null });
        if ((k === "dx" || k === "fl") && T[k]) openPanelWithAnim();
        syncToggleAvailability();
      });
    }
    function syncToggleAvailability() {
      const caps = new Set(D[variant].anims);
      const capOf = { dx: "explode", fl: "flow", pn: "panel", lb: "explode" };
      for (const [k, b] of Object.entries(toggles)) {
        const capable = caps.has(capOf[k]);
        b.hidden = !capable;
        b.disabled = !viewer || !capable;
        b.setAttribute("aria-pressed", String(!!T[k] && capable));
      }
      // labels only ever show in exploded/panel views — keep the Labels
      // toggle visibly inert until one of those is on (A-16)
      if (toggles.lb && viewer) {
        toggles.lb.disabled = !(T.dx || T.pn);
        toggles.lb.title = (T.dx || T.pn) ? "" :
          "labels appear in the exploded or open-panel views";
      }
      // the panel must stay open while exploded/flowing (N-03) — lock the
      // toggle; the reason is VISIBLE and AT-reachable, not title-only (R2-04)
      if (toggles.pn && viewer) {
        const lock = (T.dx || T.fl) && T.pn;
        toggles.pn.disabled = toggles.pn.disabled || lock;
        toggles.pn.title = lock ?
          "the panel stays open while the exploded view or coolant flow is on" : "";
        const hint = document.getElementById("detail-lockhint");
        if (hint) {
          hint.hidden = !lock;
          if (lock) toggles.pn.setAttribute("aria-describedby", "detail-lockhint");
          else toggles.pn.removeAttribute("aria-describedby");
        }
      }
    }

    // exploding slides trays THROUGH a closed door/panel, and the coolant
    // strips live BEHIND the rear service panel — either animation without
    // the panel open is physically dishonest/invisible, so both open it
    function openPanelWithAnim() {
      if (T.pn || !(T.dx || T.fl)) return;
      if (!(new Set(D[variant].anims)).has("panel")) return;
      T.pn = 1;
      if (toggles.pn) toggles.pn.setAttribute("aria-pressed", "true");
      if (viewer) viewer.set("pn", 1);
      AIDC3D.hashSet({ pn: "1" });
    }

    function clearUnsupported() {
      // a variant without flow geometry must not keep the flow engine running
      // (hidden-control-still-animating; N-10) — clear state, hash and button
      if (!(new Set(D[variant].anims)).has("flow") && T.fl) {
        T.fl = 0;
        if (toggles.fl) toggles.fl.setAttribute("aria-pressed", "false");
        if (viewer) viewer.set("fl", 0);
        AIDC3D.hashSet({ fl: null });
      }
    }

    function applyVariant() {
      poster();
      renderSpecs();
      clearUnsupported();
      syncToggleAvailability();
      if (viewer) viewer.setVariant(variant);
    }

    sel.addEventListener("change", () => {
      variant = sel.value;
      applyVariant();
      AIDC3D.hashSet({ detail: variant });
    });

    const note = document.getElementById("detail-loadnote");
    btn.addEventListener("click", () => {
      const okMaps = typeof HTMLScriptElement !== "undefined" &&
        HTMLScriptElement.supports && HTMLScriptElement.supports("importmap");
      if (!okMaps) {
        btn.disabled = true;
        if (note) note.textContent = "This browser lacks import-map support — " +
          "the static views above stay fully readable; try a current browser " +
          "for the interactive studio.";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Loading studio…";
      // NOTE: dynamic import() resolves against THIS script's URL
      // (assets/js/), not the page — hence the sibling path.
      import("./viewer3d_detail.js").then((m) => {
        viewer = m.mount({
          stage, variant, manifest: D,
          initial: { dx: T.dx, fl: T.fl, pn: T.pn, lb: T.lb },
        });
        btn.textContent = "Studio loaded";
        btn.hidden = true;
        const rst = document.getElementById("detail-reset");
        if (rst) {
          rst.hidden = false;
          rst.addEventListener("click", () => viewer.resetView());
        }
        clearUnsupported();       // e.g. #detail=<air-rack>&fl=1 (N-10)
        openPanelWithAnim();      // hash-restored dx/fl without pn: open the panel
        syncToggleAvailability();
        for (const [k, v] of Object.entries(T)) if (v !== undefined) viewer.set(k, T[k]);
        if (RM && note) note.textContent = "Reduced motion is on — animations " +
          "apply as instant state changes; nothing moves on its own.";
      }).catch((e) => {
        btn.textContent = "Studio failed to load — retry";
        btn.disabled = false;
        if (note) note.textContent = "Load error: " + ((e && e.message) || e);
      });
    });

    applyVariant();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
