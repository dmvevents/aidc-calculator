// Page config: sitescore calculator — the land-development CAPSTONE. A weighted-
// overlay site-suitability score (Weighted Linear Combination MCDA) composes LIVE
// over the parcel base (calc_land) and all five site domains — earthwork and
// stormwater cost intensity per acre (calc_landdev / calc_stormwater over the acres),
// the geotechnical bearing margin (calc_geotech), and the entitlement and
// interconnection clocks (calc_entitlements / calc_interconnect) — each mapped through
// a linear value function to a 0-100 sub-score, then combined under their planning
// weights. Renders the roll-up: the five weighted contributions summed to the overall
// score and classified into a prime / developable / constrained / unsuitable band.
// Ends with A.boot().
// parity: assets/js/calc_sitescore.js (the 1:1 core port); the arithmetic lives in the
// engine, this file only presents it.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ------------------------------------------------------------- SITESCORE --
  A.SECTIONS.push({
    id: "sitescore",
    // the suitability weights + value-function anchors carry their own DEFAULTS/chips;
    // it_mw (the master scale the five domains compose over) borrows the power core's
    // DEFAULT and each domain driver borrows its own module's DEFAULT so the field chips
    // + placeholders read like the domain pages.
    defaults: Object.assign(
      {},
      {
        it_mw: A.calcPower.DEFAULTS.it_mw,
        earthwork_unit_cost_per_cy: A.calcLanddev.DEFAULTS.earthwork_unit_cost_per_cy,
        detention_unit_cost_per_cf: A.calcStormwater.DEFAULTS.detention_unit_cost_per_cf,
        floor_load_kpa: A.calcGeotech.DEFAULTS.floor_load_kpa,
        rezoning_weeks: A.calcEntitlements.DEFAULTS.rezoning_weeks,
        queue_wait_weeks: A.calcInterconnect.DEFAULTS.queue_wait_weeks,
      },
      A.calcSitescore.DEFAULTS
    ),
    compute: (kw) => A.calcSitescore.sitescore(kw),
    hero: "overall_site_score",
    heroLabel: "overall weighted site-suitability score (0-100)", heroSrc: "legend",
    fields: [
      { key: "it_mw", label: "critical IT (scales all five domains via calc_land / calc_power)", src: "legend", step: 0.5, min: 0.1 },
      { key: "weight_earthwork", label: "weight — earthwork cost", src: "legend", step: 0.05, min: 0 },
      { key: "weight_stormwater", label: "weight — stormwater cost", src: "legend", step: 0.05, min: 0 },
      { key: "weight_geotech", label: "weight — geotechnical margin", src: "legend", step: 0.05, min: 0 },
      { key: "weight_entitlement", label: "weight — entitlement timeline", src: "legend", step: 0.05, min: 0 },
      { key: "weight_interconnect", label: "weight — interconnection timeline", src: "legend", step: 0.05, min: 0 },
      { key: "earthwork_unit_cost_per_cy", label: "earthwork unit cost ($/cy, drives earthwork domain)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "detention_unit_cost_per_cf", label: "detention unit cost ($/cf, drives stormwater domain)", src: "legend", step: 0.5, min: 0, advanced: true },
      { key: "floor_load_kpa", label: "floor load (kPa, drives geotechnical domain)", src: "legend", step: 5, min: 0.1, advanced: true },
      { key: "rezoning_weeks", label: "rezoning (weeks, drives entitlement domain)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "queue_wait_weeks", label: "queue-position wait (weeks, drives interconnection domain)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "earthwork_best_m_per_acre", label: "earthwork value-fn best ($M/acre → 100)", src: "legend", step: 0.05, min: 0, advanced: true },
      { key: "earthwork_worst_m_per_acre", label: "earthwork value-fn worst ($M/acre → 0)", src: "legend", step: 0.05, min: 0, advanced: true },
      { key: "stormwater_best_m_per_acre", label: "stormwater value-fn best ($M/acre → 100)", src: "legend", step: 0.05, min: 0, advanced: true },
      { key: "stormwater_worst_m_per_acre", label: "stormwater value-fn worst ($M/acre → 0)", src: "legend", step: 0.05, min: 0, advanced: true },
      { key: "entitlement_best_weeks", label: "entitlement value-fn best (weeks → 100)", src: "legend", step: 2, min: 0, advanced: true },
      { key: "entitlement_worst_weeks", label: "entitlement value-fn worst (weeks → 0)", src: "legend", step: 2, min: 0, advanced: true },
      { key: "interconnect_best_weeks", label: "interconnection value-fn best (weeks → 100)", src: "legend", step: 2, min: 0, advanced: true },
      { key: "interconnect_worst_weeks", label: "interconnection value-fn worst (weeks → 0)", src: "legend", step: 2, min: 0, advanced: true },
    ],
    derive: (r) => {
      const o = r.outputs;
      return [
        "site acres = calc_land parcel base = " + d(o.site_acres.value) +
          " acres (the per-acre denominator for the two cost sub-scores, composed live)",
        "earthwork cost intensity = calc_landdev earthwork cost ÷ site acres = " +
          d(o.earthwork_cost_intensity_m_per_acre.value) + " $M/acre → value score " +
          d(o.earthwork_score.value) + "/100",
        "stormwater cost intensity = calc_stormwater detention cost ÷ site acres = " +
          d(o.stormwater_cost_intensity_m_per_acre.value) + " $M/acre → value score " +
          d(o.stormwater_score.value) + "/100",
        "foundation hazard ratio = calc_geotech bearing margin ÷ building footprint = " +
          d(o.foundation_hazard_ratio.value) + " → value score " + d(o.geotech_score.value) + "/100",
        "entitlement timeline = calc_entitlements total = " + d(o.entitlement_weeks.value) +
          " weeks → value score " + d(o.entitlement_score.value) + "/100",
        "interconnection timeline = calc_interconnect total = " + d(o.interconnect_weeks.value) +
          " weeks → value score " + d(o.interconnect_score.value) + "/100",
        "overall = Σ(weightᵢ × sub-scoreᵢ) ÷ Σ(weights) = " + d(o.overall_site_score.value) +
          "/100 → " + o.suitability_band.value + " band",
      ];
    },
    // the VISUAL: a weighted-overlay roll-up table — each of the five domain sub-scores,
    // its planning weight, and its normalised contribution (weight ÷ Σweights × sub-score);
    // the contributions sum to the overall score (highlighted), with the suitability band
    // called out beneath.
    after: (r) => {
      const host = document.getElementById("sitescore-bridge");
      if (!host) return;
      const o = r.outputs, i = r.inputs;
      const wE = i.weight_earthwork.value, wS = i.weight_stormwater.value,
        wG = i.weight_geotech.value, wEn = i.weight_entitlement.value, wIc = i.weight_interconnect.value;
      const wSum = wE + wS + wG + wEn + wIc;
      const contrib = (w, s) => (wSum > 0 ? (w / wSum) * s : 0);
      const rows = [
        ["Earthwork cost suitability", d(o.earthwork_score.value), d(wE), d(contrib(wE, o.earthwork_score.value)), false],
        ["Stormwater cost suitability", d(o.stormwater_score.value), d(wS), d(contrib(wS, o.stormwater_score.value)), false],
        ["Geotechnical margin suitability", d(o.geotech_score.value), d(wG), d(contrib(wG, o.geotech_score.value)), false],
        ["Entitlement timeline suitability", d(o.entitlement_score.value), d(wEn), d(contrib(wEn, o.entitlement_score.value)), false],
        ["Interconnection timeline suitability", d(o.interconnect_score.value), d(wIc), d(contrib(wIc, o.interconnect_score.value)), false],
        ["= Overall weighted site score (Σ contributions)", d(o.overall_site_score.value), d(wSum), d(o.overall_site_score.value), true],
      ];

      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "Weighted-overlay roll-up — each domain sub-score (0-100) under its planning weight, the normalised contribution (weight ÷ Σweights × sub-score) summed to the overall site score [D]";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const h of ["domain", "sub-score", "weight", "contribution"]) {
        const th = document.createElement("th");
        th.textContent = h;
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const [label, score, weight, ctb, isNet] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
        const tds = document.createElement("td");
        tds.className = "num";
        tds.textContent = score;
        const tdw = document.createElement("td");
        tdw.className = "num";
        tdw.textContent = weight;
        const tdc = document.createElement("td");
        tdc.className = "num" + (isNet ? " sens-base" : "");
        tdc.textContent = ctb;
        tr.append(tds, tdw, tdc);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);

      // suitability-band callout under the roll-up
      const note = document.createElement("p");
      note.className = "preset-note";
      note.textContent =
        "Suitability band: the overall " + d(o.overall_site_score.value) + "/100 lands in the " +
        o.suitability_band.value + " band (prime ≥ 80, developable ≥ 60, constrained ≥ 40, else " +
        "unsuitable). The score is a weighted-overlay comparator across the five site domains at the " +
        "same scenario — a planning band, not a site-selection decision of record.";

      host.replaceChildren(tbl, note);
    },
  });

  A.boot();
})();
