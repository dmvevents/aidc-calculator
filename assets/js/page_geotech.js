// Page config: geotech calculator — the bearing-capacity / shallow-foundation
// lens. The land core sizes the building PAD live; the geotechnical-desk inputs
// (cohesion, the tabulated N-factors, unit weight, foundation width/depth,
// factor of safety, floor load, footing thickness, unit cost) roll into the
// ultimate bearing capacity and the foundation-area BAND. Renders the
// bearing-capacity chain from the three superposition terms through the
// allowable pressure to the signed area margin, with the fit-vs-raft sign called
// out. Ends with A.boot(). parity: assets/js/calc_geotech.js (the 1:1 core
// port); the arithmetic lives in the engine, this file only presents it.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // --------------------------------------------------------------- GEOTECH --
  A.SECTIONS.push({
    id: "geotech",
    // the geotechnical-desk inputs carry their own DEFAULTS/chips; it_mw (which
    // sizes the building pad the load composes over) borrows the land core's
    // DEFAULT so its field chips + placeholders like the land page.
    defaults: Object.assign({}, { it_mw: A.calcLand.DEFAULTS.it_mw }, A.calcGeotech.DEFAULTS),
    compute: (kw) => A.calcGeotech.geotech(kw),
    hero: "foundation_area_margin_m2",
    heroLabel: "foundation area margin (+ spread footings fit / − raft or improvement), m²", heroSrc: "legend",
    fields: [
      { key: "it_mw", label: "critical IT (sizes the building pad via calc_land)", src: "legend", step: 0.5, min: 0.1 },
      { key: "cohesion_kpa", label: "soil cohesion c (kPa)", src: "legend", step: 1, min: 0 },
      { key: "unit_weight_kn_m3", label: "soil unit weight γ (kN/m³)", src: "legend", step: 0.5, min: 0.1 },
      { key: "foundation_depth_m", label: "founding depth Df (m)", src: "legend", step: 0.25, min: 0 },
      { key: "factor_of_safety", label: "factor of safety on q_ult", src: "legend", step: 0.5, min: 0.1 },
      { key: "floor_load_kpa", label: "structural floor load (kPa)", src: "legend", step: 1, min: 0 },
      { key: "friction_bearing_factor_nc", label: "bearing factor Nc (tabulated, φ)", src: "legend", step: 0.5, min: 0.1, advanced: true },
      { key: "friction_bearing_factor_nq", label: "bearing factor Nq (tabulated, φ)", src: "legend", step: 0.5, min: 0.1, advanced: true },
      { key: "friction_bearing_factor_ngamma", label: "bearing factor Nγ (tabulated, φ)", src: "legend", step: 0.5, min: 0, advanced: true },
      { key: "foundation_width_m", label: "foundation width B (m)", src: "legend", step: 0.5, min: 0.1, advanced: true },
      { key: "footing_thickness_m", label: "footing / mat thickness (m)", src: "legend", step: 0.1, min: 0.1, advanced: true },
      { key: "concrete_unit_cost_per_m3", label: "concrete unit cost ($/m³)", src: "legend", step: 10, min: 0, advanced: true },
    ],
    derive: (r) => {
      const o = r.outputs;
      return [
        "q_ult = c·Nc + (γ·Df)·Nq + 0.5·γ·B·Nγ = " +
          d(o.bearing_capacity_ult_kpa.value) + " kPa (three-term superposition)",
        "surcharge q = γ × Df = " + d(o.overburden_surcharge_kpa.value) + " kPa (effective overburden)",
        "q_allow = q_ult ÷ FS = " + d(o.bearing_capacity_allow_kpa.value) + " kPa (allowable pressure)",
        "load = footprint × floor_load = " + d(o.total_structural_load_kn.value) + " kN (composed over calc_land)",
        "required area = load ÷ q_allow = " + d(o.required_bearing_area_m2.value) + " m²",
        "margin = footprint − required area = " + d(o.foundation_area_margin_m2.value) + " m² (+ fit / − raft)",
        "concrete = required area × thickness = " + d(o.foundation_concrete_m3.value) + " m³; " +
          "cost = concrete × unit / 1e6 = " + d(o.foundation_cost_m.value) + " US$M",
      ];
    },
    // the VISUAL: a bearing-capacity chain from the three superposition terms →
    // the ultimate capacity (the load-bearing sum, highlighted) → the allowable
    // pressure → the required bearing area → the signed foundation area margin
    // (highlighted). The margin row is foundation_area_margin_m2 (the signed band).
    after: (r) => {
      const host = document.getElementById("geotech-bridge");
      if (!host) return;
      const o = r.outputs;
      const gamma = r.inputs.unit_weight_kn_m3.value;
      const width = r.inputs.foundation_width_m.value;
      const cohesion = r.inputs.cohesion_kpa.value;
      const nc = r.inputs.friction_bearing_factor_nc.value;
      const nq = r.inputs.friction_bearing_factor_nq.value;
      const ngamma = r.inputs.friction_bearing_factor_ngamma.value;
      const termCohesion = cohesion * nc;
      const termSurcharge = o.overburden_surcharge_kpa.value * nq;
      const termSelfWeight = 0.5 * gamma * width * ngamma;
      const margin = o.foundation_area_margin_m2.value;
      const rows = [
        ["Cohesion term c·Nc", d(termCohesion), "kPa", false],
        ["+ Surcharge term (γ·Df)·Nq", d(termSurcharge), "kPa", false],
        ["+ Self-weight term 0.5·γ·B·Nγ", d(termSelfWeight), "kPa", false],
        ["= Ultimate bearing q_ult", d(o.bearing_capacity_ult_kpa.value), "kPa", true],
        ["÷ FS → allowable q_allow", d(o.bearing_capacity_allow_kpa.value), "kPa", false],
        ["load ÷ q_allow → required area", d(o.required_bearing_area_m2.value), "m²", false],
        ["footprint − required → area margin (+ fit / − raft)", d(margin), "m²", true],
      ];

      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "Bearing-capacity chain — the three terms through allowable pressure to the foundation area margin [D]";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const h of ["step", "quantity", "basis"]) {
        const th = document.createElement("th");
        th.textContent = h;
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const [label, amt, basis, isNet] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
        const tda = document.createElement("td");
        tda.className = "num" + (isNet ? " sens-base" : "");
        tda.textContent = amt;
        const tdb = document.createElement("td");
        tdb.textContent = basis;
        tr.append(tda, tdb);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);

      // fit/raft + concrete + cost callout under the chain
      const note = document.createElement("p");
      note.className = "preset-note";
      const fits = margin > 0;
      note.textContent =
        "Foundations: " +
        (fits ? "spread footings fit — the required " + d(o.required_bearing_area_m2.value)
                + " m² sits inside the " + d(o.building_footprint_m2.value) + " m² pad with "
                + d(margin) + " m² to spare"
              : "the required bearing area (" + d(o.required_bearing_area_m2.value) + " m²) EXCEEDS the "
                + d(o.building_footprint_m2.value) + " m² pad — a raft / ground improvement is indicated") + ". " +
        "Concrete ≈ " + d(o.foundation_concrete_m3.value) + " m³ at the assumed thickness; " +
        "construction ≈ " + d(o.foundation_cost_m.value) + " US$M on the composed building pad.";

      host.replaceChildren(tbl, note);
    },
  });

  A.boot();
})();
