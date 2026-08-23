// Rack detail studio viewer — three.js (vendored 0.185.1, MIT; import-map
// resolved). Loaded ONLY via dynamic import() after the explicit user click.
// Behavior is data-driven from GLB extras (SimReady-metadata pattern):
//   node.extras.explode=[dx,dy,dz]  node.extras.hinge={axis,deg}
//   node.extras.label/.chip/.cite   material extras flow=supply|return, led=1
// prefers-reduced-motion: no auto animation, toggles apply instantly, flow
// and LED pulse render static. Render policy: continuous rAF ONLY while the
// coolant-flow toggle is on (and the stage is on-screen); the idle LED pulse
// renders at a slow 8 fps timer, everything else is render-on-demand.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const VENDOR = "assets/vendor/three-0.185.1/";

// Bounded 1-D interval pack — THE single layout primitive for every label and
// pill column (R3-01/R3-02: three clamp-after-solve bugs in a row proved that
// per-call clamps undo the solve; both bounds now live INSIDE the sweep).
// items: [{y, h}] anchors+heights (any order). Returns tops[] in input order.
// Forward pass stacks downward from the TOP bound; backward pass pulls up
// against the BOTTOM bound. If the total fits (callers guarantee it — the
// text mode via the capacity gate, the pill mode via iterative re-clustering)
// the result is overlap-free AND in-bounds by construction; if it cannot fit,
// separation wins and the column protrudes past the TOP edge (never overlaps).
export function packColumn(items, top, bottom, gap) {
  const order = items.map((it, i) => i)
    .sort((a, b) => items[a].y - items[b].y || a - b);
  const tops = new Array(items.length);
  let prev = top;
  for (const i of order) {
    const t = Math.max(items[i].y - items[i].h / 2, prev);
    tops[i] = t;
    prev = t + items[i].h + gap;
  }
  let next = bottom;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (tops[i] + items[i].h > next) tops[i] = next - items[i].h;
    next = tops[i] - gap;
  }
  return tops;
}

