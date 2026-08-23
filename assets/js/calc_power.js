// Generic power + electrical sizing. PURE: object in -> result object out.
// parity: cli/aidc/core/calc_power.py — sizing() + breaker_frame() ported 1:1
// (same names, inputs, outputs, notes; F10 + F12-F18 of research/10 §7).
// Private-path source strings were rephrased for the public site; values,
// labels and formulas are identical to the cli core.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const REDUNDANCY = ["N", "N+1", "2N"];

  // NEC 240.6(A) standard ampere ratings, up to the range whips ever need.
  const BREAKER_FRAMES_A = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110,
                            125, 150, 175, 200, 225, 250, 300, 350, 400];
  const SQRT3 = Math.sqrt(3.0);

  const DEFAULTS = {
    it_mw: q(1.0, "MW-IT", "[A]",
             "generic 1 MW-IT reference block — set to your project"),
    pue: q(1.15, "", "[S]",
           "NVIDIA DSX facility KPI band 1.15-1.20, low end"),
    pue_peak: q(null, "", "[A]",
                "F12 PUE at the billing-peak hour; default = pue. Hot climates run PUE_p > PUE_e"),
    pf: q(0.98, "", "[A]",
          "billed power factor; AFE rectifier target >=0.99"),
    growth_margin: q(0.25, "frac", "[A]",
                     "utility-service headroom for growth + diversity"),
    redundancy: q("2N", "", "[A]",
                  "distribution redundancy N | N+1 | 2N; 2N = Tier III concurrent maintainability"),
    n_units: q(2, "", "[A]", "units per path when redundancy=N+1"),
    ups_eff: q(0.975, "frac", "[A]", "UPS + battery efficiency"),
    dist_loss: q(0.015, "frac", "[A]",
                 "transformer + feeder loss fraction"),
    mech_on_ups_frac: q(0.039, "frac", "[D]",
                        "CDU pumps + CRAH fans + controls on UPS / IT (reference-design ratio)"),
    mech_peak_ratio: q(2.5, "x", "[D]",
                       "F14 MECH_PEAK / MECH_AVG for pumped cooling, band 2-3x (NVIDIA B300 deck CDU 24->70 kVA, research/10 §5.3)"),
    ups_module_mw: q(1.1, "MW", "[A]", "UPS module rating"),
    ride_through_min: q(5.0, "min", "[A]", "battery autonomy to generator start"),
    batt_dod: q(0.9, "frac", "[A]", "F14 usable depth of discharge, Li-ion bridging duty"),
    batt_eff: q(0.95, "frac", "[A]", "F14 battery + converter discharge efficiency"),
    genset_unit_mva: q(2.5, "MVA", "[A]", "diesel unit rating"),
    gen_step_frac: q(0.5, "frac", "[A]",
                     "F15 acceptable block-load fraction per unit (research/10 §5.4). " +
                     "1.0 if every load is staged/walk-in"),
    largest_block_mw: q(null, "MW", "[A]",
                        "F15 largest SINGLE load step the gens must accept (UPS walk-in block, mech group). " +
                        "Absent, the block-load check falls back to the whole essential load — conservative"),
    fuel_hours: q(48.0, "h", "[A]", "on-site fuel autonomy"),
    fuel_l_per_kwh: q(0.27, "L/kWh", "[S]",
                      "MW-class diesel SFC, generatorsource.com chart (2,000 kW: 141.9 gal/h " +
                      "full load = 0.269 L/kWh; research/10 §5.4). The earlier reference 0.22 [A] " +
                      "is the optimistic-engine case: set 0.22 to reproduce it"),
    rack_kw: q(null, "kW", "[A]",
               "optional nameplate kW/rack — unlocks rack count, F17 busway and F18 whips"),
    rack_edpp_kw: q(null, "kW", "[A]",
                    "optional transient rack ceiling (EDPP2 240 kW on the 136 kW NVL72 rack [S]) for F16"),
    gpus: q(null, "", "[A]", "optional GPU count for the F16 site ramp rate"),
    ramp_w_per_sec_per_gpu: q(20.0, "W/s", "[S]",
                              "F16 per-GPU ramp rate (NVIDIA AIF gb300_rack template)"),
    mpf: q(false, "", "[A]",
           "F16 Minimum Power Floor on (GB200+ power smoothing) — caps grid-facing swings, costs energy"),
    mpf_floor_frac: q(0.9, "frac", "[S]",
                      "F16 MPF floor as a fraction of rack nameplate (122.4/136 kW idlePowerSmoothing90Pct, AIF template)"),
    mpf_energy_adder: q(0.105, "frac", "[S]",
                        "F16 energy cost of a 90% floor on a real training waveform, ~10.5% (arXiv:2508.14318 §IV-B)"),
    p_e_usd_kwh: q(0.0871, "US$/kWh", "[S]",
                   "F12 energy rate: US industrial average 8.71 c/kWh (EIA) " +
                   "— REPLACE with the site's tariff"),
    p_d_usd_kva_month: q(null, "US$/kVA/mo", "[A]",
                         "F12 demand rate — NO generic benchmark exists; use your utility's schedule"),
    lf_it: q(0.85, "frac", "[A]",
             "F12 IT load factor (average / peak); training runs high, bursty inference low"),
    optics_share_of_it: q(0.024, "frac", "[D]",
                          "pluggable-optics load, 4-SU worked example 2.1-2.6% of IT (research/09 §6.4)"),
    dist_v: q(480.0, "V", "[S]",
              "F17 rack distribution voltage line-line (480 V/60 Hz CDU nameplate; 415 V also native)"),
    pf_rack: q(0.99, "", "[S]",
               "F17 rack power factor: 0.99 DC-busbar, 0.95 AC-fed (NVIDIA B200/B300 decks)"),
    racks_per_path: q(8, "", "[A]",
                      "F17 racks on one busway run/path — one NVL72-class row (research/10 §6.1)"),
    busway_rating_a: q(1250.0, "A", "[S]",
                       "F17 busway rating to check — default = the 1,250 A top of the data-centre " +
                       "track-busway product band (Starline T5). Enter a higher rating (e.g. 1600) " +
                       "as a what-if for higher-power busway families (v3.1 P-M4)"),
    busway_product_ceiling_a: q(1250.0, "A", "[S]",
                                "F17 top of the data-centre track-busway product band (Starline T5, " +
                                "research/10 §6.1) — above this you are buying multiple runs, an RPP, " +
                                "or a higher distribution voltage, not a bigger busway"),
    breaker_factor: q(0.8, "frac", "[S]",
                      "usable fraction of a breaker/busway rating for continuous load (NEC 210.20(A))"),
    shelves_per_rack: q(8, "", "[S]",
                        "F18 power shelves per rack, NVL72-class 8 x 33 kW deliverable"),
    shelf_kw: q(33.0, "kW", "[S]", "F18 deliverable kW per shelf (6 x 5.5 kW PSU, N redundant)"),
    shelf_v: q(415.0, "V", "[S]", "F18 shelf feed voltage; B300 deck states 400 V minimum"),
  };

  function breaker_frame(amps, factor, frames) {
    factor = factor === undefined ? 0.8 : factor;
    frames = frames || BREAKER_FRAMES_A;
    for (const f of frames) {
      if (amps <= f * factor) return f * 1.0;
    }
    return null;
  }

  // F17 (research/10 §7 F17, detail §6.1): busway ampacity for one row on one
  // path. Plain numbers in, plain numbers out, so the check lives in exactly
  // ONE place: the power calculator calls it for the site, the rack planner
  // calls it for a row of a variant. parity: calc_power.busway_check.
  function busway_check(rack_kw, racks_per_path, dist_v, pf_rack,
                        breaker_factor, busway_rating_a, product_ceiling_a) {
    dist_v = dist_v === undefined ? 480.0 : dist_v;
    pf_rack = pf_rack === undefined ? 0.99 : pf_rack;
    breaker_factor = breaker_factor === undefined ? 0.8 : breaker_factor;
    busway_rating_a = busway_rating_a === undefined ? 1250.0 : busway_rating_a;  // matches DEFAULTS (v3.1 A-17)
    product_ceiling_a = product_ceiling_a === undefined ? 1250.0 : product_ceiling_a;
    const i_rack = rack_kw * 1000.0 / (SQRT3 * dist_v * pf_rack);
    const i_cont = i_rack * Math.trunc(racks_per_path);
    const i_min_rating = i_cont / breaker_factor;
    return {
      rack_current_a: i_rack,
      busway_continuous_a: i_cont,
      busway_min_rating_a: i_min_rating,
      busway_rating_ok: busway_rating_a >= i_min_rating,
      busway_within_product_band: i_min_rating <= product_ceiling_a,
      racks_per_busway: Math.floor(breaker_factor * busway_rating_a / i_rack),
    };
  }

  function sizing(kw) {
    kw = kw || {};
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];
    if (!REDUNDANCY.includes(p.redundancy)) {
      throw new Error("redundancy must be one of " + REDUNDANCY.join(", "));
    }

    const it = Number(p.it_mw);
    const pue = Number(p.pue);
    const pf = Number(p.pf);
    const facility = it * pue;
    const peak_mva = facility / pf;
    const service_mva = peak_mva * (1 + Number(p.growth_margin));

    // --- F13 MVA chain + N-1 on the essential bus --------------------------
    let paths, mult, tx_units;
    if (p.redundancy === "2N") { paths = 2; mult = 2.0; tx_units = 2; }
    else if (p.redundancy === "N+1") {
      const n = Math.trunc(p.n_units);
      paths = 1; mult = (n + 1) / n; tx_units = n + 1;
    } else { paths = 1; mult = 1.0; tx_units = 1; }
    const installed_tx = peak_mva * mult;
    const tx_unit_mva = installed_tx / tx_units;
    const n_minus_1_mva = (tx_units - 1) * tx_unit_mva;
    const n_minus_1_ok = n_minus_1_mva >= peak_mva;

    // --- F14 UPS + battery + mechanical peak -------------------------------
    // Per-path figures carry each path's NORMAL-OPERATION share (site / paths):
    // dual-cord loads split A/B, both paths ride an outage together. The
    // stricter full-load-per-path basis is stated in the notes (v3.1 P-H1).
    const mech_frac = Number(p.mech_on_ups_frac);
    const ups_backed = it * (1 + mech_frac);
    const mech_avg = it * mech_frac;
    const mech_peak = mech_avg * Number(p.mech_peak_ratio);
    const ups_backed_peak = it + mech_peak;
    const ups_backed_per_path = ups_backed / paths;
    const ups_backed_peak_per_path = ups_backed_peak / paths;
    const mod_n = Math.ceil(ups_backed_peak_per_path / Number(p.ups_module_mw));
    const mod_installed = mod_n + (p.redundancy !== "N" ? 1 : 0);
    const battery_kwh = ups_backed_per_path * 1000.0 * Number(p.ride_through_min) / 60.0;
    const battery_installed_kwh = battery_kwh / (Number(p.batt_dod) * Number(p.batt_eff));

    // --- F15 gensets + fuel -------------------------------------------------
    const gen_required_mva = facility / pf;
    const unit_mva = Number(p.genset_unit_mva);
    const step_frac = Number(p.gen_step_frac);
    const block_mva = p.largest_block_mw ? Number(p.largest_block_mw) / pf : gen_required_mva;
    const gen_cap_n = Math.ceil(gen_required_mva / unit_mva);
    const gen_step_n = Math.ceil(block_mva / (unit_mva * step_frac));
    const gen_n = gen_cap_n;
    const gen_installed = gen_n + (p.redundancy !== "N" ? 1 : 0);
    const fuel_m3 = facility * 1000.0 * Number(p.fuel_hours) * Number(p.fuel_l_per_kwh) / 1000.0;

    // --- F10 PUE decomposition (consistency check on the entered PUE) -------
    const l_elec = (1.0 / Number(p.ups_eff) - 1.0) * (ups_backed / it) + Number(p.dist_loss);
    const l_rest = (pue - 1.0) - l_elec;

    // --- F12 effective $/IT-kWh --------------------------------------------
    const pue_p = p.pue_peak !== null && p.pue_peak !== undefined ? Number(p.pue_peak) : pue;
    const lf = Number(p.lf_it);
    const it_mwh_yr = it * 8760.0 * lf;
    const fac_mwh_yr = it_mwh_yr * pue;
    const c_vol = pue * Number(p.p_e_usd_kwh);
    const c_dem = p.p_d_usd_kva_month !== null && p.p_d_usd_kva_month !== undefined
      ? Number(p.p_d_usd_kva_month) * pue_p / (730.0 * lf * pf) : null;
    const c_eff = c_vol + (c_dem || 0.0);
    const energy_cost_yr = c_eff * it_mwh_yr * 1000.0;

    // --- research/09 optics adder ------------------------------------------
    const optics_kw = it * 1000.0 * Number(p.optics_share_of_it);

    const out = {
      facility_mw: q(facility, "MW", "[D]", "it_mw x pue"),
      overhead_mw: q(facility - it, "MW", "[D]", "facility_mw - it_mw"),
      peak_demand_mva: q(peak_mva, "MVA", "[D]", "F13: facility_mw / pf (diversity 1.0)"),
      utility_service_mva: q(service_mva, "MVA", "[D]",
                             "F13: peak_demand_mva x (1 + growth_margin)"),
      distribution_paths: q(paths, "", "[D]", "2N = two independent A/B paths"),
      transformer_installed_mva: q(installed_tx, "MVA", "[D]",
                                   "F13: peak_demand_mva x redundancy multiplier " + mult.toFixed(2)),
      transformer_units: q(tx_units, "", "[D]", "F13: units across the chosen topology"),
      transformer_per_path_mva: q(installed_tx / paths, "MVA", "[D]",
                                  "transformer_installed_mva / distribution_paths"),
      transformer_unit_mva: q(tx_unit_mva, "MVA", "[D]",
                              "F13: transformer_installed_mva / transformer_units"),
      n_minus_1_capacity_mva: q(n_minus_1_mva, "MVA", "[D]",
                                "F13: (transformer_units - 1) x transformer_unit_mva"),
      n_minus_1_ok: q(n_minus_1_ok, "", "[D]",
                      "F13: essential bus still carries peak_demand_mva with one unit out"),
      ups_backed_site_mw: q(ups_backed, "MW", "[D]",
                            "F14: it_mw x (1 + mech_on_ups_frac) — site aggregate across paths"),
      ups_backed_per_path_mw: q(ups_backed_per_path, "MW", "[D]",
                                "F14: ups_backed_site_mw / distribution_paths — one path's " +
                                "normal-operation share"),
      mech_on_ups_avg_mw: q(mech_avg, "MW", "[D]", "F14: it_mw x mech_on_ups_frac"),
      mech_on_ups_peak_mw: q(mech_peak, "MW", "[D]",
                             "F14: mech_on_ups_avg_mw x mech_peak_ratio — size the path on THIS"),
      ups_backed_peak_mw: q(ups_backed_peak, "MW", "[D]",
                            "F14: it_mw + mech_on_ups_peak_mw (site)"),
      ups_modules_n: q(mod_n, "", "[D]",
                       "F14: ceil(ups_backed_peak_mw / distribution_paths / ups_module_mw) " +
                       "— sized on the PEAK share, per path (v3.1 P-H2)"),
      ups_modules_installed_per_path: q(mod_installed, "", "[D]", "N+1 within each path"),
      ups_battery_kwh_per_path: q(battery_kwh, "kWh", "[D]",
                                  "F14 delivered energy per path: ups_backed_per_path_mw x " +
                                  "ride_through_min"),
      ups_battery_installed_kwh: q(battery_installed_kwh, "kWh", "[D]",
                                   "F14 installed capacity per path: delivered / (batt_dod x batt_eff) " +
                                   "— what you actually buy"),
      genset_units_capacity_n: q(gen_cap_n, "", "[D]",
                                 "F15: ceil(facility MVA / genset_unit_mva) — the sizing constraint"),
      genset_units_step_n: q(gen_step_n, "", "[D]",
                             "F15 block-load CHECK: ceil(step MVA / (genset_unit_mva x gen_step_frac)), " +
                             "step = largest_block_mw if given, else the whole essential load"),
      genset_units_n: q(gen_n, "", "[D]",
                        "F15: capacity count. The block-load row is a check on the largest STEP, " +
                        "not a second sizing basis — see notes"),
      genset_units_installed: q(gen_installed, "", "[D]", "F15: + N_redundant (N+1)"),
      genset_fuel_m3: q(fuel_m3, "m3", "[D]",
                        "F15: facility_mw x fuel_hours x fuel_l_per_kwh"),
      pue_l_elec: q(l_elec, "", "[D]",
                    "F10: (1/ups_eff - 1) x ups_share + dist_loss (research/10 §4.1)"),
      pue_l_cool_plus_misc_implied: q(l_rest, "", "[D]",
                                      "F10: (pue - 1) - pue_l_elec — must be coverable by the cooling design"),
      it_energy_mwh_yr: q(it_mwh_yr, "MWh/yr", "[D]", "F12: it_mw x 8760 x lf_it"),
      facility_energy_mwh_yr: q(fac_mwh_yr, "MWh/yr", "[D]", "F12: it_energy_mwh_yr x pue"),
      c_eff_volumetric_usd_kwh: q(c_vol, "US$/IT-kWh", "[D]", "F12: pue x p_e_usd_kwh"),
      c_eff_demand_usd_kwh: q(c_dem, "US$/IT-kWh", "[D]",
                              "F12: p_d x pue_peak / (730 x lf_it x pf) — needs a demand rate"),
      c_eff_usd_per_it_kwh: q(c_eff, "US$/IT-kWh", "[D]",
                              "F12: volumetric + demand (+ riders, allocated the same way)"),
      energy_cost_usd_yr: q(energy_cost_yr, "US$/yr", "[D]",
                            "F12: c_eff_usd_per_it_kwh x it_energy_mwh_yr x 1000"),
      optics_load_kw: q(optics_kw, "kW", "[D]",
                        "research/09 §6.4: it_mw x optics_share_of_it — lands in fabric-rack power AND heat"),
    };

    const notes = [
      "Continuous ratings take diversity 1.0: training clusters synchronise, so no " +
      "diversity credit (reference power method §3).",
      "Transient rack ceilings (EDPP2, e.g. 240 kW on a 136 kW NVL72 rack [S]) are a " +
      "PROTECTION-coordination input, not a continuous sizing input — size feeders on " +
      "nameplate, coordinate breakers for the excursion (F16).",
      "pue_l_cool_plus_misc_implied is the cooling+house overhead the entered PUE leaves " +
      "room for. Cross-check it against the cooling calculator's pue_l_cool_design_hour for " +
      "the same site; if cooling needs more, the PUE input is optimistic.",
      "optics_load_kw is routinely missing from power budgets — research/09 §7 " +
      "flags adding a network.optics_kw line. If your it_mw came from a rack-TDP roll-up it is " +
      "understated by about this much.",
      "F15 fuel uses SFC " + Number(p.fuel_l_per_kwh).toFixed(2) + " L/kWh (default 0.27 " +
      "[S, generatorsource.com MW-class chart via research/10 §5.4]). The earlier reference " +
      "0.22 L/kWh [A] is the optimistic-engine case — at 0.22 the same autonomy needs ~" +
      (fuel_m3 * 0.22 / Number(p.fuel_l_per_kwh)).toFixed(1) + " m3 (" +
      (100.0 * 0.22 / Number(p.fuel_l_per_kwh)).toFixed(0) + "% of the current basis); a tank " +
      "sized at 0.22 runs short against the vendor chart (v3.1 P-M2).",
    ];
    if (paths === 2) {
      notes.push(
        "F14 2N basis: per-path UPS/battery figures carry the NORMAL-OPERATION share " +
        "(dual-cord loads split A/B; both paths ride an outage together). The stricter " +
        "basis sizes each path for the FULL load so one path rides an outage alone " +
        "during the other path's maintenance window — double the per-path figures for " +
        "that convention (v3.1 P-H1).");
    }
    if (l_rest <= 0) {
      notes.push("WARNING: the entered PUE cannot even cover electrical losses " +
                 "(pue_l_cool_plus_misc_implied <= 0) — PUE input is not physical.");
    }
    if (c_dem === null) {
      notes.push(
        "F12 demand term not computed: enter a demand rate. It is the term that " +
        "punishes low load factor (it scales 1/LF_IT) and it is where ratchets, kVA-vs-kW " +
        "billing and rate-class steps bite (research/10 §4.3).");
    }
    if (gen_step_n > gen_cap_n && !p.largest_block_mw) {
      notes.push(
        "F15 INTERPRETATION GAP, deliberately not resolved here: read literally against the " +
        "whole essential load, block-load acceptance at gen_step_frac " + step_frac.toFixed(2) +
        " wants " + gen_step_n + " units where capacity wants " + gen_cap_n +
        ". The reference design applies the same 50%-step rule and " +
        "still lands on " + gen_cap_n + "+1, because the facility arrives in STEPS " +
        "(UPS walk-in, staged mech), not as one block. genset_units_n therefore stays on the " +
        "capacity basis — enter largest_block_mw with the real biggest step to turn the check " +
        "into a real answer.");
    } else if (gen_step_n > gen_cap_n) {
      notes.push(
        "F15: the largest single step (" + Number(p.largest_block_mw).toFixed(2) +
        " MW) needs " + gen_step_n + " units to accept at gen_step_frac " +
        step_frac.toFixed(2) + ", more than the " + gen_cap_n +
        " the capacity basis wants — the yard is BLOCK-LOAD limited. " +
        "Either add units, or break the step up with walk-in/staging (research/10 §5.4).");
    }

    // --- F16 ramp, EDPP protection, MPF ------------------------------------
    if (p.gpus) {
      const ramp = Number(p.gpus) * Number(p.ramp_w_per_sec_per_gpu) / 1000.0;
      out.site_ramp_kw_per_s = q(ramp, "kW/s", "[D]",
                                 "F16: gpus x ramp_w_per_sec_per_gpu — disclose in the interconnect study");
      out.site_ramp_pct_of_it_per_s = q(100.0 * ramp / (it * 1000.0), "%/s", "[D]",
                                        "F16: site_ramp_kw_per_s / it_mw");
      notes.push(
        "F16: MW-scale ramps concentrate at 0.2-3 Hz, inside the band that couples to " +
        "turbine-torsional modes — ramp MW/s and dynamic power range are utility " +
        "disclosure items, not internal details (arXiv:2508.14318 via research/10 §5.5).");
    }
    if (p.rack_kw && p.rack_edpp_kw) {
      const ratio = Number(p.rack_edpp_kw) / Number(p.rack_kw);
      out.edpp_ratio = q(ratio, "x", "[D]", "F16: rack_edpp_kw / rack_kw");
      out.protection_short_time_multiple = q(ratio, "x", "[D]",
                                             "F16: short-time delay must ride the EDPP excursion; " +
                                             "long-time pickup at 1.25x continuous (research/10 §5.5)");
    }
    if (p.mpf) {
      const adder = Number(p.mpf_energy_adder);
      const mult = 1.0 + adder;
      out.mpf_energy_multiplier = q(mult, "x", "[D]",
                                    "F16: 1 + mpf_energy_adder — what the toggle multiplies energy by");
      out.mpf_energy_adder_mwh_yr = q(it_mwh_yr * adder, "MWh/yr", "[D]",
                                      "F16: it_energy_mwh_yr x mpf_energy_adder");
      out.it_energy_mpf_mwh_yr = q(it_mwh_yr * mult, "MWh/yr", "[D]",
                                   "F16: it_energy_mwh_yr x mpf_energy_multiplier");
      out.facility_energy_mpf_mwh_yr = q(fac_mwh_yr * mult, "MWh/yr", "[D]",
                                         "F16: facility_energy_mwh_yr x mpf_energy_multiplier");
      out.mpf_energy_cost_usd_yr = q(it_mwh_yr * adder * 1000.0 * c_vol, "US$/yr", "[D]",
                                     "F16: MPF adder priced at the volumetric rate only");
      out.energy_cost_mpf_usd_yr = q(energy_cost_yr + it_mwh_yr * adder * 1000.0 * c_vol,
                                     "US$/yr", "[D]",
                                     "F16: energy_cost_usd_yr + mpf_energy_cost_usd_yr. The demand " +
                                     "term is carried UNCHANGED — no peak-shaving credit taken");
      if (p.rack_kw) {
        out.mpf_rack_floor_kw = q(Number(p.rack_kw) * Number(p.mpf_floor_frac),
                                  "kW", "[D]", "F16: rack_kw x mpf_floor_frac");
      }
      notes.push(
        "F16 MPF ON: the floor buys grid compliance by burning energy in the troughs " +
        "(+" + (100.0 * adder).toFixed(1) + "% IT energy, applied to the *_mpf_* rows only — the " +
        "base rows stay the no-smoothing case). It also RAISES LF_IT and caps the " +
        "billing peak, so re-run F12 with the higher lf_it before judging the trade — a " +
        "demand-heavy tariff can pay for the energy (research/10 §4.3/§5.5).");
      notes.push(
        "F16 MPF is priced here as a pure energy adder and NO demand credit: capping the " +
        "peak should also cut the F12 demand term, but by how much depends on the tariff's " +
        "measurement window, so it is left for the site's schedule rather than assumed.");
      notes.push(
        "F16 MPF TREND — do not capitalise this cost for 10 years: the floor is a " +
        "GB200-generation workaround. GB300 adds in-rack energy-storage shelves and Vera " +
        "Rubin ~6x onboard storage, absorbing the same swing in HARDWARE instead of " +
        "burning energy, so a refresh should retire the adder (research/10 §5.5).");
    }

    // --- F17 busway / F18 whips (need a rack) ------------------------------
    if (p.rack_kw) {
      const rk = Number(p.rack_kw);
      const v = Number(p.dist_v), pfr = Number(p.pf_rack);
      const bf = Number(p.breaker_factor);
      const rating = Number(p.busway_rating_a);
      const ceiling = Number(p.busway_product_ceiling_a);
      const bw = busway_check(rk, Math.trunc(p.racks_per_path), v, pfr, bf, rating, ceiling);
      const i_rack = bw.rack_current_a, i_cont = bw.busway_continuous_a;
      const i_min_rating = bw.busway_min_rating_a;
      out.racks_at_rack_kw = q(Math.ceil(it * 1000.0 / rk), "", "[D]",
                               "ceil(it_mw x 1000 / rack_kw)");
      out.racks_per_mw = q(1000.0 / rk, "", "[D]", "1000 / rack_kw");
      out.rack_current_a = q(i_rack, "A", "[D]",
                             "F17: rack_kw x 1000 / (sqrt3 x dist_v x pf_rack)");
      out.busway_continuous_a = q(i_cont, "A", "[D]",
                                  "F17: rack_current_a x racks_per_path (full row on one path)");
      out.busway_min_rating_a = q(i_min_rating, "A", "[D]",
                                  "F17: busway_continuous_a / breaker_factor");
      out.busway_rating_ok = q(bw.busway_rating_ok, "", "[D]",
                               "F17: busway_rating_a >= busway_min_rating_a");
      out.busway_within_product_band = q(bw.busway_within_product_band, "", "[D]",
                                         "F17: busway_min_rating_a <= busway_product_ceiling_a " +
                                         "— is a single track-busway product enough?");
      out.racks_per_busway = q(bw.racks_per_busway, "", "[D]",
                               "F17: floor(breaker_factor x busway_rating_a / rack_current_a)");
      const shelf_kw = Number(p.shelf_kw);
      const shelves = Math.trunc(p.shelves_per_rack);
      const i_shelf = shelf_kw * 1000.0 / (SQRT3 * Number(p.shelf_v) * pfr);
      out.shelf_current_a = q(i_shelf, "A", "[D]",
                              "F18: shelf_kw x 1000 / (sqrt3 x shelf_v x pf_rack)");
      out.whip_breaker_a = q(breaker_frame(i_shelf, bf), "A", "[D]",
                             "F18: smallest NEC 240.6(A) frame whose 80% carries shelf_current_a");
      out.whips_per_rack = q(shelves, "", "[D]", "F18: one whip per shelf");
      out.whips_per_path = q(paths === 2 ? Math.floor(shelves / 2) : shelves, "", "[D]",
                             "F18: shelves split across A/B when there are two paths");
      out.rack_deliverable_kw = q(shelf_kw * shelves, "kW", "[D]",
                                  "F18: shelf_kw x shelves_per_rack — vs rack_kw nameplate, " +
                                  "the headroom that makes the rack its own transfer element");
      if (rating < i_min_rating) {
        notes.push(
          "F17 BUSWAY UNDER-RATED for a full row on one path: " + i_cont.toFixed(0) +
          " A continuous needs >=" + i_min_rating.toFixed(0) + " A but the rating is " +
          rating.toFixed(0) + " A. Either accept per-path diversity on the " +
          "shelf split (each path carries half the row), step up a size, or cut " +
          "racks_per_path to " + Math.floor(bf * rating / i_rack) + " (research/10 §6.1).");
      }
      if (Math.max(rating, i_min_rating) > ceiling) {
        notes.push(
          "F17 ABOVE THE PRODUCT BAND: this row needs >=" + i_min_rating.toFixed(0) +
          " A and you specified " + rating.toFixed(0) + " A, " +
          "against a " + ceiling.toFixed(0) + " A ceiling for data-centre track busway " +
          "(Starline T5 [S]). No single product covers it — price multiple parallel runs, " +
          "panelboard/RPP distribution, or a higher distribution voltage (research/10 §6.1).");
      }
    }

    const inputs = {};
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }
    for (const k of Object.keys(inputs)) {
      if (inputs[k].value === null || inputs[k].value === undefined) delete inputs[k];
    }

    return result(
      "power — facility electrical sizing, tariff, ramp, busway, whips",
      "research/10-cooling-power.md §7 F10 + F12-F18 (detail: §4.1 PUE, §4.3 PUE->$/kWh, " +
      "§5.1 MV->rack chain, §5.3 UPS share, §5.4 gensets, §5.5 transients/MPF, §6.1 busway, " +
      "§6.2 whips) · research/09 §6.4 (optics)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcPower = { DEFAULTS: DEFAULTS, REDUNDANCY: REDUNDANCY,
                                BREAKER_FRAMES_A: BREAKER_FRAMES_A,
                                breaker_frame: breaker_frame,
                                busway_check: busway_check, sizing: sizing };
})();
