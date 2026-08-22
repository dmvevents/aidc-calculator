// Inline reactive SVG diagrams — pure SVG + vanilla JS, no libraries.
// Style contract (DESIGN.md §6): nodes = rounded-rect on card fill with
// hairline stroke; inactive edges var(--grid) 1.5px; active path var(--accent)
// 2.5px; over-limit elements re-stroke var(--bad); node names are uppercase
// micro-labels; values are mono text tokens (text never wears the accent).
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
  function node(x, y, w, h, name, value, state) {
    const g = el("g", { "class": "dg-node" + (state ? " " + state : "") });
    g.appendChild(el("rect", { x: x, y: y, width: w, height: h, rx: 4 }));
    g.appendChild(txt(x + w / 2, y + 16, name, "dg-name"));
    g.appendChild(txt(x + w / 2, y + h - 10, value, "dg-val"));
    return g;
  }
  function edge(x1, y1, x2, y2, cls) {
    return el("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": cls || "dg-edge-active" });
  }

  // ---- one-line: UTILITY -> XFMR -> BUSWAY -> RACK, UPS core-only branch ----
  function oneLine(container, r) {
    const o = r.outputs;
    const W = 860, H = 190, y = 44, h = 56;
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "dg", role: "img",
                            "aria-label": "One-line diagram: utility service " +
                              disp()(o.utility_service_mva.value) + " MVA to transformers " +
                              disp()(o.transformer_installed_mva.value) + " MVA installed, UPS core-only branch " +
                              disp()(o.ups_backed_mw.value) + " MW, busway to racks." });
    const bw_ok = !o.busway_rating_ok || o.busway_rating_ok.value !== false;
    const nodes = [
      ["UTILITY", disp()(o.utility_service_mva.value) + " MVA svc", null],
      ["TRANSFORMERS", disp()(o.transformer_installed_mva.value) + " MVA · " + o.transformer_units.value + " units", null],
      ["BUSWAY A/B", o.busway_continuous_a ? disp()(o.busway_continuous_a.value) + " A cont" : "set rack kW", bw_ok ? null : "dg-bad"],
      ["RACKS", o.racks_at_rack_kw ? o.racks_at_rack_kw.value + " racks" : disp()(r.inputs.it_mw.value) + " MW-IT", null],
    ];
    const xw = 150, gap = (W - 40 - 4 * xw) / 3;
    const xs = nodes.map((_, i) => 20 + i * (xw + gap));
    for (let i = 0; i < nodes.length - 1; i++) {
      svg.appendChild(edge(xs[i] + xw, y + h / 2, xs[i + 1], y + h / 2));
    }
    nodes.forEach((n, i) => svg.appendChild(node(xs[i], y, xw, h, n[0], n[1], n[2])));
    // paths count under the main run
    svg.appendChild(txt((xs[1] + xs[2] + xw) / 2, y + h / 2 - 8,
                        o.distribution_paths.value + (o.distribution_paths.value === 2 ? " paths (2N)" : " path"),
                        "dg-name"));
    // UPS core-only branch hangs off the transformer bus
    const ux = xs[1] + xw / 2 + 40, uy = y + h + 34;
    svg.appendChild(edge(xs[1] + xw / 2, y + h, xs[1] + xw / 2, uy + 12, "dg-edge-active"));
    svg.appendChild(edge(xs[1] + xw / 2, uy + 12, ux - 4, uy + 12, "dg-edge-active"));
    svg.appendChild(node(ux, uy - 16, 190, h,
                         "UPS · CORE-ONLY",
                         disp()(o.ups_backed_mw.value) + " MW · " + o.ups_modules_installed_per_path.value + "/path", null));
    // genset standby, dashed
    const gx = xs[0] + xw / 2;
    svg.appendChild(el("line", { x1: gx, y1: y + h, x2: gx, y2: uy + 12, "class": "dg-edge-standby" }));
    svg.appendChild(el("line", { x1: gx, y1: uy + 12, x2: gx + 40, y2: uy + 12, "class": "dg-edge-standby" }));
    svg.appendChild(node(gx + 44, uy - 16, 150, h, "GENSETS · STANDBY",
                         o.genset_units_installed.value + " x " + disp()(r.inputs.genset_unit_mva.value) + " MVA", "dg-standby"));
    container.replaceChildren(svg);
  }

  // ---- cooling ladder: T_ref +A_rej +A_CDU -> min TCS vs rack inlet ---------
  function coolingLadder(container, r) {
    const o = r.outputs, inp = r.inputs;
    const W = 860, H = 230;
    const inlet = Number(inp.tcs_inlet_c.value);
    const tref = o.t_reject_ref_c.value, min = o.min_tcs_supply_c.value;
    const acdu = Number(inp.a_cdu.value);
    const arej = min - acdu - tref;
    const verdict = o.cooling_verdict.value;
    const ok = o.rejection_feasible.value;
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "dg", role: "img",
                            "aria-label": "Cooling approach ladder: rejection reference " + disp()(tref) +
                              " C plus rejector approach " + disp()(arej) + " K plus CDU approach " + disp()(acdu) +
                              " K gives minimum TCS supply " + disp()(min) + " C against rack inlet " + disp()(inlet) +
                              " C. Verdict: " + verdict + "." });
    // temperature scale: map [tmin..tmax] -> x
    const tmin = Math.min(tref, inlet) - 4, tmax = Math.max(min, inlet, 46) + 4;
    const x0 = 60, x1 = W - 220;
    const X = (t) => x0 + (t - tmin) / (tmax - tmin) * (x1 - x0);
    const yb = 96;
    // stacked approach segments
    const seg = (ta, tb, label, cls, yoff) => {
      svg.appendChild(el("rect", { x: X(ta), y: yb + (yoff || 0), width: Math.max(1, X(tb) - X(ta)),
                                   height: 18, rx: 3, "class": cls }));
      svg.appendChild(txt((X(ta) + X(tb)) / 2, yb - 8 + (yoff || 0), label, "dg-name"));
    };
    svg.appendChild(txt(X(tref), yb + 44, disp()(tref) + " C", "dg-val"));
    svg.appendChild(txt(x0, 30, "TCS ← CDU ← HEAT REJECTION — approach stack (F5)", "dg-name", "start"));
    seg(tref, tref + arej, "REJECTOR +" + disp()(arej) + " K", "dg-seg");
    seg(tref + arej, min, "CDU +" + disp()(acdu) + " K", "dg-seg dg-seg2");
    svg.appendChild(txt(X(min), yb + 44, "min TCS " + disp()(min) + " C", "dg-val"));
    // rack inlet marker
    svg.appendChild(el("line", { x1: X(inlet), y1: yb - 26, x2: X(inlet), y2: yb + 30,
                                 "class": ok ? "dg-marker-ok" : "dg-marker-bad" }));
    svg.appendChild(txt(X(inlet), yb - 32, "RACK INLET " + disp()(inlet) + " C", "dg-name"));
    // W-class ladder cells
    const classes = [["W17", 17], ["W27", 27], ["W32", 32], ["W40", 40], ["W45", 45], ["W+", 99]];
    const cw = 62, cy = 168;
    svg.appendChild(txt(x0, cy - 10, "ASHRAE W-CLASS — required (rack inlet) vs plant-deliverable", "dg-name", "start"));
    classes.forEach((c, i) => {
      const cx = x0 + i * (cw + 6);
      const isReq = o.ashrae_class_required.value === c[0];
      const isPlant = o.ashrae_class_of_plant.value === c[0];
      svg.appendChild(el("rect", { x: cx, y: cy, width: cw, height: 26, rx: 3,
                                   "class": "dg-wcell" + (isPlant ? " dg-wplant" : "") + (isReq ? " dg-wreq" : "") }));
      svg.appendChild(txt(cx + cw / 2, cy + 17, c[0], isReq || isPlant ? "dg-val" : "dg-name"));
    });
    svg.appendChild(txt(x0 + 6 * (cw + 6) + 8, cy + 17,
                        "required ■ / plant □", "dg-name", "start"));
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
    container.replaceChildren(svg);
  }

  // ---- commissioning load-step ladder (bars: magnitude by LENGTH) ----------
  function cxLadder(container, res, steps) {
    const fac = res.outputs.facility_mw.value;
    const rowH = 26, pad = 4, labelW = 210;
    const W = 860, H = steps.length * rowH + 30;
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "dg", role: "img",
                            "aria-label": "Commissioning load-step ladder from house energization to acceptance soak, as a share of " +
                              disp()(fac) + " MW facility load." });
    const x0 = labelW, x1 = W - 90;
    // 100% gridline
    svg.appendChild(el("line", { x1: x1, y1: 8, x2: x1, y2: H - 18, "class": "dg-grid" }));
    svg.appendChild(txt(x1, H - 4, "100%", "dg-name"));
    steps.forEach((s, i) => {
      const y = 12 + i * rowH;
      const w = Math.max(2, (x1 - x0) * Math.min(1, s.frac));
      svg.appendChild(txt(x0 - 8, y + 15, s.id + " · " + s.name.toUpperCase(), "dg-name", "end"));
      svg.appendChild(el("rect", { x: x0, y: y + 2, width: w, height: rowH - pad * 2, rx: 3,
                                   "class": "dg-bar" }));
      svg.appendChild(txt(x0 + w + 8, y + 15, disp()(s.mw) + " MW", "dg-val", "start"));
    });
    container.replaceChildren(svg);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.diagrams = { oneLine: oneLine, coolingLadder: coolingLadder, cxLadder: cxLadder };
})();
