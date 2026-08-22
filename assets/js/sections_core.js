// Section configs 1/2: power, cooling, rack planner (+ 3D twin hookup).
// Each config: fields (key/label/src per default), compute -> result object,
// hero output, derive() = the visible math, after() = reactive diagrams.
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
        options: [["", "(none)"], ["W17", "W17"], ["W27", "W27"], ["W32", "W32"], ["W40", "W40"], ["W45", "W45"]] },
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

  // ----------------------------------------------------------------- RACK ----
  const VARIANT_ORDER = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];
  const rackOf = (name) => {
    const v = globalThis.RACKDB[name];
    return { gpus_per_rack: v.gpus_per_rack, nameplate_kw: v.nameplate_kw,
             liquid_kw: v.liquid_kw || 0, air_kw: v.air_kw || 0, weight_kg: v.weight_kg,
             footprint_m2: v.footprint_m2, racks_per_su: v.racks_per_su, rails: v.rails };
  };
  A.currentVariant = () => {
    const sel = document.getElementById("rack.variant");
    return (sel && sel.value) || "gb200-nvl72";
  };

  A.SECTIONS.push({
    id: "rack",
    defaults: A.calcRack.DEFAULTS,
    compute: (kw) => {
      const name = kw.variant || "gb200-nvl72";
      const k2 = Object.assign({}, kw);
      delete k2.variant;
      return A.calcRack.plan(rackOf(name), k2);
    },
    hero: "it_total_mw", heroLabel: "total IT load", heroSrc: "variants",
    unitToggles: ["area"],
    fields: [
      { key: "variant", label: "rack platform", src: "variants", type: "select", value: "gb200-nvl72",
        options: VARIANT_ORDER.map((n) => [n, globalThis.RACKDB[n].platform]) },
      { key: "gpus", label: "target GPU count", src: "legend", step: 8, min: 1 },
      { key: "support_frac", label: "support-IT frac", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "pue", label: "PUE target", src: "dsx-kpi", step: 0.01, min: 1, advanced: true },
      { key: "m2_per_rack", label: "white space / rack", src: "refdesign", step: 1, min: 1, advanced: true },
      { key: "floor_rating_kpa", label: "floor rating", src: "refdesign", step: 1, min: 1, advanced: true },
      { key: "racks_per_path", label: "racks per busway path", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "dist_v", label: "distribution voltage", src: "aif-template", step: 1, min: 100, advanced: true },
      { key: "pf_rack", label: "rack power factor", src: "gb300-ra", step: 0.01, min: 0.5, max: 1, advanced: true },
      { key: "breaker_factor", label: "continuous factor", src: "nec", step: 0.05, min: 0.5, max: 1, advanced: true },
      { key: "busway_rating_a", label: "busway rating", src: "starline", step: 50, min: 100, advanced: true },
      { key: "busway_product_ceiling_a", label: "busway product ceiling", src: "starline", step: 50, min: 100, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      return [
        "racks = ⌈GPUs ÷ GPUs/rack⌉ = ⌈" + d(i.gpus.value) + " ÷ " + d(i["rack.gpus_per_rack"].value) + "⌉ = " + o.racks.value,
        "IT = racks × kW + support = " + o.racks.value + " × " + d(i["rack.nameplate_kw"].value) + " × " +
          d(1 + i.support_frac.value) + " = " + d(o.it_total_mw.value) + " MW-IT → facility " + d(o.facility_mw.value) + " MW",
        "density = " + d(o.gpus_per_mw.value) + " GPUs/MW · " + d(o.racks_per_mw.value) + " racks/MW · " +
          d(o.kw_per_gpu.value) + " kW/GPU",
        "F17 · I_rack = " + d(i["rack.nameplate_kw"].value) + "×1000 ÷ (1.732×" + d(i.dist_v.value) + "×" +
          d(i.pf_rack.value) + ") = " + d(o.rack_current_a.value) + " A · row ×" + o.racks_per_path_used.value +
          " = " + d(o.busway_continuous_a.value) + " A ÷ 0.8 → ≥" + d(o.busway_min_rating_a.value) + " A " +
          (o.busway_rating_ok.value ? "✓ within " + d(i.busway_rating_a.value) + " A" : "✕ over " + d(i.busway_rating_a.value) + " A"),
        "floor = " + d(i["rack.weight_kg"].value) + " kg × 9.81 ÷ " + d(i["rack.footprint_m2"].value) + " m² = " +
          d(o.floor_pressure_kpa.value) + " kPa vs " + d(i.floor_rating_kpa.value) + " rating",
      ];
    },
    init: () => {
      // comparison matrix (static per page load — the data backbone visualised)
      const host = document.getElementById("rack-matrix");
      if (!host) return;
      const rows = [
        ["GPUs / rack", (v) => v.gpus_per_rack],
        ["kW / rack (nameplate)", (v) => v.nameplate_kw],
        ["Transient ceiling EDPP2 (kW)", (v) => v.edpp2_kw || "—"],
        ["Cooling", (v) => v.cooling],
        ["Liquid / air per rack (kW)", (v) => (v.liquid_kw || 0) + " / " + v.air_kw],
        ["Weight (kg)", (v) => v.weight_kg],
        ["Height (mm / U-class)", (v) => v.height_mm + (v.u_class ? " · " + v.u_class : "")],
        ["Floor pressure (kPa)", (v) => v.floor_kpa],
        ["Racks / MW", (v) => v.racks_per_mw],
        ["GPUs / MW", (v) => v.gpus_per_mw],
        ["NVLink domain (GPUs)", (v) => v.nvlink_domain + " " + v.nvlink_label],
        ["Scale-out rails", (v) => v.rails],
        ["Fabric", (v) => v.scale_out],
        ["Racks / SU", (v) => v.racks_per_su],
      ];
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.appendChild(document.createElement("th"));
      for (const n of VARIANT_ORDER) {
        const th = document.createElement("th");
        th.textContent = globalThis.RACKDB[n].platform;
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const [label, get] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
        for (const n of VARIANT_ORDER) {
          const td = document.createElement("td");
          td.className = "num";
          td.textContent = String(get(globalThis.RACKDB[n]));
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      host.replaceChildren(tbl);
    },
    after: () => {
      // keep the 3D twin selector in sync with the chosen variant
      const twinSel = document.getElementById("twin-variant");
      if (twinSel && twinSel.value !== A.currentVariant()) {
        twinSel.value = A.currentVariant();
        twinSel.dispatchEvent(new Event("change"));
      }
    },
  });
})();
