// Row-geometry section (per-platform GLBs) — static hero webp per variant;
// the self-hosted model-viewer bundle loads ONLY on the explicit button click,
// via the shared AIDC3D loader (viewer3d.js), so the building scene and this
// section never fetch the vendor file twice. The chosen variant lives in this
// page's URL hash (#variant=<name>, merged with the building scene's
// #view/#layers keys) so links reproduce the view; rack.html deep-links here.
"use strict";
(function () {
  const VARIANTS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];

  function init() {
    const btn = document.getElementById("load3d");
    const stage = document.getElementById("twin-stage");
    const sel = document.getElementById("twin-variant");
    if (!btn || !stage || !sel || !globalThis.AIDC3D) return;
    let loaded = false;

    function heroSwap(variant) {
      const img = document.getElementById("twin-hero-img");
      if (img) img.src = "assets/img/hero-" + variant + ".webp";
    }
    function mount(variant) {
      const mv = document.createElement("model-viewer");
      mv.setAttribute("src", "assets/models/" + variant + ".glb");
      mv.setAttribute("poster", "assets/img/hero-" + variant + ".webp");
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("touch-action", "pan-y");
      mv.setAttribute("shadow-intensity", "0.6");
      mv.setAttribute("exposure", "1.05");
      mv.setAttribute("camera-orbit", "35deg 68deg 110%");
      mv.setAttribute("alt", "Procedural 3D model of one " + variant +
        " row group: compute racks, in-row CDUs and fabric racks generated from the generic variant data.");
      stage.replaceChildren(mv);
    }

    // per-page hash state: restore #variant=<name>
    const v = AIDC3D.hashGet("variant");
    if (v && VARIANTS.includes(v)) {
      sel.value = v;
      heroSwap(v);
    }

    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Loading viewer…";
      AIDC3D.loadVendor().then(() => {
        loaded = true;
        btn.textContent = "Interactive 3D loaded";
        btn.hidden = true;
        mount(sel.value);
      }).catch(() => {
        btn.textContent = "Viewer failed to load — retry";
        btn.disabled = false;
      });
    });
    sel.addEventListener("change", () => {
      heroSwap(sel.value);
      if (loaded) mount(sel.value);
      AIDC3D.hashSet({ variant: sel.value });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
