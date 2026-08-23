# Vendored three.js 0.185.1 — provenance & local deltas

Source: npm package `three@0.185.1` (https://registry.npmjs.org/three/-/three-0.185.1.tgz),
files copied verbatim from `build/` and `examples/jsm/` preserving relative-import layout.
License: MIT (LICENSE-three-MIT.txt); `addons/libs/basis/*` = Basis Universal transcoder,
Apache-2.0 (Binomial LLC), shipped inside the three npm package.

ONE local delta, functional bytes untouched:
- `addons/loaders/GLTFLoader.js` — four JSDoc comment lines carried example
  absolute URLs (`https://my-cnd-server.com/...`); the hostnames are replaced
  with `<your-server>` so the site's zero-external-loads gate stays strict
  (grep-level) without exemptions. Upstream md5 of the file BEFORE the comment
  edit: recorded below for diffability.

    upstream GLTFLoader.js md5: 8933f4a7d97e00ccb51e91e6bff1e327

Every other vendored file is byte-identical to the npm package contents.
