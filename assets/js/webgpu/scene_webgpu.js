// scene_webgpu.js — first-party WebGPU renderer for the datacenter scene.
// Renders the SAME deterministic geometry the fallback path uses (the
// tools3d-emitted GLBs: building-scene.glb and the per-variant row GLBs),
// driven by the generated scene3d.js manifest (presets / layer->material
// groups / hotspots). No frameworks, no vendor code: a hand-rolled GLB
// parser, hand-authored WGSL (./scene.wgsl), small mat4 helpers, orbit
// controls and an HTML hotspot overlay. Loaded ONLY on the explicit
// "Load interactive 3D" click, and ONLY after viewer3d.js has probed a
// real WebGPU adapter; every failure path rejects so the caller can fall
// back to the self-hosted model-viewer/WebGL build.
//
// Self-test contract (used by evidence/smoke-p6-3d.js): at mount, one frame
// is rendered through the identical pass/draws into an offscreen resolve
// target and read back via copyTextureToBuffer + mapAsync (handle.selfTest —
// pixel truth for "a frame rendered", independent of the compositor, which
// under headless SwiftShader never shows WebGPU canvases).
// window.__webgpuRendered flips true only after the first clean submit of a
// real scene frame into the configured canvas swapchain.
"use strict";

// ---------------------------------------------------------------- mat4 ----
function m4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function m4perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  // WebGPU clip z in [0,1]
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, far * near * nf, 0,
  ]);
}
function m4lookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ]);
}
function v4transform(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15],
  ];
}
const srgb2lin = (c) => Math.pow(c, 2.2);

// ------------------------------------------------------------ GLB parse ----
function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const total = dv.getUint32(8, true);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
    if (ctype === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, clen)));
    else if (ctype === 0x004e4942) bin = buf.slice(off + 8, off + 8 + clen);
    off += 8 + clen + ((4 - (clen % 4)) % 4);
  }
  if (!json || !bin) throw new Error("GLB chunks missing");
  return { json, bin };
}

function readAccessor(json, bin, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const Ctor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType];
  if (!Ctor) throw new Error("accessor componentType " + a.componentType);
  const packed = n * Ctor.BYTES_PER_ELEMENT;
  if (bv.byteStride && bv.byteStride !== packed) {
    const out = new Ctor(a.count * n);
    for (let i = 0; i < a.count; i++) {
      const row = new Ctor(bin, start + i * bv.byteStride, n);
      out.set(row, i * n);
    }
    return { arr: out, n };
  }
  return { arr: new Ctor(bin, start, a.count * n), n };
}

