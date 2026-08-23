// Page config: cooling calculator — section extracted 1:1 from the v1 single-page bundle
// (sections_core.js); formulas untouched, engine unchanged. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // -------------------------------------------------------------- COOLING ----
  A.SECTIONS.push({
    id: "cool",
    defaults: A.calcCooling.DEFAULTS,
    compute: (kw) => A.calcCooling.loads(kw),
    hero: "min_tcs_supply_c", heroLabel: "min TCS supply the plant can make", heroSrc: "dossiers",
    unitToggles: ["power", "flow"],
    fields: [
      { key: "it_kw", label: "IT load", src: "legend", step: 100, min: 1 },
      { key: "liquid_frac", label: "liquid heat fraction", src: "aif-template", step: 0.01, min: 0, max: 1 },
      { key: "tcs_inlet_c", label: "rack TCS inlet", src: "aif-template", step: 1, min: 10, max: 60 },
      { key: "rejector", label: "heat rejection", src: "dossiers", type: "select",
        options: [["dry", "dry cooler"], ["tower", "cooling tower / wetted"], ["adiabatic", "adiabatic-assist dry"]] },
      { key: "t_db_c", label: "design dry-bulb", src: "legend", step: 0.5 },
      { key: "t_wb_c", label: "design wet-bulb", src: "legend", step: 0.5 },
      { key: "w_class_target", label: "W-class target", src: "ashrae2021", type: "select",
        options: [["", "(none)"], ["W17", "W17"], ["W27", "W27"], ["W32", "W32"], ["W45", "W45"]] },
      { key: "flow_basis", label: "flow basis", src: "aif-template", type: "select",
        options: [["formula", "F1 formula (fixed ΔT)"], ["vendor", "F2 vendor rack curve"]] },
      { key: "coolant", label: "coolant", src: "dossiers", type: "select",
        options: [["pg25", "PG25 (25% glycol)"], ["water", "water"]], advanced: true },
      { key: "dt_k", label: "design ΔT (F1)", src: "dossiers", step: 1, min: 1, advanced: true },
      { key: "rack_liquid_kw", label: "liquid kW per rack", src: "aif-template", step: 1, min: 1, advanced: true },
      { key: "dp_a_kpa_lpm2", label: "rack dP a (kPa/LPM²)", src: "aif-template", step: 0.0001, min: 0, advanced: true },
      { key: "dp_b_kpa_lpm", label: "rack dP b (kPa/LPM)", src: "aif-template", step: 0.001, min: 0, advanced: true },
      { key: "dp_loop_extra_kpa", label: "loop head extra", src: "refdesign", step: 5, min: 0, advanced: true },
      { key: "cdu_kw", label: "CDU nominal", src: "aif-template", step: 10, min: 10, advanced: true },
      { key: "cdu_redundancy", label: "CDU redundancy", src: "dossiers", type: "select",
        options: [["N+1", "N+1"], ["N", "N"]], advanced: true },
      { key: "cdu_approach_rated_k", label: "CDU rated approach", src: "vertiv-cdu", step: 0.5, min: 0.5, advanced: true },
      { key: "cdu_parasitic_frac", label: "CDU parasitic frac", src: "coolit", step: 0.001, min: 0, advanced: true },
      { key: "cfm_per_kw", label: "airflow rule", src: "dg11301", step: 1, min: 50, advanced: true },
      { key: "a_rejector", label: "dry-cooler approach", src: "dossiers", step: 0.5, min: 0.5, advanced: true },
      { key: "a_wet", label: "tower approach", src: "dossiers", step: 0.5, min: 0.5, advanced: true },
      { key: "a_cdu", label: "CDU approach in stack", src: "vertiv-cdu", step: 0.5, min: 0.5, advanced: true },
      { key: "eps_adb", label: "adiabatic effectiveness", src: "dossiers", step: 0.05, min: 0.1, max: 1, advanced: true },
      { key: "t_db_rating_c", label: "rejector rating ambient", src: "dossiers", step: 0.5, advanced: true },
      { key: "rejector_water_in_c", label: "rejector water-in", src: "dossiers", step: 0.5, advanced: true },
      { key: "coc", label: "cycles of concentration", src: "dossiers", step: 0.5, min: 1.5, advanced: true },
      { key: "wet_hours_yr", label: "wet-mode hours / yr", src: "dossiers", step: 50, min: 0, advanced: true },
      { key: "load_factor", label: "IT load factor", src: "legend", step: 0.05, min: 0.05, max: 1, advanced: true },
      { key: "loop_volume_l", label: "TCS loop volume", src: "legend", step: 100, min: 0, advanced: true },
      { key: "dt_allow_k", label: "ride-through ΔT allow", src: "dossiers", step: 1, min: 1, advanced: true },
      { key: "tes_bridge_min", label: "TES bridge", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "eta_ii", label: "chiller η_II", src: "dossiers", step: 0.05, min: 0.1, max: 1, advanced: true },
      { key: "fws_supply_c", label: "FWS supply (mech trim)", src: "refdesign", step: 1, advanced: true },
      { key: "a_evap", label: "evaporator approach", src: "dossiers", step: 0.5, min: 0, advanced: true },
      { key: "a_cond", label: "condenser approach", src: "dossiers", step: 0.5, min: 0, advanced: true },
      { key: "pump_fan_frac", label: "pump+fan / IT", src: "refdesign", step: 0.001, min: 0, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      const L = [];
      if (o.flow_basis_used.value === "vendor") {
        L.push("F2 · flow/kW = curve(" + d(i.tcs_inlet_c.value) + " °C) ÷ 116 kW = " + d(o.vendor_curve_lpm_per_rack.value) +
               " ÷ 116 = " + d(o.flow_per_kw_lpm.value) + " LPM/kW (ΔT_eff " + d(o.dt_effective_k.value) + " K)");
      } else {
        L.push("F1 · flow/kW = 60 ÷ (ρ·cp·ΔT) = 60 ÷ (" + d(i.coolant_rho_kg_l.value) + "×" + d(i.coolant_cp_kj_kgk.value) +
               "×" + d(i.dt_k.value) + ") = " + d(o.flow_per_kw_lpm.value) + " LPM/kW");
      }
      L.push("Q_liquid = IT × frac = " + d(i.it_kw.value) + " × " + d(i.liquid_frac.value) + " = " +
             d(o.liquid_load_kw.value) + " kW → TCS flow = " + d(o.tcs_flow_lpm.value) + " LPM");
      L.push("F5 · min TCS = T_ref + A_rej + A_CDU = " + d(o.t_reject_ref_c.value) + " + " +
             d(o.min_tcs_supply_c.value - Number(i.a_cdu.value) - o.t_reject_ref_c.value) + " + " + d(i.a_cdu.value) +
             " = " + d(o.min_tcs_supply_c.value) + " °C vs inlet " + d(i.tcs_inlet_c.value) + " °C → " +
             o.cooling_verdict.value.toUpperCase());
      L.push("F4 · CDUs = ⌈" + d(o.liquid_load_kw.value) + " ÷ (" + d(i.cdu_kw.value) + "×" + d(o.cdu_derate.value) +
             ")⌉ = " + o.cdu_units_required.value + " (+1) at " + d(o.cdu_loading_pct.value) + "% loading");
      L.push("F9 · residual air = " + d(o.air_load_kw.value) + " kW × " + d(i.cfm_per_kw.value) + " = " +
             d(o.air_flow_cfm.value) + " CFM");
      return L;
    },
    after: (r) => {
      const c = document.getElementById("cool-ladder");
      if (c) A.diagrams.coolingLadder(c, r);
    },
  });

  A.boot();
})();
