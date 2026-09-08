// Geotechnical foundations — bearing-capacity sub-domain. PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_geotech.py — geotech() ported 1:1 (same names, inputs,
// outputs, output key order, notes). BUILDING PAD composes over the land core
// (A.calcLand.footprint(...).building_m2 for the same scenario — the loaded structure).
// METHOD: Terzaghi/Meyerhof q_ult = c*Nc + q*Nq + 0.5*gamma*B*Ngamma (q = gamma*Df),
// q_allow = q_ult/FS. The load-bearing THREE-TERM identity and the signed area band:
//   bearing_capacity_ult_kpa  = cohesion*Nc + (gamma*Df)*Nq + 0.5*gamma*width*Ngamma
//   foundation_area_margin_m2 = building_footprint_m2 - required_bearing_area_m2
// (a signed area: + = spread footings fit the pad, <= 0 = a raft/mat / ground improvement).
// The N-factors are inputs (no exp/tan), so a run byte-matches the python core to the ULP.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    cohesion_kpa: q(10.0, "kPa", "[A]",
                    "soil effective cohesion c for the bearing equation — a c-phi " +
                    "silty/clayey sand planning value (band ~5-25 kPa; clean sands ~0, " +
                    "stiff clays higher); set from your geotechnical report"),
    friction_bearing_factor_nc: q(30.14, "-", "[S]",
                                  "Meyerhof bearing-capacity factor Nc for the design " +
                                  "friction angle (tabulated; 30.14 at phi = 30 deg, " +
                                  "5.14 at phi = 0) — Terzaghi/Meyerhof standard tables"),
    friction_bearing_factor_nq: q(18.40, "-", "[S]",
                                  "Meyerhof bearing-capacity factor Nq for the design " +
                                  "friction angle (tabulated; 18.40 at phi = 30 deg, " +
                                  "1.0 at phi = 0) — Terzaghi/Meyerhof standard tables"),
    friction_bearing_factor_ngamma: q(15.67, "-", "[S]",
                                      "Meyerhof bearing-capacity factor N_gamma for the " +
                                      "design friction angle (tabulated; 15.67 at phi = " +
                                      "30 deg, 0 at phi = 0) — Terzaghi/Meyerhof tables"),
    unit_weight_kn_m3: q(18.0, "kN/m3", "[S]",
                         "moist soil unit weight gamma — sets both the overburden " +
                         "surcharge (gamma*Df) and the self-weight term; standard " +
                         "band ~16-20 kN/m3 for compacted granular fill"),
    foundation_width_m: q(3.0, "m", "[A]",
                          "representative foundation width B for the self-weight term " +
                          "(0.5*gamma*B*N_gamma) — a spread-footing / mat strip planning " +
                          "width; band ~1.5-4 m for datacenter equipment pads"),
    foundation_depth_m: q(1.5, "m", "[A]",
                          "founding depth Df below finished grade — sets the effective " +
                          "overburden surcharge q = gamma*Df; planning assumption " +
                          "(frost / bearing-stratum depth, band ~1-3 m)"),
    factor_of_safety: q(3.0, "-", "[S]",
                        "global factor of safety on ultimate bearing capacity — standard " +
                        "3.0 for shallow foundations under static load (band 2.5-3.0, " +
                        "ASCE / foundation-engineering practice)"),
    floor_load_kpa: q(20.0, "kPa", "[A]",
                      "uniform structural floor load the building pad delivers to the " +
                      "soil (dead + live: slab, racks, mechanical, roof) — a heavy " +
                      "datacenter planning band ~15-25 kPa; set from your structural loads"),
    footing_thickness_m: q(0.6, "m", "[A]",
                           "equivalent footing / mat slab thickness used to convert the " +
                           "required bearing area to a concrete volume — planning " +
                           "assumption (band ~0.4-1.0 m)"),
    concrete_unit_cost_per_m3: q(180.0, "US$/m3", "[S]",
                                 "placed structural foundation concrete (supply + " +
                                 "formwork + reinforcement + placement) per m3 — planning " +
                                 "band ~$150-250/m3 (RSMeans-class 03 30 00 cast-in-place " +
                                 "concrete; deep foundations run far higher)"),
  };

  function geotech(kw) {
    kw = kw || {};
    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    // BUILDING PAD composes over the land core (do NOT hardcode footprint area) — call
    // calc_land and read the building_m2 pad (the loaded structure) for the scenario.
    const land = globalThis.AIDC.calcLand.footprint(itGiven ? { it_mw: kw.it_mw } : {});
    const buildingFootprintM2 = land.outputs.building_m2.value;

    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    const lay = {
      cohesion_kpa: kw.cohesion_kpa,
      friction_bearing_factor_nc: kw.friction_bearing_factor_nc,
      friction_bearing_factor_nq: kw.friction_bearing_factor_nq,
      friction_bearing_factor_ngamma: kw.friction_bearing_factor_ngamma,
      unit_weight_kn_m3: kw.unit_weight_kn_m3,
      foundation_width_m: kw.foundation_width_m,
      foundation_depth_m: kw.foundation_depth_m,
      factor_of_safety: kw.factor_of_safety,
      floor_load_kpa: kw.floor_load_kpa,
      footing_thickness_m: kw.footing_thickness_m,
      concrete_unit_cost_per_m3: kw.concrete_unit_cost_per_m3,
    };
    for (const k of Object.keys(lay)) if (lay[k] !== null && lay[k] !== undefined) p[k] = lay[k];

    const cohesion = Number(p.cohesion_kpa);
    const nC = Number(p.friction_bearing_factor_nc);
    const nQ = Number(p.friction_bearing_factor_nq);
    const nGamma = Number(p.friction_bearing_factor_ngamma);
    const gamma = Number(p.unit_weight_kn_m3);
    const width = Number(p.foundation_width_m);
    const depth = Number(p.foundation_depth_m);
    const fs = Number(p.factor_of_safety);
    const floorLoad = Number(p.floor_load_kpa);
    const thickness = Number(p.footing_thickness_m);
    const unitCost = Number(p.concrete_unit_cost_per_m3);
    if (cohesion < 0.0) throw new Error("cohesion_kpa must be >= 0");
    if (nC <= 0.0) throw new Error("friction_bearing_factor_nc must be > 0");
    if (nQ <= 0.0) throw new Error("friction_bearing_factor_nq must be > 0");
    if (nGamma < 0.0) throw new Error("friction_bearing_factor_ngamma must be >= 0");
    if (gamma <= 0.0) throw new Error("unit_weight_kn_m3 must be > 0");
    if (width <= 0.0) throw new Error("foundation_width_m must be > 0");
    if (depth < 0.0) throw new Error("foundation_depth_m must be >= 0");
    if (fs <= 0.0) throw new Error("factor_of_safety must be > 0");
    if (floorLoad < 0.0) throw new Error("floor_load_kpa must be >= 0");
    if (thickness <= 0.0) throw new Error("footing_thickness_m must be > 0");
    if (unitCost < 0.0) throw new Error("concrete_unit_cost_per_m3 must be >= 0");

    // ---- effective overburden surcharge at the founding depth (q = gamma * Df) ------
    const overburdenSurchargeKpa = gamma * depth;

    // ---- the load-bearing three-term bearing-capacity identity (Terzaghi/Meyerhof) --
    //   q_ult = cohesion term + surcharge term + self-weight term; each term is an
    //   independent summand, so dropping or mis-weighting one moves the golden q_ult pin
    const termCohesion = cohesion * nC;
    const termSurcharge = overburdenSurchargeKpa * nQ;
    const termSelfWeight = 0.5 * gamma * width * nGamma;
    const bearingCapacityUltKpa = termCohesion + termSurcharge + termSelfWeight;

    // ---- allowable bearing: ultimate reduced by the factor of safety ----------------
    const bearingCapacityAllowKpa = bearingCapacityUltKpa / fs;

    // ---- foundation quantities: load -> required area -> concrete volume -> cost -----
    //   the pad's uniform floor load gives the structural load; spread at the allowable
    //   pressure it needs required_bearing_area_m2; the signed margin against the
    //   footprint flags spread-footing (fits) vs soft-ground mat/improvement (exceeds)
    const totalStructuralLoadKn = buildingFootprintM2 * floorLoad;
    const requiredBearingAreaM2 = totalStructuralLoadKn / bearingCapacityAllowKpa;
    const foundationAreaMarginM2 = buildingFootprintM2 - requiredBearingAreaM2;
    const foundationConcreteM3 = requiredBearingAreaM2 * thickness;
    const foundationCostM = foundationConcreteM3 * unitCost / 1.0e6;

    const out = {
      building_footprint_m2: q(buildingFootprintM2, "m2", "[D]",
                               "calc_land building_m2 — the loaded building pad (hall + " +
                               "mech gallery + elec/battery + NOC) that bears on the " +
                               "soil, composed live over the land core (the [D] " +
                               "reference building-pad ratio at the [A] project scale)"),
      overburden_surcharge_kpa: q(overburdenSurchargeKpa, "kPa", "[D]",
                                  "unit_weight_kn_m3 x foundation_depth_m (gamma*Df) — " +
                                  "the effective overburden surcharge at the founding " +
                                  "depth; rests on [S] gamma and the [A] founding depth"),
      bearing_capacity_ult_kpa: q(bearingCapacityUltKpa, "kPa", "[D]",
                                  "Terzaghi/Meyerhof q_ult = c*Nc + (gamma*Df)*Nq + " +
                                  "0.5*gamma*B*N_gamma — the three-term ultimate bearing " +
                                  "capacity; rests on [A] c/B/Df and the [S] N-factors"),
      bearing_capacity_allow_kpa: q(bearingCapacityAllowKpa, "kPa", "[D]",
                                    "bearing_capacity_ult_kpa / factor_of_safety — the " +
                                    "allowable bearing pressure; rests on the [S] " +
                                    "factor of safety"),
      total_structural_load_kn: q(totalStructuralLoadKn, "kN", "[D]",
                                  "building_footprint_m2 x floor_load_kpa (kPa*m2 = kN) — " +
                                  "the structural load the pad delivers; composed live " +
                                  "over the land core, rests on the [A] floor load"),
      required_bearing_area_m2: q(requiredBearingAreaM2, "m2", "[D]",
                                  "total_structural_load_kn / bearing_capacity_allow_kpa " +
                                  "(kN/kPa = m2) — the foundation bearing area the load " +
                                  "needs at the allowable pressure; composed over the pad, " +
                                  "rests on the [S] factor of safety and the [A] floor load"),
      foundation_area_margin_m2: q(foundationAreaMarginM2, "m2", "[D]",
                                   "building_footprint_m2 - required_bearing_area_m2 " +
                                   "(+ = spread footings fit inside the pad, <= 0 = the " +
                                   "required area EXCEEDS the pad -> a raft/mat or ground " +
                                   "improvement) — signed, rests on the composed footprint " +
                                   "and the [A] floor load over the [S]/[A] soil strength"),
      foundation_concrete_m3: q(foundationConcreteM3, "m3", "[D]",
                                "required_bearing_area_m2 x footing_thickness_m — the " +
                                "foundation concrete volume at the [A] footing thickness"),
      foundation_cost_m: q(foundationCostM, "US$M", "[D]",
                           "foundation_concrete_m3 x unit cost / 1e6 — [S] placed " +
                           "structural concrete 180 $/m3 (RSMeans-class 03 30 00)"),
    };

    const notes = [
      "METHOD — BEARING CAPACITY is the Terzaghi (1943) general equation with Meyerhof " +
      "(1963) factors, the three-term superposition q_ult = c*Nc + q*Nq + 0.5*gamma*B*" +
      "N_gamma with q = gamma*Df the overburden surcharge. The bearing-capacity factors " +
      "(Nc, Nq, N_gamma) are TABULATED for the design friction angle (defaults are the " +
      "Meyerhof values at phi = 30 deg) and taken as inputs, so the engine is pure " +
      "arithmetic. ALLOWABLE bearing is q_ult / FS; the required foundation bearing area " +
      "is the pad's structural load spread at the allowable pressure.",
      "SIGN CONVENTION — bearing_capacity_ult_kpa = c*Nc + (gamma*Df)*Nq + 0.5*gamma*B*" +
      "N_gamma is a SUM of three independent terms; drop or mis-weight one (e.g. omit the " +
      "surcharge term, or halve/double the self-weight term) and the golden q_ult pin and " +
      "the per-term identity rows both fail. foundation_area_margin_m2 = " +
      "building_footprint_m2 - required_bearing_area_m2 is SIGNED: competent ground keeps " +
      "the required area inside the pad (positive — spread footings), while soft ground " +
      "drops the allowable bearing below the pad's contact pressure so the required area " +
      "EXCEEDS the pad (NON-POSITIVE — a mat / ground improvement), reported as a band.",
      "BUILDING PAD composes over the land core: the loaded footprint is " +
      "calc_land.footprint(...) building_m2 for the same scenario (the hall + mech + " +
      "elec/battery + NOC pad), so a change in the site scale flows straight into the " +
      "structural load, the required bearing area, the concrete volume and the cost — " +
      "nothing about the footprint is hardcoded here.",
      "PROVENANCE — [S] bearing-capacity factors Nc 30.14 / Nq 18.40 / N_gamma 15.67 " +
      "(Meyerhof at phi = 30 deg, standard tables), [S] unit weight 18 kN/m3, [S] factor " +
      "of safety 3.0, [S] concrete 180 $/m3 (RSMeans-class 03 30 00). [A] cohesion 10 kPa, " +
      "[A] foundation width 3.0 m, [A] founding depth 1.5 m, [A] floor load 20 kPa, [A] " +
      "footing thickness 0.6 m — planning assumptions, override from your geotechnical " +
      "report and structural loads. Outputs are [D] derived; every output names its " +
      "[S]/[A] basis in its source.",
      "DETERMINISTIC: pure geotechnical + geometric + money arithmetic — no wall clock, no " +
      "randomness — so a double run is byte-identical and the JS port matches to the cubic " +
      "metre. The N-factors are inputs (no exp/tan), so python and JS agree to the ULP.",
      "Scope: a single-snapshot planning ROM, not a geotechnical design. One general " +
      "bearing-capacity equation with tabulated N-factors at ONE assumed design phi (no " +
      "phi sweep, no layered profile), the SETTLEMENT check omitted (bearing assumed to " +
      "govern — no consolidation/elastic settlement), the load taken as a uniform floor " +
      "pressure (no column reaction schedule), the foundation reduced to an equivalent " +
      "bearing area at one footing thickness (no footing schedule). No groundwater/" +
      "buoyancy, eccentric/inclined load, shape/depth factors, pile / deep foundations, " +
      "or seismic bearing reduction.",
    ];

    const itMwEcho = itGiven ? Number(kw.it_mw) : globalThis.AIDC.calcLand.DEFAULTS.it_mw.value;
    const inputs = {
      it_mw: q(itMwEcho, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale — forwarded to calc_land for the building pad area"),
    };
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (lay[k] !== null && lay[k] !== undefined)
        ? q(lay[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "geotech — bearing capacity + shallow-foundation planning bands (Terzaghi / Meyerhof)",
      "building pad composed over calc_land.footprint (building_m2); Terzaghi/Meyerhof " +
      "q_ult = c*Nc + (gamma*Df)*Nq + 0.5*gamma*B*N_gamma; q_allow = q_ult/FS; foundation " +
      "area = load/q_allow (pure geotechnical + money math, no wall clock)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcGeotech = { DEFAULTS: DEFAULTS, geotech: geotech };
})();
