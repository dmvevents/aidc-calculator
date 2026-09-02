// Parametric-site section glue (3d.html): platform + GPU inputs -> the
// scenelayout solver (engine-derived counts) -> live stats immediately,
// three.js scene on the explicit "Compute & load 3D" click (dynamic import,
// same vendored-module policy as the detail studio). Follows the shared
// scenario when one is set; the page's own inputs win once touched.
"use strict";
(function () {
  // forward this script's own cache-buster (?v…) to the dynamic import so the
  // viewer module busts in lockstep with the page's asset tag
  const VTAG = (document.currentScript && (document.currentScript.src.split("?")[1] || "")) || "";
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  if (!A || !DB || !A.sceneLayout) return;

  const PLATFORMS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];
  const $ = (id) => document.getElementById(id);
  let viewer = null, viewerMod = null, layerState = {};

  function storedScenario() {
    // 3d.html has no app/scenario pipeline — read the documented localStorage
    // key directly (same contract the scenario bar persists)
    try {
      const s = JSON.parse(localStorage.getItem("aidc.scenario"));
      return (s && DB[s.platform] && Number(s.target) > 0) ? s : null;
    } catch (e) { return null; }
  }
  function deriveGpus(plat, driver, target) {
    const g = DB[plat].gpus_per_rack, k = DB[plat].nameplate_kw;
    const ceilEps = (x) => Math.ceil(x - 1e-9 * Math.max(1, Math.abs(x)));
    let racks;
    if (driver === "gpus") racks = ceilEps(target / g);
    else if (driver === "mw") racks = ceilEps(target * 1000 / k);
    else racks = Math.round(target);
    return Math.max(1, racks) * g;
  }

  function currentInputs() {
    const scen = storedScenario();
    const platSel = $("param-platform"), gpuInp = $("param-gpus");
    let plat = platSel && platSel.value;
    let gpus = gpuInp && Number(gpuInp.value);
    if ((!plat || !gpus) && scen) {
      const g2 = deriveGpus(scen.platform, scen.driver, Number(scen.target));
      if (!plat) { plat = scen.platform; if (platSel) platSel.value = plat; }
      if (!gpus) { gpus = g2; if (gpuInp) gpuInp.value = String(g2); }
    }
    if (!plat) plat = "gb200-nvl72";
    if (!gpus || !(gpus > 0)) gpus = 512;
    return { plat: plat, gpus: Math.round(gpus) };
  }

  function renderStats(layout) {
    const host = $("param-stats");
    if (!host) return;
    const frag = document.createDocumentFragment();
    for (const [k, v, chip, cite] of layout.stats) {
      const row = document.createElement("div");
      row.className = "param-row";
      const kk = document.createElement("span");
      kk.className = "param-k";
      kk.textContent = k;
      const vv = document.createElement("span");
      vv.className = "param-v";
      vv.textContent = v + " ";
      const a = document.createElement("a");
      a.className = "chip chip-" + chip.toLowerCase();
      a.href = "sources.html#" + cite;
      a.textContent = chip;
      a.setAttribute("aria-label", (chip === "D" ? "derived" : "assumed") + " — view source");
      vv.appendChild(a);
      row.append(kk, vv);
      frag.appendChild(row);
    }
    host.replaceChildren(frag);
  }

  function recompute() {
    const { plat, gpus } = currentInputs();
    const layout = A.sceneLayout.solve(plat, gpus);
    renderStats(layout);
    if (viewer && viewerMod) {
      viewer.dispose();
      viewer = viewerMod.mount($("param-stage"), layout, layerState);
    }
    return layout;
  }

  async function load3d() {
    const btn = $("param-load");
    if (btn) { btn.disabled = true; btn.textContent = "loading three.js…"; }
    try {
      // dynamic import() in a classic script resolves against THIS script's
      // URL (the documented trap) — sibling path, not page-relative
      viewerMod = await import("./viewer3d_param.js" + (VTAG ? "?" + VTAG : ""));
      const layout = A.sceneLayout.solve(currentInputs().plat, currentInputs().gpus);
      viewer = viewerMod.mount($("param-stage"), layout, layerState);
      if (btn) { btn.textContent = "Recompute"; btn.disabled = false; }
      $("param-stage").classList.add("is-live");
    } catch (e) {
      if (btn) { btn.textContent = "3D failed to load — stats above still live"; }
    }
  }

  function boot() {
    const platSel = $("param-platform");
    if (platSel && !platSel.options.length) {
      for (const n of PLATFORMS) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = DB[n].platform;
        platSel.appendChild(o);
      }
    }
    recompute();
    if (platSel) platSel.addEventListener("change", recompute);
    const gpuInp = $("param-gpus");
    if (gpuInp) gpuInp.addEventListener("change", recompute);
    const btn = $("param-load");
    if (btn) btn.addEventListener("click", () => (viewer ? recompute() : load3d()));
    document.querySelectorAll("#param-layers input").forEach((cb) => {
      layerState[cb.dataset.layer] = cb.checked;
      cb.addEventListener("change", () => {
        layerState[cb.dataset.layer] = cb.checked;
        if (viewer) viewer.applyLayers(layerState);
      });
    });
  }

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
  else boot();
})();
