// Page config: power calculator — section extracted 1:1 from the v1 single-page bundle
// (sections_core.js); formulas untouched, engine unchanged. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ---------------------------------------------------------------- POWER ----
  A.SECTIONS.push({
    id: "power",
    defaults: A.calcPower.DEFAULTS,
    compute: (kw) => A.calcPower.sizing(kw),
    hero: "facility_mw", heroLabel: "facility load", heroSrc: "dsx-kpi",
    fields: [
      { key: "it_mw", label: "IT load", src: "legend", step: 0.1, min: 0.001 },
      { key: "pue", label: "PUE target", src: "dsx-kpi", step: 0.01, min: 1.0 },
      { key: "redundancy", label: "redundancy", src: "uptime", type: "select",
        options: [["2N", "2N (two full paths)"], ["N+1", "N+1 (catcher)"], ["N", "N (no redundancy)"]] },
      { key: "rack_kw", label: "rack nameplate (unlocks busway/whips)", src: "aif-template", step: 1, min: 1, placeholder: "e.g. 136" },
      { key: "gpus", label: "GPU count (unlocks ramp F16)", src: "legend", step: 1, min: 1, placeholder: "e.g. 2304" },
      { key: "mpf", label: "power smoothing (MPF, GB200-class)", src: "arxiv-powerstab", type: "checkbox" },
      { key: "p_e_usd_kwh", label: "energy rate", src: "eia", step: 0.001, min: 0 },
      { key: "pf", label: "billed power factor", src: "refdesign", step: 0.01, min: 0.5, max: 1, advanced: true },
      { key: "pue_peak", label: "PUE at billing peak", src: "dossiers", step: 0.01, min: 1, advanced: true },
      { key: "growth_margin", label: "service growth margin", src: "refdesign", step: 0.05, min: 0, advanced: true },
      { key: "n_units", label: "units per path (N+1)", src: "refdesign", step: 1, min: 1, advanced: true },
      { key: "ups_eff", label: "UPS efficiency", src: "refdesign", step: 0.005, min: 0.5, max: 1, advanced: true },
      { key: "dist_loss", label: "distribution loss frac", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "mech_on_ups_frac", label: "mech-on-UPS / IT", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "mech_peak_ratio", label: "mech peak/avg ratio", src: "dossiers", step: 0.1, min: 1, advanced: true },
      { key: "ups_module_mw", label: "UPS module", src: "refdesign", step: 0.1, min: 0.1, advanced: true },
      { key: "ride_through_min", label: "battery ride-through", src: "refdesign", step: 0.5, min: 0.5, advanced: true },
      { key: "batt_dod", label: "battery DoD", src: "refdesign", step: 0.05, min: 0.1, max: 1, advanced: true },
      { key: "batt_eff", label: "battery discharge eff", src: "refdesign", step: 0.01, min: 0.5, max: 1, advanced: true },
      { key: "genset_unit_mva", label: "genset unit", src: "refdesign", step: 0.25, min: 0.25, advanced: true },
      { key: "gen_step_frac", label: "gen block-load frac", src: "dossiers", step: 0.05, min: 0.1, max: 1, advanced: true },
      { key: "largest_block_mw", label: "largest load step", src: "dossiers", step: 0.1, min: 0, advanced: true },
      { key: "fuel_hours", label: "fuel autonomy", src: "refdesign", step: 1, min: 1, advanced: true },
      { key: "fuel_l_per_kwh", label: "genset SFC", src: "genset-sfc", step: 0.01, min: 0.1, advanced: true },
      { key: "rack_edpp_kw", label: "rack EDPP2 ceiling", src: "aif-template", step: 1, min: 1, advanced: true },
      { key: "ramp_w_per_sec_per_gpu", label: "ramp W/s per GPU", src: "aif-template", step: 1, min: 0, advanced: true },
      { key: "mpf_floor_frac", label: "MPF floor frac", src: "aif-template", step: 0.05, min: 0.1, max: 1, advanced: true },
      { key: "mpf_energy_adder", label: "MPF energy adder", src: "arxiv-powerstab", step: 0.005, min: 0, advanced: true },
      { key: "p_d_usd_kva_month", label: "demand rate", src: "legend", step: 0.5, min: 0, advanced: true },
      { key: "lf_it", label: "IT load factor", src: "legend", step: 0.05, min: 0.05, max: 1, advanced: true },
      { key: "optics_share_of_it", label: "optics share of IT", src: "dossiers", step: 0.001, min: 0, advanced: true },
      { key: "dist_v", label: "distribution voltage", src: "aif-template", step: 1, min: 100, advanced: true },
      { key: "pf_rack", label: "rack power factor", src: "gb300-ra", step: 0.01, min: 0.5, max: 1, advanced: true },
      { key: "racks_per_path", label: "racks per busway path", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "busway_rating_a", label: "busway rating", src: "starline", step: 50, min: 100, advanced: true },
      { key: "busway_product_ceiling_a", label: "busway product ceiling", src: "starline", step: 50, min: 100, advanced: true },
      { key: "breaker_factor", label: "continuous factor", src: "nec", step: 0.05, min: 0.5, max: 1, advanced: true },
      { key: "shelves_per_rack", label: "power shelves / rack", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "shelf_kw", label: "shelf deliverable", src: "gb200-ra", step: 0.5, min: 1, advanced: true },
      { key: "shelf_v", label: "shelf feed voltage", src: "gb300-ra", step: 1, min: 100, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      const L = [
        "F13 · facility = it_mw × PUE = " + d(i.it_mw.value) + " × " + d(i.pue.value) + " = " + d(o.facility_mw.value) + " MW",
        "F13 · utility service = facility ÷ PF × (1 + margin) = " + d(o.facility_mw.value) + " ÷ " + d(i.pf.value) +
          " × " + d(1 + i.growth_margin.value) + " = " + d(o.utility_service_mva.value) + " MVA",
        "F14 · UPS-backed = IT × (1 + mech) = " + d(i.it_mw.value) + " × " + d(1 + i.mech_on_ups_frac.value) +
          " = " + d(o.ups_backed_mw.value) + " MW → ⌈÷ " + d(i.ups_module_mw.value) + " MW⌉ = " +
          o.ups_modules_n.value + " modules (+1/path)",
        "F15 · gensets = ⌈" + d(o.peak_demand_mva.value) + " MVA ÷ " + d(i.genset_unit_mva.value) + "⌉ = " +
          o.genset_units_n.value + " (+1) · fuel = " + d(o.facility_mw.value) + " MW × " + d(i.fuel_hours.value) +
          " h × " + d(i.fuel_l_per_kwh.value) + " L/kWh = " + d(o.genset_fuel_m3.value) + " m³",
      ];
      if (o.rack_current_a) {
        L.push("F17 · I_rack = kW×1000 ÷ (√3×V×PF) = " + d(i.rack_kw.value) + "×1000 ÷ (1.732×" +
               d(i.dist_v.value) + "×" + d(i.pf_rack.value) + ") = " + d(o.rack_current_a.value) +
               " A · row ×" + i.racks_per_path.value + " = " + d(o.busway_continuous_a.value) +
               " A · ÷0.8 → ≥" + d(o.busway_min_rating_a.value) + " A " +
               (o.busway_rating_ok.value ? "✓" : "✕ vs " + d(i.busway_rating_a.value) + " A"));
      }
      L.push("F10 · L_elec = (1/η−1)×share + dist = " + d(o.pue_l_elec.value) +
             " → cooling+misc room = " + d(o.pue_l_cool_plus_misc_implied.value));
      return L;
    },
    after: (r) => {
      const c = document.getElementById("power-oneline");
      if (c) A.diagrams.oneLine(c, r);
    },
  });

  A.boot();
})();