export function mount(opts) {
  const { stage, manifest } = opts;
  const state = { variant: opts.variant, dx: 0, fl: 0, pn: 0, lb: 1,
                  loaded: false, lod: "proxy", ...opts.initial };
  state.dx = +state.dx ? 1 : 0; state.fl = +state.fl ? 1 : 0;
  state.pn = +state.pn ? 1 : 0; state.lb = state.lb === 0 || state.lb === "0" ? 0 : 1;

  // ---- renderer / scene ----------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
  const key = new THREE.DirectionalLight(0xeef3fa, 1.6); key.position.set(2.5, 3.2, 3.5);
  const rim = new THREE.DirectionalLight(0x38bdf8, 0.5); rim.position.set(-3.0, 1.6, -2.5);
  scene.add(key, rim, new THREE.AmbientLight(0x8391a6, 0.35));

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x0d1420, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  stage.replaceChildren(renderer.domElement);
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y";
  renderer.domElement.setAttribute("role", "img");
  const labelLayer = document.createElement("div");
  labelLayer.className = "d3-labels";
  stage.appendChild(labelLayer);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !RM;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.maxTargetRadius = 3.0;   // pan stays within the rack's neighborhood (R4-06)
  controls.addEventListener("change", requestRender);
  let userOrbited = false;
  controls.addEventListener("start", () => { userOrbited = true; });
  // N-01R: labels are solved ONLY at camera rest. Any camera change marks
  // motion; a debounced timer forces one more frame ~240 ms after the last
  // change so the settled solve actually runs.
  let lastCamMove = -1e9, settleTimer = 0, labelDirty = true;
  const SETTLE_MS = 220;
  // R4-04 settle latch: after a settled solve the controls are FROZEN — tick
  // stops calling controls.update(), so the damping tail cannot emit marginal
  // 'change' events at all (they flapped text<->dots 7-11x per flick). Only a
  // REAL gesture ('start': pointer/wheel/touch) or a programmatic camera move
  // unfreezes. Event semantics, not timing — fps-independent by construction.
  let camFrozen = false;
  function unfreeze() {
    if (!camFrozen) return;
    camFrozen = false;
    requestRender();
  }
  controls.addEventListener("start", unfreeze);
  // epsilon gate stays as the second line: sub-visual deltas are not motion
  const _lastPos = new THREE.Vector3(1e9, 0, 0), _lastTgt = new THREE.Vector3();
  controls.addEventListener("change", () => {
    const d = camera.position.distanceToSquared(_lastPos) +
              controls.target.distanceToSquared(_lastTgt);
    _lastPos.copy(camera.position);
    _lastTgt.copy(controls.target);
    if (d < 1e-8) return;            // sub-visual damping tail: not motion
    lastCamMove = performance.now();
    labelDirty = true;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(requestRender, SETTLE_MS + 30);
  });

  // ---- loaders ---------------------------------------------------------------
  const ktx2 = new KTX2Loader().setTranscoderPath(VENDOR + "addons/libs/basis/")
    .detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2);

  // ---- model state -----------------------------------------------------------
  let model = null, proxy = null, disposed = false;
  let explodeNodes = [], hingeNode = null, hingeBase = null;
  let flowMats = [], ledMats = [], labelNodes = [];
  let tw = { dx: state.dx, pn: state.pn };       // tweened 0..1 values
  let userCam = false;                            // external setCamera wins over load-fit
  const clock = new THREE.Clock();

  function fitCamera(h, az = 0.38, el = 0.24, mul = 1) {
    camFrozen = false;
    const d = h * 2.35 * mul;
    camera.position.set(Math.sin(az) * d, h * (0.46 + Math.sin(el)), Math.cos(az) * d);
    controls.target.set(0, h * 0.46, 0);
    controls.update();
  }

  function addProxy(name) {
    removeProxy();
    const dims = manifest[name].dims_m;
    proxy = new THREE.Mesh(
      new THREE.BoxGeometry(dims[0], dims[2], dims[1]),
      new THREE.MeshStandardMaterial({ color: 0x16202f, roughness: 0.6, metalness: 0.15 }));
    proxy.position.y = dims[2] / 2;
    scene.add(proxy);
    state.lod = "proxy";
    fitCamera(dims[2]);
    requestRender();
  }
  function removeProxy() {
    if (proxy) { scene.remove(proxy); proxy.geometry.dispose(); proxy.material.dispose(); proxy = null; }
  }

  function clearModel() {
    if (!model) return;
    scene.remove(model);
    model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material])
        .forEach((m) => m.dispose());
    });
    model = null;
    explodeNodes = []; hingeNode = null; flowMats = []; ledMats = []; labelNodes = [];
    labelLayer.replaceChildren();
    legend.replaceChildren();
    stageKey.replaceChildren();
    legendOff();
  }

  function collect(root) {
    const seenMats = new Set();
    root.traverse((o) => {
      const ex = o.userData || {};
      if (ex.explode) explodeNodes.push({ o, base: o.position.clone(),
                                          off: new THREE.Vector3(...ex.explode) });
      if (ex.hinge) { hingeNode = o; hingeBase = o.rotation.y;
                      o.userData._deg = ex.hinge.deg || -120; }
      if (ex.label) labelNodes.push(o);
      if (o.material && !seenMats.has(o.material)) {
        seenMats.add(o.material);
        const mx = o.material.userData || {};
        if (mx.flow) flowMats.push({ m: o.material, dir: mx.flow === "supply" ? 1 : -1 });
        if (mx.led) ledMats.push(o.material);
      }
    });
    // GLTFLoader dedups textures by source: both flow strips would share ONE
    // THREE.Texture and the supply(+)/return(-) scrolls would cancel out —
    // clone so each direction owns its offset.
    const seenTex = new Set();
    for (const f of flowMats) {
      let t = f.m.map;
      if (!t) continue;
      if (seenTex.has(t)) { f.m.map = t.clone(); f.m.map.needsUpdate = true; t = f.m.map; }
      seenTex.add(t);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }
  }

  // legend list (mobile label mode) lives right after the stage; the page
  // template stamps #detail-legend, the render harness gets one created
  let legend = document.getElementById("detail-legend");
  if (!legend) {
    legend = document.createElement("ol");
    legend.id = "detail-legend";
    legend.className = "d3-legend";
    legend.hidden = true;
    stage.insertAdjacentElement("afterend", legend);
  }
  // R3-03: numbered markers must never be keyless — while the camera moves
  // (and through the damping tail) the legend stays up with a resolving note;
  // it hides only after the text solve has been settled for a beat, so rapid
  // drag-release cycles cannot stroboscope it.
  let legendNote = document.getElementById("detail-legend-note");
  if (!legendNote) {
    legendNote = document.createElement("p");
    legendNote.id = "detail-legend-note";
    legendNote.className = "micro";
    legendNote.hidden = true;
    legend.insertAdjacentElement("beforebegin", legendNote);
  }
  // R4-01: the copy must not promise text labels where dots are the settled
  // mode (all <950px-class stages) — chosen per the CURRENT settled mode
  const NOTE_TEXTMODE = "camera moving — numbered markers key to this list; " +
    "full labels return when the view settles";
  const NOTE_DOTMODE = "camera moving — numbered markers key to this list";
  // R4-03: at short viewports the below-stage legend cannot coexist with the
  // stage on screen — a compact key overlays INSIDE the stage during dot
  // states so numbered markers are never keyless in practice
  let stageKey = document.getElementById("detail-stagekey");
  if (!stageKey) {
    stageKey = document.createElement("ol");
    stageKey.id = "detail-stagekey";
    stageKey.className = "d3-stagekey";
    stageKey.hidden = true;
    stageKey.setAttribute("aria-hidden", "true");  // visual echo of the legend (R5-03)
    stage.appendChild(stageKey);
  }
  function legendUsablyVisible() {
    // R5-02: the invariant is markers-never-keyless IN PRACTICE — "usable"
    // means at least ~4 key rows (120 px) of the below-stage legend are on
    // screen; phone-portrait passes this (≈8 rows visible), short windows
    // and landscape phones do not and get the on-stage key instead
    const vh = window.innerHeight || 1e9;
    let top, height;
    if (legend.hidden) {
      top = stage.getBoundingClientRect().bottom + 24;
      height = legend.scrollHeight || 260;
    } else {
      const r = legend.getBoundingClientRect();
      top = r.top;
      height = r.height;
    }
    const visible = Math.min(vh, top + height) - Math.max(0, top);
    return visible >= 120;
  }
  function syncStageKey(dotsActive) {
    const show = dotsActive && !legendUsablyVisible();
    stageKey.hidden = !show;
    // compact variant on narrow stages so the key never occludes the model
    stageKey.classList.toggle("d3-compact", stage.clientWidth < 640);
  }
  let legendHideTimer = 0;
  const keyArea = document.getElementById("detail-keyarea");
  function pinKeyArea() {
    // R4-07: reserve the key block's space once it has rendered, so legend
    // show/hide cannot pump the layout below the stage on every orbit
    if (!keyArea) return;
    const need = keyArea.offsetHeight;
    const cur = parseFloat(keyArea.style.minHeight) || 0;
    if (need > cur) keyArea.style.minHeight = need + "px";
  }
  function legendDots(movingNow) {
    clearTimeout(legendHideTimer);
    legendHideTimer = 0;
    legend.hidden = false;
    if (movingNow) {
      const dotSettled = stage.clientWidth < 640 || settledMode === "dots";
      legendNote.textContent = dotSettled ? NOTE_DOTMODE : NOTE_TEXTMODE;
      legendNote.hidden = false;
    } else legendNote.hidden = true;
    syncStageKey(true);
    pinKeyArea();
  }
  function legendTextSettled() {
    legendNote.hidden = true;
    syncStageKey(false);
    if (legend.hidden || legendHideTimer) return;
    legendHideTimer = setTimeout(() => {
      legendHideTimer = 0;
      legend.hidden = true;
    }, 600);
  }
  function legendOff() {
    clearTimeout(legendHideTimer);
    legendHideTimer = 0;
    legend.hidden = true;
    legendNote.hidden = true;
    if (stageKey) stageKey.hidden = true;
  }

  const FIXED_LABEL_CSS = "left:0;top:0;width:max-content;max-width:260px";

  function chipLink(o) {
    const chip = o.userData.chip || "A";
    const a = document.createElement("a");
    a.className = "chip chip-" + chip.toLowerCase();
    a.href = "sources.html#" + (o.userData.cite || "detail3d-method");
    a.textContent = chip;
    a.title = "provenance — see source entry";
    return a;
  }

  function buildLabels() {
    labelLayer.replaceChildren();
    legend.replaceChildren();
    stageKey.replaceChildren();
    labelNodes.forEach((o, i) => {
      const d = document.createElement("div");
      d.className = "d3-label";
      d.style.cssText = FIXED_LABEL_CSS;
      const s = document.createElement("span");
      s.textContent = o.userData.label;
      d.append(s, chipLink(o));
      labelLayer.appendChild(d);
      o.userData._el = d;
      o.userData._h = 0;   // measured lazily at solve time, position-independent
      // numbered dot marker (small-viewport mode — keyed to the legend)
      const dot = document.createElement("div");
      dot.className = "d3-dot";
      dot.textContent = String(i + 1);
      labelLayer.appendChild(dot);
      o.userData._dot = dot;
      const li = document.createElement("li");
      const t = document.createElement("span");
      t.textContent = o.userData.label + " ";
      li.append(t, chipLink(o));
      legend.appendChild(li);
      const ki = document.createElement("li");
      const short = o.userData.label.split("—")[0].trim();
      ki.textContent = short.length > 30 ? short.slice(0, 29) + "…" : short;
      stageKey.appendChild(ki);
    });
  }

  function load(name) {
    state.variant = name;
    state.loaded = false;
    renderer.domElement.setAttribute("aria-label",
      (manifest[name] && manifest[name].alt) || ("Detail 3D model: " + name));
    clearModel();
    addProxy(name);
    const url = manifest[name].glb;
    loader.load(url, (gltf) => {
      if (disposed || state.variant !== name) return;
      removeProxy();
      model = gltf.scene;
      scene.add(model);
      collect(model);
      buildLabels();
      state.loaded = true;
      state.lod = "detail";
      labelDirty = true;
      applyAll(true);
      if (!userCam) {
        // hash-restored flow: land directly on the rear quarter where the
        // flow strips are visible, instead of front-fit-then-nothing (A-09)
        if (state.fl && !userOrbited)
          fitCamera(manifest[name].dims_m[2], Math.PI * 1.12, 0.14, 1);
        else fitCamera(manifest[name].dims_m[2]);
      }
      requestRender();
      report();
    }, undefined, (e) => {
      state.error = String((e && e.message) || e);
      report();
    });
  }

  // ---- animation state -------------------------------------------------------
  let raf = 0, needsFrame = false, visible = true, tweening = false;

  const io = new IntersectionObserver((es) => {
    visible = es[0] ? es[0].isIntersecting : true;
    schedule();
  });
  io.observe(stage);
  document.addEventListener("visibilitychange", schedule);

  function continuous() {
    return !RM && visible && !document.hidden && state.loaded && !!state.fl;
  }
  // idle LED pulse renders at ~8 fps via a timer, NOT a continuous rAF loop —
  // a flag-check no-op whenever hidden/off-screen/unloaded/flow-running
  const ledTimer = setInterval(() => {
    if (!RM && visible && !document.hidden && state.loaded &&
        ledMats.length && !continuous()) requestRender();
  }, 125);
  function requestRender() { needsFrame = true; schedule(); }
  function schedule() {
    if (raf) return;
    if (continuous() || needsFrame || tweening) raf = requestAnimationFrame(tick);
  }

  function applyExplode(t) {
    for (const n of explodeNodes)
      n.o.position.copy(n.base).addScaledVector(n.off, t);
  }
  function applyHinge(t) {
    if (!hingeNode) return;
    hingeNode.rotation.y = hingeBase + THREE.MathUtils.degToRad(hingeNode.userData._deg) * t;
  }
  function applyAll(instant) {
    if (instant) { tw.dx = state.dx; tw.pn = state.pn; }
    applyExplode(tw.dx);
    applyHinge(tw.pn);
    updateLabels();
  }

  function runsText(idxs) {
    // EXACT membership as contiguous runs ("7, 9–11") — a min–max range over
    // non-contiguous members asserts markers it doesn't contain (R2-02)
    const s = [...idxs].sort((a, b) => a - b);
    const parts = [];
    let a = s[0], b = s[0];
    for (let i = 1; i <= s.length; i++) {
      if (s[i] === b + 1) { b = s[i]; continue; }
      parts.push(a === b ? String(a) : (b === a + 1 ? a + "," + b : a + "–" + b));
      a = b = s[i];
    }
    return parts.join(",");
  }

  function dotMode(items, w, h) {
    for (const it of items) {
      it.o.userData._el.style.display = "none";
      it.o.userData._el.classList.remove("d3-in");
    }
    const on = [];
    items.forEach((it, i) => {
      const dot = it.o.userData._dot;
      if (!it.on) { dot.style.display = "none"; dot.removeAttribute("data-members"); return; }
      it.cx = Math.min(Math.max(it.x, 12), w - 12);
      it.cy = Math.min(Math.max(it.y, 12), h - 12);
      it.idx = i + 1;
      on.push(it);
    });
    // TRANSITIVE clustering (union until stable) — the greedy first-fit
    // produced simultaneous "7–11" and "8–9" pills (R2-02 double-claim).
    // The merge radius GROWS until the pill column fits the stage height, so
    // the bounded pack below always has capacity (R3-01: no clamp fallback).
    function clusterAt(r) {
      let cl = on.map((it) => ({ cx: it.cx, cy: it.cy, members: [it] }));
      let merged = true;
      while (merged) {
        merged = false;
        outer: for (let i = 0; i < cl.length; i++)
          for (let j = i + 1; j < cl.length; j++) {
            if (Math.abs(cl[i].cx - cl[j].cx) < r &&
                Math.abs(cl[i].cy - cl[j].cy) < r) {
              const m = cl[i].members.concat(cl[j].members);
              cl[i] = { cx: m.reduce((s, x) => s + x.cx, 0) / m.length,
                        cy: m.reduce((s, x) => s + x.cy, 0) / m.length,
                        members: m };
              cl.splice(j, 1);
              merged = true;
              break outer;
            }
          }
      }
      return cl;
    }
    const PILL_H = 20;   // measured pill height incl. border (nominal)
    let radius = 22;
    let clusters = clusterAt(radius);
    while (clusters.length > 1 &&
           clusters.length * (PILL_H + 2) > (h - 8)) {
      radius += 14;
      clusters = clusterAt(radius);
    }
    for (const it of on) it.o.userData._dot.style.display = "none";
    const pills = [];
    for (const cl of clusters.sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
      const idxs = cl.members.map((m) => m.idx);
      const dot = cl.members[0].o.userData._dot;
      dot.textContent = runsText(idxs);
      dot.setAttribute("data-members", idxs.sort((a, b) => a - b).join(","));
      dot.classList.toggle("d3-dot-multi", idxs.length > 1);
      dot.style.display = "";
      dot.style.left = cl.cx + "px";
      pills.push({ dot, y: cl.cy, h: 0 });
    }
    // measure BOTH dimensions, then bound: vertical via the shared pack,
    // horizontal by measured pill width (R4-02: the +-12px centroid clamp
    // treated pills as 24px dots — pan parked wide pills over the edge and
    // overflow:hidden clipped the runs text into false membership)
    for (const p of pills) {
      p.h = p.dot.offsetHeight || PILL_H;
      p.w = p.dot.offsetWidth || 24;
    }
    const tops = packColumn(pills, 2, h - 2, 2);
    pills.forEach((p, i) => {
      p.dot.style.top = (tops[i] + p.h / 2) + "px";
      const cx = parseFloat(p.dot.style.left);
      const half = p.w / 2;
      p.dot.style.left = Math.min(Math.max(cx, 2 + half), w - 2 - half) + "px";
    });
  }

  let settledMode = "text";        // capacity hysteresis state (per viewer)

  function projectItems(w, h) {
    const v = new THREE.Vector3();
    const items = [];
    for (const o of labelNodes) {
      o.getWorldPosition(v).project(camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      items.push({ o, on, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h });
    }
    return items;
  }

  function updateLabels() {
    const show = state.loaded && state.lb && (state.dx || state.pn);
    labelLayer.style.display = show ? "" : "none";
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!show) { legendOff(); globalThis.__AIDC_LABEL_MODE = "hidden"; return; }
    const moving = tweening || (performance.now() - lastCamMove) < SETTLE_MS;
    if (moving) {
      // N-01R: NO text solve during motion — labels fade to dots; R3-03: the
      // legend keys those dots for the whole motion + damping tail
      dotMode(projectItems(w, h), w, h);
      legendDots(true);
      globalThis.__AIDC_LABEL_MODE = "dots";
      return;
    }
    if (!labelDirty) return;         // idle frames (LED timer) skip label work
    labelDirty = false;
    // settled solve reached: latch — the damping tail is snapped dead until
    // the next real gesture or programmatic camera move (R4-04)
    camFrozen = true;
    const items = projectItems(w, h);
    const small = w < 640;
    let need = 0;
    if (!small) {
      for (const it of items) {
        const el = it.o.userData._el;
        if (!it.on) { el.style.display = "none"; continue; }
        if (!it.o.userData._h) {     // measure once; width is position-fixed
          el.style.display = "";
          it.o.userData._h = el.offsetHeight || 24;
        }
        it.hh = it.o.userData._h;
        need += it.hh + 4;
      }
      // hysteresis: enter dots when labels cannot fit, return to text only
      // once there is clear headroom — the boundary cannot oscillate (N-01R)
      if (settledMode === "text" && need > h - 8) settledMode = "dots";
      else if (settledMode === "dots" && need < h - 40) settledMode = "text";
    }
    const useDots = small || settledMode === "dots";
    if (useDots) { dotMode(items, w, h); legendDots(false);
                   globalThis.__AIDC_LABEL_MODE = "dots"; return; }
    legendTextSettled();
    globalThis.__AIDC_LABEL_MODE = "text";
    for (const it of items) if (it.o.userData._dot) {
      it.o.userData._dot.style.display = "none";
      it.o.userData._dot.removeAttribute("data-members");
    }
    // ONE GLOBAL column solve across BOTH sides via the shared bounded pack
    // (N-01R + R3-02): the capacity gate above guarantees fit, and both stage
    // bounds live inside the sweep — no clamp can undo the separation
    const list = items.filter((it) => it.on)
      .map((it) => ({ y: it.y, h: it.hh, it }));
    const tops = packColumn(list, 2, h - 2, 4);
    list.forEach((e, i) => {
      const el = e.it.o.userData._el;
      const y = tops[i] + e.h / 2;
      const flip = e.it.x > w * 0.62;
      el.classList.toggle("d3-left", flip);
      el.style.transform = "translate(" + e.it.x + "px," + y + "px) " +
        (flip ? "translate(-100%,-50%) translate(-10px,0)" : "translate(10px,-50%)");
      el.style.display = "";
      requestAnimationFrame(() => el.classList.add("d3-in"));
    });
  }

  function tick() {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    tweening = false;
    const speed = dt / 0.35;
    for (const k of ["dx", "pn"]) {
      const goal = state[k];
      if (Math.abs(tw[k] - goal) > 1e-3) {
        tw[k] = RM ? goal : tw[k] + Math.sign(goal - tw[k]) * Math.min(speed, Math.abs(goal - tw[k]));
        tweening = !RM && Math.abs(tw[k] - goal) > 1e-3;
      } else tw[k] = goal;
    }
    if (tweening) { lastCamMove = performance.now(); labelDirty = true;
                    clearTimeout(settleTimer);
                    settleTimer = setTimeout(requestRender, SETTLE_MS + 30); }
    applyExplode(easing(tw.dx));
    applyHinge(easing(tw.pn));
    if (!RM) {
      const t = clock.elapsedTime;
      if (state.fl) {
        for (const f of flowMats)
          if (f.m.map) f.m.map.offset.y = (f.m.map.offset.y + f.dir * dt * 0.25) % 1;
        // observability for the browser smoke (motion proof)
        if (flowMats[0] && flowMats[0].m.map)
          globalThis.__AIDC_FLOW_OFFSET = flowMats[0].m.map.offset.y;
      }
      const pulse = 1.7 + 0.7 * Math.sin(t * 2.1);
      for (const m of ledMats) m.emissiveIntensity = state.loaded ? pulse : 1.7;
    } else {
      for (const m of ledMats) m.emissiveIntensity = 1.7;
    }
    if (!RM && !camFrozen) controls.update();
    renderer.render(scene, camera);
    globalThis.__AIDC_CAM_AZ = Math.atan2(
      camera.position.x - controls.target.x,
      camera.position.z - controls.target.z) * 180 / Math.PI;
    updateLabels();
    needsFrame = false;
    schedule();
  }
  const easing = (t) => t * t * (3 - 2 * t);

  // ---- resize ---------------------------------------------------------------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const o of labelNodes) o.userData._h = 0;   // label widths/heights change
    labelDirty = true;
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  function report() {
    if (opts.onstate) opts.onstate({ ...state });
    globalThis.__AIDC_DETAIL_STATE = { ...state, tw: { ...tw },
      labels: labelNodes.length, flowMats: flowMats.length, ledMats: ledMats.length,
      explodeNodes: explodeNodes.length, reducedMotion: RM,
      labelMeta: labelNodes.map((o) => ({ label: o.userData.label,
        chip: o.userData.chip || "A", cite: o.userData.cite || "detail3d-method" })) };
  }

  load(state.variant);
  report();

  // ---- controller ------------------------------------------------------------
  return {
    setVariant(name) { if (manifest[name] && name !== state.variant) { load(name); report(); } },
    resetView() {
      userOrbited = false;
      userCam = false;
      fitCamera(manifest[state.variant].dims_m[2]);
      labelDirty = true;
      requestRender();
      report();
    },
    setCamera(azDeg, elDeg, mul) {
      userCam = true;
      fitCamera(manifest[state.variant].dims_m[2],
                (azDeg || 0) * Math.PI / 180, (elDeg || 14) * Math.PI / 180, mul || 1);
      requestRender();
    },
    set(k, v) {
      state[k] = v ? 1 : 0;
      labelDirty = true;
      // the flow strips live on the REAR manifolds: if the user hasn't taken
      // the camera and is still on the front 3/4 view, swing to a rear
      // quarter so enabling flow visibly does something (A-09)
      if (k === "fl" && state.fl && !userOrbited && !userCam) {
        const az = Math.atan2(camera.position.x - controls.target.x,
                              camera.position.z - controls.target.z);
        if (Math.abs(az) < Math.PI * 0.5)
          fitCamera(manifest[state.variant].dims_m[2], Math.PI * 1.12, 0.14, 1);
      }
      if (RM) { tw.dx = state.dx; tw.pn = state.pn; }
      updateLabels();
      requestRender();
      report();
    },
    get state() { return { ...state }; },
    dispose() {
      disposed = true;
      clearInterval(ledTimer);
      clearTimeout(settleTimer);
      clearTimeout(legendHideTimer);
      io.disconnect(); ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      clearModel(); removeProxy();
      ktx2.dispose(); pmrem.dispose(); renderer.dispose();
      stage.replaceChildren();
    },
  };
}
