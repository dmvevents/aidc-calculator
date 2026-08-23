// Engineering-view renderers: full-page annotated one-line, cooling schematic,
// fiber logical topology, fiber physical overlay on the generated hall plan,
// hall-plan layer mount, and the downloadable-SVG helper. Pure inline SVG +
// vanilla JS (DESIGN.md §6 style contract); values come from the SAME parity-
// tested calc engines the calculator pages run — nothing is hand-typed here.
"use strict";
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const disp = () => globalThis.AIDC.res.disp;

  function el(name, attrs, children) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    for (const c of children || []) e.appendChild(c);
    return e;
  }
  function txt(x, y, s, cls, anchor) {
    const t = el("text", { x: x, y: y, "class": cls || "dg-val",
                           "text-anchor": anchor || "middle" });
    t.textContent = s;
    return t;
  }
  function node(x, y, w, h, name, value, state, kind) {
    const g = el("g", { "class": "dg-node" + (state ? " " + state : "") });
    g.appendChild(el("rect", { x: x, y: y, width: w, height: h, rx: 4 }));
    g.appendChild(txt(x + w / 2, y + (h >= 66 ? 15 : 16), name, "dg-name"));
    if (kind) g.appendChild(glyph(kind, x + w / 2, y + h / 2 + 4));
    g.appendChild(txt(x + w / 2, y + h - (h >= 66 ? 9 : 10), value, "dg-val"));
    return g;
  }
  function edge(x1, y1, x2, y2, cls) {
    return el("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": cls || "dg-edge-active" });
  }
  // ---- P10 diagram-craft helpers (mirrored in diagrams.js — same contract) ----
  // estimated rendered width for collision math (deterministic, no getBBox)
  function estW(s, cls) {
    const per = (!cls || cls.indexOf("dg-name") >= 0 || cls.indexOf("dg-fid") >= 0) ? 6.9
              : cls.indexOf("dg-symtxt") >= 0 ? 5.4 : 7.25;
    return String(s).length * per;
  }
  const clampX = (cx, halfW, W) => Math.max(22 + halfW, Math.min(W - 22 - halfW, cx));
  // flow arrow: small polygon, tip 8px along dir (deg: 0=+x, 90=+y)
  function arrow(x, y, dir, cls) {
    return el("polygon", { points: "0,-4.5 8,0 0,4.5", "class": cls || "dg-arr",
                           transform: "translate(" + x + " " + y + ") rotate(" + (dir || 0) + ")" });
  }
  // IEEE-315-style simplified glyph set (consistent across all one-lines)
  function glyph(kind, cx, cy) {
    const g = el("g", { "class": "dg-glyph", "data-glyph": kind });
    const C = (dx, r) => el("circle", { cx: cx + dx, cy: cy, r: r, "class": "dg-sym" });
    const L = (a, b, c, d) => el("line", { x1: cx + a, y1: cy + b, x2: cx + c, y2: cy + d, "class": "dg-sym" });
    if (kind === "xfmr") {
      g.appendChild(C(-4.5, 6.5)); g.appendChild(C(4.5, 6.5));
    } else if (kind === "cb") {
      g.appendChild(el("rect", { x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, "class": "dg-sym-cb" }));
      g.appendChild(L(-4.5, 4.5, 4.5, -4.5));
    } else if (kind === "ups") {
      g.appendChild(el("rect", { x: cx - 13, y: cy - 8, width: 26, height: 16, rx: 2, "class": "dg-sym" }));
      g.appendChild(el("path", { d: "M " + (cx - 10) + " " + cy + " q 2.5 -5 5 0 t 5 0", "class": "dg-sym" }));
      g.appendChild(L(5, -5, 5, 5)); g.appendChild(L(9, -2.5, 9, 2.5));
    } else if (kind === "gen") {
      g.appendChild(C(0, 8.5)); g.appendChild(txt(cx, cy + 3, "G", "dg-symtxt"));
    } else if (kind === "meter") {
      g.appendChild(C(0, 6.5)); g.appendChild(txt(cx, cy + 3, "M", "dg-symtxt"));
    } else if (kind === "src") {
      g.appendChild(C(0, 8.5)); g.appendChild(txt(cx, cy + 3, "~", "dg-symtxt"));
    } else if (kind === "bus") {
      g.appendChild(el("rect", { x: cx - 15, y: cy - 2.5, width: 30, height: 5, "class": "dg-sym-fill" }));
      g.appendChild(L(-7, 2.5, -7, 7.5)); g.appendChild(L(7, 2.5, 7, 7.5));
    } else if (kind === "load") {
      g.appendChild(el("rect", { x: cx - 9, y: cy - 7.5, width: 18, height: 15, rx: 1.5, "class": "dg-sym" }));
      g.appendChild(L(-5.5, -2.5, 5.5, -2.5)); g.appendChild(L(-5.5, 2.5, 5.5, 2.5));
    } else if (kind === "pump") {
      g.appendChild(C(0, 7.5)); g.appendChild(L(-3, 4.5, 6.7, 0)); g.appendChild(L(-3, -4.5, 6.7, 0));
    }
    return g;
  }
  // legend + units row; returns the bottom y consumed (caller re-sizes viewBox)
  function legend(svg, W, y0, items, units) {
    const g = el("g", { "data-p10b": "legend" });
    g.appendChild(el("line", { x1: 20, y1: y0, x2: W - 20, y2: y0, "class": "dg-grid" }));
    const rowH = 24;
    let y = y0 + 17;
    g.appendChild(txt(20, y + 3, "LEGEND", "dg-name", "start"));
    let x = 20 + estW("LEGEND", "dg-name") + 16;
    const uStr = units ? "UNITS · " + units : null;
    const uW = uStr ? estW(uStr, "dg-name") : 0;
    for (const it of items) {
      const kind = it[0], cls = it[1], label = it[2];
      const sw = kind.indexOf("glyph:") === 0 ? 30 : kind === "rect" || kind === "badnode" ? 15
               : kind === "marker" ? 8 : kind === "arr" ? 14 : 24;
      const w = sw + 6 + estW(label, "dg-name") + 18;
      const lim = (y === y0 + 17) ? (W - 24 - uW - 20) : (W - 20);
      if (x + w > lim && x > 22) { x = 20; y += rowH; }
      if (kind === "line" || kind === "dash") {
        g.appendChild(el("line", { x1: x, y1: y, x2: x + sw, y2: y, "class": cls }));
      } else if (kind === "rect") {
        g.appendChild(el("rect", { x: x, y: y - 6, width: 15, height: 12, rx: 2, "class": cls }));
      } else if (kind === "badnode") {
        const n = el("g", { "class": "dg-node dg-bad" });
        n.appendChild(el("rect", { x: x, y: y - 6, width: 15, height: 12, rx: 2 }));
        g.appendChild(n);
      } else if (kind === "marker") {
        g.appendChild(el("line", { x1: x + 4, y1: y - 7, x2: x + 4, y2: y + 7, "class": cls }));
      } else if (kind === "arr") {
        g.appendChild(arrow(x + 3, y, 0, cls));
      } else if (kind.indexOf("glyph:") === 0) {
        g.appendChild(glyph(kind.slice(6), x + sw / 2, y));
      }
      g.appendChild(txt(x + sw + 6, y + 3, label, "dg-name", "start"));
      x += w;
    }
    if (uStr) g.appendChild(txt(W - 20, y0 + 20, uStr, "dg-name", "end"));
    svg.appendChild(g);
    return y + rowH - 6;
  }
  // annotation block: F-ID title + mono lines (the derivation-chain, drawn)
  function annot(svg, x, y, w, fid, lines) {
    svg.appendChild(el("line", { x1: x, y1: y - 14, x2: x + w, y2: y - 14, "class": "dg-grid" }));
    svg.appendChild(txt(x, y, fid, "dg-fid", "start"));
    lines.forEach((s, i) => svg.appendChild(txt(x, y + 16 + i * 16, s, "dg-ann", "start")));
    return y + 16 + lines.length * 16;
  }

  // ---- downloadable SVG -------------------------------------------------------
  // Standalone files carry a fixed light palette (the site's print tokens) so
  // they read correctly in documents; on-page rendering keeps the CSS tokens.
  const DL_STYLE =
    "text{font-family:ui-monospace,Menlo,Consolas,monospace}" +
    ".dg-name,.hp-lbl,.hp-lbl-dim{fill:#5a6472;font-size:10px;letter-spacing:.08em;" +
    "text-transform:uppercase;font-family:system-ui,sans-serif}" +
    ".dg-val,.hp-val,.dg-ann{fill:#111418;font-size:12px}" +
    ".dg-fid{fill:#0f6aa8;font-size:10px;letter-spacing:.08em;font-family:system-ui,sans-serif}" +
    ".dg-node rect{fill:#f3f4f6;stroke:#5a6472;stroke-width:1}" +
    ".dg-node.dg-bad rect{stroke:#b42323;stroke-width:2}" +
    ".dg-node.dg-standby rect{stroke-dasharray:3 3}" +
    ".dg-edge-active{stroke:#0f6aa8;stroke-width:2.5}" +
    ".dg-edge-standby{stroke:#5a6472;stroke-width:1.5;stroke-dasharray:4 4}" +
    ".dg-grid{stroke:#c3c9d4;stroke-width:1}" +
    ".dg-seg{fill:#0f6aa84d;stroke:#0f6aa8}.dg-seg2{fill:#6d3fc742;stroke:#6d3fc7}" +
    ".dg-marker-ok{stroke:#0c7a4d;stroke-width:2.5}.dg-marker-bad{stroke:#b42323;stroke-width:2.5}" +
    ".dg-wcell{fill:#f6f7f9;stroke:#c3c9d4}.dg-wcell.dg-wplant{stroke:#0f6aa8;stroke-width:2}" +
    ".dg-wcell.dg-wreq{fill:#0f6aa82e}" +
    ".dg-verdict rect{fill:#fff;stroke-width:1.5}" +
    ".dg-verdict.v-good rect{stroke:#0c7a4d}.dg-verdict.v-good .dg-val{fill:#0c7a4d}" +
    ".dg-verdict.v-warn rect{stroke:#9a6a00}.dg-verdict.v-warn .dg-val{fill:#9a6a00}" +
    ".dg-verdict.v-bad rect{stroke:#b42323}.dg-verdict.v-bad .dg-val{fill:#b42323}" +
    ".hp-apron{fill:#f6f7f9;stroke:none}.hp-wall{fill:#5a6472}" +
    ".hp-rack{fill:#e5e9ef;stroke:#5a6472}.hp-rack-front{fill:#0f6aa8}" +
    ".hp-mgmt{fill:#e4dcf2;stroke:#6d3fc7}.hp-contain{fill:#0f6aa814;stroke:#0f6aa855}" +
    ".hp-crah{fill:#dce8ee;stroke:#33707e}.hp-cdu{fill:#d8e2f0;stroke:#2b4d7e}" +
    ".hp-pipe,.hp-pipe-branch{stroke:#1b7a72;stroke-width:2}.hp-pipe-branch{stroke-width:1.2}" +
    ".hp-fws{stroke:#0c5a64;stroke-width:2.5}.hp-dc{fill:#dfeae8;stroke:#0c5a64}" +
    ".hp-fan{fill:none;stroke:#0c5a64}" +
    ".hp-swgr{fill:#dfe3ec;stroke:#2b3a5e}.hp-ups{fill:#dbe4f2;stroke:#2b4d7e}" +
    ".hp-batt{fill:#e9e4d2;stroke:#9a6a00}.hp-tx{fill:#e3e3e6;stroke:#44464c}" +
    ".hp-gen{fill:#eee8d8;stroke:#6b5b1e}.hp-tank{fill:#f1ecdc;stroke:#6b5b1e}" +
    ".hp-bus{stroke:#9a6a00;stroke-width:2}.hp-bus-b{stroke:#9a6a00;stroke-width:2;stroke-dasharray:5 3}" +
    ".hp-bus-drop{fill:#9a6a00}" +
    ".hp-tray{stroke:#6d3fc7;stroke-width:2.2;stroke-dasharray:7 3}.hp-riser{fill:#e4dcf2;stroke:#6d3fc7}" +
    ".hp-dim{stroke:#8a94a4;stroke-width:1}" +
    ".fl-bundle{stroke:#0f6aa8;stroke-width:3;opacity:.8}.fl-bundle-thin{stroke:#0f6aa8;stroke-width:1.5}" +
    ".fl-run{stroke:#6d3fc7;stroke-width:2.5;fill:none}" +
    ".fl-zone-cu{fill:#9a6a0022;stroke:#9a6a00}.fl-zone-fi{fill:#0f6aa81f;stroke:#0f6aa8}" +
    // P10 craft: stroke hierarchy, glyphs, arrows, legend samples
    ".dg-edge-branch{stroke:#5a6472;stroke-width:1.5}" +
    ".dg-edge-return{stroke:#0f6aa8;stroke-width:2.5;stroke-dasharray:6 4}" +
    ".dg-leader{stroke:#c3c9d4;stroke-width:1;fill:none}" +
    ".dg-arr{fill:#0f6aa8;stroke:none}.dg-arr-mut{fill:#5a6472;stroke:none}" +
    ".dg-sym{fill:none;stroke:#333a44;stroke-width:1.5}" +
    ".dg-sym-cb{fill:#fff;stroke:#333a44;stroke-width:1.5}" +
    ".dg-sym-fill{fill:#333a44;stroke:none}" +
    ".dg-symtxt{fill:#333a44;font-size:9px;font-family:ui-monospace,Menlo,Consolas,monospace}" +
    ".fl-stack{fill:#f6f7f9;stroke:#c3c9d4}.fl-count{fill:#111418;font-size:22px;font-weight:650}" +
    ".hp-arr-power{fill:#9a6a00;stroke:none}.hp-arr-fiber{fill:#6d3fc7;stroke:none}" +
    ".hp-arr-liquid{fill:#1b7a72;stroke:none}";

  function wireDownload(btnId, stageId, filename) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const src = document.getElementById(stageId);
      const svg = src && (src.tagName === "svg" ? src : src.querySelector("svg"));
      if (!svg) return;
      const c = svg.cloneNode(true);
      const vb = (c.getAttribute("viewBox") || "0 0 980 600").split(/\s+/);
      c.setAttribute("xmlns", NS);
      c.setAttribute("width", vb[2]);
      c.setAttribute("height", vb[3]);
      const st = document.createElementNS(NS, "style");
      st.textContent = DL_STYLE;
      c.insertBefore(st, c.firstChild);
      const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' +
                            new XMLSerializer().serializeToString(c)],
                           { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  }

  // ---- 1 · electrical one-line, full page + formula annotations --------------
  const ONELINE_LEGEND = [
    ["line", "dg-edge-active", "PRIMARY FEED"], ["line", "dg-edge-branch", "BRANCH"],
    ["dash", "dg-edge-standby", "STANDBY (OPEN)"], ["arr", "dg-arr", "FLOW"],
    ["glyph:src", "", "SOURCE"], ["glyph:meter", "", "METER"], ["glyph:cb", "", "BREAKER"],
    ["glyph:xfmr", "", "TRANSFORMER"], ["glyph:ups", "", "UPS"], ["glyph:gen", "", "GENSET"],
    ["glyph:bus", "", "BUSWAY"], ["glyph:load", "", "IT LOAD"], ["badnode", "", "OVER LIMIT"],
  ];
  function oneLineFull(container, r) {
    const o = r.outputs, i = r.inputs, d = disp();
    const W = 980;
    const haveRack = o.rack_current_a && o.rack_current_a.value !== null && o.rack_current_a.value !== undefined;
    const bwOk = !o.busway_rating_ok || o.busway_rating_ok.value !== false;
    const svg = el("svg", { viewBox: "0 0 " + W + " 700", "class": "dg", role: "img",
      "aria-label": "Annotated electrical one-line: utility service " + d(o.utility_service_mva.value) +
        " MVA, transformers " + d(o.transformer_installed_mva.value) + " MVA installed, UPS core-only " +
        d(o.ups_backed_site_mw.value) + " MW site, standby generation " + o.genset_units_installed.value +
        " units, busway to racks, with sizing formulas F13 to F18; legend and units included." });
    svg.appendChild(txt(20, 26, "ELECTRICAL ONE-LINE — SIZED LIVE BY F13 · F14 · F15 · F17 · F18", "dg-name", "start"));

    const y = 48, h = 76, xw = 176, gap = (W - 40 - 4 * xw) / 3, ym = y + h / 2;
    const xs = [0, 1, 2, 3].map((k) => 20 + k * (xw + gap));
    for (let k = 0; k < 3; k++) {
      svg.appendChild(edge(xs[k] + xw, ym, xs[k + 1], ym));
      svg.appendChild(arrow(xs[k] + xw + gap * 0.7, ym, 0, "dg-arr"));
    }
    // service metering + breakers on the primary run (IEEE-simplified)
    svg.appendChild(glyph("meter", xs[0] + xw + gap * 0.3, ym));
    svg.appendChild(glyph("cb", xs[1] + xw + gap * 0.3, ym));
    svg.appendChild(glyph("cb", xs[2] + xw + gap * 0.3, ym));
    svg.appendChild(node(xs[0], y, xw, h, "UTILITY SERVICE", d(o.utility_service_mva.value) + " MVA", null, "src"));
    svg.appendChild(node(xs[1], y, xw, h, "TRANSFORMERS",
      d(o.transformer_installed_mva.value) + " MVA · " + o.transformer_units.value + " units", null, "xfmr"));
    svg.appendChild(node(xs[2], y, xw, h, "BUSWAY A/B",
      haveRack ? d(o.busway_continuous_a.value) + " A cont/row" : "set rack kW", bwOk ? null : "dg-bad", "bus"));
    svg.appendChild(node(xs[3], y, xw, h, "RACKS",
      haveRack ? o.racks_at_rack_kw.value + " × " + d(i.rack_kw.value) + " kW"
               : d(i.it_mw.value) + " MW-IT", null, "load"));
    // paths count: two short stacked labels clear of the edge glyphs
    const pcx = xs[1] + xw + gap / 2;
    svg.appendChild(txt(pcx, ym - 12, o.distribution_paths.value + (o.distribution_paths.value === 2 ? " PATHS" : " PATH"), "dg-name"));
    svg.appendChild(txt(pcx, ym + 20, String(i.redundancy.value), "dg-name"));

    // branches (secondary stroke weight; standby tie stays dashed-open)
    const by = y + h + 44;
    const txc = xs[1] + xw / 2;
    svg.appendChild(edge(txc, y + h, txc, by + 10, "dg-edge-branch"));
    svg.appendChild(edge(txc, by + 10, txc + 30, by + 10, "dg-edge-branch"));
    svg.appendChild(arrow(txc + 22, by + 10, 0, "dg-arr-mut"));
    svg.appendChild(node(txc + 32, by - 18, 210, h, "UPS · CORE-ONLY BRANCH",
      d(o.ups_backed_site_mw.value) + " MW · " + o.ups_modules_installed_per_path.value + " modules/path", null, "ups"));
    svg.appendChild(txt(txc + 32 + 105, by - 18 + h + 14,
      "battery " + d(o.ups_battery_installed_kwh.value) + " kWh · " + d(i.ride_through_min.value) + " min", "dg-name"));
    const gxc = xs[0] + xw / 2;
    svg.appendChild(el("line", { x1: gxc, y1: y + h, x2: gxc, y2: by + 10, "class": "dg-edge-standby" }));
    svg.appendChild(el("line", { x1: gxc, y1: by + 10, x2: gxc + 24, y2: by + 10, "class": "dg-edge-standby" }));
    svg.appendChild(node(gxc + 26, by - 18, 180, h, "GENSETS · STANDBY",
      o.genset_units_installed.value + " × " + d(i.genset_unit_mva.value) + " MVA", "dg-standby", "gen"));
    svg.appendChild(txt(gxc + 26 + 90, by - 18 + h + 14,
      "fuel " + d(o.genset_fuel_m3.value) + " m³ · " + d(i.fuel_hours.value) + " h", "dg-name"));
    if (haveRack) {
      const rxc = xs[3] + xw / 2;
      svg.appendChild(edge(rxc, y + h, rxc, by + 10, "dg-edge-branch"));
      svg.appendChild(edge(rxc, by + 10, rxc - 30, by + 10, "dg-edge-branch"));
      svg.appendChild(node(rxc - 30 - 200, by - 18, 200, h, "WHIPS / POWER SHELVES",
        o.whips_per_rack.value + " whips × " + d(o.whip_breaker_a.value) + " A frame", null, "cb"));
      svg.appendChild(txt(rxc - 30 - 100, by - 18 + h + 14,
        i.shelves_per_rack.value + " × " + d(i.shelf_kw.value) + " kW = " +
        d(o.rack_deliverable_kw.value) + " kW deliverable", "dg-name"));
    }

    // formula annotations (the sizing math, numbers substituted)
    let ay = by + h + 62;
    const colw = W - 40;
    ay = annot(svg, 20, ay, colw, "F13 · SERVICE & TRANSFORMERS", [
      "facility = IT × PUE = " + d(i.it_mw.value) + " × " + d(i.pue.value) + " = " + d(o.facility_mw.value) +
        " MW → peak = ÷ PF " + d(i.pf.value) + " = " + d(o.peak_demand_mva.value) + " MVA",
      "service = peak × (1 + growth " + d(i.growth_margin.value) + ") = " + d(o.utility_service_mva.value) +
        " MVA · " + i.redundancy.value + " → " + o.transformer_units.value + " transformers, N-1 holds peak",
    ]) + 14;
    ay = annot(svg, 20, ay, colw, "F14 · UPS (CORE-ONLY) & BATTERY", [
      "UPS-backed = IT × (1 + mech " + d(i.mech_on_ups_frac.value) + ") = " + d(o.ups_backed_site_mw.value) +
        " MW site → ÷ " + o.distribution_paths.value + " = " + d(o.ups_backed_per_path_mw.value) +
        " MW/path · modules ⌈peak/path ÷ " + d(i.ups_module_mw.value) + " MW⌉ + 1 = " +
        o.ups_modules_installed_per_path.value + "/path",
      "battery = backed/path × " + d(i.ride_through_min.value) + " min ÷ (DoD " + d(i.batt_dod.value) +
        " × η " + d(i.batt_eff.value) + ") = " + d(o.ups_battery_installed_kwh.value) + " kWh installed/path",
    ]) + 14;
    ay = annot(svg, 20, ay, colw, "F15 · STANDBY GENERATION & FUEL", [
      "units = ⌈peak " + d(o.peak_demand_mva.value) + " MVA ÷ " + d(i.genset_unit_mva.value) + " MVA⌉ + 1 = " +
        o.genset_units_installed.value + " · block-load step ≤ " + d(i.gen_step_frac.value) + " × unit",
      "fuel = facility " + d(o.facility_mw.value * 1000) + " kW × " + d(i.fuel_hours.value) + " h × SFC " +
        d(i.fuel_l_per_kwh.value) + " L/kWh ÷ 1000 = " + d(o.genset_fuel_m3.value) + " m³ on site",
    ]) + 14;
    if (haveRack) {
      ay = annot(svg, 20, ay, colw, "F17 · BUSWAY AMPACITY CHAIN" + (bwOk ? " — ✓ PASS" : " — ✕ FAIL"), [
        "I_rack = kW×1000 ÷ (√3 × " + d(i.dist_v.value) + " V × pf " + d(i.pf_rack.value) + ") = " +
          d(o.rack_current_a.value) + " A → row × " + i.racks_per_path.value + " racks = " +
          d(o.busway_continuous_a.value) + " A continuous",
        "rating ≥ continuous ÷ 0.8 (NEC 210.20(A)) = " + d(o.busway_min_rating_a.value) + " A vs " +
          d(i.busway_rating_a.value) + " A chosen → " + (bwOk ? "PASS" : "FAIL — pick the next frame"),
      ]) + 14;
      ay = annot(svg, 20, ay, colw, "F18 · WHIPS & POWER SHELVES", [
        "I_shelf = " + d(i.shelf_kw.value) + " kW ÷ (√3 × " + d(i.shelf_v.value) + " V × pf " + d(i.pf_rack.value) +
          ") = " + d(o.shelf_current_a.value) + " A → breaker frame " + d(o.whip_breaker_a.value) + " A × " +
          o.whips_per_rack.value + " whips (4A + 4B)",
      ]);
    } else {
      ay = annot(svg, 20, ay, colw, "F17 / F18 · RACK DISTRIBUTION", [
        "enter a rack nameplate kW in the inputs to unlock the busway ampacity chain and whip sizing",
      ]);
    }
    const bot = legend(svg, W, ay + 14, ONELINE_LEGEND, "MVA · MW · A · kWh · min · m³");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (bot + 8));
    container.replaceChildren(svg);
  }

  // ---- 2 · cooling schematic: TCS loop -> CDU -> heat rejection ---------------
  function coolingSchematic(container, r) {
    const o = r.outputs, i = r.inputs, d = disp();
    const W = 980;
    const rej = String(i.rejector.value);
    const rejName = rej === "dry" ? "DRY COOLERS" : rej === "tower" ? "COOLING TOWERS (WETTED)" : "ADIABATIC-ASSIST DRY";
    const verdict = o.cooling_verdict.value;
    const inlet = Number(i.tcs_inlet_c.value);
    const tref = o.t_reject_ref_c.value, minT = o.min_tcs_supply_c.value;
    const acdu = Number(i.a_cdu.value);
    const arej = minT - acdu - tref;
    const svg = el("svg", { viewBox: "0 0 " + W + " 760", "class": "dg", role: "img",
      "aria-label": "Cooling schematic: rack cold plates " + d(o.liquid_load_kw.value) +
        " kW to CDU (" + o.cdu_units_installed.value + " units) to " + rejName.toLowerCase() +
        "; approach stack gives minimum TCS supply " + d(minT) + " C vs rack inlet " + d(inlet) +
        " C; verdict " + verdict + "; legend and units included." });
    svg.appendChild(txt(20, 26, "COOLING PATH — TCS LOOP → CDU → HEAT REJECTION (F1–F5 · F9)", "dg-name", "start"));

    const y = 64, h = 76, xw = 190, gap = (W - 40 - 4 * xw) / 3;
    const xs = [0, 1, 2, 3].map((k) => 20 + k * (xw + gap));
    // heat flows left→right on the supply run; the return run flows back
    for (let k = 0; k < 3; k++) {
      svg.appendChild(edge(xs[k] + xw, y + 20, xs[k + 1], y + 20));
      svg.appendChild(arrow(xs[k] + xw + gap * 0.62, y + 20, 0, "dg-arr"));
      svg.appendChild(el("line", { x1: xs[k] + xw, y1: y + h - 18, x2: xs[k + 1], y2: y + h - 18,
                                   "class": "dg-edge-return" }));
      svg.appendChild(arrow(xs[k] + xw + gap * 0.38, y + h - 18, 180, "dg-arr"));
    }
    svg.appendChild(node(xs[0], y, xw, h, "RACK COLD PLATES", d(o.liquid_load_kw.value) + " kW liquid", null, "load"));
    svg.appendChild(node(xs[1], y, xw, h, "CDU (LIQUID-LIQUID)",
      o.cdu_units_required.value + "+" + (o.cdu_units_installed.value - o.cdu_units_required.value) +
      " × " + d(i.cdu_kw.value) + " kW", null, "pump"));
    svg.appendChild(node(xs[2], y, xw, h, rejName, "approach " + d(arej) + " K"));
    svg.appendChild(node(xs[3], y, xw, h, "AMBIENT (DESIGN HOUR)",
      d(i.t_db_c.value) + " °C db · " + d(i.t_wb_c.value) + " °C wb"));
    // loop captions ride a dedicated row ABOVE the cards (no border collisions)
    svg.appendChild(txt(xs[0] + xw + gap / 2, y - 12, "TCS " + d(inlet) + "→" + d(o.tcs_return_c.value) + " °C · " +
      d(o.tcs_flow_lpm.value) + " LPM", "dg-name"));
    svg.appendChild(txt(xs[1] + xw + gap / 2, y - 12, "FWS LOOP", "dg-name"));
    svg.appendChild(txt(xs[2] + xw + gap / 2, y - 12, "REFERENCE " + d(tref) + " °C", "dg-name"));
    // residual-air branch (secondary weight)
    const axc = xs[0] + xw / 2, ay0 = y + h + 36;
    svg.appendChild(edge(axc, y + h, axc, ay0 + 10, "dg-edge-branch"));
    svg.appendChild(edge(axc, ay0 + 10, axc + 26, ay0 + 10, "dg-edge-branch"));
    svg.appendChild(arrow(axc + 18, ay0 + 10, 0, "dg-arr-mut"));
    svg.appendChild(node(axc + 28, ay0 - 16, 220, 50, "RESIDUAL AIR — CRAH (F9)",
      d(o.air_load_kw.value) + " kW → " + d(o.air_flow_cfm.value) + " CFM"));

    // approach stack (F5) + rack-inlet marker; labels clamp + stagger
    const tmin = Math.min(tref, inlet) - 4, tmax = Math.max(minT, inlet, 46) + 4;
    const x0 = 60, x1 = W - 240, yb = 262;
    const X = (t) => x0 + (t - tmin) / (tmax - tmin) * (x1 - x0);
    const putSeg = (ta, tb, cls) => svg.appendChild(el("rect", {
      x: X(ta), y: yb, width: Math.max(1, X(tb) - X(ta)), height: 18, rx: 3, "class": cls }));
    svg.appendChild(txt(x0, yb - 28, "F5 APPROACH STACK — T_ref + A_rejector + A_CDU = MIN TCS SUPPLY", "dg-name", "start"));
    putSeg(tref, tref + arej, "dg-seg");
    putSeg(tref + arej, minT, "dg-seg dg-seg2");
    svg.appendChild(arrow(X(tref + arej) - 3, yb + 9, 0, "dg-arr-mut"));
    svg.appendChild(arrow(X(minT) - 3, yb + 9, 0, "dg-arr-mut"));
    const labR = "REJECTOR +" + d(arej) + " K", labC = "CDU +" + d(acdu) + " K";
    const cxR = clampX((X(tref) + X(tref + arej)) / 2, estW(labR, "dg-name") / 2, W);
    const cxC = clampX((X(tref + arej) + X(minT)) / 2, estW(labC, "dg-name") / 2, W);
    const segCollide = (cxR + estW(labR, "dg-name") / 2 + 6) > (cxC - estW(labC, "dg-name") / 2);
    svg.appendChild(txt(cxR, yb - 8, labR, "dg-name"));
    svg.appendChild(txt(cxC, segCollide ? yb - 22 : yb - 8, labC, "dg-name"));
    svg.appendChild(txt(X(tref) - 6, yb + 32, d(tref) + " °C", "dg-val", "end"));
    const labM = "min TCS " + d(minT) + " °C";
    const wM = estW(labM, "dg-val");
    let mx0 = X(minT) + 6, mAnch = "start";
    if (mx0 + wM > W - 22) { mx0 = X(minT) - 6; mAnch = "end"; }
    // dodge the inlet marker if it would cross the label's span
    if (mAnch === "start" && X(inlet) > mx0 - 4 && X(inlet) < mx0 + wM + 4) mx0 = X(inlet) + 8;
    if (mAnch === "end" && X(inlet) > mx0 - wM - 4 && X(inlet) < mx0 + 4) mx0 = X(inlet) - 8;
    if (mAnch === "start" && mx0 + wM > W - 22) { mx0 = Math.min(X(minT), X(inlet)) - 8; mAnch = "end"; }
    svg.appendChild(txt(mx0, yb + 32, labM, "dg-val", mAnch));
    svg.appendChild(el("line", { x1: X(inlet), y1: yb - 6, x2: X(inlet), y2: yb + 42,
      "class": o.rejection_feasible.value ? "dg-marker-ok" : "dg-marker-bad" }));
    const labI = "RACK INLET " + d(inlet) + " °C";
    svg.appendChild(txt(clampX(X(inlet), estW(labI, "dg-name") / 2, W), yb + 56, labI, "dg-name"));

    // W-class ladder
    const classes = [["W17", 17], ["W27", 27], ["W32", 32], ["W45", 45], ["W+", 99]];  // W40 removed v3.1 (C-M4, DA-11933-001 ladder)
    const cw = 64, cy = 346;
    svg.appendChild(txt(x0, cy - 10, "ASHRAE W-CLASS LADDER — required (rack inlet) ■ vs plant-deliverable □", "dg-name", "start"));
    classes.forEach((c, k) => {
      const cx = x0 + k * (cw + 6);
      const isReq = o.ashrae_class_required.value === c[0];
      const isPlant = o.ashrae_class_of_plant.value === c[0];
      svg.appendChild(el("rect", { x: cx, y: cy, width: cw, height: 26, rx: 3,
        "class": "dg-wcell" + (isPlant ? " dg-wplant" : "") + (isReq ? " dg-wreq" : "") }));
      svg.appendChild(txt(cx + cw / 2, cy + 17, c[0], isReq || isPlant ? "dg-val" : "dg-name"));
    });
    // verdict badge — beside the W-class row, clear of the stack's labels
    const vb = el("g", { "class": "dg-verdict " +
      (verdict === "dry-only" ? "v-good" : verdict === "wetted-assist" ? "v-warn" : "v-bad") });
    vb.appendChild(el("rect", { x: W - 210, y: cy - 18, width: 190, height: 56, rx: 4 }));
    vb.appendChild(txt(W - 115, cy + 6, verdict === "dry-only" ? "✓ DRY-ONLY"
      : verdict === "wetted-assist" ? "! WETTED-ASSIST" : "✕ INFEASIBLE", "dg-val"));
    vb.appendChild(txt(W - 115, cy + 26, "F5 verdict at design hour", "dg-name"));
    svg.appendChild(vb);

    // annotations
    let ay = 430;
    const colw = W - 40;
    const flowLine = o.flow_basis_used.value === "vendor"
      ? "F2 vendor curve at " + d(inlet) + " °C → " + d(o.flow_per_kw_lpm.value) + " LPM/kW (ΔT_eff " +
        d(o.dt_effective_k.value) + " K) — the rack is return-temp-limited"
      : "F1 flow/kW = 60 ÷ (ρ·cp·ΔT) = 60 ÷ (" + d(i.coolant_rho_kg_l.value) + " × " + d(i.coolant_cp_kj_kgk.value) +
        " × " + d(i.dt_k.value) + " K) = " + d(o.flow_per_kw_lpm.value) + " LPM/kW";
    ay = annot(svg, 20, ay, colw, "F1/F2 · TCS FLOW", [
      flowLine,
      "Q_liquid = IT × capture = " + d(i.it_kw.value) + " × " + d(i.liquid_frac.value) + " = " +
        d(o.liquid_load_kw.value) + " kW → " + d(o.tcs_flow_lpm.value) + " LPM total",
    ]) + 14;
    ay = annot(svg, 20, ay, colw, "F3 · LOOP HEAD", [
      "rack dP(curve) + hoses/manifold/CDU HX = " + d(o.rack_dp_kpa.value) + " + " +
        d(i.dp_loop_extra_kpa.value) + " = " + d(o.loop_head_kpa.value) + " kPa pump head",
    ]) + 14;
    ay = annot(svg, 20, ay, colw, "F4 · CDU COUNT", [
      "⌈" + d(o.liquid_load_kw.value) + " kW ÷ (" + d(i.cdu_kw.value) + " × derate " + d(o.cdu_derate.value) +
        ")⌉ = " + o.cdu_units_required.value + " → " + o.cdu_units_installed.value +
        " installed (" + i.cdu_redundancy.value + ") at " + d(o.cdu_loading_pct.value) + "% loading",
    ]) + 14;
    ay = annot(svg, 20, ay, colw, "F5 · FEASIBILITY", [
      "dry min TCS = " + d(i.t_db_c.value) + " + " + d(i.a_rejector.value) + " + " + d(acdu) + " = " +
        d(o.min_tcs_dry_mode_c.value) + " °C · wetted min = " + d(i.t_wb_c.value) + " + " + d(i.a_wet.value) +
        " + " + d(acdu) + " = " + d(o.min_tcs_wetted_mode_c.value) + " °C vs inlet " + d(inlet) + " °C → " +
        verdict.toUpperCase(),
    ]);
    const bot = legend(svg, W, ay + 14, [
      ["line", "dg-edge-active", "SUPPLY"], ["dash", "dg-edge-return", "RETURN"],
      ["line", "dg-edge-branch", "AIR BRANCH"], ["arr", "dg-arr", "FLOW"],
      ["glyph:load", "", "RACK"], ["glyph:pump", "", "CDU / PUMP"],
      ["rect", "dg-seg", "REJECTOR APPROACH"], ["rect", "dg-seg dg-seg2", "CDU APPROACH"],
      ["marker", "dg-marker-ok", "INLET FEASIBLE"], ["marker", "dg-marker-bad", "INLET INFEASIBLE"],
      ["rect", "dg-wcell dg-wreq", "W REQUIRED"], ["rect", "dg-wcell dg-wplant", "W PLANT"],
    ], "°C · K · LPM · kW · CFM");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (bot + 8));
    container.replaceChildren(svg);
  }

  // deep-link that always carries the CURRENT hash: the href is refreshed on
  // every render AND rewritten at click time, so it never lags the 150 ms
  // hash-encode debounce behind the last input.
  function liveLink(id, target) {
    const a = document.getElementById(id);
    if (!a) return;
    // field state, not location.hash: gallery presets pre-fill fields without
    // writing the hash, and the deep link must still reproduce what's drawn
    const dest = () => {
      const A = globalThis.AIDC;
      const h = A && A.stateHash ? A.stateHash() : location.hash.replace(/^#/, "");
      return target + (h ? "#" + h : "");
    };
    if (!a.dataset.wired) {
      a.dataset.wired = "1";
      a.addEventListener("click", () => { a.href = dest(); });
    }
    a.href = dest();
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.designs = { oneLineFull: oneLineFull, coolingSchematic: coolingSchematic,
                              wireDownload: wireDownload, liveLink: liveLink,
                              el: el, txt: txt, node: node, edge: edge, annot: annot,
                              arrow: arrow, glyph: glyph, legend: legend,
                              estW: estW, clampX: clampX };
})();
