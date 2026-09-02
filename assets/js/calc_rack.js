// Rack planner: GPU count -> racks, rows, power, floor area, load, network ports.
// parity: cli/aidc/core/calc_rack.py — plan() ported 1:1. The caller passes the
// per-rack figures as a plain object; the web page fills `rack` from
// rackdata.js, the cli fills it from the same variant YAMLs.
// The busway ampacity rows are research/10 §7 F17 applied to ONE ROW of this
// variant. They call AIDC.calcPower.busway_check — the same function the power
// calculator uses — and reuse its labelled defaults, so the two cannot drift.
// (Load order: calc_power.js must load before this file.)
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;
  const calcPower = globalThis.AIDC.calcPower;

  const G = 9.81;
  const CFM_PER_KW = 157;

  const RACK_KEYS = ["gpus_per_rack", "nameplate_kw", "liquid_kw", "air_kw", "weight_kg",
                     "footprint_m2", "racks_per_su", "rails"];

  const DEFAULTS = {
    gpus: q(512, "", "[A]", "target GPU count — set to your project"),
    support_frac: q(0.077, "frac", "[D]",
                    "storage + mgmt + core-network IT as a share of compute IT " +
                    "(reference-design ratio)"),
    pue: q(1.15, "", "[S]",
           "NVIDIA DSX facility KPI band 1.15-1.20, low end"),
    m2_per_rack: q(25.0, "m2", "[D]",
                   "white space per compute rack incl. CDUs, fabric racks and circulation " +
                   "(reference-design hall ratio) — override per layout"),
    floor_rating_kpa: q(25.0, "kPa", "[S]",
                        "design floor loading (reference-design building basis)"),
    racks_per_path: q(null, "", "[A]",
                      "F17 racks on one busway run; default = rack.racks_per_su (one row per SU), " +
                      "else 8 (research/10 §6.1)"),
    // Same labelled defaults as the power calculator — shared, not re-stated.
    dist_v: calcPower.DEFAULTS.dist_v,
    pf_rack: calcPower.DEFAULTS.pf_rack,
    breaker_factor: calcPower.DEFAULTS.breaker_factor,
    busway_rating_a: calcPower.DEFAULTS.busway_rating_a,
    busway_product_ceiling_a: calcPower.DEFAULTS.busway_product_ceiling_a,
  };

  function plan(rack, kw) {
    kw = kw || {};
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];
    const missing = ["gpus_per_rack", "nameplate_kw"].filter((k) => !rack[k]);
    if (missing.length) {
      throw new Error("rack data missing required keys: " + missing.join(", "));
    }

    const gpus_req = Math.trunc(p.gpus);
    const per_rack = Math.trunc(rack.gpus_per_rack);
    const rack_kw = Number(rack.nameplate_kw);
    const racks = Math.ceil(gpus_req / per_rack);

    const it_compute = racks * rack_kw / 1000.0;
    const it_support = it_compute * Number(p.support_frac);
    const it_total = it_compute + it_support;
    const facility = it_total * Number(p.pue);

    const footprint = Number(rack.footprint_m2 || 0);
    const weight = Number(rack.weight_kg || 0);
    const air_kw = Number(rack.air_kw || 0);
    const liq_kw = Number(rack.liquid_kw || 0);

    const out = {
      racks: q(racks, "", "[D]", "ceil(gpus / gpus_per_rack)"),
      gpus_installed: q(racks * per_rack, "", "[D]", "racks x gpus_per_rack"),
      gpus_stranded: q(racks * per_rack - gpus_req, "", "[D]",
                       "rounding up to whole racks"),
      rows_at_racks_per_su: q(rack.racks_per_su ? Math.ceil(racks / Math.trunc(rack.racks_per_su)) : null,
                              "", "[D]", "one SU per row convention"),
      it_compute_mw: q(it_compute, "MW-IT", "[D]", "racks x nameplate_kw"),
      it_support_mw: q(it_support, "MW-IT", "[D]", "it_compute_mw x support_frac"),
      it_total_mw: q(it_total, "MW-IT", "[D]", "compute + support"),
      facility_mw: q(facility, "MW", "[D]", "it_total_mw x pue"),
      racks_per_mw: q(1000.0 / rack_kw, "", "[D]", "1000 / nameplate_kw"),
      gpus_per_mw: q(per_rack * 1000.0 / rack_kw, "", "[D]", "gpus_per_rack x racks_per_mw"),
      kw_per_gpu: q(rack_kw / per_rack, "kW/GPU", "[D]", "nameplate_kw / gpus_per_rack"),
      liquid_load_kw: q(racks * liq_kw, "kW", "[D]", "racks x liquid_kw"),
      air_load_kw: q(racks * air_kw, "kW", "[D]", "racks x air_kw"),
      air_flow_cfm: q(racks * air_kw * CFM_PER_KW, "CFM", "[D]",
                      "air_load_kw x 157 CFM/kW [S]"),
      rack_weight_total_t: q(racks * weight / 1000.0, "t", "[D]", "racks x weight_kg"),
      rack_footprint_m2: q(racks * footprint, "m2", "[D]",
                           "racks x (width x depth) — geometric floor, no aisles"),
      white_space_m2: q(racks * Number(p.m2_per_rack), "m2", "[D]",
                        "racks x m2_per_rack (incl. CDUs, fabric racks, circulation)"),
      floor_pressure_kpa: q(footprint ? weight * G / footprint / 1000.0 : null,
                            "kPa", "[D]", "weight_kg x 9.81 / footprint_m2"),
      compute_fabric_ports: q(rack.rails ? racks * per_rack : null, "", "[D]",
                              "one scale-out port per GPU on a rail-optimised fabric"),
    };
    const fp = out.floor_pressure_kpa.value;
    const rating = Number(p.floor_rating_kpa);
    out.floor_pressure_pass = q(fp === null ? null : fp <= rating, "", "[D]",
                                "floor_pressure_kpa <= floor_rating_kpa");

    // --- F17 busway ampacity for one row of THIS variant --------------------
    const per_path = Math.trunc(p.racks_per_path || rack.racks_per_su || 8);
    const bw_rating = Number(p.busway_rating_a);
    const bw_ceiling = Number(p.busway_product_ceiling_a);
    const bw = calcPower.busway_check(rack_kw, per_path, Number(p.dist_v), Number(p.pf_rack),
                                      Number(p.breaker_factor), bw_rating, bw_ceiling);
    out.racks_per_path_used = q(per_path, "", "[D]",
                                "racks on one busway run: racks_per_path, else rack.racks_per_su, else 8");
    out.rack_current_a = q(bw.rack_current_a, "A", "[D]",
                           "F17: nameplate_kw x 1000 / (sqrt3 x dist_v x pf_rack)");
    out.busway_continuous_a = q(bw.busway_continuous_a, "A", "[D]",
                                "F17: rack_current_a x racks_per_path_used");
    out.busway_min_rating_a = q(bw.busway_min_rating_a, "A", "[D]",
                                "F17: busway_continuous_a / breaker_factor (NEC 215.3 feeder continuous)");
    out.busway_rating_ok = q(bw.busway_rating_ok, "", "[D]",
                             "F17 PASS/FAIL: busway_rating_a >= busway_min_rating_a");
    out.busway_within_product_band = q(bw.busway_within_product_band, "", "[D]",
                                       "F17: busway_min_rating_a <= busway_product_ceiling_a — is a " +
                                       "single track-busway product enough for this row?");
    out.racks_per_busway = q(bw.racks_per_busway, "", "[D]",
                             "F17: floor(breaker_factor x busway_rating_a / rack_current_a) — the row " +
                             "length the specified busway actually supports");

    const notes = [
      "racks_per_mw / gpus_per_mw / kW-per-GPU are scale-independent — they are the " +
      "columns to compare variants on (COMPARISON.md).",
      "white_space_m2 uses a per-rack allowance derived from the reference hall. It " +
      "is a PLANNING figure; the real number comes from the layout generator's row pitch, " +
      "aisle widths and ancillary rooms.",
    ];
    if (fp !== null && fp > rating) {
      notes.push("FLOOR PRESSURE EXCEEDS RATING (" + fp.toFixed(1) + " > " + rating.toFixed(1) +
                 " kPa): the rack needs load spreading or a stronger slab — this is the " +
                 "structural flag NVL72-class racks raise (COMPARISON.md, RA-S1).");
    }
    if (liq_kw <= 0) {
      notes.push("Air-cooled variant: cooling, not floor space, sets the density limit — " +
                 "expect a materially higher PUE band than a DLC design.");
    }
    if (!bw.busway_rating_ok) {
      notes.push(
        "F17 BUSWAY UNDER-RATED for a " + per_path + "-rack row on one path: " +
        bw.busway_continuous_a.toFixed(0) + " A continuous needs >=" +
        bw.busway_min_rating_a.toFixed(0) + " A but busway_rating_a is " + bw_rating.toFixed(0) +
        " A. Split the row across the A/B shelf feeds, " +
        "step up a size, or cut the row to " + bw.racks_per_busway + " racks (research/10 §6.1).");
    }
    if (!bw.busway_within_product_band) {
      notes.push(
        "F17 ABOVE THE PRODUCT BAND: >=" + bw.busway_min_rating_a.toFixed(0) +
        " A exceeds the " + bw_ceiling.toFixed(0) + " A ceiling for data-centre " +
        "track busway (Starline T5 [S]) — this variant needs multiple parallel runs, an " +
        "RPP, or a higher distribution voltage, whatever rating you specify " +
        "(research/10 §6.1).");
    }

    const inputs = {};
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }
    for (const k of RACK_KEYS) {
      if (rack[k] !== null && rack[k] !== undefined) {
        inputs["rack." + k] = q(rack[k], "", "[S]",
                                "rack variant data (per-value labels in the variant YAML)");
      }
    }

    return result(
      "rack — GPU count to racks, power, floor, cooling and busway rollout",
      "rack-scale variant YAMLs as the data backbone · COMPARISON.md conventions · " +
      "research/10-cooling-power.md §7 F17 (§6.1 busway ampacity) via " +
      "calc_power.busway_check",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcRack = { DEFAULTS: DEFAULTS, RACK_KEYS: RACK_KEYS,
                               CFM_PER_KW: CFM_PER_KW, plan: plan };
})();