// Bake the flat node list (translation-only, single-primitive meshes — the
// exact shape gen_building_glb.py / gen_glb.py emit) into ONE interleaved
// world-space vertex buffer + ONE uint32 index buffer, grouped per material.
function bakeGeometry(json, bin) {
  const perMat = new Map();
  const aabb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const node of json.nodes) {
    if (node.mesh === undefined || node.mesh === null) continue;
    const prim = json.meshes[node.mesh].primitives[0];
    const t = node.translation || [0, 0, 0];
    const pos = readAccessor(json, bin, prim.attributes.POSITION);
    const nrm = readAccessor(json, bin, prim.attributes.NORMAL);
    const col = prim.attributes.COLOR_0 !== undefined ? readAccessor(json, bin, prim.attributes.COLOR_0) : null;
    const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, bin, prim.attributes.TEXCOORD_0) : null;
    const idx = readAccessor(json, bin, prim.indices);
    const mi = prim.material;
    let g = perMat.get(mi);
    if (!g) { g = { verts: [], inds: [], vcount: 0 }; perMat.set(mi, g); }
    const vcount = pos.arr.length / 3;
    const inter = new Float32Array(vcount * 11);
    for (let i = 0; i < vcount; i++) {
      const o = i * 11;
      const x = pos.arr[i * 3] + t[0], y = pos.arr[i * 3 + 1] + t[1], z = pos.arr[i * 3 + 2] + t[2];
      inter[o] = x; inter[o + 1] = y; inter[o + 2] = z;
      inter[o + 3] = nrm.arr[i * 3]; inter[o + 4] = nrm.arr[i * 3 + 1]; inter[o + 5] = nrm.arr[i * 3 + 2];
      if (col) {
        inter[o + 6] = col.arr[i * col.n]; inter[o + 7] = col.arr[i * col.n + 1]; inter[o + 8] = col.arr[i * col.n + 2];
      } else { inter[o + 6] = 1; inter[o + 7] = 1; inter[o + 8] = 1; }
      if (uv) { inter[o + 9] = uv.arr[i * 2]; inter[o + 10] = uv.arr[i * 2 + 1]; }
      if (x < aabb.min[0]) aabb.min[0] = x; if (x > aabb.max[0]) aabb.max[0] = x;
      if (y < aabb.min[1]) aabb.min[1] = y; if (y > aabb.max[1]) aabb.max[1] = y;
      if (z < aabb.min[2]) aabb.min[2] = z; if (z > aabb.max[2]) aabb.max[2] = z;
    }
    const rebase = new Uint32Array(idx.arr.length);
    for (let i = 0; i < idx.arr.length; i++) rebase[i] = idx.arr[i] + g.vcount;
    g.verts.push(inter);
    g.inds.push(rebase);
    g.vcount += vcount;
  }
  // concatenate groups (stable material-index order = deterministic draws)
  let vtot = 0, itot = 0;
  const order = [...perMat.keys()].sort((a, b) => a - b);
  for (const mi of order) { const g = perMat.get(mi); vtot += g.vcount; itot += g.inds.reduce((s, x) => s + x.length, 0); }
  const vbuf = new Float32Array(vtot * 11);
  const ibuf = new Uint32Array(itot);
  const draws = [];
  let vOff = 0, iOff = 0;
  for (const mi of order) {
    const g = perMat.get(mi);
    const first = iOff;
    for (const chunk of g.verts) { vbuf.set(chunk, vOff * 11); vOff += chunk.length / 11; }
    const base = vOff - g.vcount;
    for (const chunk of g.inds) {
      for (let i = 0; i < chunk.length; i++) ibuf[iOff + i] = chunk[i] + base;
      iOff += chunk.length;
    }
    draws.push({ material: mi, firstIndex: first, indexCount: iOff - first });
  }
  return { vbuf, ibuf, draws, aabb };
}

// -------------------------------------------------- device (module-level) ----
let devicePromise = null;
function getDevice() {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    if (!navigator.gpu) throw new Error("navigator.gpu absent");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    const device = await adapter.requestDevice();
    device.lost.then((info) => {
      window.__AIDC_WEBGPU_STATUS = "lost: " + (info && info.message || "device lost");
      devicePromise = null;
    });
    // real validation/OOM errors surface here (and in the console — we do
    // not preventDefault, so test harnesses still see them)
    device.addEventListener("uncapturederror", (e) => {
      window.__AIDC_WEBGPU_STATUS = "error: " + (e.error && e.error.message || "uncaptured GPU error");
    });
    return device;
  })();
  devicePromise.catch(() => { devicePromise = null; });
  return devicePromise;
}

// Once ANY canvas has been configured on the shared device, headless
// software WebGPU (Dawn/SwiftShader) can no longer service device async
// callbacks (popErrorScope / mapAsync / onSubmittedWorkDone) — leaving such
// ops dangling has been observed to LOSE the device outright. So: the FIRST
// mount gets the full validation-scope + pixel self-test treatment; mounts
// after a configure skip creating device async ops entirely (real validation
// errors still surface via the device's uncapturederror listener, and on
// real GPUs probe() remains available on the first mount's handle).
let anyCanvasConfigured = false;

let shaderPromise = null;
function getShaderSource() {
  if (shaderPromise) return shaderPromise;
  shaderPromise = fetch(new URL("./scene.wgsl", import.meta.url))
    .then((r) => { if (!r.ok) throw new Error("scene.wgsl fetch " + r.status); return r.text(); });
  shaderPromise.catch(() => { shaderPromise = null; });
  return shaderPromise;
}

// Guard for device ASYNC ops (popErrorScope / mapAsync): on some headless
// software stacks these die or hang once any canvas has been configured on
// the device (Dawn "external Instance" bug). Never let them block a mount:
// resolve `fallback` on rejection or after `ms`.
function settleWithin(p, ms, fallback) {
  return Promise.race([
    p.catch(() => fallback),
    new Promise((res) => setTimeout(() => res(fallback), ms)),
  ]);
}

