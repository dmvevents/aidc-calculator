// Row-geometry section (per-platform GLBs) — static hero webp per variant.
// PRIMARY renderer: the shared first-party WebGPU module (probed + imported
// via AIDC3D.loadWebGPU, same policy: only on the explicit button click).
// Fallback: the self-hosted model-viewer bundle via the shared AIDC3D loader
// (viewer3d.js), so the building scene and this section never fetch either
// renderer twice. The chosen variant lives in this page's URL hash
// (#variant=<name>, merged with the building scene's #view/#layers keys) so
// links reproduce the view; rack.html deep-links here.
"use strict";
(function () {
  const VARIANTS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];

  function init() {
    const btn = document.getElementById("load3d");
    const stage = document.getElementById("twin-stage");
    const sel = document.getElementById("twin-variant");
    if (!btn || !stage || !sel || !globalThis.AIDC3D) return;
    let loaded = false;    // model-viewer fallback mounted
    let gpuRow = null;     // WebGPU handle

    function heroSwap(variant) {
      const img = document.getElementById("twin-hero-img");
      if (img) img.src = "assets/img/hero-" + variant + ".webp";
    }
    function rowAlt(variant) {
      return "Procedural 3D model of one " + variant +
        " row group: compute racks, in-row CDUs and fabric racks generated from the generic variant data.";
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
      mv.setAttribute("alt", rowAlt(variant));
      stage.replaceChildren(mv);
    }
    function mountGPU(mod, variant) {
      // dispose the old handle BEFORE the new mount: its render loop must
      // stop and its swapchain unconfigure while its canvas is still in the
      // DOM (removing a live presenting canvas first has been observed to
      // lose the whole shared device on headless software WebGPU)
      if (gpuRow) { gpuRow.dispose(); gpuRow = null; }
      return mod.mountScene(stage, {
        glbUrl: "assets/models/" + variant + ".glb",
        // row GLBs carry their factors in the GLB itself (no manifest table);
        // bounding-sphere autoframe stands in for the fallback's "35deg 68deg 110%"
        camera: { autoFrame: { thetaDeg: 35, phiDeg: 68, pct: 0.85, fovDeg: 30 } },
        clampRadius: [1, 80],
        clampPhiDeg: [0, 88],
        reducedMotion: AIDC3D.reducedMotion,
        selfTestImage: AIDC3D.hashGet("gputest") === "1",
        registerGlobal: "__AIDC_WEBGPU_ROW",
        ariaLabel: rowAlt(variant),
      }).then((h) => {
        gpuRow = h;
        return true;
      }, (err) => {
        window.__AIDC_WEBGPU_STATUS = "fallback: row mount failed — " + err;
        return false;
      });
    }
    function loadAny(variant) {
      return AIDC3D.loadWebGPU()
        .then((mod) => (mod ? mountGPU(mod, variant) : false))
        .then((ok) => {
          if (ok) return true;
          return AIDC3D.loadVendor().then(() => {
            loaded = true;
            mount(variant);
            return true;
          });
        });
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
      loadAny(sel.value).then((ok) => {
        if (ok) {
          btn.textContent = "Interactive 3D loaded";
          btn.hidden = true;
        }
      }).catch(() => {
        btn.textContent = "Viewer failed to load — retry";
        btn.disabled = false;
      });
    });
    sel.addEventListener("change", () => {
      heroSwap(sel.value);
      if (gpuRow) {
        AIDC3D.loadWebGPU().then((mod) => { if (mod) mountGPU(mod, sel.value); });
      } else if (loaded) {
        mount(sel.value);
      }
      AIDC3D.hashSet({ variant: sel.value });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
