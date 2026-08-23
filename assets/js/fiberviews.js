// Fiber-plant visualizations: LOGICAL spine-leaf topology with live-computed
// link/pluggable counts (calc_fiber engine — the same parity-tested formulas
// as fiber.html) and the PHYSICAL tray/pathway view overlaid on the generated
// hall plan (hallplan.js — same manifest math as the 3D scene), plus the
// NVL72 rear-copper vs front-fiber platform inset. Vanilla JS + inline SVG.
"use strict";
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const D = () => globalThis.AIDC.designs;
  const disp = () => globalThis.AIDC.res.disp;

  // stacked-node: a tier of N identical boxes drawn as a 3-deep stack + counts
  function tierNode(svg, x, y, w, h, name, count, sub) {
    const d = D();
    for (let k = 2; k >= 1; k--) {
      svg.appendChild(d.el("rect", { x: x + k * 5, y: y - k * 5, width: w, height: h, rx: 4,
                                     "class": "fl-stack" }));
    }
    const g = d.el("g", { "class": "dg-node" });
    g.appendChild(d.el("rect", { x: x, y: y, width: w, height: h, rx: 4 }));
    g.appendChild(d.txt(x + w / 2, y + 16, name, "dg-name"));
    g.appendChild(d.txt(x + w / 2, y + h / 2 + 8, count, "fl-count"));
    if (sub) g.appendChild(d.txt(x + w / 2, y + h - 10, sub, "dg-name"));
    svg.appendChild(g);
  }
  // trunk bundle with an UPLINK-direction arrow (links are duplex — the arrow
  // marks the conventional up-tier drawing direction, decoded in the legend);
  // count rides above the line, the short role label beneath it
  function bundle(svg, x1, y1, x2, y2, label, sub) {
    const d = D();
    svg.appendChild(d.el("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": "fl-bundle" }));
    for (const off of [-7, 7]) {
      svg.appendChild(d.el("line", { x1: x1, y1: y1 + off, x2: x2, y2: y2 + off, "class": "fl-bundle-thin" }));
    }
    const mx = (x1 + x2) / 2;
    svg.appendChild(d.arrow(mx + (x2 - x1) * 0.28, (y1 + y2) / 2, 0, "dg-arr"));
    svg.appendChild(d.txt(mx, (y1 + y2) / 2 - 16, label, "dg-val"));
    if (sub) svg.appendChild(d.txt(mx, (y1 + y2) / 2 + 26, sub, "dg-name"));
  }

  // ---- LOGICAL: rail-optimized spine-leaf (-core) fabric ----------------------
  function fiberLogical(container, r) {
    const d = D(), o = r.outputs, i = r.inputs, f = disp();
    const tiers = Math.trunc(Number(i.tiers.value));
    const W = 980, H = 520;
    const svg = d.el("svg", { viewBox: "0 0 " + W + " " + H, "class": "dg", role: "img",
      "aria-label": "Logical fabric topology: " + f(o.compute_racks.value) + " racks feed " +
        f(o.switches_leaf.value) + " leaf and " + f(o.switches_spine.value) + " spine switches" +
        (tiers >= 3 ? " and " + f(o.switches_core.value) + " core switches" : "") + "; " +
        f(o.links_fabric_total.value) + " fabric links, " + f(o.pluggables_total.value) +
        " pluggable transceivers, optics " + f(o.optics_power_kw.value) + " kW." });
    svg.appendChild(d.txt(20, 26, "LOGICAL — RAIL-OPTIMIZED FABRIC (§6.1 COUNTS, LIVE)", "dg-name", "start"));
    svg.appendChild(d.txt(W - 20, 26, i.su.value + " SU × " + i.rails.value + " RAILS", "dg-name", "end"));

    const n = tiers >= 3 ? 4 : 3;
    // 4 tiers narrow the cards so the inter-tier gaps still hold their labels
    const xw = n === 4 ? 164 : 188, y = 120, h = 92;
    const gap = (W - 60 - n * xw) / (n - 1);
    const xs = [];
    for (let k = 0; k < n; k++) xs.push(30 + k * (xw + gap));
    tierNode(svg, xs[0], y, xw, h, "COMPUTE RACKS", f(o.compute_racks.value),
      i.trays_per_rack.value + " trays × " + i.rails.value + " rails/rack");
    tierNode(svg, xs[1], y, xw, h, "LEAF SWITCHES", f(o.switches_leaf.value),
      f(o.ports_per_leaf.value) + " ports used each");
    tierNode(svg, xs[2], y, xw, h, "SPINE SWITCHES", f(o.switches_spine.value),
      f(o.ports_per_spine.value) + " ports used each");
    if (n === 4) {
      tierNode(svg, xs[3], y, xw, h, "CORE (RAIL PLANES)", f(o.switches_core.value),
        f(o.ports_per_core.value) + " ports used each");
    }
    bundle(svg, xs[0] + xw, y + h / 2, xs[1], y + h / 2, f(o.links_nic_leaf.value),
      "NIC→LEAF");
    bundle(svg, xs[1] + xw, y + h / 2, xs[2], y + h / 2, f(o.links_leaf_spine.value),
      i.links_leaf_spine.value + "/PAIR");
    if (n === 4) {
      bundle(svg, xs[2] + xw, y + h / 2, xs[3], y + h / 2, f(o.links_spine_core.value),
        i.links_spine_core.value + "/PAIR");
    }
    svg.appendChild(d.txt(30, y + h + 30,
      "COUNTS = LINKS PER TIER PAIR · 1 HOP STAYS IN-RAIL — NIC→LEAF NEVER LEAVES ITS RAIL PLANE", "dg-name", "start"));

    // totals band
    let ay = y + h + 72;
    ay = d.annot(svg, 20, ay, W - 40, "§6.1/§6.4 · WHAT THE FABRIC COSTS TO LIGHT", [
      "fabric links " + f(o.links_fabric_total.value) + " → port-ends " + f(o.port_ends.value) +
        " → pluggables " + f(o.pluggables_total.value) + " (" + f(o.switch_twin_modules.value) +
        " twin-port switch + " + f(o.nic_modules.value) + " NIC) + spares " + f(o.spares_per_length_class.value),
      "optics power = " + f(o.port_ends.value) + " ends × " + f(i.w_per_end.value) + " W = " +
        f(o.optics_power_kw.value) + " kW = " + f(o.optics_share_of_it_pct.value) +
        "% of IT — a real load AND heat line",
    ]) + 14;
    const il = o.channel_il_pass.value;
    ay = d.annot(svg, 20, ay, W - 40, "§6.2/§6.6 · REPRESENTATIVE CHANNEL" + (il ? " — ✓ BUDGET PASS" : " — ✕ BUDGET FAIL"), [
      "length " + f(o.link_length_m.value) + " m → media " + o.link_media_class.value +
        " · IL = " + f(o.channel_il_db.value) + " dB vs " + f(o.channel_il_budget_db.value) +
        " dB budget · storage/in-band adds " + f(o.links_storage_inband.value) + " links",
    ]);
    const bot = d.legend(svg, W, ay + 14, [
      ["line", "fl-bundle", "TRUNK BUNDLE"], ["line", "fl-bundle-thin", "STRANDS (SAMPLE)"],
      ["arr", "dg-arr", "UPLINK DIRECTION — LINKS ARE DUPLEX"],
      ["rect", "fl-stack", "TIER = N STACKED UNITS"],
    ], "LINKS · F · W · dB");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (bot + 8));
    container.replaceChildren(svg);
  }

  // ---- PHYSICAL: tray/pathway routing on the generated hall plan --------------
  let hallMounted = false;
  function fiberPhysical(stage, r) {
    const HP = globalThis.HALLPLAN, d = D(), o = r.outputs, i = r.inputs, f = disp();
    if (!HP) return;
    if (!hallMounted) {
      stage.innerHTML = HP.svg;
      // the physical fiber story: keep shell+racks+fiber+dims, drop liquid/power
      // (their legend entries hide with them — the generator groups them lg-*)
      for (const lid of ["hp-liquid", "hp-power"]) {
        const g = stage.querySelector("#" + lid);
        if (g) g.style.display = "none";
      }
      for (const lg of stage.querySelectorAll(".lg-liquid, .lg-power")) {
        lg.style.display = "none";
      }
      hallMounted = true;
    }
    const svg = stage.querySelector("svg");
    if (!svg) return;
    const old = svg.querySelector("#fl-overlay");
    if (old) old.remove();
    const g = document.createElementNS(NS, "g");
    g.setAttribute("id", "fl-overlay");
    const G = HP.geom;
    const X = (wx) => (wx - G.minx) * G.px_per_m + G.pad;
    const Y = (wz) => (wz - G.minz) * G.px_per_m + G.pad;
    // trunk runs: each row tray -> cross tray -> support (leaf/spine) row
    const sy = Y(G.support_z + G.rack_d / 2);
    for (const zf of G.rows_z) {
      const ry = Y(zf + G.rack_d / 2);
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", "M " + X(-G.row_len / 2) + " " + ry + " H " + X(G.cross_x) +
                          " V " + sy + " H " + X(0));
      p.setAttribute("class", "fl-run");
      g.appendChild(p);
      g.appendChild(d.arrow(X(G.cross_x - 1.0), ry, 0, "hp-arr-fiber"));
    }
    // routing direction: down the cross tray, then along the support row
    // (the riser→OSP arrow lives in the plan's own hp-fiber layer)
    g.appendChild(d.arrow(X(G.cross_x), Y(G.support_z - 0.55), 90, "hp-arr-fiber"));
    g.appendChild(d.arrow(X(G.cross_x / 2), sy, 180, "hp-arr-fiber"));
    g.appendChild(d.txt(X(G.hall_x / 2 - 0.2), Y(G.support_z + G.rack_d + 0.85) + 3,
      "TRUNKS → LEAF/SPINE ROW", "hp-lbl-dim", "end"));
    // pathway key for this view (the plan's own legend hides liquid/power here)
    const lg = document.createElementNS(NS, "g");
    lg.setAttribute("data-p10b", "legend");
    const L0 = 34;
    let ly = 40;
    lg.appendChild(d.txt(L0, ly, "FIBER PATHWAY KEY", "hp-lbl", "start"));
    ly += 18;
    lg.appendChild(d.el("line", { x1: L0, y1: ly - 4, x2: L0 + 22, y2: ly - 4, "class": "fl-run" }));
    lg.appendChild(d.txt(L0 + 28, ly, "TRUNK ROUTE", "hp-lbl-dim", "start"));
    ly += 16;
    lg.appendChild(d.el("line", { x1: L0, y1: ly - 4, x2: L0 + 22, y2: ly - 4, "class": "hp-tray" }));
    lg.appendChild(d.txt(L0 + 28, ly, "TRAY (FILL ≤ 50%)", "hp-lbl-dim", "start"));
    ly += 16;
    lg.appendChild(d.el("rect", { x: L0 + 4, y: ly - 12, width: 12, height: 12, rx: 1, "class": "hp-riser" }));
    lg.appendChild(d.txt(L0 + 28, ly, "RISER", "hp-lbl-dim", "start"));
    ly += 16;
    lg.appendChild(d.arrow(L0 + 6, ly - 4, 0, "hp-arr-fiber"));
    lg.appendChild(d.txt(L0 + 28, ly, "ROUTING DIRECTION", "hp-lbl-dim", "start"));
    ly += 16;
    lg.appendChild(d.txt(L0, ly, "UNITS · m · F · kg/m", "hp-lbl-dim", "start"));
    g.appendChild(lg);
    g.appendChild(d.txt(X(-G.row_len / 2), Y(G.rows_z[0] - 0.24),
      f(o.trunks_per_rack.value) + " × MPO-" + i.trunk_size_f.value + " TRUNK / RACK (" +
      f(o.fibers_per_rack.value) + " F)", "hp-lbl-dim", "start"));
    g.appendChild(d.txt(X(G.cross_x + 0.42), Y(G.hall_z0 + 1.0) + 12,
      "→ OSP / CAMPUS", "hp-lbl-dim", "start"));
    g.appendChild(d.txt(X(0), Y(G.hall_z1 + 0.25),
      "COMPUTE-FABRIC TOTAL " + f(o.fibers_compute_total.value) + " F · TRAY LOAD " +
      f(o.tray_load_kg_per_m.value) + " kg/m · FILL ≤ " + f(Number(i.tray_fill_max.value) * 100) + "%",
      "hp-lbl"));
    svg.appendChild(g);
  }

  // ---- NVL72 rear-copper vs front-fiber inset ---------------------------------
  function nvl72Inset(container, r) {
    const d = D(), i = r.inputs, f = disp();
    const W = 980, H = 268;
    const trays = Math.trunc(Number(i.trays_per_rack.value)), rails = Math.trunc(Number(i.rails.value));
    const svg = d.el("svg", { viewBox: "0 0 " + W + " " + H, "class": "dg", role: "img",
      "aria-label": "NVL72-class rack cabling zones, side view: the front face carries the " +
        "user-installed scale-out fiber (" + trays + " trays by " + rails + " rails); the rear " +
        "is factory blind-mate copper NVLink cartridges with no user fiber, plus the liquid " +
        "manifold and busbar." });
    svg.appendChild(d.txt(20, 24, "NVL72-CLASS RACK — WHERE THE FIBER ACTUALLY GOES (SIDE VIEW)", "dg-name", "start"));
    // rack body
    const rx = 400, ry = 52, rw = 180, rh = 150;
    svg.appendChild(d.el("rect", { x: rx, y: ry, width: rw, height: rh, rx: 4, "class": "dg-wcell" }));
    for (let k = 0; k < 6; k++) {
      svg.appendChild(d.el("line", { x1: rx + 14, y1: ry + 18 + k * 22, x2: rx + rw - 14,
                                     y2: ry + 18 + k * 22, "class": "dg-grid" }));
    }
    svg.appendChild(d.txt(rx + rw / 2, ry + rh + 16, "COMPUTE + NVSWITCH TRAYS", "dg-name"));
    // front fiber zone
    svg.appendChild(d.el("rect", { x: rx - 190, y: ry, width: 178, height: rh, rx: 4, "class": "fl-zone-fi" }));
    svg.appendChild(d.txt(rx - 101, ry + 22, "FRONT · COLD AISLE", "dg-name"));
    svg.appendChild(d.txt(rx - 101, ry + 52, "scale-out FIBER", "dg-val"));
    svg.appendChild(d.txt(rx - 101, ry + 74, trays + " trays × " + rails + " rails OSFP", "dg-val"));
    svg.appendChild(d.txt(rx - 101, ry + 96, "user plant: inspect, certify,", "dg-name"));
    svg.appendChild(d.txt(rx - 101, ry + 112, "strain-relieve every mate", "dg-name"));
    for (let k = 0; k < 4; k++) {
      svg.appendChild(d.el("line", { x1: rx - 12, y1: ry + 26 + k * 34, x2: rx, y2: ry + 26 + k * 34,
                                     "class": "fl-bundle-thin" }));
    }
    // rear copper zone
    svg.appendChild(d.el("rect", { x: rx + rw + 12, y: ry, width: 178, height: rh, rx: 4, "class": "fl-zone-cu" }));
    svg.appendChild(d.txt(rx + rw + 101, ry + 22, "REAR · HOT AISLE", "dg-name"));
    svg.appendChild(d.txt(rx + rw + 101, ry + 52, "NVLink COPPER cartridges", "dg-val"));
    svg.appendChild(d.txt(rx + rw + 101, ry + 74, "factory blind-mate — the 72-GPU", "dg-name"));
    svg.appendChild(d.txt(rx + rw + 101, ry + 90, "scale-up domain has NO user fiber", "dg-name"));
    svg.appendChild(d.txt(rx + rw + 101, ry + 112, "+ liquid manifold · busbar", "dg-name"));
    svg.appendChild(d.txt(20, 246, "Air-cooled HGX/DGX-class platforms cable their scale-out " +
      "fabric at the rear instead — every fabric link is user fiber there.", "dg-ann", "start"));
    const bot = d.legend(svg, W, 260, [
      ["rect", "fl-zone-fi", "FIBER ZONE — USER PLANT"],
      ["rect", "fl-zone-cu", "COPPER ZONE — FACTORY"],
      ["line", "fl-bundle-thin", "OSFP FIBER STUBS"],
    ], "TRAYS × RAILS");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (bot + 8));
    container.replaceChildren(svg);
  }

  globalThis.AIDC.fiberviews = { fiberLogical: fiberLogical, fiberPhysical: fiberPhysical,
                                 nvl72Inset: nvl72Inset };
})();
