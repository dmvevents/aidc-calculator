// Parametric site viewer — three.js (vendored 0.185.1, MIT; import-map
// resolved; dynamic-imported ONLY on the explicit user click, same policy as
// the detail studio). Renders the scenelayout solver's spec with instanced
// boxes, hemisphere + shadowed key light (massing-grade realism: soft ground
// shadows, subtle fog — no textures, no photorealism claim).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// palette mirrors the generated reference scene's material table
const MATS = {
  rack: [0x131821, 0.35, 0.55], door: [0x295989, 0.30, 0.45],
  system: [0x386b99, 0.30, 0.40], fabric: [0x4d3d6b, 0.35, 0.50],
  containment: [0x8ca6bf, 0.10, 0.30, 0.16], cdu: [0x213861, 0.35, 0.50],
  crah: [0x2b455c, 0.30, 0.50], pipe: [0x29736b, 0.50, 0.40],
  fws: [0x1a5257, 0.50, 0.45], drycooler: [0x295c57, 0.35, 0.50],
  busway: [0x8c6b2e, 0.60, 0.40], ups: [0x2e4d80, 0.35, 0.50],
  swgr: [0x243357, 0.35, 0.50], transformer: [0x474d57, 0.55, 0.45],
  genset: [0x4d4733, 0.40, 0.50], tray: [0x6b618c, 0.45, 0.45],
  tes: [0x1f6166, 0.40, 0.45], fence: [0x242b38, 0.30, 0.60],
  shell: [0x6b85a8, 0.10, 0.35, 0.14],
  floor: [0x161b24, 0.05, 0.90], site: [0x0e1119, 0.05, 0.95],
};

export function mount(host, layout, layerState) {
  const W = host.clientWidth, H = Math.max(420, Math.round(W * 0.56));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b111c);
  scene.fog = new THREE.Fog(0x0b111c, layout.camera.r * 1.6, layout.camera.r * 4.5);

  scene.add(new THREE.HemisphereLight(0xcfe0f5, 0x181c24, 2.1));
  const key = new THREE.DirectionalLight(0xfff3e0, 3.2);
  key.position.set(-40, 60, -30);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const ext = layout.camera.r;
  key.shadow.camera.left = -ext; key.shadow.camera.right = ext;
  key.shadow.camera.top = ext; key.shadow.camera.bottom = -ext;
  key.shadow.camera.far = 300;
  key.shadow.bias = -0.0004;
  scene.add(key);

  // group per layer; instanced mesh per (material) within a layer
  const groups = {};
  const byKey = {};
  for (const b of layout.spec) {
    (byKey[b.g + "|" + b.m] = byKey[b.g + "|" + b.m] || []).push(b);
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(),
        p = new THREE.Vector3();
  for (const key2 in byKey) {
    const [g, mName] = key2.split("|");
    const [color, metal, rough, alpha] = MATS[mName] || MATS.rack;
    const mat = new THREE.MeshStandardMaterial({
      color: color, metalness: metal, roughness: rough,
      transparent: alpha !== undefined, opacity: alpha !== undefined ? alpha : 1,
      depthWrite: alpha === undefined,
    });
    const items = byKey[key2];
    const im = new THREE.InstancedMesh(unit, mat, items.length);
    items.forEach((b, i) => {
      p.set(b.x, b.y, b.z); s.set(b.w, b.h, b.d);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = alpha === undefined;
    im.receiveShadow = true;
    if (!groups[g]) { groups[g] = new THREE.Group(); groups[g].name = g; scene.add(groups[g]); }
    groups[g].add(im);
  }

  const camera = new THREE.PerspectiveCamera(26, W / H, 0.5, 1200);
  const r = layout.camera.r;
  camera.position.set(r * 0.75, r * 0.85, r * 0.9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, layout.camera.targetY, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 4;
  controls.maxDistance = r * 3;

  function applyLayers(state) {
    for (const g in groups) {
      if (g === "site") continue;                 // ground truth, always on
      groups[g].visible = state[g] !== false;
    }
  }
  applyLayers(layerState || {});

  let live = true;
  (function loop() {
    if (!live) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  const onResize = () => {
    const w2 = host.clientWidth, h2 = Math.max(420, Math.round(w2 * 0.56));
    renderer.setSize(w2, h2);
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", onResize);

  return {
    applyLayers: applyLayers,
    dispose() {
      live = false;
      removeEventListener("resize", onResize);
      renderer.dispose();
      unit.dispose();
    },
  };
}
