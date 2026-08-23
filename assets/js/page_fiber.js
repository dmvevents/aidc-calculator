// Page config: fiber calculator — section extracted 1:1 from the v1 single-page bundle
// (sections_more.js); formulas untouched, engine unchanged. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ---------------------------------------------------------------- FIBER ----
  A.SECTIONS.push({
    id: "fiber",
    defaults: A.calcFiber.DEFAULTS,
    compute: (kw) => A.calcFiber.plant(kw),
    hero: "links_fabric_total", heroLabel: "compute-fabric links", heroSrc: "gb200-ra",
    fields: [
      { key: "su", label: "scalable units", src: "legend", step: 1, min: 1 },
      { key: "tiers", label: "fabric tiers", src: "dossiers", type: "select", numeric: true,
        options: [[3, "3 (leaf/spine/core)"], [2, "2 (leaf/spine)"]] },
      { key: "rails", label: "rails", src: "gb200-ra", step: 1, min: 1 },
      { key: "w_per_end", label: "optic W per end (errs high)", src: "cabling-guide", step: 0.5, min: 0 },
      { key: "it_mw", label: "compute IT (share note)", src: "legend", step: 0.1, min: 0.1 },
      { key: "mated_pairs", label: "mated MPO pairs", src: "tia568", step: 1, min: 0 },
      { key: "il_conn_db", label: "IL per mated pair", src: "tia568", step: 0.05, min: 0 },
      { key: "racks_per_su", label: "racks per SU", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "trays_per_rack", label: "compute trays / rack", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "leaves_per_su_rail", label: "leaves / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "spines_per_su_rail", label: "spines / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "links_leaf_spine", label: "links / leaf-spine pair", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "cores_per_rail", label: "cores / rail", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "links_spine_core", label: "links spine→core", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "storage_ports_per_tray", label: "storage ports / tray", src: "gb200-ra", step: 1, min: 0, advanced: true },
      { key: "ib_twin_modules", label: "twin-port switch optics (IB)", src: "gb200-ra", type: "checkbox", advanced: true },
      { key: "dx_m", label: "Manhattan Δx", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "dy_m", label: "Manhattan Δy", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "clear_height_m", label: "hall clear height", src: "refdesign", step: 0.1, min: 2, advanced: true },
      { key: "rack_height_m", label: "rack height", src: "aif-template", step: 0.05, min: 1, advanced: true },
      { key: "routing_factor", label: "routing factor", src: "dossiers", step: 0.05, min: 1, advanced: true },
      { key: "service_slack_m", label: "service slack / end", src: "dossiers", step: 0.5, min: 0, advanced: true },
      { key: "fibers_per_parallel_port", label: "fibers / parallel port", src: "cabling-guide", step: 1, min: 1, advanced: true },
      { key: "trunk_size_f", label: "trunk size (F)", src: "cabling-guide", step: 12, min: 12, advanced: true },
      { key: "spares_per_endpoints", label: "endpoints per spare", src: "cabling-guide", step: 10, min: 10, advanced: true },
      { key: "hops", label: "switch hops (worst path)", src: "cabling-guide", step: 1, min: 1, advanced: true },
      { key: "t_switch_ns", label: "switch latency", src: "cabling-guide", step: 10, min: 0, advanced: true },
      { key: "path_fiber_m", label: "worst-path fiber", src: "cabling-guide", step: 5, min: 0, advanced: true },
      { key: "attn_db_per_km", label: "SMF attenuation", src: "itu-g652", step: 0.05, min: 0, advanced: true },
      { key: "loss_budget_media", label: "loss budget", src: "ieee-8023", type: "select",
        options: [["DR", "DR (3.0 dB / 500 m)"], ["FR4", "FR4 (4.0 dB / 2 km)"]], advanced: true },
      { key: "cable_od_mm", label: "jumper OD", src: "cabling-guide", step: 0.1, min: 1, advanced: true },
      { key: "tray_fill_max", label: "max tray fill", src: "dg11301", step: 0.05, min: 0.1, max: 1, advanced: true },
      { key: "cables_per_tray", label: "cables in sized tray", src: "dossiers", step: 8, min: 1, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      return [
        "§6.1 · NIC→leaf = SU×racks×trays×rails = " + i.su.value + "×" + i.racks_per_su.value + "×" +
          i.trays_per_rack.value + "×" + i.rails.value + " = " + d(o.links_nic_leaf.value) +
          " · leaf→spine " + d(o.links_leaf_spine.value) + " · spine→core " + d(o.links_spine_core.value) +
          " → " + d(o.links_fabric_total.value) + " links",
        "§6.4 · optics = 2×links × W/end = " + d(o.port_ends.value) + " × " + d(i.w_per_end.value) + " W = " +
          d(o.optics_power_kw.value) + " kW = " + d(o.optics_share_of_it_pct.value) + "% of IT",
        "§6.2 · length = (Δx+Δy+2×drop)×rf + 2×slack = (" + d(i.dx_m.value) + "+" + d(i.dy_m.value) + "+2×" +
          d(o.rack_to_tray_drop_m.value) + ")×" + d(i.routing_factor.value) + "+2×" + d(i.service_slack_m.value) +
          " = " + d(o.link_length_m.value) + " m → " + o.link_media_class.value,
        "§6.6 · IL = " + d(i.attn_db_per_km.value) + "×km + pairs×" + d(i.il_conn_db.value) + " = " +
          d(i.attn_db_per_km.value * o.link_length_m.value / 1000) +
          " + " + i.mated_pairs.value + "×" + d(i.il_conn_db.value) + " = " + d(o.channel_il_db.value) +
          " dB vs " + d(o.channel_il_budget_db.value) + " dB " + (o.channel_il_pass.value ? "✓" : "✕"),
        "§6.5 · latency = 5 ns/m × " + d(i.path_fiber_m.value) + " + " + i.hops.value + "×" +
          d(i.t_switch_ns.value) + " ns = " + d(o.latency_one_way_us.value) + " µs one-way",
      ];
    },
    // keep the fiber-layout cross-link carrying the live hash state (v3);
    // rewritten at click time too, so it never lags the hash-encode debounce
    after: () => {
      const a = document.querySelector('a[href^="fiber-layout.html"]');
      if (!a) return;
      if (!a.dataset.wired) {
        a.dataset.wired = "1";
        a.addEventListener("click", () => { a.href = "fiber-layout.html" + location.hash; });
      }
      a.href = "fiber-layout.html" + location.hash;
    },
  });

  A.boot();
})();
