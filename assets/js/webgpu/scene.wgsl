// scene.wgsl — first-party WGSL for the datacenter building-scene renderer.
// Hand-authored (no framework, no generated shader graph). One shader pair
// drives both the opaque and the alpha-blend pipeline; per-material state
// arrives through the Material uniform. Lighting is deliberately basic and
// deterministic: one warm key light + a cool hemisphere fill + distance fog,
// ACES-approx tone map, gamma-encode at the end (canvas format is non-sRGB).
// Palette flows from the generated scene manifest's material factors (which
// were designed on the aidc-design token system) — nothing is hardcoded here
// except the light tints.

struct Globals {
  viewProj  : mat4x4f,
  camPos    : vec4f,   // xyz = camera position (world), w = exposure
  lightDir  : vec4f,   // xyz = direction TOWARD the key light, w = key intensity
  skyCol    : vec4f,   // rgb = hemisphere sky tint (linear), w = hemisphere intensity
  groundCol : vec4f,   // rgb = hemisphere ground tint (linear)
  fogCol    : vec4f,   // rgb = fog color (linear)
  fogRange  : vec4f,   // x = fog near (m), y = fog far (m)
};

struct Material {
  color : vec4f,   // baseColorFactor rgb (linear) + EFFECTIVE alpha (layer-driven)
  opts  : vec4f,   // x = has baseColor texture (0/1), y = unlit (0/1)
};

@group(0) @binding(0) var<uniform> G : Globals;
@group(1) @binding(0) var<uniform> M : Material;
@group(1) @binding(1) var baseTex  : texture_2d<f32>;
@group(1) @binding(2) var baseSamp : sampler;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
  @location(2) col : vec3f,   // COLOR_0 vertex tint (linear); 1,1,1 when absent
  @location(3) uv  : vec2f,   // TEXCOORD_0; 0,0 when absent
};

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) wpos : vec3f,
  @location(1) nrm  : vec3f,
  @location(2) col  : vec3f,
  @location(3) uv   : vec2f,
};

@vertex
fn vs_main(v : VSIn) -> VSOut {
  var o : VSOut;
  o.clip = G.viewProj * vec4f(v.pos, 1.0);
  o.wpos = v.pos;         // vertices are pre-baked to world space at load
  o.nrm  = v.nrm;
  o.col  = v.col;
  o.uv   = v.uv;
  return o;
}

// Narkowicz ACES filmic approximation (input linear, output 0..1 linear-ish)
fn aces(x : vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_main(v : VSOut) -> @location(0) vec4f {
  // albedo = material factor x vertex tint x (optional) sRGB-decoded texture.
  // The texture sample stays in uniform control flow (mix by a uniform flag),
  // which keeps WGSL uniformity analysis trivially satisfied.
  let t = textureSample(baseTex, baseSamp, v.uv);
  var albedo = M.color.rgb * v.col * mix(vec3f(1.0), t.rgb, step(0.5, M.opts.x));

  var n = normalize(v.nrm);
  let V = normalize(G.camPos.xyz - v.wpos);
  // double-sided safety for the thin blend planes (containment / shell):
  if (dot(n, V) < 0.0) { n = -n; }

  // hemisphere ambient: ground tint below, sky tint above
  let hemi = mix(G.groundCol.rgb, G.skyCol.rgb, n.y * 0.5 + 0.5) * G.skyCol.w;

  // warm key + a cool wrap fill from the opposite side + a small
  // view-dependent fill (keeps aisle-level faces legible from any angle —
  // the massing viewer's stand-in for the fallback renderers' IBL)
  let L    = normalize(G.lightDir.xyz);
  let nl   = max(dot(n, L), 0.0);
  let fillDir = normalize(vec3f(-L.x, 0.3, -L.z));
  let fill = max(dot(n, fillDir), 0.0) * 0.35;
  let vfill = max(dot(n, V), 0.0) * 0.42;
  let key  = vec3f(1.0, 0.955, 0.88) * (nl * G.lightDir.w);
  let cool = vec3f(0.72, 0.82, 1.0) * fill + vec3f(0.82, 0.88, 1.0) * vfill;

  var lit = albedo * (hemi + key + cool);

  // faint Blinn highlight so metal-ish enclosures read as surfaces, not flats
  let H = normalize(L + V);
  lit += vec3f(0.05) * pow(max(dot(n, H), 0.0), 40.0) * step(0.02, nl);

  // unlit escape hatch (backdrop-class surfaces): albedo carries the look
  lit = mix(lit, albedo, step(0.5, M.opts.y));

  // distance fog toward the page-background tint
  let dist = length(G.camPos.xyz - v.wpos);
  let f = clamp((dist - G.fogRange.x) / max(G.fogRange.y - G.fogRange.x, 0.001), 0.0, 1.0);
  lit = mix(lit, G.fogCol.rgb, f * 0.85);

  // exposure -> tone map -> gamma encode (canvas view is non-sRGB)
  var c = aces(lit * G.camPos.w);
  c = pow(c, vec3f(1.0 / 2.2));
  return vec4f(c, M.color.a);
}
