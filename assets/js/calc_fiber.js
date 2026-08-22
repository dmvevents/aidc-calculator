// Fiber plant: link counts, cable lengths, strands, transceivers, latency, loss.
// parity: cli/aidc/core/calc_fiber.py — plant() and media_for() ported 1:1.
// Direct implementation of research/09-network-fiber-routing.md §6.1-§6.7
// (the dossier's "calculator-ready" formulas). The defaults reproduce the
// dossier's worked 4-SU example, so a no-input run is a regression test:
// 2,304 / 2,304 / 1,728 = 6,336 fabric links, 12,672 port-ends,
// 7,488 pluggables, 576 fibers/rack, ~101-127 kW optics (2.1-2.6% of IT).
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  // Media reach thresholds (m) — research/09 §3.2 ladder + §6.2 selector.
  const MEDIA_THRESHOLDS = [["DAC", 3.0], ["LACC", 5.0], ["SMF-DR", 500.0], ["SMF-FR4", 2000.0]];
  const IB_DERATE = 0.9;          // [S] IB-family 90% of rated reach (research/09 §3.3, RA-N5)
  const NS_PER_M = 5.0;           // [S] cable latency (research/09 §6.5)
  const FIBER_KG_PER_M = 0.009;   // [S] jumper (research/09 §6.7)
  const COPPER_KG_PER_M = 0.045;  // [S] (research/09 §6.7)

  const LOSS_BUDGET_DB = { DR: 3.0, FR4: 4.0 };  // [S] IEEE 802.3-2022 Cl.124 / 802.3cu

  const DEFAULTS = {
    // --- fabric shape (§6.1) -------------------------------------------------
    su: q(4, "", "[A]", "scalable units — design choice"),
    racks_per_su: q(8, "", "[S]", "DGX SuperPOD GB200 RA: 8 systems per SU"),
    trays_per_rack: q(18, "", "[S]", "NVL72: 18 compute trays per rack"),
    rails: q(4, "", "[S]", "rail-optimised scale-out: 4 rails (1 NIC/tray/rail)"),
    leaves_per_su_rail: q(8, "", "[S]", "GB200 RA per-SLG leaf count"),
    spines_per_su_rail: q(6, "", "[S]", "GB200 RA per-SLG spine count"),
    links_leaf_spine: q(3, "", "[S]", "3 links per leaf-spine pair (GB200 RA shape)"),
    tiers: q(3, "", "[A]", "2 = leaf/spine only, 3 = adds a core (rail-plane) tier"),
    cores_per_rail: q(9, "", "[D]", "core switches per rail plane at 4 SU (reference fabric design)"),
    links_spine_core: q(2, "", "[S]", "2 links spine->core (reference fabric design)"),
    storage_ports_per_tray: q(4, "", "[S]",
                              "BlueField-3 storage/in-band ports per tray (GB200; GB300 = 2)"),
    // --- lengths (§6.2) ------------------------------------------------------
    dx_m: q(30.0, "m", "[A]",
            "representative Manhattan x span rack->switch; from the layout in a real design"),
    dy_m: q(20.0, "m", "[A]", "representative Manhattan y span"),
    clear_height_m: q(6.0, "m", "[S]", "hall clear height (reference building basis)"),
    rack_height_m: q(2.3, "m", "[S]", "MGX-class rack height 2,300 mm"),
    routing_factor: q(1.1, "", "[A]", "tray-path inefficiency (research/09 §8 A-7)"),
    service_slack_m: q(1.0, "m/end", "[A]", "service loop per end (research/09 §8 A-7)"),
    // --- strands + trunks (§6.3) --------------------------------------------
    fibers_per_parallel_port: q(8, "F", "[S]",
                                "DR4/DR8 parallel: 8 active fibers in MPO-12 (middle 4 dark)"),
    fibers_per_duplex_port: q(2, "F", "[S]", "FR4/DR1 duplex"),
    trunk_size_f: q(144, "F", "[S]", "MPO-144 base trunk"),
    // --- optics (§6.4) -------------------------------------------------------
    w_per_end: q(9.0, "W", "[A]",
                 "400G-class DR pluggable, band 8-10 W (research/09 §8 A-1; HDR <=6 W [S], 1.6T ~30 W [S])"),
    spares_per_endpoints: q(200, "", "[S]", "1 spare per 200 endpoints per length class"),
    // --- latency (§6.5) ------------------------------------------------------
    hops: q(5, "", "[A]", "switch hops on the worst in-hall path"),
    t_switch_ns: q(100.0, "ns", "[S]", "IB-class switch latency (research/09 §6.5)"),
    path_fiber_m: q(190.0, "m", "[A]", "end-to-end fiber on the worst path (research/09 §6.5 example)"),
    // --- loss (§6.6) ---------------------------------------------------------
    mated_pairs: q(4, "", "[A]", "structured-channel mated MPO pairs (2 panels x 2)"),
    il_conn_db: q(0.75, "dB", "[S]", "standard mated pair, TIA-568.3-D (low-loss 0.35 dB [A])"),
    attn_db_per_km: q(0.4, "dB/km", "[S]", "SMF attenuation at 1310 nm"),
    loss_budget_media: q("DR", "", "[S]", "DR (3.0 dB) | FR4 (4.0 dB)"),
    // --- pathway (§6.7) ------------------------------------------------------
    cable_od_mm: q(3.0, "mm", "[A]", "jumper outer diameter — verify per vendor trunk"),
    tray_fill_max: q(0.5, "frac", "[S]", "max fill ratio F (research/09 §5.2, DG-11301)"),
    cables_per_tray: q(576, "", "[A]", "cables assigned to the sized tray segment"),
    // --- IT load for the optics-share cross-check ---------------------------
    it_mw: q(4.8, "MW-IT", "[A]", "compute IT load for the optics-power share note"),
  };

  function media_for(length_m, ib_family) {
    if (ib_family === undefined) ib_family = true;
    for (const [name, rated] of MEDIA_THRESHOLDS) {
      const usable = rated * (ib_family && name.startsWith("SMF") ? IB_DERATE : 1.0);
      if (length_m <= usable) return name;
    }
    return "OUT-OF-REACH";
  }

  function plant(kw) {
    kw = kw || {};
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];

    const su = Math.trunc(p.su), rps = Math.trunc(p.racks_per_su);
    const trays = Math.trunc(p.trays_per_rack), rails = Math.trunc(p.rails);
    const leaves = Math.trunc(p.leaves_per_su_rail), spines = Math.trunc(p.spines_per_su_rail);
    const lls = Math.trunc(p.links_leaf_spine), tiers = Math.trunc(p.tiers);
    const cores_per_rail = Math.trunc(p.cores_per_rail), lsc = Math.trunc(p.links_spine_core);

    const racks = su * rps;
    // §6.1 link counts
    const n_nic_leaf = su * rps * trays * rails;
    const n_leaf_spine = su * rails * leaves * spines * lls;
    const n_spine_core = tiers >= 3 ? su * rails * spines * cores_per_rail * lsc : 0;
    const n_fabric = n_nic_leaf + n_leaf_spine + n_spine_core;
    const n_storage = su * rps * trays * Math.trunc(p.storage_ports_per_tray);

    // switch counts + per-switch ports used (§6.4)
    const leaf_n = su * rails * leaves;
    const spine_n = su * rails * spines;
    const core_n = tiers >= 3 ? rails * cores_per_rail : 0;
    const leaf_ports = trays + spines * lls;
    const spine_ports = leaves * lls + (tiers >= 3 ? cores_per_rail * lsc : 0);
    const core_ports = su * spines * lsc;

    const twin_modules = leaf_n * Math.ceil(leaf_ports / 2)
                       + spine_n * Math.ceil(spine_ports / 2)
                       + (core_n ? core_n * Math.ceil(core_ports / 2) : 0);
    const nic_modules = n_nic_leaf;
    const pluggables = twin_modules + nic_modules;
    const port_ends = 2 * n_fabric;
    const optics_kw = port_ends * Number(p.w_per_end) / 1000.0;
    const optics_share = p.it_mw ? 100.0 * optics_kw / (Number(p.it_mw) * 1000.0) : null;

    // §6.2 representative length
    const h_drop = Number(p.clear_height_m) - Number(p.rack_height_m);
    const raw = Math.abs(Number(p.dx_m)) + Math.abs(Number(p.dy_m)) + 2 * h_drop;
    const length = raw * Number(p.routing_factor) + 2 * Number(p.service_slack_m);

    // §6.3 strands + trunks
    const fibers_per_rack = trays * rails * Math.trunc(p.fibers_per_parallel_port);
    const fibers_total_compute = fibers_per_rack * racks;
    const trunks_per_rack = Math.ceil(fibers_per_rack / Math.trunc(p.trunk_size_f));

    // §6.5 latency
    const t_cable_ns = Number(p.path_fiber_m) * NS_PER_M;
    const t_switch_total = Math.trunc(p.hops) * Number(p.t_switch_ns);
    const t_path_us = (t_cable_ns + t_switch_total) / 1000.0;

    // §6.6 loss
    const il = Number(p.attn_db_per_km) * length / 1000.0
             + Math.trunc(p.mated_pairs) * Number(p.il_conn_db);
    const budget = LOSS_BUDGET_DB[String(p.loss_budget_media).toUpperCase()];
    if (budget === undefined) {
      throw new Error("loss_budget_media must be one of " +
                      Object.keys(LOSS_BUDGET_DB).sort().join(", "));
    }

    // §6.7 pathway
    const area_per_cable_mm2 = Math.PI * Math.pow(Number(p.cable_od_mm) / 2.0, 2);
    const tray_area_mm2 = Math.trunc(p.cables_per_tray) * area_per_cable_mm2 / Number(p.tray_fill_max);
    const tray_load_kg_m = Math.trunc(p.cables_per_tray) * FIBER_KG_PER_M;

    const spares = Math.ceil(port_ends / Math.trunc(p.spares_per_endpoints));

    const out = {
      compute_racks: q(racks, "", "[D]", "su x racks_per_su"),
      links_nic_leaf: q(n_nic_leaf, "", "[D]", "su x racks_per_su x trays x rails"),
      links_leaf_spine: q(n_leaf_spine, "", "[D]",
                          "su x rails x leaves x spines x links_leaf_spine"),
      links_spine_core: q(n_spine_core, "", "[D]",
                          "su x rails x spines x cores_per_rail x links_spine_core (tiers=3)"),
      links_fabric_total: q(n_fabric, "", "[D]", "sum of the three tiers"),
      links_storage_inband: q(n_storage, "", "[D]",
                              "su x racks_per_su x trays x storage_ports_per_tray"),
      switches_leaf: q(leaf_n, "", "[D]", "su x rails x leaves_per_su_rail"),
      switches_spine: q(spine_n, "", "[D]", "su x rails x spines_per_su_rail"),
      switches_core: q(core_n, "", "[D]", "rails x cores_per_rail"),
      ports_per_leaf: q(leaf_ports, "", "[D]", "trays down + spines x links_leaf_spine up"),
      ports_per_spine: q(spine_ports, "", "[D]", "leaves x links down + cores x links up"),
      ports_per_core: q(core_ports, "", "[D]", "su x spines x links_spine_core"),
      port_ends: q(port_ends, "", "[D]", "2 x links_fabric_total"),
      switch_twin_modules: q(twin_modules, "", "[D]",
                             "sum over switches of ceil(ports_used / 2) twin-port OSFP"),
      nic_modules: q(nic_modules, "", "[D]", "= links_nic_leaf, flat OSFP"),
      pluggables_total: q(pluggables, "", "[D]", "switch twin modules + NIC modules"),
      spares_per_length_class: q(spares, "", "[D]", "ceil(port_ends / spares_per_endpoints)"),
      optics_power_kw: q(optics_kw, "kW", "[D]", "port_ends x w_per_end"),
      optics_share_of_it_pct: q(optics_share, "%", "[D]",
                                "optics_power_kw / it_mw — lands in fabric-rack power AND heat"),
      rack_to_tray_drop_m: q(h_drop, "m", "[D]", "clear_height_m - rack_height_m, per end"),
      link_length_m: q(length, "m", "[D]",
                       "(dx + dy + 2 x drop) x routing_factor + 2 x service_slack (§6.2)"),
      link_media_class: q(media_for(length), "", "[D]",
                          "DAC <=3 m, LACC <=5 m, then SMF-DR/FR4 at 90% IB derate"),
      fibers_per_rack: q(fibers_per_rack, "F", "[D]",
                         "trays x rails x fibers_per_parallel_port (compute fabric)"),
      fibers_compute_total: q(fibers_total_compute, "F", "[D]", "fibers_per_rack x racks"),
      trunks_per_rack: q(trunks_per_rack, "", "[D]", "ceil(fibers_per_rack / trunk_size_f)"),
      latency_cable_ns: q(t_cable_ns, "ns", "[D]", "5 ns/m x path_fiber_m"),
      latency_switching_ns: q(t_switch_total, "ns", "[D]", "hops x t_switch_ns"),
      latency_one_way_us: q(t_path_us, "us", "[D]",
                            "(cable + switching) — excludes FEC (0-120 ns copper Ethernet [S])"),
      channel_il_db: q(il, "dB", "[D]",
                       "attn_db_per_km x km + mated_pairs x il_conn_db (§6.6)"),
      channel_il_budget_db: q(budget, "dB", "[S]",
                              String(p.loss_budget_media).toUpperCase() + " budget"),
      channel_il_pass: q(il <= budget, "", "[D]", "channel_il_db <= budget"),
      tray_area_required_mm2: q(tray_area_mm2, "mm2", "[D]",
                                "cables x pi(OD/2)^2 / tray_fill_max (§6.7)"),
      tray_load_kg_per_m: q(tray_load_kg_m, "kg/m", "[D]",
                            "cables x 0.009 kg/m fiber jumper [S] (§6.7)"),
    };

    const notes = [
      "Lengths here use ONE representative dx/dy. A real BOM runs §6.2 per link over the " +
      "layout generator's rack positions so cable lengths stay twin-consistent — that " +
      "per-link pass belongs in the topology generator, not in this estimator " +
      "(research/09 §7).",
      "Trunk weight: the 0.009 kg/m figure is a JUMPER spec. MPO-144 trunks are " +
      "0.02-0.04 kg/m [A] — re-run tray_load with the vendor trunk datasheet before " +
      "structural sign-off (research/09 §8 A-2).",
      "Optics power is real IT load AND real heat — budget a network.optics_kw line " +
      "item; it is routinely omitted (research/09 §7).",
    ];
    if (!out.channel_il_pass.value) {
      notes.push(
        "CHANNEL LOSS FAILS the " + String(p.loss_budget_media).toUpperCase() +
        " budget by " + (il - budget).toFixed(2) + " dB. This is the dossier's design rule " +
        "reproducing itself, not an error: " + Math.trunc(p.mated_pairs) +
        " standard-grade mated pairs at " + Number(p.il_conn_db).toFixed(2) + " dB " +
        "consume " + (Math.trunc(p.mated_pairs) * Number(p.il_conn_db)).toFixed(2) +
        " dB of a " + budget.toFixed(1) + " dB budget on their own. Any DR-class structured " +
        "channel with >=3 mated pairs must use low-loss APC components " +
        "(il_conn_db 0.35), or standard grade limits you to <=2 pairs " +
        "(research/09 §4.3).");
    }
    if (out.link_media_class.value === "OUT-OF-REACH") {
      notes.push("link_length_m exceeds the FR4 reach ladder — re-check the route or " +
                 "move the switch tier closer (research/09 §3.2).");
    }

    const inputs = {};
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "fiber — link counts, lengths, strands, optics, latency, loss, pathway",
      "research/09-network-fiber-routing.md §6.1-§6.7 (the dossier's calculator-ready formulas)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcFiber = { DEFAULTS: DEFAULTS, MEDIA_THRESHOLDS: MEDIA_THRESHOLDS,
                                IB_DERATE: IB_DERATE, NS_PER_M: NS_PER_M,
                                FIBER_KG_PER_M: FIBER_KG_PER_M, COPPER_KG_PER_M: COPPER_KG_PER_M,
                                LOSS_BUDGET_DB: LOSS_BUDGET_DB,
                                media_for: media_for, plant: plant };
})();
