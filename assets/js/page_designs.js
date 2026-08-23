// Page config: designs.html — the reference design gallery. Registers the
// SAME power + cooling sections as power.html / cooling.html (identical ids
// and field keys, so URL-hash state round-trips between pages; only the
// primary/advanced split differs) and renders the full-page annotated views
// from designs.js. The hall plan is generated data (hallplan.js) mounted with
// layer toggles. Ends with ONE A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  A.SECTIONS = A.SECTIONS || [];


  // -------- view 1 · electrical one-line (power engine, rack chain preset) ----
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
      { key: "rack_kw", label: "rack nameplate (F17/F18 chain)", src: "aif-template", step: 1, min: 1 },
      { key: "gpus", label: "GPU count (unlocks ramp F16)", src: "legend", step: 1, min: 1, placeholder: "e.g. 2304", advanced: true },
      { key: "mpf", label: "power smoothing (MPF, GB200-class)", src: "arxiv-powerstab", type: "checkbox", advanced: true },
      { key: "p_e_usd_kwh", label: "energy rate", src: "eia", step: 0.001, min: 0, advanced: true },
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
    // Gallery preset (P3): 136 kW (NVL72 nameplate [S aif-template]) unlocks the
    // F17/F18 chain, and 6 racks per path is the F17 product-band max — the
    // demonstrated reference PASSES as drawn (the template's preset-note says how
    // to re-trigger the failure). The calculators' own defaults are untouched;
    // restoreHash runs after init, so shared links still override the preset.
    init: () => {
      const ctl = document.getElementById("power.rack_kw");
      if (ctl && ctl.value === "") ctl.value = "136";
      const rpp = document.getElementById("power.racks_per_path");
      if (rpp && rpp.value === "") rpp.value = "6";
      // a real product: Starline T5 tops out at 1250 A — the default 1600 A
      // "rating" is above the product band and keeps a red note alive
      const bwr = document.getElementById("power.busway_rating_a");
      if (bwr && bwr.value === "") bwr.value = "1250";
    },
    after: (r) => {
      const c = document.getElementById("designs-oneline");
      if (c) A.designs.oneLineFull(c, r);
      A.designs.liveLink("designs-open-power", "power.html");
    },
  });

  // -------- view 2 · cooling schematic (cooling engine) ------------------------
  A.SECTIONS.push({
    id: "cool",
    defaults: A.calcCooling.DEFAULTS,
    compute: (kw) => A.calcCooling.loads(kw),
    hero: "min_tcs_supply_c", heroLabel: "min TCS supply the plant can make", heroSrc: "dossiers",
    fields: [
      { key: "it_kw", label: "IT load", src: "legend", step: 100, min: 1 },
      { key: "liquid_frac", label: "liquid heat fraction", src: "aif-template", step: 0.01, min: 0, max: 1 },
      { key: "tcs_inlet_c", label: "rack TCS inlet", src: "aif-template", step: 1, min: 10, max: 60 },
      { key: "rejector", label: "heat rejection (dry/wetted)", src: "dossiers", type: "select",
        options: [["dry", "dry cooler"], ["tower", "cooling tower / wetted"], ["adiabatic", "adiabatic-assist dry"]] },
      { key: "t_db_c", label: "design dry-bulb", src: "legend", step: 0.5 },
      { key: "t_wb_c", label: "design wet-bulb", src: "legend", step: 0.5 },
      { key: "w_class_target", label: "W-class target", src: "ashrae2021", type: "select",
        options: [["", "(none)"], ["W17", "W17"], ["W27", "W27"], ["W32", "W32"], ["W45", "W45"]], advanced: true },
      { key: "flow_basis", label: "flow basis", src: "aif-template", type: "select",
        options: [["formula", "F1 formula (fixed ΔT)"], ["vendor", "F2 vendor rack curve"]], advanced: true },
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
    // Gallery preset (P3): wetted/tower at a 40 C TCS point (inside the NVL72
    // 25-45 C curve) — the workable design for the 28 C wet-bulb default site,
    // per the schematic's own notes. Same preset mechanics as the power section.
    init: () => {
      const sel = document.getElementById("cool.rejector");
      if (sel && sel.value === "dry") sel.value = "tower";
      const inlet = document.getElementById("cool.tcs_inlet_c");
      if (inlet && inlet.value === "") inlet.value = "40";
    },
    after: (r) => {
      const c = document.getElementById("designs-cooling");
      if (c) A.designs.coolingSchematic(c, r);
      A.designs.liveLink("designs-open-cooling", "cooling.html");
      // reflect the live rejector into the quick toggle buttons
      const cur = String(r.inputs.rejector.value);
      for (const b of document.querySelectorAll("#designs-rej-toggle button")) {
        b.setAttribute("aria-pressed", b.dataset.rej === cur ? "true" : "false");
      }
    },
  });

  // -------- view 3 · hall layout plan (generated data + layer toggles) ---------
  function mountHallPlan() {
    const HP = globalThis.HALLPLAN;
    const stage = document.getElementById("designs-plan");
    const bar = document.getElementById("designs-plan-layers");
    const spec = document.getElementById("designs-plan-specs");
    if (!HP || !stage || !bar) return;
    stage.innerHTML = HP.svg;
    for (const L of HP.layers) {
      const id = "hp-toggle-" + L.id;
      const lab = document.createElement("label");
      lab.className = "hp-toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.id = id;
      cb.addEventListener("change", () => {
        const g = stage.querySelector("#" + L.id);
        if (g) g.style.display = cb.checked ? "" : "none";
      });
      lab.append(cb, " " + L.label);
      bar.appendChild(lab);
    }
    if (spec) {
      for (const s of HP.specs) {
        const tr = document.createElement("tr");
        const td1 = document.createElement("td");
        td1.textContent = s.k;
        const td2 = document.createElement("td");
        td2.className = "num";
        td2.textContent = s.v;
        const td3 = document.createElement("td");
        td3.appendChild(A.chipEl("[" + s.chip + "]", s.cite, null));
        tr.append(td1, td2, td3);
        spec.appendChild(tr);
      }
    }
  }

  // quick wetted/dry toggle buttons drive the rejector select
  function wireRejectorToggle() {
    for (const b of document.querySelectorAll("#designs-rej-toggle button")) {
      b.addEventListener("click", () => {
        const sel = document.getElementById("cool.rejector");
        if (!sel) return;
        sel.value = b.dataset.rej;
        sel.dispatchEvent(new Event("change"));
      });
    }
  }

  mountHallPlan();
  wireRejectorToggle();
  A.designs.wireDownload("designs-dl-oneline", "designs-oneline", "one-line-annotated.svg");
  A.designs.wireDownload("designs-dl-cooling", "designs-cooling", "cooling-schematic.svg");
  A.designs.wireDownload("designs-dl-plan", "designs-plan", "hall-layout-plan.svg");
  A.boot();
})();
