// Land / site-area estimator: IT MW -> developed area, parcel, acres. PURE.
// parity: cli/aidc/core/calc_land.py — footprint() ported 1:1 (same names,
// inputs, outputs, notes). Component land-use ratios are derived from the
// reference-design site plan (the same blocks the digital twin draws) at its
// 5.2 MW-IT scale; the closure check reproduces the reference parcel
// (8 acres at 5.2 MW-IT + 100% reserve, +0.9%). A PLANNING band, not a survey.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const ACRE_M2 = 4046.8564224;     // international acre, exact [S]
  const HA_M2 = 10000.0;
  const SQFT_PER_M2 = 10.763910417;  // [S] exact-basis conversion, 6 s.f.
  const REF_MW = 5.2;               // [D] reference-design site plan basis

  const DEFAULTS = {
    it_mw: q(1.0, "MW-IT", "[A]", "critical IT capacity — set to your project"),
    building_m2_per_mw: q(769.2, "m2/MW", "[D]",
                          "building pad 80 x 50 m = 4,000 m2 / 5.2 MW-IT reference " +
                          "(hall + mech gallery + elec/battery rooms + NOC, envelope " +
                          "629 m2, plus apron/logistics on the pad)"),
    substation_m2_per_mw: q(115.4, "m2/MW", "[D]",
                            "substation yard 30 x 20 m = 600 m2 / 5.2 MW-IT reference " +
                            "(MV yard; a 115 kV on-site sub for multi-hall growth needs " +
                            "its own bay — carry as a FEED item)"),
    genset_m2_per_mw: q(138.5, "m2/MW", "[D]",
                        "generator yard 24 x 30 m = 720 m2 / 5.2 MW-IT reference " +
                        "(N+1 gensets + fuel day tanks + noise setback to the fence)"),
    cooling_m2_per_mw: q(183.1, "m2/MW", "[D]",
                         "heat-rejection yard 28 x 34 m = 952 m2 / 5.2 MW-IT reference " +
                         "(dry coolers / adiabatic bank + trim chillers)"),
    water_m2_per_mw: q(43.3, "m2/MW", "[D]",
                       "water storage + treatment 15 x 15 m = 225 m2 / 5.2 MW-IT " +
                       "reference (makeup tanks, TES tie-in)"),
    parking_roads_m2_per_mw: q(384.6, "m2/MW", "[D]",
                               "parking 50 x 25 m = 1,250 m2 + internal roads ~750 m2 " +
                               "[A share] / 5.2 MW-IT reference"),
    circulation_setback_factor: q(1.9, "x", "[A]",
                                  "developed -> parcel multiplier: fire lanes, security " +
                                  "ring, stormwater detention, zoning setbacks, geometry " +
                                  "loss — band 1.5-2.5; 1.9 closes the reference parcel " +
                                  "(8 acres at 5.2 MW-IT + 100% reserve, +0.9%)"),
    expansion_reserve_frac: q(0.0, "frac", "[A]",
                              "land banked for future halls as a fraction of the phase-1 " +
                              "parcel (the reference parcel carries 1.0 — a full " +
                              "second-hall reserve)"),
    land_cost_m_per_acre: q(null, "US$M/acre", "[A]",
                            "optional — Northern-Virginia benchmark 1-2 $M/acre [S]; " +
                            "industrial-park leases elsewhere can be nominal. Set your " +
                            "market to price the land row"),
  };

  const COMPONENTS = [
    ["building", "building_m2_per_mw", "hall + mech gallery + elec/battery + NOC, on-pad"],
    ["substation", "substation_m2_per_mw", "MV yard + metering"],
    ["gensets", "genset_m2_per_mw", "generator yard + fuel + noise setback"],
    ["cooling", "cooling_m2_per_mw", "dry coolers / adiabatic bank + trim chillers"],
    ["water", "water_m2_per_mw", "makeup storage + treatment"],
    ["parking_roads", "parking_roads_m2_per_mw", "parking + internal roads"],
  ];

  function footprint(kw) {
    kw = kw || {};
    const p = {};
    for (const k in DEFAULTS) p[k] = DEFAULTS[k].value;
    for (const k in kw) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];

    const it = Number(p.it_mw);
    if (!(it > 0)) throw new Error("it_mw must be > 0");
    const factor = Number(p.circulation_setback_factor);
    const reserve = Number(p.expansion_reserve_frac);

    const comp = {};
    let developed = 0.0;
    for (const [name, key] of COMPONENTS) {
      comp[name] = it * Number(p[key]);
      developed += comp[name];
    }
    const parcel = developed * factor;
    const parcelRes = parcel * (1.0 + reserve);
    const acres = parcelRes / ACRE_M2;
    const cost = (p.land_cost_m_per_acre !== null && p.land_cost_m_per_acre !== undefined)
      ? acres * Number(p.land_cost_m_per_acre) : null;

    const out = {};
    for (const [name, key, desc] of COMPONENTS) {
      out[name + "_m2"] = q(comp[name], "m2", "[D]", "it_mw x " + key + " — " + desc);
    }
    out.developed_m2 = q(developed, "m2", "[D]",
                         "sum of the six component pads (the equipment actually placed)");
    out.parcel_m2 = q(parcel, "m2", "[D]",
                      "developed_m2 x circulation_setback_factor — the phase-1 buildable " +
                      "parcel incl. lanes, setbacks, stormwater");
    out.parcel_with_reserve_m2 = q(parcelRes, "m2", "[D]",
                                   "parcel_m2 x (1 + expansion_reserve_frac)");
    out.site_acres = q(acres, "acres", "[D]",
                       "parcel_with_reserve_m2 / 4,046.856 m2 per acre [S]");
    out.site_hectares = q(parcelRes / HA_M2, "ha", "[D]", "parcel_with_reserve_m2 / 10,000");
    out.building_sqft = q(comp.building * SQFT_PER_M2, "sqft", "[D]",
                          "building_m2 x 10.7639 — gross building square footage " +
                          "(US developer convention)");
    out.developed_sqft = q(developed * SQFT_PER_M2, "sqft", "[D]",
                           "developed_m2 x 10.7639 — all six pads in square feet");
    out.mw_it_per_acre = q(acres ? it / acres : null, "MW-IT/acre", "[D]",
                           "it_mw / site_acres — compare against your market's zoning");
    out.land_cost_m = q(cost, "US$M", cost !== null ? "[D]" : "[A]",
                        cost !== null ? "site_acres x land_cost_m_per_acre"
                                      : "not priced — set land_cost_m_per_acre (no generic " +
                                        "benchmark is defensible)");

    const notes = [
      "PLANNING model, not a survey: components scale linearly per MW-IT from the " +
      "reference-design site plan; real substations/parking amortise sub-linearly at " +
      "scale, and jurisdictional setbacks/stormwater rules move the factor — treat " +
      "site_acres as a band centred here (factor band 1.5-2.5 alone is -21%/+32%).",
      "Closure: at the 5.2 MW-IT reference with expansion_reserve_frac 1.0 this model " +
      "gives 7.98 acres vs the reference's 8-acre [A] parcel (+0.9%) — the parcel that " +
      "the digital twin and drawing set draw.",
      "Density cross-check: this single-story greenfield model lands ~1.0-1.7 MW-IT/acre " +
      "at ZERO reserve across the 1.5-2.5 factor band (~0.65 with a full second-hall " +
      "reserve — antagonist A-01: an earlier note quoted the reserve figure as the " +
      "zero-reserve band). Hyperscale multi-story campuses land an order of magnitude " +
      "denser — do not mix the classes.",
      "Excluded: utility ROW/interconnect corridor, off-site substation land, wetland/" +
      "buffer set-asides, and any phased masterplan beyond the single reserve fraction " +
      "— site-specific by nature (list them with your site's constraints).",
      "Land COST has no defensible generic default: Northern Virginia trades at $1-2M/" +
      "acre [S] while industrial-park leases elsewhere are nominal — the cost row prices " +
      "only when you set your market's figure.",
    ];

    const inputs = {};
    for (const k in DEFAULTS) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied") : DEFAULTS[k];
    }
    for (const k in inputs) if (inputs[k].value === null || inputs[k].value === undefined) delete inputs[k];

    return result(
      "land — IT capacity to developed area, parcel and acres",
      "component land-use ratios [D] from the reference-design site plan (digital-twin " +
      "site features at 5.2 MW-IT) · circulation/setback factor [A] band 1.5-2.5 · " +
      "Northern-Virginia land cost benchmark [S]",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcLand = { DEFAULTS: DEFAULTS, ACRE_M2: ACRE_M2, REF_MW: REF_MW,
                               COMPONENTS: COMPONENTS, footprint: footprint };
})();
