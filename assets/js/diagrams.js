// Inline reactive SVG diagrams — pure SVG + vanilla JS, no libraries.
// Style contract (DESIGN.md §6 + the P10 diagram-craft pass): nodes =
// rounded-rect on card fill with hairline stroke, an IEEE-315-style simplified
// glyph identifying the equipment class, uppercase micro-label name and mono
// value. Stroke hierarchy is three-class: PRIMARY flow 2.5px (dg-edge-active /
// dg-edge-return), SECONDARY branches + glyph linework 1.5px (dg-edge-branch /
// dg-edge-standby / dg-sym), ANNOTATION 1px (dg-grid / dg-leader). Flow
// direction wears explicit arrow polygons (no marker elements — print-safe);
// every view ends in a legend + units row whose samples reuse the LIVE classes
// so the key can never drift from the drawing. Over-limit elements re-stroke
// var(--bad); text never wears the accent. Labels use deterministic
// estimated-width collision math (clamp + stagger), so no layout reads.
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
  // estimated rendered width for collision math (10px uppercase UI ≈ 6.9px/ch
  // incl. tracking; 12px mono ≈ 7.25px/ch) — deterministic, no getBBox
  function estW(s, cls) {
    const per = (!cls || cls.indexOf("dg-name") >= 0 || cls.indexOf("dg-fid") >= 0) ? 6.9
              : cls.indexOf("dg-symtxt") >= 0 ? 5.4 : 7.25;
    return String(s).length * per;
  }
  const clampX = (cx, halfW, W) => Math.max(22 + halfW, Math.min(W - 22 - halfW, cx));

  function node(x, y, w, h, name, value, state, kind) {
    const g = el("g", { "class": "dg-node" + (state ? " " + state : "") });
    g.appendChild(el("rect", { x: x, y: y, width: w, height: h, rx: 4 }));
    g.appendChild(txt(x + w / 2, y + 15, name, "dg-name"));
    if (kind) g.appendChild(glyph(kind, x + w / 2, y + h / 2 + 4));
    g.appendChild(txt(x + w / 2, y + h - 9, value, "dg-val"));
    return g;
  }
  function edge(x1, y1, x2, y2, cls) {
    return el("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": cls || "dg-edge-active" });
  }
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
    if (kind === "xfmr") {                        // two-winding transformer
      g.appendChild(C(-4.5, 6.5)); g.appendChild(C(4.5, 6.5));
    } else if (kind === "cb") {                   // breaker: square + tick
      g.appendChild(el("rect", { x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, "class": "dg-sym-cb" }));
      g.appendChild(L(-4.5, 4.5, 4.5, -4.5));
    } else if (kind === "ups") {                  // rect w/ AC wave + battery plates
      g.appendChild(el("rect", { x: cx - 13, y: cy - 8, width: 26, height: 16, rx: 2, "class": "dg-sym" }));
      g.appendChild(el("path", { d: "M " + (cx - 10) + " " + cy + " q 2.5 -5 5 0 t 5 0", "class": "dg-sym" }));
      g.appendChild(L(5, -5, 5, 5)); g.appendChild(L(9, -2.5, 9, 2.5));
    } else if (kind === "gen") {                  // genset: G circle
      g.appendChild(C(0, 8.5)); g.appendChild(txt(cx, cy + 3, "G", "dg-symtxt"));
    } else if (kind === "meter") {                // revenue meter: M circle
      g.appendChild(C(0, 6.5)); g.appendChild(txt(cx, cy + 3, "M", "dg-symtxt"));
    } else if (kind === "src") {                  // utility source: AC circle
      g.appendChild(C(0, 8.5)); g.appendChild(txt(cx, cy + 3, "~", "dg-symtxt"));
    } else if (kind === "bus") {                  // busway: heavy bar + drops
      g.appendChild(el("rect", { x: cx - 15, y: cy - 2.5, width: 30, height: 5, "class": "dg-sym-fill" }));
      g.appendChild(L(-7, 2.5, -7, 7.5)); g.appendChild(L(7, 2.5, 7, 7.5));
    } else if (kind === "load") {                 // IT load: rack elevation
      g.appendChild(el("rect", { x: cx - 9, y: cy - 7.5, width: 18, height: 15, rx: 1.5, "class": "dg-sym" }));
      g.appendChild(L(-5.5, -2.5, 5.5, -2.5)); g.appendChild(L(-5.5, 2.5, 5.5, 2.5));
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
  const ONELINE_LEGEND = [
    ["line", "dg-edge-active", "PRIMARY FEED"], ["line", "dg-edge-branch", "BRANCH"],
    ["dash", "dg-edge-standby", "STANDBY (OPEN)"], ["arr", "dg-arr", "FLOW"],
    ["glyph:src", "", "SOURCE"], ["glyph:meter", "", "METER"], ["glyph:cb", "", "BREAKER"],
    ["glyph:xfmr", "", "TRANSFORMER"], ["glyph:ups", "", "UPS"], ["glyph:gen", "", "GENSET"],
    ["glyph:bus", "", "BUSWAY"], ["glyph:load", "", "IT LOAD"], ["badnode", "", "OVER LIMIT"],
  ];

  // ---- one-line: UTILITY -> XFMR -> BUSWAY -> RACK, UPS core-only branch ----
  function oneLine(container, r) {
    const o = r.outputs;
    const W = 860, y = 40, h = 76;
    const svg = el("svg", { viewBox: "0 0 " + W + " 320", "class": "dg", role: "img",
                            "aria-label": "One-line diagram: utility service " +
                              disp()(o.utility_service_mva.value) + " MVA to transformers " +
                              disp()(o.transformer_installed_mva.value) + " MVA installed, UPS core-only branch " +
                              disp()(o.ups_backed_site_mw.value) + " MW site, busway to racks; legend and units included." });
    const bw_ok = !o.busway_rating_ok || o.busway_rating_ok.value !== false;
    const nodes = [
      ["UTILITY", disp()(o.utility_service_mva.value) + " MVA svc", null, "src"],
      ["TRANSFORMERS", disp()(o.transformer_installed_mva.value) + " MVA · " + o.transformer_units.value + " units", null, "xfmr"],
      ["BUSWAY A/B", o.busway_continuous_a ? disp()(o.busway_continuous_a.value) + " A cont" : "set rack kW", bw_ok ? null : "dg-bad", "bus"],
      ["RACKS", o.racks_at_rack_kw ? o.racks_at_rack_kw.value + " racks" : disp()(r.inputs.it_mw.value) + " MW-IT", null, "load"],
    ];
    const xw = 150, gap = (W - 40 - 4 * xw) / 3;
    const xs = nodes.map((_, i) => 20 + i * (xw + gap));
    const ym = y + h / 2;
    for (let i = 0; i < nodes.length - 1; i++) {
      svg.appendChild(edge(xs[i] + xw, ym, xs[i + 1], ym));
      svg.appendChild(arrow(xs[i] + xw + gap * 0.7, ym, 0, "dg-arr"));
    }
    // service metering + breakers on the primary run (IEEE-simplified)
    svg.appendChild(glyph("meter", xs[0] + xw + gap * 0.3, ym));
    svg.appendChild(glyph("cb", xs[1] + xw + gap * 0.3, ym));
    svg.appendChild(glyph("cb", xs[2] + xw + gap * 0.3, ym));
    nodes.forEach((n, i) => svg.appendChild(node(xs[i], y, xw, h, n[0], n[1], n[2], n[3])));
    // paths count: two short stacked labels clear of the edge glyphs
    const pcx = xs[1] + xw + gap / 2;
    svg.appendChild(txt(pcx, ym - 12, o.distribution_paths.value + (o.distribution_paths.value === 2 ? " PATHS" : " PATH"), "dg-name"));
    svg.appendChild(txt(pcx, ym + 20, String(r.inputs.redundancy.value), "dg-name"));
    // UPS core-only branch hangs off the transformer bus (secondary weight)
    const ux = xs[1] + xw / 2 + 40, uy = y + h + 34;
    svg.appendChild(edge(xs[1] + xw / 2, y + h, xs[1] + xw / 2, uy + 12, "dg-edge-branch"));
    svg.appendChild(edge(xs[1] + xw / 2, uy + 12, ux - 4, uy + 12, "dg-edge-branch"));
    svg.appendChild(arrow(ux - 12, uy + 12, 0, "dg-arr-mut"));
    svg.appendChild(node(ux, uy - 16, 190, h,
                         "UPS · CORE-ONLY",
                         disp()(o.ups_backed_site_mw.value) + " MW · " + o.ups_modules_installed_per_path.value + "/path", null, "ups"));
    // genset standby, dashed (open tie — no flow arrow)
    const gx = xs[0] + xw / 2;
    svg.appendChild(el("line", { x1: gx, y1: y + h, x2: gx, y2: uy + 12, "class": "dg-edge-standby" }));
    svg.appendChild(el("line", { x1: gx, y1: uy + 12, x2: gx + 40, y2: uy + 12, "class": "dg-edge-standby" }));
    svg.appendChild(node(gx + 44, uy - 16, 150, h, "GENSETS · STANDBY",
                         o.genset_units_installed.value + " x " + disp()(r.inputs.genset_unit_mva.value) + " MVA", "dg-standby", "gen"));
    const bot = legend(svg, W, uy - 16 + h + 22, ONELINE_LEGEND, "MVA · MW · A");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (bot + 8));
    container.replaceChildren(svg);
  }

  // ---- cooling ladder: T_ref +A_rej +A_CDU -> min TCS vs rack inlet ---------
  function coolingLadder(container, r) {
    const o = r.outputs, inp = r.inputs;
    const W = 860;
    const inlet = Number(inp.tcs_inlet_c.value);
    const tref = o.t_reject_ref_c.value, min = o.min_tcs_supply_c.value;
    const acdu = Number(inp.a_cdu.value);
    const arej = min - acdu - tref;
    const verdict = o.cooling_verdict.value;
    const ok = o.rejection_feasible.value;
    const svg = el("svg", { viewBox: "0 0 " + W + " 300", "class": "dg", role: "img",
                            "aria-label": "Cooling approach ladder: rejection reference " + disp()(tref) +
                              " C plus rejector approach " + disp()(arej) + " K plus CDU approach " + disp()(acdu) +
                              " K gives minimum TCS supply " + disp()(min) + " C against rack inlet " + disp()(inlet) +
                              " C. Verdict: " + verdict + "; legend and units included." });
    // temperature scale: map [tmin..tmax] -> x
    const tmin = Math.min(tref, inlet) - 4, tmax = Math.max(min, inlet, 46) + 4;
    const x0 = 60, x1 = W - 220;
    const X = (t) => x0 + (t - tmin) / (tmax - tmin) * (x1 - x0);
    const yb = 96;
    svg.appendChild(txt(x0, 30, "TCS ← CDU ← HEAT REJECTION — approach stack (F5)", "dg-name", "start"));
    // stacked approach segments; labels stagger when the segments are narrow
    const putSeg = (ta, tb, cls) => svg.appendChild(el("rect", {
      x: X(ta), y: yb, width: Math.max(1, X(tb) - X(ta)), height: 18, rx: 3, "class": cls }));
    putSeg(tref, tref + arej, "dg-seg");
    putSeg(tref + arej, min, "dg-seg dg-seg2");
    svg.appendChild(arrow(X(tref + arej) - 3, yb + 9, 0, "dg-arr-mut"));
    svg.appendChild(arrow(X(min) - 3, yb + 9, 0, "dg-arr-mut"));
    const labR = "REJECTOR +" + disp()(arej) + " K", labC = "CDU +" + disp()(acdu) + " K";
    let cxR = clampX((X(tref) + X(tref + arej)) / 2, estW(labR, "dg-name") / 2, W);
    let cxC = clampX((X(tref + arej) + X(min)) / 2, estW(labC, "dg-name") / 2, W);
    const collide = (cxR + estW(labR, "dg-name") / 2 + 6) > (cxC - estW(labC, "dg-name") / 2);
    svg.appendChild(txt(cxR, yb - 8, labR, "dg-name"));
    svg.appendChild(txt(cxC, collide ? yb - 22 : yb - 8, labC, "dg-name"));
    const wTref = estW(disp()(tref) + " C", "dg-val") / 2;
    const labM = "min TCS " + disp()(min) + " C";
    let cxT = clampX(X(tref), wTref, W);
    let cxM = clampX(X(min), estW(labM, "dg-val") / 2, W);
    let yM = yb + 44;
    if (cxM - estW(labM, "dg-val") / 2 < cxT + wTref + 6) yM = yb + 60;
    svg.appendChild(txt(cxT, yb + 44, disp()(tref) + " C", "dg-val"));
    svg.appendChild(txt(cxM, yM, labM, "dg-val"));
    // rack inlet marker
    svg.appendChild(el("line", { x1: X(inlet), y1: yb - 26, x2: X(inlet), y2: yb + 30,
                                 "class": ok ? "dg-marker-ok" : "dg-marker-bad" }));
    const labI = "RACK INLET " + disp()(inlet) + " C";
    svg.appendChild(txt(clampX(X(inlet), estW(labI, "dg-name") / 2, W), yb - 32, labI, "dg-name"));
    // W-class ladder cells
    const classes = [["W17", 17], ["W27", 27], ["W32", 32], ["W45", 45], ["W+", 99]];  // W40 removed v3.1 (C-M4, DA-11933-001 ladder)
    const cw = 62, cy = 178;
    svg.appendChild(txt(x0, cy - 10, "ASHRAE W-CLASS — required (rack inlet) vs plant-deliverable", "dg-name", "start"));
    classes.forEach((c, i) => {
      const cx = x0 + i * (cw + 6);
      const isReq = o.ashrae_class_required.value === c[0];
      const isPlant = o.ashrae_class_of_plant.value === c[0];
      svg.appendChild(el("rect", { x: cx, y: cy, width: cw, height: 26, rx: 3,
                                   "class": "dg-wcell" + (isPlant ? " dg-wplant" : "") + (isReq ? " dg-wreq" : "") }));
      svg.appendChild(txt(cx + cw / 2, cy + 17, c[0], isReq || isPlant ? "dg-val" : "dg-name"));
    });
    // verdict badge (icon + word — never color alone)
    const vb = el("g", { "class": "dg-verdict " +
      (verdict === "dry-only" ? "v-good" : verdict === "wetted-assist" ? "v-warn" : "v-bad") });
    vb.appendChild(el("rect", { x: W - 200, y: 60, width: 180, height: 54, rx: 4 }));
    vb.appendChild(txt(W - 110, 82, verdict === "dry-only" ? "✓ DRY-ONLY"
                       : verdict === "wetted-assist" ? "! WETTED-ASSIST" : "✕ INFEASIBLE", "dg-val"));
    vb.appendChild(txt(W - 110, 102, verdict === "infeasible"
                       ? "chillerless fails — trim " + disp()(o.chillerless_min_tcs_c.value - inlet) + " K"
                       : "F5 verdict at design hour", "dg-name"));
    svg.appendChild(vb);
    const bot = legend(svg, W, cy + 26 + 18, [
      ["rect", "dg-seg", "REJECTOR APPROACH"], ["rect", "dg-seg dg-seg2", "CDU APPROACH"],
      ["arr", "dg-arr-mut", "STACK DIRECTION"],
      ["marker", "dg-marker-ok", "INLET FEASIBLE"], ["marker", "dg-marker-bad", "INLET INFEASIBLE"],
      ["rect", "dg-wcell dg-wreq", "W REQUIRED"], ["rect", "dg-wcell dg-wplant", "W PLANT"],
    ], "°C · K");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (bot + 8));
    container.replaceChildren(svg);
  }

  // ---- commissioning load-step ladder (bars: magnitude by LENGTH) ----------
  function cxLadder(container, res, steps) {
    const fac = res.outputs.facility_mw.value;
    const rowH = 26, pad = 4, labelW = 210;
    const W = 860;
    const svg = el("svg", { viewBox: "0 0 " + W + " " + (steps.length * rowH + 70), "class": "dg", role: "img",
                            "aria-label": "Commissioning load-step ladder from house energization to acceptance soak, as a share of " +
                              disp()(fac) + " MW facility load; legend and units included." });
    const x0 = labelW, x1 = W - 90;
    // 0 baseline + 100% gridline
    svg.appendChild(el("line", { x1: x0, y1: 8, x2: x0, y2: steps.length * rowH + 12, "class": "dg-grid" }));
    svg.appendChild(el("line", { x1: x1, y1: 8, x2: x1, y2: steps.length * rowH + 12, "class": "dg-grid" }));
    svg.appendChild(txt(x0, steps.length * rowH + 26, "0", "dg-name"));
    svg.appendChild(txt(x1, steps.length * rowH + 26, "100% = " + disp()(fac) + " MW", "dg-name"));
    steps.forEach((s, i) => {
      const y = 12 + i * rowH;
      const w = Math.max(2, (x1 - x0) * Math.min(1, s.frac));
      svg.appendChild(txt(x0 - 8, y + 15, s.id + " · " + s.name.toUpperCase(), "dg-name", "end"));
      svg.appendChild(el("rect", { x: x0, y: y + 2, width: w, height: rowH - pad * 2, rx: 3,
                                   "class": "dg-bar" }));
      const val = disp()(s.mw) + " MW";
      if (x0 + w + 8 + estW(val, "dg-val") > W - 4) {
        svg.appendChild(txt(x0 + w - 8, y + 15, val, "dg-val", "end"));
      } else {
        svg.appendChild(txt(x0 + w + 8, y + 15, val, "dg-val", "start"));
      }
    });
    const bot = legend(svg, W, steps.length * rowH + 34, [
      ["rect", "dg-bar", "STEP LOAD — LENGTH = SHARE OF FACILITY"],
      ["line", "dg-grid", "0 / 100% BOUNDS"],
    ], "MW · %");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (bot + 8));
    container.replaceChildren(svg);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.diagrams = { oneLine: oneLine, coolingLadder: coolingLadder, cxLadder: cxLadder };
})();
