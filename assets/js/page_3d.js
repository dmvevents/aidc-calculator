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
  function init() {
    const btn = document.getElementById("load3d");
    const stage = document.getElementById("twin-stage");
    const sel = document.getElementById("twin-variant");
    if (!btn || !stage || !sel || !globalThis.AIDC3D) return;
    let loaded = false;    // model-viewer fallback mounted
    let gpuRow = null;     // WebGPU handle

    // Fill the selector from the variant set when platforms.js is loaded. It is
    // NOT in this tree yet (consolidation W3 adds it), hence the guard: until
    // then the page keeps the selector markup build_pages.py emits.
    if (globalThis.AIDC && globalThis.AIDC.platforms) {
      globalThis.AIDC.platforms.populateSelect(sel, {
        detailOnly: false,
        shortLabels: true,
      });
    }
    // The offered platform list is READ BACK off the selector rather than kept
    // as a second hardcoded array here. This file used to carry its own copy of
    // the four names, so the page markup and the deep-link validator could
    // disagree — and once platforms.js populates the selector, a copy here
    // would silently shrink #variant= deep links back to four platforms.
    // One list, one place, whichever fills it.
    const VARIANTS = Array.prototype.map.call(sel.options, (o) => o.value);

    // Poster URL from the generated manifest (rowposters.js), never built by
    // string concatenation: only 4 of the 11 variants have a bespoke hero
    // render, so "assets/img/hero-" + variant + ".webp" 404'd on the other 7
    // (DSX-61). Variants without one fall back to the generic row poster.
    //
    // rowposters.js is added by consolidation W4, so ROWPOSTERS is undefined in
    // this tree and the manifest branch cannot run yet. Sending every variant to
    // the generic render in the meantime would DOWNGRADE the page: the four
    // variants the selector currently offers each have a bespoke
    // hero-<variant>.webp on disk and are shown it today.
    //
    // So while the selector is still the page's own markup, keep showing the
    // bespoke render — the concatenated path is safe for exactly that list,
    // because every name in it has the file. The moment platforms.js drives the
    // selector (W3) that stops being true for 7 of 11 variants, which is the
    // DSX-61 404, so from then on a variant with no manifest entry gets the
    // generic render instead of a URL that would 404. Both conditions retire
    // themselves when W4 lands the manifest. [D]
    //
    // DSX-71: DSX-25 arrived with a SECOND generated manifest for this same
    // table (heroes.js / HERO_IMAGES, byte-identical content). Shipping both
    // would be the drift this work exists to remove, so the manifest is
    // rowposters.js — the one tests/test_platform_coverage.py resolves against
    // assets/img/ on disk — and DSX-25's contribution kept here is the part
    // rowposters.js had no answer for: TELLING THE USER the static preview is
    // generic rather than silently showing another platform's render.
    const GENERIC_POSTER = "assets/img/hero-scene-row.webp";
    const registryDriven = !!(globalThis.AIDC && globalThis.AIDC.platforms);
    function bespokePoster(variant) {
      if (globalThis.ROWPOSTERS) return !!globalThis.ROWPOSTERS[variant];
      return !registryDriven;      // page-markup list: all of it has a render
    }
    function posterFor(variant) {
      if (globalThis.ROWPOSTERS) {
        return globalThis.ROWPOSTERS[variant] ||
          globalThis.ROWPOSTERS_FALLBACK || GENERIC_POSTER;
      }
      return registryDriven ? GENERIC_POSTER
        : "assets/img/hero-" + variant + ".webp";
    }
    function heroSwap(variant) {
      const img = document.getElementById("twin-hero-img");
      if (!img) return;
      const bespoke = bespokePoster(variant);
      img.src = posterFor(variant);
      img.alt = bespoke ? rowAlt(variant)
        : "Generic row-geometry render — this platform has no bespoke static " +
          "render yet; load the interactive 3D for its generated row model.";
      const note = document.getElementById("twin-hero-note");
      if (note) {
        note.hidden = bespoke;
        note.textContent = bespoke ? "" :
          "Static preview is the generic row render — the per-platform row model " +
          "for this variant is generated (assets/models/" + variant + ".glb); " +
          "press “Load interactive 3D” to view it.";
      }
    }
    function rowAlt(variant) {
      return "Procedural 3D model of one " + variant +
        " row group: compute racks, in-row CDUs and fabric racks generated from the generic variant data.";
    }
    function mount(variant) {
      const mv = document.createElement("model-viewer");
      mv.setAttribute("src", "assets/models/" + variant + ".glb");
      mv.setAttribute("poster", posterFor(variant));
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
    } else if (sel.options.length) {
      // No hash, or a variant this build does not offer: show the selector's own
      // first option. Without this the hero image kept whatever variant the page
      // markup hardcoded into its src while the selector showed another.
      sel.value = sel.options[0].value;
      heroSwap(sel.value);
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