// ----------------------------------------------------------- camera utils ----
const rad = (d) => d * Math.PI / 180;
function parseOrbit(s) {
  const p = String(s).trim().split(/\s+/);
  return { theta: rad(parseFloat(p[0])), phi: rad(parseFloat(p[1])), radius: parseFloat(p[2]) };
}
function parseTriple(s) {
  const p = String(s).trim().split(/\s+/).map(parseFloat);
  return [p[0] || 0, p[1] || 0, p[2] || 0];
}

// ------------------------------------------------------------- mountScene ----
// opts: {
//   glbUrl,                        // relative URL, tools3d-emitted GLB
//   materials,                     // manifest table name->{factor,mode} (authoritative); falls back to GLB factors
//   layers,                        // manifest [{id, mats:[..]}] or null
//   layerState,                    // {layerId: bool}
//   hotspots, onHotspotClick,      // manifest hotspot list + card callback
//   camera: {orbit,target,fov} OR {autoFrame:{thetaDeg,phiDeg,pct,fovDeg}},
//   clampRadius: [min,max], clampPhiDeg: [min,max],
//   reducedMotion, registerGlobal, ariaLabel,
// }
export async function mountScene(stage, opts) {
  const device = await getDevice();
  const wgsl = await getShaderSource();
  const res = await fetch(opts.glbUrl);
  if (!res.ok) throw new Error("GLB fetch " + res.status);
  const { json, bin } = parseGLB(await res.arrayBuffer());
  const geo = bakeGeometry(json, bin);

  // ---- asset census (#229 fails-if-removed hook): structural truth of what
  // this mount actually wired — node/mesh/material/draw/triangle counts plus
  // the named detail classes the fidelity pass added (generator name suffixes
  // are the contract). The smoke asserts floors on these; reverting the
  // procedural detail (or the generators) makes the census fall and the
  // smoke fail.
  const census = (() => {
    const names = (json.nodes || []).map((n) => n.name || "");
    const tag = (re) => names.reduce((k, n) => k + (re.test(n) ? 1 : 0), 0);
    return {
      nodes: names.length,
      meshes: (json.meshes || []).length,
      materials: (json.materials || []).length,
      draws: geo.draws.length,
      triangles: geo.ibuf.length / 3,
      detail: {
        leds: tag(/-led$/), taps: tag(/-tap\d+$/), hangers: tag(/-hanger\d+$/),
        frames: tag(/-frame\d+$/), cowls: tag(/-cowl$/), grilles: tag(/-grille$/),
        vents: tag(/-vent$/), risers: tag(/-riser\d+$/), hubs: tag(/-hub$/),
      },
    };
  })();

  // ---- validation-scoped GPU object creation (fail -> caller falls back) --
  const useScopes = !anyCanvasConfigured;   // see anyCanvasConfigured note
  if (useScopes) device.pushErrorScope("validation");

  const format = navigator.gpu.getPreferredCanvasFormat();
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "pan-y";
  if (opts.ariaLabel) { canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", opts.ariaLabel); }
  const ctx = canvas.getContext("webgpu");
  if (!ctx) {
    if (useScopes) device.popErrorScope().catch(() => {});
    throw new Error("no webgpu canvas context");
  }

  const module = device.createShaderModule({ code: wgsl, label: "aidc scene.wgsl" });

  const bgl0 = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const bgl1 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });

  const vertexState = {
    module, entryPoint: "vs_main",
    buffers: [{
      arrayStride: 44,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x3" },
        { shaderLocation: 3, offset: 36, format: "float32x2" },
      ],
    }],
  };
  const SAMPLES = 4;
  const pipeOpaque = device.createRenderPipeline({
    label: "aidc-opaque", layout,
    vertex: vertexState,
    fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    multisample: { count: SAMPLES },
  });
  const pipeBlend = device.createRenderPipeline({
    label: "aidc-blend", layout,
    vertex: vertexState,
    fragment: {
      module, entryPoint: "fs_main",
      targets: [{
        format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" },
    multisample: { count: SAMPLES },
  });

  // ---- geometry buffers ---------------------------------------------------
  const vb = device.createBuffer({ size: geo.vbuf.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, geo.vbuf);
  const ib = device.createBuffer({ size: geo.ibuf.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ib, 0, geo.ibuf);

  // ---- globals + per-material uniforms ------------------------------------
  const globalsBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg0 = device.createBindGroup({ layout: bgl0, entries: [{ binding: 0, resource: { buffer: globalsBuf } }] });

  const sampler = device.createSampler({
    magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat",
  });
  const whiteTex = device.createTexture({
    size: [1, 1], format: "rgba8unorm-srgb",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: whiteTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);

  // decode the GLB's embedded baseColor textures (PNG blobs in the BIN chunk)
  const imageTex = new Map();
  const wantImages = new Set();
  for (const m of json.materials || []) {
    const bct = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
    if (bct && json.textures) {
      const src = json.textures[bct.index].source;
      if (src !== undefined) wantImages.add(src);
    }
  }
  for (const idx of wantImages) {
    try {
      const im = json.images[idx];
      const bv = json.bufferViews[im.bufferView];
      const blob = new Blob([new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength)], { type: im.mimeType || "image/png" });
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
      const tex = device.createTexture({
        size: [bmp.width, bmp.height], format: "rgba8unorm-srgb",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
      bmp.close();
      imageTex.set(idx, tex);
    } catch (e) { /* texture optional: factor+vertex color still carry the palette */ }
  }

  // material records: manifest factors govern when provided (same math emits both)
  const MAT_STRIDE = 256;
  const matBuf = device.createBuffer({
    size: MAT_STRIDE * Math.max(1, json.materials.length),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const mats = [];   // by GLB material index
  const byName = new Map();
  json.materials.forEach((gm, i) => {
    const name = gm.name || ("mat" + i);
    const manifest = opts.materials && opts.materials[name];
    const pbr = gm.pbrMetallicRoughness || {};
    const factor = (manifest && manifest.factor) ||
      pbr.baseColorFactor || [1, 1, 1, 1];
    const mode = (manifest && manifest.mode) || gm.alphaMode || "OPAQUE";
    const bct = pbr.baseColorTexture;
    const src = bct && json.textures ? json.textures[bct.index].source : undefined;
    const tex = src !== undefined && imageTex.has(src) ? imageTex.get(src) : whiteTex;
    const unlit = name === "backdrop" ? 1 : 0;
    const rec = {
      name, index: i, factor: factor.slice(), mode,
      effAlpha: factor[3], hasTex: tex !== whiteTex ? 1 : 0, unlit,
      // #229 material response: the generators author these per material —
      // metal/rough drive the WGSL specular + env-reflection terms, emissive
      // carries the LED band, isBlend enables the grazing-angle alpha lift
      metallic: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 1,
      roughness: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1,
      emissive: (gm.emissiveFactor || [0, 0, 0]).slice(),
      isBlend: mode === "BLEND" ? 1 : 0,
      bindGroup: device.createBindGroup({
        layout: bgl1,
        entries: [
          { binding: 0, resource: { buffer: matBuf, offset: i * MAT_STRIDE, size: 48 } },
          { binding: 1, resource: tex.createView() },
          { binding: 2, resource: sampler },
        ],
      }),
    };
    mats.push(rec);
    byName.set(name, rec);
  });
  const matScratch = new Float32Array(12);
  function writeMat(rec) {
    matScratch[0] = srgb2lin(rec.factor[0]); // factors are authored as display-ish values;
    matScratch[1] = srgb2lin(rec.factor[1]); // linearize so lighting operates in linear space
    matScratch[2] = srgb2lin(rec.factor[2]);
    matScratch[3] = rec.effAlpha;
    matScratch[4] = rec.hasTex; matScratch[5] = rec.unlit;
    matScratch[6] = rec.metallic; matScratch[7] = rec.roughness;
    matScratch[8] = srgb2lin(rec.emissive[0]);
    matScratch[9] = srgb2lin(rec.emissive[1]);
    matScratch[10] = srgb2lin(rec.emissive[2]);
    matScratch[11] = rec.isBlend;
    device.queue.writeBuffer(matBuf, rec.index * MAT_STRIDE, matScratch);
  }
  mats.forEach(writeMat);

  // split draws into opaque / blend passes (blend after opaque)
  const drawsOpaque = [], drawsBlend = [];
  for (const d of geo.draws) {
    const rec = mats[d.material];
    (rec.mode === "BLEND" ? drawsBlend : drawsOpaque).push({ ...d, rec });
  }

  // popErrorScope is async — settleWithin so even a first-mount hang cannot
  // block; genuine validation errors reject the mount here, and otherwise
  // surface via the device's uncapturederror listener. Skipped entirely on
  // post-configure mounts (see anyCanvasConfigured).
  const initErr = useScopes ? await settleWithin(device.popErrorScope(), 1500, null) : null;
  if (initErr) throw new Error("WebGPU validation: " + initErr.message);

  // ---- render-state flags (declared before camera/configure which set them)
  let dirty = true, disposed = false, firstFrameDone = false;
  let vpNow = null;

  // ---- camera --------------------------------------------------------------
  const bbox = geo.aabb;
  const center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
  const bsRadius = Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]) / 2;
  const clampR = opts.clampRadius || [1.5, 160];
  const clampPhi = (opts.clampPhiDeg || [0.5, 88]).map(rad);
  const cam = { theta: 0, phi: rad(65), radius: 20, target: [0, 1, 0], fov: rad(28) };
  const goal = { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.slice(), fov: cam.fov };
  function setFromPreset(p, jump) {
    const o = parseOrbit(p.orbit);
    goal.theta = o.theta; goal.phi = o.phi; goal.radius = o.radius;
    goal.target = parseTriple(p.target);
    goal.fov = rad(parseFloat(p.fov));
    if (jump || opts.reducedMotion) jumpToGoal();
    dirty = true;
  }
  function jumpToGoal() {
    cam.theta = goal.theta; cam.phi = goal.phi; cam.radius = goal.radius;
    cam.target = goal.target.slice(); cam.fov = goal.fov;
    dirty = true;
  }
  if (opts.camera && opts.camera.orbit) {
    setFromPreset(opts.camera, true);
  } else if (opts.camera && opts.camera.autoFrame) {
    const af = opts.camera.autoFrame;
    const fov = rad(af.fovDeg || 30);
    goal.fov = fov;
    goal.theta = rad(af.thetaDeg); goal.phi = rad(af.phiDeg);
    goal.target = center.slice();
    // fit the bounding sphere in the tighter screen axis, then apply the % zoom
    const aspect = Math.max(0.5, (stage.clientWidth || 16) / (stage.clientHeight || 8));
    const half = Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * aspect));
    goal.radius = (af.pct || 1.05) * bsRadius / Math.tan(half);
    jumpToGoal();
  }

  // ---- canvas mount + hotspot overlay --------------------------------------
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.width = "100%";
  wrap.style.height = "100%";
  wrap.appendChild(canvas);
  let hsLayer = null;
  const dots = [];
  if (opts.hotspots && opts.hotspots.length) {
    hsLayer = document.createElement("div");
    hsLayer.className = "gpu-hs-layer";
    opts.hotspots.forEach((h, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hs-dot";
      b.dataset.layer = h.layer;
      b.setAttribute("aria-label", h.label + " — show spec card");
      b.textContent = String(i + 1);
      b.addEventListener("click", () => { if (opts.onHotspotClick) opts.onHotspotClick(h.id); });
      hsLayer.appendChild(b);
      dots.push({ el: b, pos: parseTriple(h.pos), layer: h.layer });
    });
    wrap.appendChild(hsLayer);
  }
  stage.replaceChildren(wrap);

  // ---- swapchain / depth / msaa sizing -------------------------------------
  // size() (attachments) is split from configureCtx() (swapchain) because the
  // mount-time pixel self-test must run BEFORE the first ctx.configure():
  // headless SwiftShader permanently breaks device mapAsync once a canvas is
  // configured on the device (Dawn "external Instance" bug) — on real GPUs
  // the order makes no difference.
  let depthTex = null, msaaTex = null, W = 0, H = 0;
  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(8, Math.round((stage.clientWidth || 640) * dpr));
    H = Math.max(8, Math.round((stage.clientHeight || 320) * dpr));
    canvas.width = W; canvas.height = H;
    if (depthTex) depthTex.destroy();
    if (msaaTex) msaaTex.destroy();
    depthTex = device.createTexture({ size: [W, H], format: "depth24plus", sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    msaaTex = device.createTexture({ size: [W, H], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    dirty = true;
  }
  function configureCtx() {
    ctx.configure({ device, format, alphaMode: "opaque", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    anyCanvasConfigured = true;
  }
  size();

  // ---- layer -> material alpha driving (manifest semantics) ----------------
  const layerOf = new Map();
  if (opts.layers) for (const l of opts.layers) for (const n of l.mats) layerOf.set(n, l.id);
  function applyLayers(layerState) {
    if (opts.layers) {
      for (const l of opts.layers) {
        const on = !layerState || layerState[l.id] !== false;
        for (const n of l.mats) {
          const rec = byName.get(n);
          if (!rec) continue;
          rec.effAlpha = on ? rec.factor[3] : 0;
          writeMat(rec);
        }
      }
    }
    for (const d of dots) d.el.hidden = !!(d.layer && layerState && layerState[d.layer] === false);
    dirty = true;
  }

  // ---- render loop (dirty-flag; damping unless reduced motion) -------------
  const BG = [0x0b / 255, 0x11 / 255, 0x1c / 255]; // --bg token, gamma-encoded (matches clear-to-page)
  const gl = new Float32Array(64);
  function step(k) {
    let moving = false;
    for (const key of ["theta", "phi", "radius", "fov"]) {
      const d = goal[key] - cam[key];
      if (Math.abs(d) > 1e-4) { cam[key] += d * k; moving = true; } else cam[key] = goal[key];
    }
    for (let i = 0; i < 3; i++) {
      const d = goal.target[i] - cam.target[i];
      if (Math.abs(d) > 1e-4) { cam.target[i] += d * k; moving = true; } else cam.target[i] = goal.target[i];
    }
    return moving;
  }
  function eyePos() {
    cam.phi = Math.min(Math.max(cam.phi, clampPhi[0]), clampPhi[1]);
    cam.radius = Math.min(Math.max(cam.radius, clampR[0]), clampR[1]);
    const sp = Math.sin(cam.phi), cpn = Math.cos(cam.phi);
    return [
      cam.target[0] + cam.radius * sp * Math.sin(cam.theta),
      cam.target[1] + cam.radius * cpn,
      cam.target[2] + cam.radius * sp * Math.cos(cam.theta),
    ];
  }
  function writeGlobals() {
    const eye = eyePos();
    const proj = m4perspective(cam.fov, W / H, 0.1, Math.max(600, bsRadius * 8));
    const view = m4lookAt(eye, cam.target, [0, 1, 0]);
    vpNow = m4mul(proj, view);
    gl.set(vpNow, 0);
    gl.set([eye[0], eye[1], eye[2], 4.6], 16);                       // camPos + exposure
    const L = [-0.51, 0.77, -0.38];                                   // key toward light (matches the WebGL fallback's key)
    gl.set([L[0], L[1], L[2], 1.7], 20);                             // lightDir + intensity
    gl.set([srgb2lin(0.81), srgb2lin(0.88), srgb2lin(0.96), 1.35], 24);  // sky tint + hemi intensity
    gl.set([srgb2lin(0.36), srgb2lin(0.39), srgb2lin(0.44), 0], 28); // ground tint
    gl.set([srgb2lin(BG[0]), srgb2lin(BG[1]), srgb2lin(BG[2]), 0], 32); // fog color (page bg)
    const fogNear = Math.max(30, bsRadius * 1.6), fogFar = Math.max(240, bsRadius * 5.5);
    gl.set([fogNear, fogFar, 0, 0], 36);
    device.queue.writeBuffer(globalsBuf, 0, gl, 0, 40);
    return eye;
  }
  function encodeScene(colorView, resolveTarget) {
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: colorView, resolveTarget,
        clearValue: { r: BG[0], g: BG[1], b: BG[2], a: 1 },
        loadOp: "clear", storeOp: resolveTarget ? "discard" : "store",
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard",
      },
    });
    pass.setBindGroup(0, bg0);
    pass.setVertexBuffer(0, vb);
    pass.setIndexBuffer(ib, "uint32");
    for (const d of drawsOpaque) {
      if (d.rec.effAlpha <= 0) continue;
      pass.setPipeline(pipeOpaque);
      pass.setBindGroup(1, d.rec.bindGroup);
      pass.drawIndexed(d.indexCount, 1, d.firstIndex, 0, 0);
    }
    for (const d of drawsBlend) {
      if (d.rec.effAlpha <= 0) continue;
      pass.setPipeline(pipeBlend);
      pass.setBindGroup(1, d.rec.bindGroup);
      pass.drawIndexed(d.indexCount, 1, d.firstIndex, 0, 0);
    }
    pass.end();
    return enc;
  }
  function placeDots() {
    if (!hsLayer || !vpNow) return;
    const cw = canvas.clientWidth || W, ch = canvas.clientHeight || H;
    for (const d of dots) {
      if (d.el.hidden) continue;
      const c = v4transform(vpNow, d.pos);
      if (c[3] < 0.02) { d.el.style.visibility = "hidden"; continue; }
      d.el.style.visibility = "";
      d.el.style.left = ((c[0] / c[3]) * 0.5 + 0.5) * cw + "px";
      d.el.style.top = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * ch + "px";
    }
  }
  function frame() {
    if (disposed) return;
    requestAnimationFrame(frame);
    let moving = false;
    if (opts.reducedMotion) {
      // no animated transitions: snap to goal ONLY when it changed, so the
      // loop stays idle (no per-frame work) for reduced-motion users
      if (cam.theta !== goal.theta || cam.phi !== goal.phi ||
          cam.radius !== goal.radius || cam.fov !== goal.fov ||
          cam.target[0] !== goal.target[0] || cam.target[1] !== goal.target[1] ||
          cam.target[2] !== goal.target[2]) {
        jumpToGoal();   // sets dirty for exactly one render
      }
    } else {
      moving = step(0.22);
    }
    if (!dirty && !moving) return;
    dirty = moving;
    writeGlobals();
    const enc = encodeScene(msaaTex.createView(), ctx.getCurrentTexture().createView());
    device.queue.submit([enc.finish()]);
    placeDots();
    if (!firstFrameDone) {
      firstFrameDone = true;
      window.__webgpuRendered = true;
    }
  }

  // ---- pointer orbit controls ----------------------------------------------
  const pointers = new Map();
  let pinchDist = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const p = [...pointers.values()];
      pinchDist = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      goal.theta -= (e.clientX - prev[0]) * 0.006;
      goal.phi -= (e.clientY - prev[1]) * 0.006;
      goal.phi = Math.min(Math.max(goal.phi, clampPhi[0]), clampPhi[1]);
      cam.theta = goal.theta; cam.phi = goal.phi;   // immediate response while dragging
      dirty = true;
    } else if (pointers.size === 2) {
      const p = [...pointers.values()];
      const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      if (pinchDist > 0) {
        goal.radius = Math.min(Math.max(goal.radius * (pinchDist / d), clampR[0]), clampR[1]);
        cam.radius = goal.radius;
        dirty = true;
      }
      pinchDist = d;
    }
  });
  const endPtr = (e) => { pointers.delete(e.pointerId); pinchDist = 0; };
  canvas.addEventListener("pointerup", endPtr);
  canvas.addEventListener("pointercancel", endPtr);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    goal.radius = Math.min(Math.max(goal.radius * Math.exp(e.deltaY * 0.0012), clampR[0]), clampR[1]);
    dirty = true;
  }, { passive: false });

  // ---- pixel self-test: render one frame through the IDENTICAL pass/draws
  // into an offscreen resolve target and read the pixels back
  // (copyTextureToBuffer + mapAsync). Runs once at mount BEFORE the canvas
  // is configured — pixel truth for "a frame rendered" that also works under
  // headless SwiftShader, where (a) the compositor never shows WebGPU
  // canvases and (b) device mapAsync dies with a Dawn "external Instance"
  // error once any canvas has been configured. On real GPUs probe() can be
  // called again at any time.
  async function renderOffscreen(withImage) {
    writeGlobals();
    const tex = device.createTexture({
      size: [W, H], format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const enc = encodeScene(msaaTex.createView(), tex.createView());
    const bpr = Math.ceil(W * 4 / 256) * 256;
    const readBuf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow: bpr, rowsPerImage: H }, [W, H]);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const px = new Uint8Array(readBuf.getMappedRange());
    const bgr = format === "bgra8unorm";
    const bg = [Math.round(BG[0] * 255), Math.round(BG[1] * 255), Math.round(BG[2] * 255)];
    let counted = 0, nonBg = 0;
    const distinct = new Set();
    for (let y = 0; y < H; y += 4) {
      for (let x = 0; x < W; x += 4) {
        const o = y * bpr + x * 4;
        const r = bgr ? px[o + 2] : px[o], g = px[o + 1], b = bgr ? px[o] : px[o + 2];
        counted++;
        if (Math.abs(r - bg[0]) > 6 || Math.abs(g - bg[1]) > 6 || Math.abs(b - bg[2]) > 6) nonBg++;
        distinct.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      }
    }
    let dataURL = null;
    if (withImage) {
      const c2 = document.createElement("canvas");
      c2.width = W; c2.height = H;
      const g2 = c2.getContext("2d");
      const img = g2.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const o = y * bpr + x * 4, q = (y * W + x) * 4;
          img.data[q] = bgr ? px[o + 2] : px[o];
          img.data[q + 1] = px[o + 1];
          img.data[q + 2] = bgr ? px[o] : px[o + 2];
          img.data[q + 3] = 255;
        }
      }
      g2.putImageData(img, 0, 0);
      dataURL = c2.toDataURL("image/png");
    }
    readBuf.unmap();
    readBuf.destroy();
    tex.destroy();
    dirty = true;
    return { width: W, height: H, sampled: counted, nonBackground: nonBg, distinct: distinct.size, format, dataURL };
  }
  async function probe(withImage) {
    try { return await renderOffscreen(withImage); }
    catch (e) { return { error: String(e) }; }
  }

  const handle = {
    kind: "webgpu",
    canvas,
    glbUrl: opts.glbUrl,
    device,
    contextConfigured: false,
    selfTest: null,
    census,
    applyLayers,
    setPreset(p) { setFromPreset(p, false); },
    jumpToGoal,
    camera() { return { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.slice(), fov: cam.fov }; },
    materialAlpha(name) { const r = byName.get(name); return r ? r.effAlpha : null; },
    materialNames() { return [...byName.keys()]; },
    dotCount() { return dots.length; },
    probe,
    dispose() {
      disposed = true;
      ro.disconnect();
      try { depthTex.destroy(); msaaTex.destroy(); vb.destroy(); ib.destroy(); globalsBuf.destroy(); matBuf.destroy(); } catch (e) { /* device may be lost */ }
      ctx.unconfigure();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (window[opts.registerGlobal || "__AIDC_WEBGPU"] === handle) window[opts.registerGlobal || "__AIDC_WEBGPU"] = null;
    },
  };
  if (opts.layerState) applyLayers(opts.layerState);

  // mount-time pixel self-test (must precede the first ctx.configure — see
  // renderOffscreen). Stats always; PNG only when the caller asks (#gputest).
  // First mount only: after any configure the shared device must not be
  // handed new async ops (see anyCanvasConfigured) — later mounts record the
  // skip instead; the canvas render path is identical either way.
  if (useScopes) {
    try {
      handle.selfTest = await settleWithin(
        renderOffscreen(!!opts.selfTestImage), 4000,
        { error: "self-test timed out (device async callbacks unavailable)" });
    } catch (e) {
      handle.selfTest = { error: String(e) };
    }
  } else {
    handle.selfTest = {
      skipped: "pixel self-test runs on the device's first mount only — a " +
        "configured canvas ends device async-op service on headless software " +
        "WebGPU (real GPUs: call probe() on the first mount's handle)",
    };
  }

  configureCtx();
  handle.contextConfigured = true;
  const ro = new ResizeObserver(() => { size(); });
  ro.observe(stage);
  requestAnimationFrame(frame);

  window[opts.registerGlobal || "__AIDC_WEBGPU"] = handle;
  return handle;
}
