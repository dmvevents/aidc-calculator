// Topology designer views: a per-rail leaf/spine(/core) fabric diagram, the
// §6.8 oversubscription dials, a read-the-diagram legend, and the deal-free
// JSON/CSV exporters. All counts come from the SAME parity-tested calc_fiber
// engine the fiber pages run — nothing here is hand-typed. Vanilla JS + inline
// SVG via AIDC.designs helpers (DESIGN.md §6 style contract).
//
// Colour encodes RAIL identity ONLY (fixed --rail-1..4 order, never re-hued);
// TIER is column position + label, never colour-alone. Rails render as ordered
// stacked planes so only adjacent rails touch (dataviz adjacent pairlist), with
// mandatory direct "RAIL N" labels. See tokens.css for the validated palette.
"use strict";
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const D = () => globalThis.AIDC.designs;
  const disp = () => globalThis.AIDC.res.disp;

  // Cap on switch GLYPHS drawn per rail per tier (pathological scenarios stay
  // renderable); the true per-tier total is ALWAYS emitted as the count label
  // + data-count, so the diagram never lies about scale. At RA defaults the
  // per-rail counts (32/24/9) are far under the cap, so nothing clamps and the
  // rendered [data-tier=X] element count === the engine switch count exactly.
  const CAP = 96;
  const RAIL_TOKENS = 4;            // fixed categorical slots --rail-1..4
  const railFill = (rail) => rail <= RAIL_TOKENS ? "fill:var(--rail-" + rail + ")"
                                                 : "fill:var(--grid)";  // >4: identity via label

  const asInt = (q) => Math.trunc(Number(q.value));

  // ---- shared structural enumerator (diagram + exporters read this) ----------
  // Pure function of the engine INPUTS: the RA-generic node set + the switch-to-
  // switch fabric adjacency (leaf<->spine, spine<->core). Link multiplicities
  // reproduce the engine tier totals (links_leaf_spine / links_spine_core).
  function enumerate(inputs) {
    const su = asInt(inputs.su), rails = asInt(inputs.rails);
    const leaves = asInt(inputs.leaves_per_su_rail), spines = asInt(inputs.spines_per_su_rail);
    const tiers = asInt(inputs.tiers);
    const cores = asInt(inputs.cores_per_rail);
    const lls = asInt(inputs.links_leaf_spine), lsc = asInt(inputs.links_spine_core);
    const hasCore = tiers >= 3 && cores > 0;

    const pad2 = (n) => (n < 10 ? "0" + n : String(n));
    const nodes = [];                       // {name, role, rail, su, pod}
    const byName = new Map();
    const add = (name, role, rail, suIdx, pod) => {
      const n = { name, role, rail, su: suIdx, pod, port: 0 };
      nodes.push(n); byName.set(name, n); return n;
    };
    // leaf + spine live in a (su, rail) pod; core planes are per-rail (span SUs)
    for (let s = 1; s <= su; s++) {
      for (let r = 1; r <= rails; r++) {
        for (let n = 1; n <= leaves; n++) add("su" + s + "-r" + r + "-leaf" + pad2(n), "leaf", r, s, s);
        for (let n = 1; n <= spines; n++) add("su" + s + "-r" + r + "-spine" + n, "spine", r, s, s);
      }
    }
    if (hasCore) {
      for (let r = 1; r <= rails; r++) {
        for (let n = 1; n <= cores; n++) add("core-r" + r + "-" + n, "core", r, null, null);
      }
    }
    // links: consume the next swpN on each endpoint (parallel links = distinct ports)
    const links = [];
    const link = (a, b) => {
      a.port++; b.port++;
      links.push([{ node: a.name, interface: "swp" + a.port },
                  { node: b.name, interface: "swp" + b.port }]);
    };
    for (let s = 1; s <= su; s++) {
      for (let r = 1; r <= rails; r++) {
        const L = nodes.filter((x) => x.role === "leaf" && x.su === s && x.rail === r);
        const S = nodes.filter((x) => x.role === "spine" && x.su === s && x.rail === r);
        for (const lf of L) for (const sp of S) for (let k = 0; k < lls; k++) link(lf, sp);
      }
    }
    if (hasCore) {
      for (let r = 1; r <= rails; r++) {
        const C = nodes.filter((x) => x.role === "core" && x.rail === r);
        const S = nodes.filter((x) => x.role === "spine" && x.rail === r);
        for (const sp of S) for (const co of C) for (let k = 0; k < lsc; k++) link(sp, co);
      }
    }
    return { su, rails, leaves, spines, cores, tiers, hasCore, nodes, links, byName };
  }

  // ---- per-rail leaf/spine(/core) fabric diagram -----------------------------
  // One <rect data-tier data-rail> per switch (colour = rail), grouped into
  // ordered per-rail planes. A per-tier COUNT label carries data-tier-count +
  // data-count = the TRUE engine total (disp-formatted). E/W (fabric) vs N/S
  // (access/egress) role framing on the column gaps and side lanes.
  function topologyDiagram(container, r) {
    const d = D(), o = r.outputs, i = r.inputs, f = disp();
    const su = asInt(i.su), rails = asInt(i.rails), tiers = asInt(i.tiers);
    const leaves = asInt(i.leaves_per_su_rail), spines = asInt(i.spines_per_su_rail);
    const cores = asInt(i.cores_per_rail);
    const hasCore = tiers >= 3 && o.switches_core.value > 0;

    // tier column model: role, engine total, per-rail count
    const tierDefs = [
      { role: "leaf", label: "LEAF SWITCHES", total: o.switches_leaf.value, perRail: su * leaves },
      { role: "spine", label: "SPINE SWITCHES", total: o.switches_spine.value, perRail: su * spines },
    ];
    if (hasCore) tierDefs.push({ role: "core", label: "CORE (RAIL PLANES)",
                                 total: o.switches_core.value, perRail: cores });
    const nCols = tierDefs.length;

    const W = 980, marginL = 24, marginR = 24;
    const railGutterW = 64, accessLaneW = 78, egressLaneW = 84;
    const gridW = 150, cellW = 13, cellH = 9, cellGap = 3;
    const cols = Math.floor(gridW / (cellW + cellGap));   // 9
    const middle = W - marginL - marginR - railGutterW - accessLaneW - egressLaneW;
    const gap = nCols > 1 ? (middle - nCols * gridW) / (nCols - 1) : 0;
    const tierLeft = (k) => marginL + railGutterW + accessLaneW + k * (gridW + gap);
    const tierCX = (k) => tierLeft(k) + gridW / 2;
    const accessCX = marginL + railGutterW + accessLaneW / 2;
    const egressCX = W - marginR - egressLaneW / 2;
    const clamped = tierDefs.some((t) => t.perRail > CAP);

    const svg = d.el("svg", { viewBox: "0 0 " + W + " 400", "class": "dg", role: "img",
      "aria-label": "Leaf-spine fabric by rail: " + rails + " rails × " + su + " scalable units; " +
        f(o.switches_leaf.value) + " leaf, " + f(o.switches_spine.value) + " spine" +
        (hasCore ? ", " + f(o.switches_core.value) + " core" : "") + " switches. Colour is rail " +
        "identity; tier is column. East/West is the leaf-spine-core GPU fabric; North/South is " +
        "NIC-to-leaf access and storage/in-band/uplink egress." });
    svg.appendChild(d.txt(marginL, 24, "LEAF-SPINE FABRIC BY RAIL — §6.1 COUNTS, LIVE", "dg-name", "start"));
    svg.appendChild(d.txt(W - marginR, 24, su + " SU × " + rails + " RAILS", "dg-name", "end"));

    // role-framing gap headers (drawn once, above the planes)
    svg.appendChild(d.txt(accessCX, 46, "N/S ACCESS", "dg-name"));
    svg.appendChild(d.txt(egressCX, 46, "N/S EGRESS", "dg-name"));
    for (let k = 0; k < nCols - 1; k++) {
      svg.appendChild(d.txt((tierLeft(k) + gridW + tierLeft(k + 1)) / 2, 46, "◄ E/W FABRIC ►", "dg-name"));
    }
    // per-tier COUNT labels (LOAD-BEARING: data-count = true engine total)
    for (let k = 0; k < nCols; k++) {
      const t = tierDefs[k];
      svg.appendChild(d.txt(tierCX(k), 66, t.label, "dg-name"));
      const ct = d.el("text", { x: tierCX(k), y: 88, "class": "fl-count", "text-anchor": "middle",
                                "data-tier-count": t.role, "data-count": String(t.total) });
      ct.textContent = f(t.total);
      svg.appendChild(ct);
    }

    // per-rail planes (ordered 1..rails top→bottom; only neighbours touch)
    let y = 104;
    for (let rail = 1; rail <= rails; rail++) {
      const maxRows = tierDefs.reduce((m, t) =>
        Math.max(m, Math.ceil(Math.min(t.perRail, CAP) / cols)), 1);
      const planeH = 22 + maxRows * (cellH + cellGap) + 10;
      const midY = y + planeH / 2;
      // rail identity: swatch + "RAIL r" (direct label — the mandatory secondary encoding)
      svg.appendChild(d.el("rect", { x: marginL, y: y + 6, width: 12, height: 12, rx: 2,
                                     style: railFill(rail), "class": "tp-swatch" }));
      svg.appendChild(d.txt(marginL, y + 30, "RAIL " + rail, "dg-name", "start"));
      // N/S access stub → into leaf column
      svg.appendChild(d.el("line", { x1: accessCX, y1: midY, x2: tierLeft(0), y2: midY, "class": "fl-bundle-thin" }));
      svg.appendChild(d.arrow(tierLeft(0) - 4, midY, 0, "dg-arr-mut"));
      // E/W fabric connectors between tier columns
      for (let k = 0; k < nCols - 1; k++) {
        svg.appendChild(d.el("line", { x1: tierLeft(k) + gridW, y1: midY, x2: tierLeft(k + 1), y2: midY,
                                       "class": "fl-bundle-thin" }));
        svg.appendChild(d.arrow((tierLeft(k) + gridW + tierLeft(k + 1)) / 2, midY, 0, "dg-arr"));
      }
      // N/S egress stub out of the last tier column
      svg.appendChild(d.el("line", { x1: tierLeft(nCols - 1) + gridW, y1: midY, x2: egressCX, y2: midY,
                                     "class": "fl-bundle-thin" }));
      svg.appendChild(d.arrow(egressCX - 2, midY, 0, "dg-arr-mut"));
      // switch glyphs per tier (data-tier + data-rail; colour = rail)
      for (let k = 0; k < nCols; k++) {
        const t = tierDefs[k];
        const draw = Math.min(t.perRail, CAP);
        const gTop = y + 20;
        for (let n = 0; n < draw; n++) {
          const col = n % cols, row = Math.floor(n / cols);
          svg.appendChild(d.el("rect", {
            x: tierLeft(k) + col * (cellW + cellGap), y: gTop + row * (cellH + cellGap),
            width: cellW, height: cellH, rx: 2, "class": "tp-sw",
            style: railFill(rail), "data-tier": t.role, "data-rail": String(rail) }));
        }
      }
      y += planeH;
    }

    // display-cap note (states the cap on-page; true total always labelled)
    y += 6;
    svg.appendChild(d.txt(marginL, y, clamped
      ? "DISPLAY CAP — showing ≤ " + CAP + " glyphs per rail per tier; the count label + data-count carry the TRUE total"
      : "Colour = rail identity (RAIL 1–" + rails + ", fixed order) · tier = column + label · one glyph = one switch",
      "dg-name", "start"));
    y += 14;
    svg.setAttribute("viewBox", "0 0 " + W + " " + (y + 8));
    container.replaceChildren(svg);
  }

  // ---- §6.8 oversubscription dials -------------------------------------------
  // Each ratio is a single value against a limit → a meter, in gauge form: a
  // recessive track + one-hue (accent) fill, a 1:1 reference tick, a numeric
  // readout. Colour here is NOT categorical (magnitude, not identity). The
  // non-blocking bool is a NEUTRAL readout (a design dial, not a pass/fail —
  // matches the engine note + app.js NEUTRAL_BOOLS).
  function arcPts(cx, cy, R, tStart, tEnd) {
    const steps = 36, out = [];
    for (let s = 0; s <= steps; s++) {
      const t = (tStart + (tEnd - tStart) * s / steps) * Math.PI / 180;
      out.push((cx + R * Math.cos(t)).toFixed(2) + "," + (cy - R * Math.sin(t)).toFixed(2));
    }
    return out.join(" ");
  }
  function gauge(svg, cx, cy, R, frac, refFrac, valStr, label, scale) {
    const d = D();
    const theta = (fr) => 180 - 180 * Math.max(0, Math.min(1, fr));
    svg.appendChild(d.el("polyline", { points: arcPts(cx, cy, R, 180, 0),
      "class": "dg-grid", style: "fill:none;stroke-width:10;stroke-linecap:round" }));
    if (frac !== null) {
      svg.appendChild(d.el("polyline", { points: arcPts(cx, cy, R, 180, theta(frac)),
        style: "fill:none;stroke:var(--accent);stroke-width:10;stroke-linecap:round" }));
      const tv = theta(frac) * Math.PI / 180;
      svg.appendChild(d.el("circle", { cx: cx + R * Math.cos(tv), cy: cy - R * Math.sin(tv), r: 4.5,
        style: "fill:var(--accent);stroke:var(--surface);stroke-width:1.5" }));
    }
    if (refFrac !== null) {
      const tr = theta(refFrac) * Math.PI / 180;
      svg.appendChild(d.el("line", { x1: cx + (R - 8) * Math.cos(tr), y1: cy - (R - 8) * Math.sin(tr),
        x2: cx + (R + 8) * Math.cos(tr), y2: cy - (R + 8) * Math.sin(tr),
        style: "stroke:var(--ink-2);stroke-width:2" }));
    }
    const val = d.el("text", { x: cx, y: cy - 4, "class": "fl-count", "text-anchor": "middle" });
    val.textContent = valStr;
    svg.appendChild(val);
    svg.appendChild(d.txt(cx, cy + 18, label, "dg-name"));
    svg.appendChild(d.txt(cx, cy + 32, scale, "dg-name"));
  }
  function topologyDials(container, r) {
    const d = D(), o = r.outputs, f = disp();
    const W = 980, slot = W / 5;
    const cx = (k) => slot * k + slot / 2, cy = 88, R = 54;
    const svg = d.el("svg", { viewBox: "0 0 " + W + " 200", "class": "dg", role: "img",
      "aria-label": "Oversubscription dials: leaf " + f(o.oversub_leaf.value) + ", spine " +
        f(o.oversub_spine.value) + ", fabric " + f(o.oversub_fabric.value) + " to 1; delivered " +
        "bisection " + f(o.bisection_ratio.value) + " of a non-blocking fabric; 1:1 non-blocking " +
        f(o.fabric_non_blocking.value) + "." });
    svg.appendChild(d.txt(20, 22, "§6.8 OVERSUBSCRIPTION DIALS — 1:1 = NON-BLOCKING, >1 = OVERSUBSCRIBED", "dg-name", "start"));
    const osv = (q) => q.value === null ? null : Math.max(0, Math.min(1, q.value / 2));
    gauge(svg, cx(0), cy, R, osv(o.oversub_leaf), 0.5, f(o.oversub_leaf.value), "OVERSUB LEAF", "0—2 · 1:1 ref");
    gauge(svg, cx(1), cy, R, osv(o.oversub_spine), 0.5, f(o.oversub_spine.value), "OVERSUB SPINE", "0—2 · 1:1 ref");
    gauge(svg, cx(2), cy, R, osv(o.oversub_fabric), 0.5, f(o.oversub_fabric.value), "OVERSUB FABRIC", "0—2 · 1:1 ref");
    gauge(svg, cx(3), cy, R,
      o.bisection_ratio.value === null ? null : Math.max(0, Math.min(1, o.bisection_ratio.value)),
      1.0, f(o.bisection_ratio.value), "BISECTION", "0—1 · 1.0 ideal");
    // non-blocking bool — neutral readout tile (not a verdict badge)
    const bx = cx(4);
    const bv = d.el("text", { x: bx, y: cy - 4, "class": "fl-count", "text-anchor": "middle" });
    bv.textContent = f(o.fabric_non_blocking.value);
    svg.appendChild(d.el("rect", { x: bx - 64, y: cy - 46, width: 128, height: 62, rx: 4, "class": "fl-stack" }));
    svg.appendChild(bv);
    svg.appendChild(d.txt(bx, cy + 18, "1:1 NON-BLOCKING", "dg-name"));
    svg.appendChild(d.txt(bx, cy + 32, "design dial — not pass/fail", "dg-name"));
    svg.setAttribute("viewBox", "0 0 " + W + " 148");
    container.replaceChildren(svg);
  }

  // ---- read-the-diagram legend -----------------------------------------------
  function topologyLegend(container, r) {
    const d = D(), i = r.inputs, rails = asInt(i.rails);
    const W = 980;
    const svg = d.el("svg", { viewBox: "0 0 " + W + " 108", "class": "dg", role: "img",
      "aria-label": "Legend: colour is rail identity (fixed order); tier is column and label; " +
        "East/West is the GPU fabric, North/South is access and egress." });
    // rails row (fixed order 1..4 → the clashing orange↔yellow pair stays non-adjacent)
    svg.appendChild(d.txt(20, 20, "RAILS (COLOUR = IDENTITY, FIXED ORDER)", "dg-name", "start"));
    let x = 20;
    for (let rail = 1; rail <= Math.min(rails, RAIL_TOKENS); rail++) {
      svg.appendChild(d.el("rect", { x: x, y: 30, width: 14, height: 12, rx: 2, style: railFill(rail) }));
      svg.appendChild(d.txt(x + 20, 40, "RAIL " + rail, "dg-name", "start"));
      x += 20 + d.estW("RAIL " + rail, "dg-name") + 22;
    }
    if (rails > RAIL_TOKENS) {
      svg.appendChild(d.el("rect", { x: x, y: 30, width: 14, height: 12, rx: 2, style: railFill(99) }));
      svg.appendChild(d.txt(x + 20, 40, "RAIL 5+ (LABEL)", "dg-name", "start"));
    }
    // role framing: E/W fabric vs N/S access/egress
    svg.appendChild(d.el("line", { x1: 20, y1: 64, x2: 44, y2: 64, "class": "fl-bundle-thin" }));
    svg.appendChild(d.arrow(44, 64, 0, "dg-arr"));
    svg.appendChild(d.txt(56, 68, "EAST/WEST — leaf↔spine, spine↔core (GPU fabric)", "dg-name", "start"));
    svg.appendChild(d.el("line", { x1: 520, y1: 58, x2: 520, y2: 70, "class": "fl-bundle-thin" }));
    svg.appendChild(d.arrow(520, 70, 90, "dg-arr-mut"));
    svg.appendChild(d.txt(532, 68, "NORTH/SOUTH — NIC↔leaf access, storage/in-band & uplink egress", "dg-name", "start"));
    // tier encoding note
    svg.appendChild(d.txt(20, 92, "TIER = column position + label (LEAF | SPINE | CORE), never colour · " +
      "one glyph = one switch · count label shows the true engine total", "dg-name", "start"));
    container.replaceChildren(svg);
  }

  // ---- deal-free exporters (mirror gen_topology shape; structural fields only)
  function topologyJSON(outputs, inputs) {
    const t = enumerate(inputs);
    const nodes = {};
    for (const n of t.nodes) nodes[n.name] = { role: n.role, rail_index: n.rail, pod: n.pod };
    return {
      format: "JSON",
      title: "AIDC-topology-" + t.su + "SU-" + t.rails + "rail",
      ztp: null,
      content: { nodes: nodes, links: t.links },
    };
  }
  function topologyCSV(outputs, inputs) {
    const t = enumerate(inputs);
    const rows = ["# nodes: name,role,rail,su"];
    for (const n of t.nodes) rows.push([n.name, n.role, n.rail, n.su == null ? "" : n.su].join(","));
    rows.push("", "# links: src_node,src_if,dst_node,dst_if");
    for (const l of t.links) rows.push([l[0].node, l[0].interface, l[1].node, l[1].interface].join(","));
    return rows.join("\n") + "\n";
  }
  function exportTitle(inputs) {
    return "AIDC-topology-" + asInt(inputs.su) + "SU-" + asInt(inputs.rails) + "rail";
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.topologyviews = { enumerate: enumerate, CAP: CAP,
    topologyDiagram: topologyDiagram, topologyDials: topologyDials,
    topologyLegend: topologyLegend, topologyJSON: topologyJSON,
    topologyCSV: topologyCSV, exportTitle: exportTitle };
})();
