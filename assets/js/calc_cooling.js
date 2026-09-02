// Generic cooling load + heat-rejection feasibility. PURE: object in -> result out.
// parity: cli/aidc/core/calc_cooling.py — loads(), w_class_of(), vendor_flow_lpm()
// ported 1:1 (F1-F9 + F11 of research/10 §7; same names, inputs, outputs, notes).
// Private-path source strings were rephrased for the public site; values,
// labels and formulas are identical to the cli core.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  // rho kg/L, cp kJ/kg.K — research/10-cooling-power.md §1.2 property table
  const COOLANTS = {
    water: [0.996, 4.18, "[S]", "water ~30 C (research/10 §1.2)"],
    pg25: [1.03, 3.9, "[A]", "25% propylene glycol ~45 C, reference property set (research/10 §1.2)"],
  };
  const RHO_CP_WATER = 0.996 * 4.18;  // kJ/L.K — facility/TES side is water, not PG25

  // ASHRAE 2021 (5th ed. Thermal Guidelines) liquid classes: max facility supply C.
  // W40 removed v3.1 (C-M4): no public source names it. NVIDIA CDU Requirements
  // DA-11933-001_v04 names only W17/W27/W32/W45 (non-exhaustive "including"
  // wording — cannot alone prove absence) and prior ASHRAE editions enumerate
  // exactly these four. Restore only from the 5th ed. itself (v3.1 A-08).
  const W_CLASSES = [["W17", 17], ["W27", 27], ["W32", 32], ["W45", 45]];

  const REJECTORS = ["dry", "tower", "adiabatic"];
  const FLOW_BASES = ["formula", "vendor"];
  const CFM_PER_KW = 157;

  // NVL72-class required-flow curve: [inlet C, LPM per rack] at 116 kW liquid/rack.
  // NVIDIA AIF gb300_rack template [S]. The rack is return-temperature-limited,
  // NOT fixed-delta-T — this curve is F2 and it beats F1 when you have it.
  const VENDOR_FLOW_CURVE = [[25.0, 65.1], [30.0, 76.5], [35.0, 92.6], [40.0, 117.5], [45.0, 160.0]];
  const VENDOR_CURVE_LIQUID_KW = 116.0;

  const DEFAULTS = {
    it_kw: q(1000.0, "kW-IT", "[A]", "generic 1 MW-IT block — set to your project"),
    liquid_frac: q(0.87, "frac", "[S]",
                   "NVL72-class heat-capture HEADLINE ratio 87% (aif-pipeline-samples " +
                   "gb300_rack template). The template's own kW split is 116/(116+19.3) = " +
                   "85.7% — 1.3pp lower; the rack matrix carries the reconciled 85.7 and a " +
                   "platform pick seeds it here (v3.1 A-12)"),
    coolant: q("pg25", "", "[A]", "water | pg25 (research/10 §1.2 property table)"),
    dt_k: q(15.0, "K", "[A]",
            "design TCS delta-T for F1; NVL72 racks are return-temp-limited, prefer F2 (research/10 §1.2)"),
    tcs_inlet_c: q(35.0, "C", "[A]", "TCS supply to rack; NVL72 curve spans 25-45 C (research/10 §2.1)"),
    flow_basis: q("formula", "", "[A]",
                  "formula = F1 (fixed delta-T) | vendor = F2 (rack curve at tcs_inlet_c, authoritative)"),
    rack_liquid_kw: q(VENDOR_CURVE_LIQUID_KW, "kW", "[S]",
                      "liquid load per rack, NVL72-class 116 of 136 kW (research/10 §1.5) — sets F3 per-rack flow"),
    dp_a_kpa_lpm2: q(0.0048, "kPa/LPM2", "[S]",
                     "F3 quadratic term of the sourced rack PQ curve dP=0.0048x^2+0.0617x, x=LPM 0-160 (AIF gb300_rack template)"),
    dp_b_kpa_lpm: q(0.0617, "kPa/LPM", "[S]", "F3 linear term of the same sourced rack PQ curve"),
    dp_loop_extra_kpa: q(95.0, "kPa", "[A]",
                         "rest of the F3 head stack: hoses/valves 25 + manifold/riser 30 + CDU HX 40 (reference cooling design §3)"),
    cdu_kw: q(1350.0, "kW", "[S]",
              "Vertiv CoolChip CDU 1350 catalog nominal; the AIF-template metadata carries " +
              "1368 for the same XDU1350-class unit [A] (v3.1 C-M1)"),
    cdu_redundancy: q("N+1", "", "[A]", "N | N+1 CDU units per loop"),
    cdu_approach_rated_k: q(4.0, "K", "[S]",
                            "approach the CDU is RATED at, 4-5 C market standard — F4 derate reference (research/10 §1.3)"),
    cdu_parasitic_frac: q(0.010, "frac", "[D]",
                          "F4 CDU pump power / duty, band 0.5-1.5% (XDU1350 13.7/1350 = 1.0%, CHx2000 0.6%) (research/10 §1.3)"),
    cfm_per_kw: q(157.0, "CFM/kW", "[S]",
                  "157 CFM/kW, DG-11301-001 H100 design guide (stricter of 157 vs B200 deck 150) (research/10 §3.1)"),
    rejector: q("dry", "", "[A]", "dry | tower | adiabatic heat-rejection mode"),
    t_db_c: q(35.0, "C", "[A]", "site design dry-bulb — set per site"),
    t_wb_c: q(28.0, "C", "[A]", "site design wet-bulb — set per site"),
    a_rejector: q(10.0, "K", "[A]", "dry-cooler approach to dry-bulb, economic band 8-15 K (research/10 §2.2)"),
    a_wet: q(5.0, "K", "[A]", "tower approach to wet-bulb, band 4-7 K (research/10 §2.2)"),
    a_cdu: q(4.0, "K", "[S]", "CDU heat-exchanger approach 3-5 C (research/10 §1.3)"),
    eps_adb: q(0.8, "frac", "[A]", "adiabatic pre-cool effectiveness, band 0.6-0.9 (research/10 §2.2)"),
    w_class_target: q(null, "", "[A]",
                      "optional ASHRAE 2021 liquid class the plant must hold (W17|W27|W32|W45); " +
                      "the F5 verdict then also reports whether it makes that class (research/10 §2.1)"),
    t_db_rating_c: q(35.0, "C", "[A]",
                     "ambient the rejector was SELECTED at — F6 reference leg (research/10 §2.3)"),
    rejector_water_in_c: q(null, "C", "[A]",
                           "water-in to the rejector for F6; default = tcs_return_c"),
    coc: q(4.0, "", "[A]", "F7 cycles of concentration, band 3-6 (research/10 §2.4)"),
    wet_hours_yr: q(null, "h/yr", "[A]",
                    "F7 hours in evaporative mode; default by rejector (dry 0, adiabatic 1000, tower 8760)"),
    load_factor: q(0.85, "frac", "[A]", "IT load factor (average / peak) for the F7 annual energy base"),
    loop_volume_l: q(null, "L", "[A]", "TCS loop fluid volume for the F8 ride-through — site-specific"),
    dt_allow_k: q(10.0, "K", "[A]", "allowable loop temperature rise during F8 ride-through (research/10 §1.4)"),
    tes_bridge_min: q(5.0, "min", "[A]", "F8 thermal-storage bridge to plant restart (research/10 §1.4)"),
    eta_ii: q(0.55, "frac", "[A]", "F11 second-law efficiency of the chiller, band 0.5-0.6 (research/10 §4.2)"),
    fws_supply_c: q(20.0, "C", "[A]", "F11 chilled-water supply when mechanical trim runs (reference cooling design)"),
    a_evap: q(5.0, "K", "[A]", "F11 evaporator approach"),
    a_cond: q(5.0, "K", "[A]", "F11 condenser approach"),
    pump_fan_frac: q(0.0187, "frac", "[D]",
                     "CDU pumps + CRAH fans / IT (reference-design power budget ratio = " +
                     "0.0187; the prior 0.021 did not match its own derivation — " +
                     "calc-fix stale-data pass)"),
    // --- F7b cooling-tower fleet (rejector = tower only) --------------------
    tower_cell_kw: q(2000.0, "kW_th", "[A]",
                     "thermal duty per tower CELL at the design wet-bulb — large " +
                     "open/closed cells span ~1-5 MW_th; capacity is wb-dependent, " +
                     "vendor selection at YOUR design wet-bulb governs " +
                     "(assumption-verify)"),
    tower_range_k: q(10.0, "K", "[A]",
                     "condenser/FWS water range across the tower (the reference FWS " +
                     "runs 20/30 C — research/10 §1.3)"),
    tower_spare_cells: q(1, "", "[A]",
                         "redundant cells beyond duty (N+1 convention — a cell down " +
                         "for basin/fill service is routine)"),
    tower_drift_pct: q(0.002, "%", "[S]",
                       "drift as % of recirculation flow with modern eliminators, " +
                       "band 0.001-0.005% (CTI/vendor practice)"),
    tower_fan_frac: q(0.012, "frac", "[A]",
                      "tower fan electrical draw / thermal duty, band 0.008-0.02 — " +
                      "DISPLAY estimate; plant pump/fan power is already budgeted " +
                      "inside pump_fan_frac (do not double-count)"),
  };

  function w_class_of(supply_c) {
    for (const [name, cap] of W_CLASSES) {
      if (supply_c <= cap) return name;
    }
    return "W+";
  }

  function vendor_flow_lpm(inlet_c, curve) {
    curve = curve || VENDOR_FLOW_CURVE;
    if (inlet_c <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      const [t0, f0] = curve[i - 1];
      const [t1, f1] = curve[i];
      if (inlet_c <= t1) return f0 + (f1 - f0) * (inlet_c - t0) / (t1 - t0);
    }
    return curve[curve.length - 1][1];
  }

  function loads(kw) {
    kw = kw || {};
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];
    if (!(p.coolant in COOLANTS)) {
      throw new Error("coolant must be one of " + Object.keys(COOLANTS).sort().join(", "));
    }
    if (!REJECTORS.includes(p.rejector)) {
      throw new Error("rejector must be one of " + REJECTORS.join(", "));
    }
    if (!FLOW_BASES.includes(p.flow_basis)) {
      throw new Error("flow_basis must be one of " + FLOW_BASES.join(", "));
    }
    const W_CAPS = Object.fromEntries(W_CLASSES);
    if (p.w_class_target !== null && p.w_class_target !== undefined && !(p.w_class_target in W_CAPS)) {
      throw new Error("w_class_target must be one of " + W_CLASSES.map((x) => x[0]).join(", "));
    }

    const [rho, cp, cl_label, cl_src] = COOLANTS[p.coolant];
    const it = Number(p.it_kw);
    const dt = Number(p.dt_k);
    const inlet = Number(p.tcs_inlet_c);
    const q_liq = it * Number(p.liquid_frac);
    const q_air = it - q_liq;

    // --- F1 / F2 flow ------------------------------------------------------
    const formula_per_kw = 60.0 / (rho * cp * dt);
    const vendor_lpm_rack = vendor_flow_lpm(inlet);
    const vendor_per_kw = vendor_lpm_rack / VENDOR_CURVE_LIQUID_KW;
    let flow_per_kw, flow_src;
    if (p.flow_basis === "vendor") {
      flow_per_kw = vendor_per_kw; flow_src = "F2: rack curve at tcs_inlet_c / 116 kW liquid per rack";
    } else {
      flow_per_kw = formula_per_kw; flow_src = "F1: 60 / (rho x cp x dt_k)";
    }
    const dt_eff = 60.0 / (rho * cp * flow_per_kw);   // the delta-T that flow implies
    const flow_lpm = q_liq * flow_per_kw;
    const m_dot = q_liq / (cp * dt_eff);
    const return_c = inlet + dt_eff;

    // --- F3 pump head (per rack, on the sourced PQ curve) ------------------
    const rack_flow = Number(p.rack_liquid_kw) * flow_per_kw;
    const rack_dp = Number(p.dp_a_kpa_lpm2) * rack_flow * rack_flow
                  + Number(p.dp_b_kpa_lpm) * rack_flow;
    const loop_head = rack_dp + Number(p.dp_loop_extra_kpa);

    // --- F4 CDU ladder ------------------------------------------------------
    const derate = Math.min(1.0, Number(p.a_cdu) / Number(p.cdu_approach_rated_k));
    const cdu_eff_kw = Number(p.cdu_kw) * derate;
    const cdu_n = q_liq > 0 ? Math.ceil(q_liq / cdu_eff_kw) : 0;
    const cdu_installed = cdu_n + (p.cdu_redundancy === "N+1" && cdu_n ? 1 : 0);
    const cdu_loading = cdu_installed ? 100.0 * q_liq / (cdu_installed * Number(p.cdu_kw)) : null;
    const cdu_parasitic = q_liq * Number(p.cdu_parasitic_frac);

    // --- F9 residual air ----------------------------------------------------
    const cfm = q_air * Number(p.cfm_per_kw);
    const m3s = cfm / 2118.88;
    const air_dt = m3s ? q_air / (1.2 * m3s) : null;  // rho.cp ~ 1.2 kJ/m3.K sea level [A]

    // --- F5 approach stack, all three modes --------------------------------
    const t_db = Number(p.t_db_c), t_wb = Number(p.t_wb_c);
    const a_cdu = Number(p.a_cdu);
    const t_adb = t_db - Number(p.eps_adb) * (t_db - t_wb);
    let t_ref, t_ref_note, approach;
    if (p.rejector === "dry") {
      t_ref = t_db;
      t_ref_note = "F5 dry cooler: reference = design dry-bulb";
      approach = Number(p.a_rejector);
    } else if (p.rejector === "tower") {
      t_ref = t_wb;
      t_ref_note = "F5 tower/wetted: reference = design wet-bulb";
      approach = Number(p.a_wet);
    } else {
      t_ref = t_adb;
      t_ref_note = "F5 adiabatic: t_db - eps_adb x (t_db - t_wb)";
      approach = Number(p.a_rejector);
    }

    const min_tcs = t_ref + approach + a_cdu;
    const feasible = min_tcs <= inlet;
    const min_dry = t_db + Number(p.a_rejector) + a_cdu;
    const min_wet = t_wb + Number(p.a_wet) + a_cdu;
    // The best a CHILLERLESS plant can do here, whichever passive mode wins.
    const min_passive = Math.min(min_dry, min_wet);
    const chillerless = min_passive <= inlet;
    // Wet-bulb-limited = no passive mode reaches the racks AND the floor is set by
    // wet-bulb, not dry-bulb. This is the load-bearing tropical result (§2.2).
    const wb_limited = (!chillerless) && min_wet <= min_dry;
    // The three-way F5 verdict the site gate asks for. "infeasible" means no
    // CHILLERLESS mode closes — mechanical trim still solves it, priced as x_mech.
    let verdict;
    if (min_dry <= inlet) verdict = "dry-only";
    else if (min_wet <= inlet) verdict = "wetted-assist";
    else verdict = "infeasible";

    // --- F6 dry-cooler derate vs ambient (DRY mode only, v3.1 C-M2) --------
    // For tower/adiabatic the site reference is wet-bulb-based while the rating
    // reference is dry-bulb — the ratio is meaningless, so F6 nulls out.
    const water_in = p.rejector_water_in_c !== null && p.rejector_water_in_c !== undefined
      ? Number(p.rejector_water_in_c) : return_c;
    let dry_derate = null;
    if (p.rejector === "dry") {
      const itd_site = water_in - t_ref, itd_ref = water_in - Number(p.t_db_rating_c);
      dry_derate = (itd_ref > 0 && itd_site > 0) ? itd_site / itd_ref : null;
    }
    const rejector_mult = dry_derate ? 1.0 / dry_derate : null;

    // --- F7 water ----------------------------------------------------------
    const coc = Number(p.coc);
    const makeup_l_kwh = coc > 1 ? 1.47 * coc / (coc - 1.0) : null;
    let wet_h = p.wet_hours_yr;
    if (wet_h === null || wet_h === undefined) {
      wet_h = { dry: 0.0, adiabatic: 1000.0, tower: 8760.0 }[p.rejector];
    }
    wet_h = Number(wet_h);
    const lf = Number(p.load_factor);
    const it_mwh_yr = it * 8760.0 * lf / 1000.0;
    const water_m3 = it * lf * wet_h * (makeup_l_kwh || 0.0) / 1000.0;
    const wue = it_mwh_yr ? water_m3 / it_mwh_yr : null;

    // --- F8 ride-through + TES ---------------------------------------------
    let ride_s = null;
    if (p.loop_volume_l && q_liq > 0) {
      ride_s = Number(p.loop_volume_l) * rho * cp * Number(p.dt_allow_k) / q_liq;
    }
    const tes_m3 = q_liq * Number(p.tes_bridge_min) * 60.0
      / (RHO_CP_WATER * Number(p.dt_allow_k)) / 1000.0;

    // --- F11 design-hour COP + mechanical trim -----------------------------
    const t_evap_k = Number(p.fws_supply_c) - Number(p.a_evap) + 273.15;
    const t_cond_k = t_ref + Number(p.a_cond) + 273.15;
    const cop = t_cond_k > t_evap_k ? Number(p.eta_ii) * t_evap_k / (t_cond_k - t_evap_k) : null;
    const x_mech = feasible ? 0.0 : 1.0;
    const l_cool = Number(p.pump_fan_frac)
      + (cop ? x_mech * Number(p.liquid_frac) / cop : 0.0);

    // --- F7b cooling-tower fleet (tower mode only; F6-null pattern) ---------
    // parity: calc_cooling.py F7b — duty = it x (1+l_cool); evap on the same
    // 1.47 L/kWh_th basis as F7; makeup(day) closes to evap + blowdown + drift.
    let tower_duty = null, tower_cells = null, tower_recirc = null;
    let tower_evap_day = null, tower_blow_day = null, tower_drift_day = null;
    let tower_makeup = null, tower_fan = null;
    if (p.rejector === "tower") {
      tower_duty = it * (1.0 + l_cool);
      const cell_kw = Number(p.tower_cell_kw);
      if (cell_kw <= 0) throw new Error("tower_cell_kw must be > 0");
      const range_k = Number(p.tower_range_k);
      if (range_k <= 0) throw new Error("tower_range_k must be > 0");
      tower_cells = Math.ceil(tower_duty / cell_kw) + Math.trunc(p.tower_spare_cells);
      tower_recirc = tower_duty / (RHO_CP_WATER * range_k);           // L/s
      const tower_evap = tower_duty * 1.47 / 3600.0;                  // L/s, all-latent
      const tower_blow = coc > 1 ? tower_evap / (coc - 1.0) : null;
      const tower_drift = tower_recirc * Number(p.tower_drift_pct) / 100.0;
      if (tower_blow !== null) {
        tower_makeup = (tower_evap + tower_blow + tower_drift) * 86.4; // m3/day
      }
      tower_evap_day = tower_evap * 86.4;
      tower_blow_day = tower_blow !== null ? tower_blow * 86.4 : null;
      tower_drift_day = tower_drift * 86.4;
      tower_fan = tower_duty * Number(p.tower_fan_frac);
    }

    const out = {
      liquid_load_kw: q(q_liq, "kW", "[D]", "it_kw x liquid_frac"),
      air_load_kw: q(q_air, "kW", "[D]", "it_kw - liquid_load_kw"),
      flow_basis_used: q(p.flow_basis, "", "[A]", flow_src),
      flow_per_kw_lpm: q(flow_per_kw, "LPM/kW", "[D]", flow_src),
      flow_per_kw_lpm_f1: q(formula_per_kw, "LPM/kW", "[D]",
                            "F1 cross-check: 60 / (rho x cp x dt_k)"),
      vendor_curve_lpm_per_rack: q(vendor_lpm_rack, "LPM", "[S]",
                                   "F2: NVL72-class curve at tcs_inlet_c (AIF gb300_rack template)"),
      vendor_curve_flow_per_kw_lpm: q(vendor_per_kw, "LPM/kW", "[D]",
                                      "F2: vendor_curve_lpm_per_rack / 116 kW liquid per rack"),
      dt_effective_k: q(dt_eff, "K", "[D]",
                        "delta-T the selected flow implies: 60 / (rho x cp x flow_per_kw_lpm)"),
      tcs_flow_lpm: q(flow_lpm, "LPM", "[D]", "liquid_load_kw x flow_per_kw_lpm"),
      tcs_flow_lps: q(flow_lpm / 60.0, "L/s", "[D]", "tcs_flow_lpm / 60"),
      tcs_mass_flow_kg_s: q(m_dot, "kg/s", "[D]", "F1: Q / (cp x dt_effective_k)"),
      tcs_return_c: q(return_c, "C", "[D]", "tcs_inlet_c + dt_effective_k"),
      rack_flow_lpm: q(rack_flow, "LPM", "[D]", "F3 input: rack_liquid_kw x flow_per_kw_lpm"),
      rack_dp_kpa: q(rack_dp, "kPa", "[D]", "F3: dp_a x rack_flow^2 + dp_b x rack_flow"),
      loop_head_kpa: q(loop_head, "kPa", "[D]", "F3: rack_dp_kpa + dp_loop_extra_kpa"),
      cdu_derate: q(derate, "", "[D]",
                    "F4: a_cdu / cdu_approach_rated_k, capped at 1.0 (capacity ~ LMTD available)"),
      cdu_effective_kw: q(cdu_eff_kw, "kW", "[D]", "F4: cdu_kw x cdu_derate"),
      cdu_units_required: q(cdu_n, "", "[D]", "F4: ceil(liquid_load_kw / cdu_effective_kw)"),
      cdu_units_installed: q(cdu_installed, "", "[D]", "F4: +1 when cdu_redundancy=N+1"),
      cdu_loading_pct: q(cdu_loading, "%", "[D]", "liquid_load_kw / installed nominal capacity"),
      cdu_parasitic_kw: q(cdu_parasitic, "kW", "[D]", "F4: liquid_load_kw x cdu_parasitic_frac"),
      air_flow_cfm: q(cfm, "CFM", "[D]", "F9: air_load_kw x cfm_per_kw"),
      air_flow_m3s: q(m3s, "m3/s", "[D]", "CFM / 2118.88"),
      air_dt_implied_k: q(air_dt, "K", "[D]",
                          "F9: air_load_kw / (1.2 x m3/s), rho.cp ~ 1.2 kJ/m3.K [A]"),
      t_reject_ref_c: q(t_ref, "C", "[D]", t_ref_note),
      min_tcs_supply_c: q(min_tcs, "C", "[D]",
                          "F5: t_reject_ref_c + rejector approach + a_cdu (research/10 §2.2)"),
      min_tcs_dry_mode_c: q(min_dry, "C", "[D]", "F5 dry: t_db_c + a_rejector + a_cdu"),
      min_tcs_wetted_mode_c: q(min_wet, "C", "[D]", "F5 wetted: t_wb_c + a_wet + a_cdu"),
      rejection_feasible: q(feasible, "", "[D]",
                            "F5: min_tcs_supply_c <= tcs_inlet_c at the design hour"),
      chillerless_min_tcs_c: q(min_passive, "C", "[D]",
                               "F5: best passive mode, min(dry, wetted)"),
      chillerless_feasible: q(chillerless, "", "[D]",
                              "F5: chillerless_min_tcs_c <= tcs_inlet_c — no mechanical trim needed"),
      wet_bulb_limited: q(wb_limited, "", "[D]",
                          "F5 verdict: no passive mode reaches the racks and the floor is the " +
                          "WET-bulb one — the tropical case (research/10 §2.2)"),
      cooling_verdict: q(verdict, "", "[D]",
                         "F5 three-way site gate: dry-only (a dry cooler alone reaches " +
                         "tcs_inlet_c) | wetted-assist (needs evaporative/adiabatic) | infeasible " +
                         "(no chillerless mode closes — mechanical trim required, priced as " +
                         "x_mech_design_hour)"),
      ashrae_class_required: q(w_class_of(inlet), "", "[S]",
                               "ASHRAE 2021 5th ed. liquid class of the chosen inlet (research/10 §2.1)"),
      ashrae_class_of_plant: q(w_class_of(min_tcs), "", "[D]",
                               "class the plant can actually deliver at design"),
      dry_cooler_derate: q(dry_derate, "", "[D]",
                           "F6 (dry mode only): ITD_site / ITD_ref = (water_in - t_ref) / " +
                           "(water_in - t_db_rating_c); null for tower/adiabatic (v3.1 C-M2)"),
      rejector_count_multiplier: q(rejector_mult, "x", "[D]",
                                   "F6: 1 / dry_cooler_derate — units vs the rating-ambient selection"),
      water_makeup_l_per_kwh_th: q(makeup_l_kwh, "L/kWh", "[D]",
                                   "F7: 1.47 latent x coc/(coc-1) (research/10 §2.4)"),
      wet_mode_hours_yr: q(wet_h, "h/yr", "[A]", "F7 hours in evaporative mode"),
      annual_water_m3: q(water_m3, "m3/yr", "[D]",
                         "F7: it_kw x load_factor x wet_mode_hours_yr x makeup / 1000"),
      wue_m3_per_mwh_it: q(wue, "m3/MWh", "[D]",
                           "F7: annual_water_m3 / IT MWh — DSX KPI envelope 1.1-1.5 (research/10 §2.4)"),
      tower_duty_kw_th: q(tower_duty, "kW_th", "[D]",
                          "F7b: it_kw x (1 + l_cool) — IT heat + the plant's own pump/fan/" +
                          "compressor heat, all rejected at the tower (tower mode only)"),
      tower_cells_installed: q(tower_cells, "", "[D]",
                               "F7b: ceil(duty / tower_cell_kw) + tower_spare_cells — " +
                               "verify cell capacity at YOUR design wet-bulb (wb-dependent)"),
      tower_recirc_l_s: q(tower_recirc, "L/s", "[D]",
                          "F7b: duty / (rho.cp_water x tower_range_k)"),
      tower_evaporation_m3_day: q(tower_evap_day, "m3/day", "[D]",
                                  "F7b design-day: duty x 1.47 L/kWh_th (all-latent, same " +
                                  "basis as F7) — the irreducible water cost of wet rejection"),
      tower_blowdown_m3_day: q(tower_blow_day, "m3/day", "[D]",
                               "F7b: evaporation / (coc - 1) — water-chemistry tax; raising " +
                               "CoC cuts it but tightens treatment"),
      tower_drift_m3_day: q(tower_drift_day, "m3/day", "[D]",
                            "F7b: recirculation x tower_drift_pct (modern eliminators)"),
      tower_makeup_m3_day: q(tower_makeup, "m3/day", "[D]",
                             "F7b design-day total: evaporation + blowdown + drift — the " +
                             "F7 annual figure applies wet_mode_hours + load_factor instead"),
      tower_fan_kw_est: q(tower_fan, "kW", "[D]",
                          "F7b: duty x tower_fan_frac — display estimate; already inside " +
                          "pump_fan_frac's F10 budget (not additive)"),
      loop_ride_through_s: q(ride_s, "s", "[D]",
                             "F8: loop_volume_l x rho x cp x dt_allow_k / liquid_load_kw"),
      tes_volume_m3: q(tes_m3, "m3", "[D]",
                       "F8: Q x tes_bridge_min / (rho.cp_water x dt_allow_k) — the allowable " +
                       "ride-through rise, same basis as loop_ride_through_s (v3.1 C-H1)"),
      chiller_cop_design: q(cop, "", "[D]",
                            "F11: eta_ii x T_evap / (T_cond - T_evap) at the design hour"),
      x_mech_design_hour: q(x_mech, "frac", "[D]",
                            "F11: 1.0 when F5 fails (chiller carries the lift), else 0"),
      pue_l_cool_design_hour: q(l_cool, "", "[D]",
                                "F11 -> F10: pump_fan_frac + x_mech x liquid_frac / " +
                                "chiller_cop_design — the chiller lifts only the liquid " +
                                "loop (v3.1 C-H2)"),
      pue_l_cool_parasitic: q(Number(p.pump_fan_frac), "", "[A]",
                              "pump + fan parasitic share of IT, before any mechanical-lift term"),
    };

    if (p.w_class_target !== null && p.w_class_target !== undefined) {
      const cap = W_CAPS[p.w_class_target];
      out.w_class_target_cap_c = q(cap * 1.0, "C", "[S]",
                                   "ASHRAE 2021 5th ed. facility-supply cap for " + p.w_class_target +
                                   " (research/10 §2.1)");
      out.w_class_target_ok = q(min_tcs <= cap, "", "[D]",
                                "F5: min_tcs_supply_c <= w_class_target_cap_c — can the PLANT hold " +
                                "the class the racks were bought for");
    }

    // Warm-inlet trade, straight off the two sourced curves (F2 flow, F3 head).
    const [lo_t, lo_f] = VENDOR_FLOW_CURVE[0];
    const [hi_t, hi_f] = VENDOR_FLOW_CURVE[VENDOR_FLOW_CURVE.length - 1];
    const dp_lo = Number(p.dp_a_kpa_lpm2) * lo_f * lo_f + Number(p.dp_b_kpa_lpm) * lo_f;
    const dp_hi = Number(p.dp_a_kpa_lpm2) * hi_f * hi_f + Number(p.dp_b_kpa_lpm) * hi_f;

    const notes = [
      "WARM-INLET PENALTY (the price of the F5 verdict): moving the racks from " + lo_t.toFixed(0) +
      " to " + hi_t.toFixed(0) + " C to reach a warm-water class costs x" + (hi_f / lo_f).toFixed(1) +
      " flow (" + lo_f.toFixed(1) + " -> " + hi_f.toFixed(1) + " LPM/rack) and " +
      "x" + (dp_hi / dp_lo).toFixed(1) + " pump head (" + dp_lo.toFixed(0) + " -> " + dp_hi.toFixed(0) +
      " kPa) on the sourced NVL72-class curves — bigger CDUs, " +
      "bigger pumps, more parasitic kW. Trade that against the mechanical trim it avoids " +
      "(research/10 §1.2/§2.1).",
      "F1 is a CLOSURE CHECK, not the sizing input: NVL72-class racks do not run " +
      "fixed delta-T — required flow rises with inlet temperature (65->160 LPM over " +
      "25->45 C for 116 kW liquid [S]). Set flow_basis=vendor to size on F2 (the " +
      "sourced rack curve) and read dt_effective_k as the closure (research/10 §1.2).",
      "min_tcs_supply_c is the design-HOUR feasibility gate only. Annual economizer " +
      "hours and the mechanical-trim fraction need the site's hourly climate CDF " +
      "(research/10 §4.2) — x_mech_design_hour is the binary design-hour reading, not " +
      "an annual average.",
      "pue_l_cool_design_hour is what the power calculator has to leave room for: compare " +
      "it against that calculator's pue_l_cool_plus_misc_implied for the same site.",
    ];
    if (p.flow_basis === "formula") {
      notes.push(
        "F1 vs F2 at " + inlet.toFixed(0) + " C: " + formula_per_kw.toFixed(3) + " vs " +
        vendor_per_kw.toFixed(3) + " LPM/kW (" +
        (vendor_per_kw >= formula_per_kw ? "+" : "") +
        (100.0 * (vendor_per_kw - formula_per_kw) / formula_per_kw).toFixed(0) +
        "%). The vendor curve governs; " +
        "if the gap is large your dt_k is not what the rack will actually deliver.");
    }
    if (!(VENDOR_FLOW_CURVE[0][0] <= inlet && inlet <= VENDOR_FLOW_CURVE[VENDOR_FLOW_CURVE.length - 1][0])) {
      notes.push(
        "tcs_inlet_c " + inlet.toFixed(0) + " C is OUTSIDE the sourced 25-45 C curve range: F2 is clamped " +
        "to the nearest endpoint, not extrapolated. Get the vendor curve for this " +
        "inlet before designing to it.");
    }
    if (rack_flow > VENDOR_FLOW_CURVE[VENDOR_FLOW_CURVE.length - 1][1]) {
      notes.push(
        "rack_flow_lpm " + rack_flow.toFixed(0) + " exceeds the PQ curve's stated 160 LPM validity limit — F3 " +
        "pump head is an extrapolation (research/10 §1.2).");
    }
    if (!feasible) {
      notes.push(
        "REJECTION INFEASIBLE at the design hour (F5): the plant can only reach " + min_tcs.toFixed(1) + " C " +
        "(" + out.ashrae_class_of_plant.value + ") but the racks are specified at " + inlet.toFixed(1) +
        " C (" + out.ashrae_class_required.value + "). Options: warmer-class racks, " +
        "wetted/adiabatic assist, or mechanical trim sized for the " + (min_tcs - inlet).toFixed(1) +
        " K gap — priced here as x_mech 1.0 at COP " + (cop ? cop.toFixed(1) : "n/a") +
        " (research/10 §2.2).");
    }
    if (wb_limited) {
      notes.push(
        "WET-BULB VERDICT (F5): dry-only needs " + min_dry.toFixed(1) + " C TCS, wetted/tower still needs " +
        min_wet.toFixed(1) + " C, and the racks are at " + inlet.toFixed(1) + " C — no chillerless mode closes, and the floor " +
        "is set by the " + t_wb.toFixed(1) + " C WET-bulb, not the " + t_db.toFixed(1) + " C dry-bulb. Design collapses to " +
        "W45-capable racks on wet-assisted rejection, or mechanical trim for the " + (min_passive - inlet).toFixed(1) + " K " +
        "residual (research/10 §2.2).");
    } else if (chillerless && !feasible) {
      notes.push(
        "The SELECTED rejector fails but a passive mode exists: " + min_passive.toFixed(1) + " C is reachable " +
        "(vs " + min_tcs.toFixed(1) + " C on rejector=" + p.rejector + "). Switch mode before pricing a chiller " +
        "(research/10 §2.2).");
    }
    if (p.rejector !== "dry" && water_m3 && Number(p.liquid_frac) < 1.0) {
      notes.push(
        "F7 charges the FULL IT load to the wet rejector — the conservative " +
        "single-wet-plant reading. If only the LIQUID loop rejects through the " +
        "tower (q_liq " + q_liq.toFixed(0) + " kW), scale by liquid_frac " +
        Number(p.liquid_frac).toFixed(2) + " (about " +
        (100.0 * (1.0 - Number(p.liquid_frac))).toFixed(0) + "% less water) (v3.1 C-M3).");
    }
    if (32.0 < Math.max(inlet, min_tcs) && Math.max(inlet, min_tcs) <= 45.0) {
      notes.push(
        "W-class ladder (v3.1): no public source names a W40 class — NVIDIA CDU " +
        "Requirements DA-11933-001 names only W17/W27/W32/W45 (non-exhaustive " +
        "'including' wording) and prior ASHRAE editions enumerate exactly those " +
        "four — so supplies above 32 C classify as W45 here.");
    }
    if (Number(p.liquid_frac) < 1.0) {
      notes.push(
        "pue_l_cool_design_hour prices the LIQUID loop's mechanical lift only; the " +
        "residual-AIR loop's chilled-water lift is NOT modelled (pump_fan_frac is " +
        "fans/pumps parasitics). For air-heavy platforms the PUE-closure cross-check " +
        "understates cooling overhead by roughly the air fraction's lift " +
        "(v3.1 antagonist A-11).");
    }
    if (p.rejector === "adiabatic" && water_m3) {
      notes.push(
        "F7 for adiabatic mode is an UPPER BOUND: it charges every wet hour at the full " +
        "evaporative rate. Only the PRE-COOL duty is latent, an order of magnitude less " +
        "— the real number needs rejector airflow + psychrometrics (research/10 §2.4).");
    }
    if (p.rejector === "dry" && Number(p.t_wb_c) >= 26) {
      notes.push(
        "High design wet-bulb (>=26 C) is what blocks chillerless tropical designs, not " +
        "dry-bulb: evaporative assist gains little at the design hour (research/10 §2.2).");
    }
    if (ride_s === null) {
      notes.push(
        "F8 ride-through not computed: enter loop_volume_l. It matters because loop " +
        "thermal mass buys SECONDS (reference worked value 13 s at 10 K) — which is why CDU pumps and " +
        "residual-air fans must sit on the UPS, not on the gensets (research/10 §1.4).");
    }

    const inputs = {};
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }
    inputs.coolant = q(p.coolant, "", cl_label, cl_src);
    inputs.coolant_rho_kg_l = q(rho, "kg/L", cl_label, cl_src);
    inputs.coolant_cp_kj_kgk = q(cp, "kJ/kg.K", cl_label, cl_src);
    for (const k of Object.keys(inputs)) {
      if (inputs[k].value === null || inputs[k].value === undefined) delete inputs[k];
    }

    return result(
      "cooling — flow, pump head, CDU ladder, rejection feasibility, water, TES",
      "research/10-cooling-power.md §7 F1-F9 + F11 (detail: §1.2 flow, §1.3 CDU, " +
      "§1.4 ride-through/TES, §2.1 ASHRAE classes, §2.2 approach stack, §2.3 derating, " +
      "§2.4 water, §3.1 157 CFM/kW, §4.2 COP)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcCooling = { DEFAULTS: DEFAULTS, COOLANTS: COOLANTS,
                                  W_CLASSES: W_CLASSES, REJECTORS: REJECTORS,
                                  FLOW_BASES: FLOW_BASES, CFM_PER_KW: CFM_PER_KW,
                                  VENDOR_FLOW_CURVE: VENDOR_FLOW_CURVE,
                                  VENDOR_CURVE_LIQUID_KW: VENDOR_CURVE_LIQUID_KW,
                                  w_class_of: w_class_of, vendor_flow_lpm: vendor_flow_lpm,
                                  loads: loads };
})();
