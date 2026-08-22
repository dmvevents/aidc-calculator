// 3D viewer page — static hero webp per variant; the self-hosted model-viewer
// bundle (~1 MB, Apache-2.0) loads ONLY on the explicit button click. The
// chosen variant lives in this page's URL hash (#variant=<name>) so links
// reproduce the view; rack.html deep-links here the same way.
"use strict";
(function () {
  const VARIANTS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];

  function init() {
    const btn = document.getElementById("load3d");
    const stage = document.getElementById("twin-stage");
    const sel = document.getElementById("twin-variant");
    if (!btn || !stage || !sel) return;
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
    const m = /(?:^#|[#&])variant=([a-z0-9-]+)/.exec(location.hash || "");
    if (m && VARIANTS.includes(m[1])) {
      sel.value = m[1];
      heroSwap(m[1]);
    }

    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Loading viewer…";
      const s = document.createElement("script");
      s.src = "assets/vendor/model-viewer-umd.min.js";
      s.onload = () => {
        loaded = true;
        btn.textContent = "Interactive 3D loaded";
        btn.hidden = true;
        mount(sel.value);
      };
      s.onerror = () => { btn.textContent = "Viewer failed to load"; btn.disabled = false; };
      document.body.appendChild(s);
    });
    sel.addEventListener("change", () => {
      heroSwap(sel.value);
      if (loaded) mount(sel.value);
      history.replaceState(null, "", "#variant=" + sel.value);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
