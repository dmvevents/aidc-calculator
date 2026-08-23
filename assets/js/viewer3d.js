// Building-scene viewer — presets, layer toggles, provenance hotspots.
// Data comes from the GENERATED scene3d.js manifest (same math as the GLB);
// this file is hand-written logic only. The self-hosted model-viewer bundle
// (~1 MB, Apache-2.0) loads ONLY on the explicit button click; until then the
// page is a static hero + a fully readable annotations grid, so every chipped
// value is available without WebGL. View state lives in the page URL hash
// (#view=<preset>&layers=<on,list>&variant=<rack-variant>) so a link
// reproduces the exact view — same URLSearchParams convention as the
// calculator pages' input state.
"use strict";
(function () {
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- shared helpers (page_3d.js reuses these) -----------------------------
  let vendorPromise = null;
  function loadVendor() {
    if (customElements.get("model-viewer")) return Promise.resolve();
    if (vendorPromise) return vendorPromise;
    vendorPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "assets/vendor/model-viewer-umd.min.js";
      s.onload = () => res();
      s.onerror = () => { vendorPromise = null; rej(new Error("vendor load failed")); };
      document.body.appendChild(s);
    });
    return vendorPromise;
  }
  function hashGet(key) {
    const ps = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    return ps.get(key);
  }
  function hashSet(pairs) {
    const ps = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    for (const [k, v] of Object.entries(pairs)) {
      if (v === null || v === undefined || v === "") ps.delete(k);
      else ps.set(k, v);
    }
    const s = ps.toString();
    history.replaceState(null, "", s ? "#" + s : location.pathname);
  }
  globalThis.AIDC3D = { loadVendor, hashGet, hashSet };

  // ---- building-scene experience --------------------------------------------
  function init() {
    const S = globalThis.SCENE3D;
    const stage = document.getElementById("scene-stage");
    const presetBar = document.getElementById("scene-presets");
    const layerBar = document.getElementById("scene-layers");
    const grid = document.getElementById("scene-annotations");
    const loadBtn = document.getElementById("load-scene");
    if (!S || !stage || !presetBar || !layerBar || !grid || !loadBtn) return;

    const CHIPNAME = { S: "stated", D: "derived", A: "assumed" };
    let viewer = null;
    let activePreset = byId(S.presets, hashGet("view")) || byId(S.presets, "building") || S.presets[0];
    const layerState = {};
    for (const l of S.layers) layerState[l.id] = !!activePreset.layers[l.id];
    const hashLayers = hashGet("layers");
    if (hashLayers !== null) {
      const on = new Set(hashLayers.split(",").filter(Boolean));
      for (const l of S.layers) layerState[l.id] = on.has(l.id);
    }

    function byId(arr, id) { return arr.find((x) => x.id === id) || null; }
    function onLayers() {
      return S.layers.filter((l) => layerState[l.id]).map((l) => l.id).join(",");
    }
    function writeHash() { AIDC3D.hashSet({ view: activePreset.id, layers: onLayers() }); }

    // preset buttons + layer checkboxes are STAMPED in the page (no layout
    // shift, readable without JS) — bind them to the manifest here; anything
    // the manifest has that the page lacks gets created as a fallback
    const presetBtns = {};
    for (const p of S.presets) {
      let b = presetBar.querySelector('[data-preset="' + p.id + '"]');
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "btn preset-btn";
        b.dataset.preset = p.id;
        presetBar.appendChild(b);
      }
      b.textContent = p.label;
      b.setAttribute("aria-pressed", String(p.id === activePreset.id));
      b.addEventListener("click", () => applyPreset(p, true, true));
      presetBtns[p.id] = b;
    }

    const layerInputs = {};
    for (const l of S.layers) {
      let c = layerBar.querySelector('input[data-layer="' + l.id + '"]');
      if (!c) {
        const lab = document.createElement("label");
        lab.className = "lyr";
        c = document.createElement("input");
        c.type = "checkbox";
        c.dataset.layer = l.id;
        lab.append(c, " " + l.label);
        layerBar.appendChild(lab);
      }
      c.checked = layerState[l.id];
      c.addEventListener("change", () => {
        layerState[l.id] = c.checked;
        applyLayers();
        writeHash();
      });
      layerInputs[l.id] = c;
    }

    // annotations grid — the hotspot spec cards, readable without any 3D
    S.hotspots.forEach((h, i) => {
      const art = document.createElement("article");
      art.className = "hs-item";
      art.id = "hs-" + h.id;
      const h3 = document.createElement("h3");
      const num = document.createElement("span");
      num.className = "hs-num";
      num.textContent = String(i + 1);
      h3.append(num, " " + h.label);
      const dl = document.createElement("dl");
      dl.className = "hs-rows";
      for (const r of h.rows) {
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
      const note = document.createElement("p");
      note.className = "hs-note";
      note.textContent = h.note;
      const link = document.createElement("a");
      link.className = "hs-link";
      link.href = h.link.href;
      link.textContent = h.link.label + " →";
      art.append(h3, dl, note, link);
      grid.appendChild(art);
    });

    function focusCard(id) {
      for (const el of grid.querySelectorAll(".hs-item.is-active")) el.classList.remove("is-active");
      const el = document.getElementById("hs-" + id);
      if (!el) return;
      el.classList.add("is-active");
      el.scrollIntoView({ block: "nearest", behavior: RM ? "auto" : "smooth" });
    }

    function heroSwap() {
      const img = document.getElementById("scene-hero-img");
      if (img) img.src = S.posterBase + activePreset.id + ".webp";
    }

    function applyLayers() {
      // look materials up LIVE on every apply and drive them from the
      // manifest's authoritative factors — the renderer may rebuild its
      // scene after load, which silently discards mutations made through
      // stale scene-graph wrappers
      const live = {};
      if (viewer && viewer.model) {
        for (const m of viewer.model.materials) live[m.name] = m;
      }
      for (const l of S.layers) {
        const on = layerState[l.id];
        for (const name of l.mats) {
          const mat = live[name];
          const orig = S.materials[name];
          if (!mat || !orig) continue;
          const f = orig.factor.slice();
          if (!on) { mat.setAlphaMode("BLEND"); f[3] = 0; }
          else mat.setAlphaMode(orig.mode);
          mat.pbrMetallicRoughness.setBaseColorFactor(f);
        }
        if (layerInputs[l.id]) layerInputs[l.id].checked = on;
      }
      if (viewer) {
        for (const b of viewer.querySelectorAll(".hs-dot")) {
          const lid = b.dataset.layer;
          b.hidden = !!lid && !layerState[lid];
        }
      }
    }

    function applyPreset(p, resetLayers, write) {
      activePreset = p;
      for (const [id, b] of Object.entries(presetBtns)) {
        b.setAttribute("aria-pressed", String(id === p.id));
      }
      if (resetLayers) {
        for (const l of S.layers) layerState[l.id] = !!p.layers[l.id];
      }
      if (viewer) {
        viewer.setAttribute("camera-orbit", p.orbit);
        viewer.setAttribute("camera-target", p.target);
        viewer.setAttribute("field-of-view", p.fov);
        if (RM && viewer.jumpCameraToGoal) viewer.jumpCameraToGoal();
      } else {
        heroSwap();
      }
      applyLayers();
      if (write) writeHash();
    }

    function mount() {
      const mv = document.createElement("model-viewer");
      mv.setAttribute("src", S.glb);
      mv.setAttribute("poster", S.posterBase + activePreset.id + ".webp");
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("touch-action", "pan-y");
      mv.setAttribute("interaction-prompt", "none");
      mv.setAttribute("shadow-intensity", "0.45");
      mv.setAttribute("exposure", "1.05");
      mv.setAttribute("interpolation-decay", "160");
      mv.setAttribute("min-camera-orbit", "auto 0deg 1.5m");
      mv.setAttribute("max-camera-orbit", "auto 88deg 160m");
      mv.setAttribute("camera-orbit", activePreset.orbit);
      mv.setAttribute("camera-target", activePreset.target);
      mv.setAttribute("field-of-view", activePreset.fov);
      mv.setAttribute("alt", "Procedural 3D scene of a generic single-hall AI " +
        "data center: four contained rack rows, mechanical gallery with CRAH and " +
        "CDU units, electrical rooms, MV yard, genset pad and dry-cooler pad.");
      S.hotspots.forEach((h, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.slot = "hotspot-" + h.id;
        b.className = "hs-dot";
        b.dataset.position = h.pos;
        b.dataset.normal = h.normal;
        b.dataset.layer = h.layer;
        b.setAttribute("aria-label", h.label + " — show spec card");
        b.textContent = String(i + 1);
        b.addEventListener("click", () => focusCard(h.id));
        mv.appendChild(b);
      });
      mv.addEventListener("load", () => {
        applyLayers();
        // re-assert once the renderer settles (async environment/scene work
        // after 'load' can rebuild materials and drop earlier mutations)
        setTimeout(applyLayers, 700);
        setTimeout(applyLayers, 2000);
      });
      stage.replaceChildren(mv);
      viewer = mv;
      applyLayers();
    }

    loadBtn.addEventListener("click", () => {
      loadBtn.disabled = true;
      loadBtn.textContent = "Loading viewer…";
      loadVendor().then(() => {
        loadBtn.textContent = "Interactive 3D loaded";
        loadBtn.hidden = true;
        mount();
      }).catch(() => {
        loadBtn.textContent = "Viewer failed to load — retry";
        loadBtn.disabled = false;
      });
    });

    // boot: reflect the (possibly hash-restored) state without loading 3D
    // and without touching the URL — hash writes happen on user action only
    applyPreset(activePreset, hashLayers === null, false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
