// Page config: land / site-area estimator (calc_land.js) + the parametric
// site-plan diagram (siteplan.js). Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  A.SECTIONS.push({
    id: "land",
    defaults: A.calcLand.DEFAULTS,
    compute: (kw) => A.calcLand.footprint(kw),
    hero: "site_acres", heroLabel: "site area (planning band)", heroSrc: "land-model",
    fields: [
      { key: "it_mw", label: "critical IT", src: "legend", step: 0.5, min: 0.1 },
      { key: "circulation_setback_factor", label: "circulation + setback factor (band 1.5–2.5)",
        src: "land-model", step: 0.1, min: 1 },
      { key: "expansion_reserve_frac", label: "expansion reserve (1.0 = second-hall land bank)",
        src: "land-model", step: 0.25, min: 0 },
      { key: "land_cost_m_per_acre", label: "land price $M/acre (optional)", src: "nova-land",
        step: 0.25, min: 0, placeholder: "not priced" },
      { key: "building_m2_per_mw", label: "building pad m²/MW", src: "land-model", step: 10, min: 0, advanced: true },
      { key: "substation_m2_per_mw", label: "substation yard m²/MW", src: "land-model", step: 5, min: 0, advanced: true },
      { key: "genset_m2_per_mw", label: "generator yard m²/MW", src: "land-model", step: 5, min: 0, advanced: true },
      { key: "cooling_m2_per_mw", label: "heat-rejection yard m²/MW", src: "land-model", step: 5, min: 0, advanced: true },
      { key: "water_m2_per_mw", label: "water storage m²/MW", src: "land-model", step: 5, min: 0, advanced: true },
      { key: "parking_roads_m2_per_mw", label: "parking + roads m²/MW", src: "land-model", step: 5, min: 0, advanced: true },
    ],
    derive: (r) => {
      const i = r.inputs, o = r.outputs;
      const lines = [
        "developed = (building " + d(o.building_m2.value) + " + substation " + d(o.substation_m2.value) +
          " + gensets " + d(o.gensets_m2.value) + " + heat-rejection " + d(o.cooling_m2.value) +
          " + water " + d(o.water_m2.value) + " + parking/roads " + d(o.parking_roads_m2.value) +
          ") = " + d(o.developed_m2.value) + " m² — six pads × " + d(i.it_mw.value) + " MW-IT",
        "parcel = developed × factor = " + d(o.developed_m2.value) + " × " +
          d(i.circulation_setback_factor.value) + " = " + d(o.parcel_m2.value) +
          " m² — lanes, security ring, stormwater, setbacks",
        "with reserve = parcel × (1 + " + d(i.expansion_reserve_frac.value) + ") = " +
          d(o.parcel_with_reserve_m2.value) + " m²",
        "acres = " + d(o.parcel_with_reserve_m2.value) + " ÷ 4,046.856 = " +
          d(o.site_acres.value) + " acres (" + d(o.site_hectares.value) + " ha) — " +
          d(o.mw_it_per_acre.value) + " MW-IT/acre",
      ];
      if (o.land_cost_m.value !== null && o.land_cost_m.value !== undefined) {
        lines.push("land cost = " + d(o.site_acres.value) + " acres × " +
          d(i.land_cost_m_per_acre.value) + " $M/acre = " + d(o.land_cost_m.value) + " US$M");
      }
      return lines;
    },
    after: (r) => {
      const host = document.getElementById("land-siteplan");
      if (host && A.siteplan) A.siteplan.render(host, r);
    },
  });

  A.boot();
})();
