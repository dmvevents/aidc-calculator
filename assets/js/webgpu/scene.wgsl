// scene.wgsl — first-party WGSL for the datacenter building-scene renderer.
// Hand-authored (no framework, no generated shader graph). One shader pair
// drives both the opaque and the alpha-blend pipeline; per-material state
// arrives through the Material uniform. Lighting is deliberately basic and
// deterministic: one warm key light + a cool hemisphere fill + distance fog,
// ACES-approx tone map, gamma-encode at the end (canvas format is non-sRGB).
// Palette flows from the generated scene manifest's material factors (which
// were designed on the aidc-design token system) — nothing is hardcoded here
// except the light tints.
//
// #229 material response (still diagram-grade, not photoreal): per-material
// metallic/roughness now drive a Schlick-Fresnel + roughness-shaped Blinn
// highlight and a hemisphere-gradient environment reflection (the first-party
// stand-in for IBL — same sky/ground tints as the ambient, so it is one
// consistent light rig); emissiveFactor carries the LED status bands; the
// alpha-blend materials (containment/shell) gain a grazing-angle alpha lift
// so the translucent panels read as physical surfaces edge-on.

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
  opts  : vec4f,   // x = has baseColor texture (0/1), y = unlit (0/1),
                   // z = metallicFactor, w = roughnessFactor
  emiss : vec4f,   // rgb = emissiveFactor (linear), w = 1 on alpha-blend materials
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
  let NoV = clamp(dot(n, V), 0.0, 1.0);

  // per-material surface response (#229): authored by the generators
  let metal = clamp(M.opts.z, 0.0, 1.0);
  let rough = clamp(M.opts.w, 0.08, 1.0);
  let gloss = 1.0 - rough;

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

  // metals return their energy through reflection, not diffuse
  var lit = albedo * (hemi + key + cool) * (1.0 - 0.55 * metal);

  // Schlick Fresnel: dielectric floor -> albedo-tinted for metals
  let f0 = mix(vec3f(0.045), albedo, metal);
  let fres = f0 + (max(vec3f(gloss), f0) - f0) * pow(1.0 - NoV, 5.0);

  // roughness-shaped Blinn key highlight (replaces the old fixed pow-40 term)
  let H = normalize(L + V);
  let specPow = exp2(mix(3.5, 9.0, gloss * gloss));
  lit += fres * pow(max(dot(n, H), 0.0), specPow)
         * (G.lightDir.w * step(0.02, nl)) * mix(0.10, 0.85, gloss);

  // hemisphere-gradient environment reflection + a horizon band: the cheap,
  // deterministic stand-in for IBL that lets enclosures/pipes read as metal
  let R = reflect(-V, n);
  var env = mix(G.groundCol.rgb, G.skyCol.rgb, clamp(R.y * 0.5 + 0.5, 0.0, 1.0)) * G.skyCol.w;
  env += vec3f(0.9, 0.95, 1.0) * (pow(1.0 - abs(R.y), 4.0) * 0.25);
  lit += env * fres * mix(0.05, 0.6, gloss) * (0.35 + 0.65 * metal);

  // emissive (LED status bands — illustrative static color, no telemetry)
  lit += M.emiss.rgb;

  // unlit escape hatch (backdrop-class surfaces): albedo carries the look
  lit = mix(lit, albedo, step(0.5, M.opts.y));

  // distance fog toward the page-background tint
  let dist = length(G.camPos.xyz - v.wpos);
  let f = clamp((dist - G.fogRange.x) / max(G.fogRange.y - G.fogRange.x, 0.001), 0.0, 1.0);
  lit = mix(lit, G.fogCol.rgb, f * 0.85);

  // alpha: blend materials (containment/shell) get a grazing-angle lift so
  // the translucent panels read as surfaces edge-on; layer-driven alpha 0
  // stays exactly 0 (hidden layers never ghost back)
  var alpha = M.color.a;
  alpha = mix(alpha,
              clamp(alpha * (0.6 + 2.2 * pow(1.0 - NoV, 3.0)), 0.0, 1.0),
              M.emiss.w);

  // exposure -> tone map -> gamma encode (canvas view is non-sRGB)
  var c = aces(lit * G.camPos.w);
  c = pow(c, vec3f(1.0 / 2.2));
  return vec4f(c, alpha);
}
