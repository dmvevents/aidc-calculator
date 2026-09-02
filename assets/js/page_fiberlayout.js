// Page config: fiber-layout.html — the fiber plant visualized. Registers the
// SAME fiber section as fiber.html (identical id + field keys, so URL-hash
// state round-trips between the two pages; only the primary/advanced split
// differs) and renders the LOGICAL topology + PHYSICAL pathway views from
// fiberviews.js. Counts recompute live from the parity-tested calc_fiber
// engine. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  A.SECTIONS = A.SECTIONS || [];

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
      { key: "racks_per_su", label: "racks per SU", src: "gb200-ra", step: 1, min: 1 },
      { key: "trays_per_rack", label: "compute trays / rack", src: "gb200-ra", step: 1, min: 1 },
      { key: "w_per_end", label: "optic W per end", src: "cpo-blog", step: 0.5, min: 0 },
      { key: "it_mw", label: "compute IT (share note)", src: "legend", step: 0.1, min: 0.1, advanced: true },
      { key: "mated_pairs", label: "mated MPO pairs", src: "tia568", step: 1, min: 0, advanced: true },
      { key: "il_conn_db", label: "IL per mated pair", src: "tia568", step: 0.05, min: 0, advanced: true },
      { key: "leaves_per_su_rail", label: "leaves / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "spines_per_su_rail", label: "spines / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "links_leaf_spine", label: "links / leaf-spine pair", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "cores_per_rail", label: "cores / rail", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "links_spine_core", label: "links spine→core", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "storage_ports_per_tray", label: "storage ports / tray", src: "gb200-ra", step: 1, min: 0, advanced: true },
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
      const d = (v) => A.res.disp(v);
      const i = r.inputs, o = r.outputs;
      return [
        "§6.1 · NIC→leaf = SU×racks×trays×rails = " + i.su.value + "×" + i.racks_per_su.value + "×" +
          i.trays_per_rack.value + "×" + i.rails.value + " = " + d(o.links_nic_leaf.value) +
          " · leaf→spine " + d(o.links_leaf_spine.value) + " · spine→core " + d(o.links_spine_core.value) +
          " → " + d(o.links_fabric_total.value) + " links",
        "§6.4 · optics = 2×links × W/end = " + d(o.port_ends.value) + " × " + d(i.w_per_end.value) + " W = " +
          d(o.optics_power_kw.value) + " kW = " + d(o.optics_share_of_it_pct.value) + "% of IT",
        "§6.3 · fibers/rack = trays×rails×" + i.fibers_per_parallel_port.value + " = " +
          d(o.fibers_per_rack.value) + " F → " + d(o.trunks_per_rack.value) + " × MPO-" +
          i.trunk_size_f.value + " trunks per rack",
      ];
    },
    after: (r) => {
      const lg = document.getElementById("fl-logical");
      if (lg) A.fiberviews.fiberLogical(lg, r);
      const ph = document.getElementById("fl-physical");
      if (ph) A.fiberviews.fiberPhysical(ph, r);
      const inset = document.getElementById("fl-inset");
      if (inset) A.fiberviews.nvl72Inset(inset, r);
      // ToR-vs-EoR card (backlog 77ce1aaa): research/09 §4.1 with the
      // transceiver delta computed LIVE from this run's link counts.
      const tor = document.getElementById("fl-tor");
      if (tor) {
        const d = (v) => A.res.disp(v);
        const nl = r.outputs.links_nic_leaf.value;
        const wrap = document.createElement("div");
        wrap.className = "preset-note";
        wrap.innerHTML =
          "<strong>Why there is no top-of-rack switch in an NVL72 row:</strong> the " +
          "compute rack is fully consumed — 18 compute trays + 9 NVLink-switch trays + " +
          "8 power shelves leave no U-space for a leaf tier, and rail purity would need " +
          "4 leaves per rack anyway. The AI-factory pattern relocates Tier-1 to " +
          "<strong>end-of-row fabric racks</strong>, which makes every NIC→leaf run " +
          "optical instead of DAC-able copper. At your inputs that is " +
          "<span class='mono'>" + d(nl) + "</span> NIC→leaf links priced as pluggables " +
          "(the NIC-END optics a DAC-able ToR would avoid; the leaf-end twin-port " +
          "modules for those links add roughly half again) — the price of " +
          "rail-pure wiring, radix utilization and serviceability. Copper reaches only " +
          "~3 m at 100G+ PAM4 lane rates, so ToR would not scale past adjacent racks " +
          "regardless. Basis: research dossier 09 §4.1 [D] over the public RA pattern; " +
          "counts from this page's engine run.";
        tor.replaceChildren(wrap);
      }
      A.designs.liveLink("fl-open-fiber", "fiber.html");
    },
  });

  A.designs.wireDownload("fl-dl-logical", "fl-logical", "fiber-logical-topology.svg");
  A.designs.wireDownload("fl-dl-physical", "fl-physical", "fiber-physical-routing.svg");
  A.boot();
})();
