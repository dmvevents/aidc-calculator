// Site suitability score — the land-development capstone roll-up. PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_sitescore.py — sitescore() ported 1:1 (same names, inputs,
// outputs, output key order, notes). The site-selection lens ON TOP of the whole land-dev
// layer: composes LIVE over the parcel base (A.calcLand.footprint site_acres) and all five
// land-dev domains — earthwork (A.calcLanddev), stormwater (A.calcStormwater), the
// geotechnical HAZARD (A.calcGeotech), the entitlement clock (A.calcEntitlements) and the
// grid-interconnection clock (A.calcInterconnect) — for the same scenario, and rolls the five
// burdens into a single 0-100 SUITABILITY SCORE + a planning tier. METHOD: Weighted Linear
// Combination (WLC), the standard weighted-overlay GIS-MCDA site-suitability model (Malczewski
// 1999) over linear value functions (Keeney & Raiffa 1976). The load-bearing weighted roll-up
// identity:
//   overall_site_score = ( sum_i weight_i * sub_score_i ) / ( sum_i weight_i )
// PARCEL + HAZARD BASIS: the two cost sub-scores are normalised PER ACRE of the parcel base
// (site_acres) and the geotech sub-score is the composed foundation-area margin over the
// building footprint — so the parcel base and the on-site bearing hazard are both load-bearing.
// Pure scoring arithmetic (no calendar dates), so a run byte-matches the python core.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    weight_earthwork: q(0.15, "weight", "[A]",
                        "criterion weight on the earthwork (grading cut/fill cost) sub-score " +
                        "in the weighted-overlay roll-up — an [A] planning priority; the " +
                        "weights are normalised by their sum (WLC), so only the RATIOS matter"),
    weight_stormwater: q(0.10, "weight", "[A]",
                         "criterion weight on the stormwater (detention cost) sub-score — an " +
                         "[A] planning priority (lowest weight: detention is usually the " +
                         "smallest development burden of the five)"),
    weight_geotech: q(0.20, "weight", "[A]",
                     "criterion weight on the geotechnical (foundation-area-margin HAZARD) " +
                     "sub-score — an [A] planning priority (soft ground can force a mat / " +
                     "ground improvement, a material cost + schedule risk)"),
    weight_entitlement: q(0.25, "weight", "[A]",
                         "criterion weight on the entitlement (land-use approval clock) " +
                         "sub-score — an [A] planning priority (the approval timeline is a " +
                         "top schedule risk for a greenfield site)"),
    weight_interconnect: q(0.30, "weight", "[A]",
                          "criterion weight on the grid-interconnection (queue / study clock) " +
                          "sub-score — the highest [A] planning priority (the interconnection " +
                          "queue is the dominant long pole for an AIDC site)"),
    earthwork_best_m_per_acre: q(0.0, "US$M/acre", "[A]",
                                 "best-case earthwork cost per acre that scores 100 — a " +
                                 "balanced, flat pad-on-grade site with negligible mass " +
                                 "grading (value-function best anchor)"),
    earthwork_worst_m_per_acre: q(0.20, "US$M/acre", "[A]",
                                  "worst-case earthwork cost per acre that scores 0 — a heavily " +
                                  "cut/filled site; planning band top (value-function worst " +
                                  "anchor). Must be > the best anchor"),
    stormwater_best_m_per_acre: q(0.0, "US$M/acre", "[A]",
                                  "best-case detention cost per acre that scores 100 — a site " +
                                  "needing negligible detention (value-function best anchor)"),
    stormwater_worst_m_per_acre: q(0.10, "US$M/acre", "[A]",
                                   "worst-case detention cost per acre that scores 0 — a site " +
                                   "needing heavy detention; planning band top (value-function " +
                                   "worst anchor). Must be > the best anchor"),
    entitlement_best_weeks: q(26.0, "weeks", "[A]",
                              "best-case end-to-end entitlement timeline that scores 100 — a " +
                              "by-right / fast-track jurisdiction (value-function best anchor)"),
    entitlement_worst_weeks: q(104.0, "weeks", "[A]",
                              "worst-case entitlement timeline that scores 0 — a slow " +
                              "discretionary + EIS jurisdiction (~2 years; value-function " +
                              "worst anchor). Must be > the best anchor"),
    interconnect_best_weeks: q(52.0, "weeks", "[A]",
                              "best-case end-to-end interconnection timeline that scores 100 — " +
                              "a short-queue utility (~1 year; value-function best anchor)"),
    interconnect_worst_weeks: q(156.0, "weeks", "[A]",
                               "worst-case interconnection timeline that scores 0 — a " +
                               "long-queue cluster study (~3 years; value-function worst " +
                               "anchor). Must be > the best anchor"),
  };

  const SCORE_MAX = 100.0;         // [S] MCDA sub-scores normalised to a 0-100 suitability scale
  const PRIME_BAND = 80.0;         // [A] overall >= this -> "prime" (planning band break)
  const DEVELOPABLE_BAND = 60.0;   // [A] overall >= this -> "developable"
  const CONSTRAINED_BAND = 40.0;   // [A] overall >= this -> "constrained" (else "unsuitable")

  function clamp01(x) {
    // Clamp a value to [0, 1] — the value-function saturation on the sub-scores.
    if (x < 0.0) return 0.0;
    if (x > 1.0) return 1.0;
    return x;
  }

  function sitescore(kw) {
    kw = kw || {};
    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    const ewucGiven = kw.earthwork_unit_cost_per_cy !== null && kw.earthwork_unit_cost_per_cy !== undefined;
    const ducfGiven = kw.detention_unit_cost_per_cf !== null && kw.detention_unit_cost_per_cf !== undefined;
    const floorGiven = kw.floor_load_kpa !== null && kw.floor_load_kpa !== undefined;
    const rezGiven = kw.rezoning_weeks !== null && kw.rezoning_weeks !== undefined;
    const queueGiven = kw.queue_wait_weeks !== null && kw.queue_wait_weeks !== undefined;

    // ---- compose LIVE over the parcel base + the five land-dev domains --------------
    //   the parcel base (calc_land) supplies the per-acre denominator for the two cost
    //   sub-scores; each domain supplies its own burden. Nothing is hardcoded here — every
    //   composed input is read from its module for the scenario it_mw / domain knob.
    const land = globalThis.AIDC.calcLand.footprint(itGiven ? { it_mw: kw.it_mw } : {});
    const siteAcres = land.outputs.site_acres.value;

    const ldev = globalThis.AIDC.calcLanddev.landdev(
      { it_mw: kw.it_mw, earthwork_unit_cost_per_cy: kw.earthwork_unit_cost_per_cy });
    const earthworkCostM = ldev.outputs.earthwork_cost_m.value;

    const storm = globalThis.AIDC.calcStormwater.stormwater(
      { it_mw: kw.it_mw, detention_unit_cost_per_cf: kw.detention_unit_cost_per_cf });
    const detentionCostM = storm.outputs.detention_cost_m.value;

    const geo = globalThis.AIDC.calcGeotech.geotech(
      { it_mw: kw.it_mw, floor_load_kpa: kw.floor_load_kpa });
    const foundationAreaMarginM2 = geo.outputs.foundation_area_margin_m2.value;
    const buildingFootprintM2 = geo.outputs.building_footprint_m2.value;

    const ent = globalThis.AIDC.calcEntitlements.entitlements(
      { it_mw: kw.it_mw, rezoning_weeks: kw.rezoning_weeks });
    const entitlementWeeks = ent.outputs.total_entitlement_weeks.value;

    const ic = globalThis.AIDC.calcInterconnect.interconnect(
      { it_mw: kw.it_mw, queue_wait_weeks: kw.queue_wait_weeks });
    const interconnectWeeks = ic.outputs.total_interconnect_weeks.value;

    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    const lay = {
      weight_earthwork: kw.weight_earthwork, weight_stormwater: kw.weight_stormwater,
      weight_geotech: kw.weight_geotech, weight_entitlement: kw.weight_entitlement,
      weight_interconnect: kw.weight_interconnect,
      earthwork_best_m_per_acre: kw.earthwork_best_m_per_acre,
      earthwork_worst_m_per_acre: kw.earthwork_worst_m_per_acre,
      stormwater_best_m_per_acre: kw.stormwater_best_m_per_acre,
      stormwater_worst_m_per_acre: kw.stormwater_worst_m_per_acre,
      entitlement_best_weeks: kw.entitlement_best_weeks,
      entitlement_worst_weeks: kw.entitlement_worst_weeks,
      interconnect_best_weeks: kw.interconnect_best_weeks,
      interconnect_worst_weeks: kw.interconnect_worst_weeks,
    };
    for (const k of Object.keys(lay)) if (lay[k] !== null && lay[k] !== undefined) p[k] = lay[k];

    const wEarth = Number(p.weight_earthwork);
    const wStorm = Number(p.weight_stormwater);
    const wGeo = Number(p.weight_geotech);
    const wEnt = Number(p.weight_entitlement);
    const wIc = Number(p.weight_interconnect);
    const ewBest = Number(p.earthwork_best_m_per_acre);
    const ewWorst = Number(p.earthwork_worst_m_per_acre);
    const swBest = Number(p.stormwater_best_m_per_acre);
    const swWorst = Number(p.stormwater_worst_m_per_acre);
    const entBest = Number(p.entitlement_best_weeks);
    const entWorst = Number(p.entitlement_worst_weeks);
    const icBest = Number(p.interconnect_best_weeks);
    const icWorst = Number(p.interconnect_worst_weeks);
    if (wEarth < 0.0) throw new Error("weight_earthwork must be >= 0");
    if (wStorm < 0.0) throw new Error("weight_stormwater must be >= 0");
    if (wGeo < 0.0) throw new Error("weight_geotech must be >= 0");
    if (wEnt < 0.0) throw new Error("weight_entitlement must be >= 0");
    if (wIc < 0.0) throw new Error("weight_interconnect must be >= 0");
    if (ewWorst <= ewBest) throw new Error("earthwork_worst_m_per_acre must be > earthwork_best_m_per_acre");
    if (swWorst <= swBest) throw new Error("stormwater_worst_m_per_acre must be > stormwater_best_m_per_acre");
    if (entWorst <= entBest) throw new Error("entitlement_worst_weeks must be > entitlement_best_weeks");
    if (icWorst <= icBest) throw new Error("interconnect_worst_weeks must be > interconnect_best_weeks");

    const weightSum = wEarth + wStorm + wGeo + wEnt + wIc;
    if (weightSum <= 0.0) throw new Error("site-suitability weights must sum to > 0");

    // ---- burden reads: two costs PER ACRE of the parcel base, the geotech HAZARD ratio,
    //      and the two composed timelines (the parcel + hazard basis of the score) --------
    const earthworkCostIntensity = earthworkCostM / siteAcres;
    const stormwaterCostIntensity = detentionCostM / siteAcres;
    const foundationHazardRatio = foundationAreaMarginM2 / buildingFootprintM2;

    // ---- value functions: each burden -> a 0-100 sub-score (linear, clamped) ----------
    //   lower cost / shorter clock / larger bearing margin -> higher suitability.
    const earthworkScore = SCORE_MAX * clamp01((ewWorst - earthworkCostIntensity) / (ewWorst - ewBest));
    const stormwaterScore = SCORE_MAX * clamp01((swWorst - stormwaterCostIntensity) / (swWorst - swBest));
    const geotechScore = SCORE_MAX * clamp01(foundationHazardRatio);
    const entitlementScore = SCORE_MAX * clamp01((entWorst - entitlementWeeks) / (entWorst - entBest));
    const interconnectScore = SCORE_MAX * clamp01((icWorst - interconnectWeeks) / (icWorst - icBest));

    // ---- the load-bearing weighted-overlay roll-up (WLC, weight-normalised) -----------
    //   overall = sum(weight_i * sub_score_i) / sum(weights). Drop/zero any sub-score or
    //   weight and the golden overall pin moves; the weights are distinguishable so no two
    //   sub-scores are interchangeable.
    const overallSiteScore = (wEarth * earthworkScore + wStorm * stormwaterScore
                              + wGeo * geotechScore + wEnt * entitlementScore
                              + wIc * interconnectScore) / weightSum;

    // ---- suitability band: a three-break planning-tier classification -----------------
    let suitabilityBand;
    if (overallSiteScore >= PRIME_BAND) suitabilityBand = "prime";
    else if (overallSiteScore >= DEVELOPABLE_BAND) suitabilityBand = "developable";
    else if (overallSiteScore >= CONSTRAINED_BAND) suitabilityBand = "constrained";
    else suitabilityBand = "unsuitable";

    const out = {
      site_acres: q(siteAcres, "acres", "[D]",
                    "calc_land site_acres — the buildable parcel base, composed live over " +
                    "the land core; the per-acre denominator for the two cost sub-scores " +
                    "(the PARCEL basis of the score)"),
      earthwork_cost_intensity_m_per_acre: q(earthworkCostIntensity, "US$M/acre", "[D]",
                                             "calc_landdev earthwork_cost_m / site_acres — " +
                                             "the grading cost per acre; composed live over " +
                                             "calc_landdev and the parcel base (scale-" +
                                             "invariant, a site-quality read)"),
      stormwater_cost_intensity_m_per_acre: q(stormwaterCostIntensity, "US$M/acre", "[D]",
                                              "calc_stormwater detention_cost_m / site_acres " +
                                              "— the detention cost per acre; composed live " +
                                              "over calc_stormwater and the parcel base"),
      foundation_hazard_ratio: q(foundationHazardRatio, "ratio", "[D]",
                                 "calc_geotech foundation_area_margin_m2 / " +
                                 "building_footprint_m2 — the bearing-area margin over the " +
                                 "pad (the geotechnical HAZARD basis: 1 = the whole pad is " +
                                 "spare bearing margin, <= 0 = a soft-ground mat / ground " +
                                 "improvement), composed live over calc_geotech"),
      entitlement_weeks: q(entitlementWeeks, "weeks", "[D]",
                           "calc_entitlements total_entitlement_weeks — the end-to-end " +
                           "land-use approval critical path, composed live over " +
                           "calc_entitlements"),
      interconnect_weeks: q(interconnectWeeks, "weeks", "[D]",
                            "calc_interconnect total_interconnect_weeks — the end-to-end " +
                            "grid-interconnection critical path, composed live over " +
                            "calc_interconnect"),
      earthwork_score: q(earthworkScore, "score", "[D]",
                         "100 x clamp01((worst - earthwork_cost_intensity) / (worst - best)) " +
                         "— the earthwork value-function sub-score over the [A] cost-per-acre " +
                         "anchors (lower cost -> higher score)"),
      stormwater_score: q(stormwaterScore, "score", "[D]",
                          "100 x clamp01((worst - stormwater_cost_intensity) / (worst - best)) " +
                          "— the stormwater value-function sub-score over the [A] " +
                          "cost-per-acre anchors"),
      geotech_score: q(geotechScore, "score", "[D]",
                       "100 x clamp01(foundation_hazard_ratio) — the geotechnical sub-score, " +
                       "the composed bearing-area margin ratio scaled to 100 (self-" +
                       "normalised: a positive margin scores high, a soft-ground deficit low)"),
      entitlement_score: q(entitlementScore, "score", "[D]",
                           "100 x clamp01((worst - entitlement_weeks) / (worst - best)) — the " +
                           "entitlement value-function sub-score over the [A] timeline anchors " +
                           "(shorter clock -> higher score)"),
      interconnect_score: q(interconnectScore, "score", "[D]",
                            "100 x clamp01((worst - interconnect_weeks) / (worst - best)) — " +
                            "the interconnection value-function sub-score over the [A] " +
                            "timeline anchors"),
      overall_site_score: q(overallSiteScore, "score", "[D]",
                            "sum(weight_i x sub_score_i) / sum(weights) — the weighted-overlay " +
                            "(WLC) site-suitability score composed live over the parcel base " +
                            "and all five land-dev domains; the load-bearing roll-up identity, " +
                            "rests on the [A] criterion weights over the [D] composed " +
                            "sub-scores"),
      suitability_band: q(suitabilityBand, "band", "[D]",
                          "overall_site_score classified: prime >= 80, developable >= 60, " +
                          "constrained >= 40, else unsuitable — an [A] ordinal planning tier, " +
                          "not a go/no-go verdict"),
    };

    const notes = [
      "METHOD — Weighted Linear Combination (WLC), the standard weighted-overlay site-" +
      "suitability model in GIS-based Multi-Criteria Decision Analysis (Malczewski 1999, 'GIS " +
      "and Multicriteria Decision Analysis'). Each of the five criteria is normalised to a " +
      "0-100 sub-score by a linear value function (multi-attribute value theory, Keeney & " +
      "Raiffa 1976) anchored best -> 100 / worst -> 0 and clamped, then combined by criterion " +
      "weight and normalised by the weight sum so the overall stays on the 0-100 scale.",
      "SIGN CONVENTION — overall_site_score = sum(weight_i x sub_score_i) / sum(weights), a " +
      "weight-normalised SUM of the five sub-scores. Each sub-score composes LIVE over its " +
      "domain (earthwork/stormwater cost per acre of the parcel base, the geotech bearing-area " +
      "margin, the entitlement and interconnection clocks), so a change in ANY domain burden " +
      "moves its sub-score and — through its weight — the overall with the correct signed " +
      "delta. Drop or zero any sub-score or weight, or hardcode any composed input (the parcel " +
      "acres, a domain cost, the geotech margin, a timeline), and the varying-scenario golden " +
      "row fails while the decoupled default row still passes. The weights are DISTINGUISHABLE " +
      "(0.15 / 0.10 / 0.20 / 0.25 / 0.30) so no two sub-scores are interchangeable.",
      "PARCEL + HAZARD BASIS — the two cost sub-scores are normalised PER ACRE of the parcel " +
      "base (calc_land site_acres), so the parcel geometry is load-bearing (hardcode the acres " +
      "and the it_mw-swept row fails: the live domain cost scales with the parcel but the " +
      "pinned denominator does not). The geotech sub-score is the composed foundation-area " +
      "margin over the building footprint (calc_geotech), the on-site bearing HAZARD — both the " +
      "parcel base and the hazard feed the overall score.",
      "COMPOSITION — the score reads six modules live for the same scenario: calc_land (the " +
      "parcel base / per-acre denominator), calc_landdev (earthwork cost), calc_stormwater " +
      "(detention cost), calc_geotech (the bearing-area-margin hazard), calc_entitlements (the " +
      "approval clock) and calc_interconnect (the interconnection clock). The five domain knobs " +
      "(earthwork_unit_cost_per_cy, detention_unit_cost_per_cf, floor_load_kpa, rezoning_weeks, " +
      "queue_wait_weeks) forward to their domains so each burden is exercisable independently; " +
      "it_mw forwards to the parcel base and all five domains.",
      "PROVENANCE — [A] criterion weights (earthwork 0.15, stormwater 0.10, geotech 0.20, " +
      "entitlement 0.25, interconnect 0.30 — set from your own AHP / direct-rating weighting), " +
      "[A] value-function anchors (earthwork 0-0.20 $M/acre, stormwater 0-0.10 $M/acre, " +
      "entitlement 26-104 weeks, interconnect 52-156 weeks — set to your market). The composed " +
      "burdens are [D] over the domain modules; every output names its [S]/[A] basis in its " +
      "source.",
      "DETERMINISTIC: pure scoring arithmetic over the composed domain outputs and the weight / " +
      "anchor assumptions — no wall clock, no calendar dates, no randomness — so a double run is " +
      "byte-identical and the JS port matches to the point.",
      "Scope: a single-snapshot planning ROM, not a site-selection decision. The overall is an " +
      "ORDINAL suitability index for comparing parcels on a consistent basis, NOT a cardinal " +
      "probability, a cost, or a permit verdict. Five criteria only (no utility-capacity, " +
      "fiber, water-supply, environmental-justice or market criteria) and a linear additive " +
      "model (no criterion interactions, veto / constraint masks or risk weighting). The band " +
      "breaks (prime / developable / constrained / unsuitable) are [A] planning conventions, " +
      "not a regulatory classification.",
    ];

    const itMwEcho = itGiven ? Number(kw.it_mw) : globalThis.AIDC.calcLand.DEFAULTS.it_mw.value;
    const ewucEcho = ewucGiven ? Number(kw.earthwork_unit_cost_per_cy)
                               : globalThis.AIDC.calcLanddev.DEFAULTS.earthwork_unit_cost_per_cy.value;
    const ducfEcho = ducfGiven ? Number(kw.detention_unit_cost_per_cf)
                               : globalThis.AIDC.calcStormwater.DEFAULTS.detention_unit_cost_per_cf.value;
    const floorEcho = floorGiven ? Number(kw.floor_load_kpa)
                                 : globalThis.AIDC.calcGeotech.DEFAULTS.floor_load_kpa.value;
    const rezEcho = rezGiven ? Number(kw.rezoning_weeks)
                             : globalThis.AIDC.calcEntitlements.DEFAULTS.rezoning_weeks.value;
    const queueEcho = queueGiven ? Number(kw.queue_wait_weeks)
                                 : globalThis.AIDC.calcInterconnect.DEFAULTS.queue_wait_weeks.value;
    const inputs = {
      it_mw: q(itMwEcho, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale — forwarded to the parcel base (calc_land) and all five " +
               "land-dev domains for the same scenario"),
      earthwork_unit_cost_per_cy: q(ewucEcho, "US$/CY", ewucGiven ? "[S]" : "[A]",
                                    "forwarded to calc_landdev — drives the earthwork " +
                                    "sub-score independently of scale"),
      detention_unit_cost_per_cf: q(ducfEcho, "US$/CF", ducfGiven ? "[S]" : "[A]",
                                    "forwarded to calc_stormwater — drives the stormwater " +
                                    "sub-score independently of scale"),
      floor_load_kpa: q(floorEcho, "kPa", floorGiven ? "[S]" : "[A]",
                        "forwarded to calc_geotech — drives the geotechnical (bearing-area " +
                        "margin) sub-score"),
      rezoning_weeks: q(rezEcho, "weeks", rezGiven ? "[S]" : "[A]",
                        "forwarded to calc_entitlements — drives the entitlement sub-score"),
      queue_wait_weeks: q(queueEcho, "weeks", queueGiven ? "[S]" : "[A]",
                          "forwarded to calc_interconnect — drives the interconnection " +
                          "sub-score"),
    };
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (lay[k] !== null && lay[k] !== undefined)
        ? q(lay[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "sitescore — land-development site-suitability score (weighted-overlay MCDA)",
      "weighted linear combination (WLC) over five criteria composed live: earthwork / " +
      "stormwater cost per acre of the parcel base (calc_land / calc_landdev / " +
      "calc_stormwater), the geotechnical bearing-area-margin hazard (calc_geotech), and the " +
      "entitlement / interconnection clocks (calc_entitlements / calc_interconnect); " +
      "overall = sum(weight_i x sub_score_i) / sum(weights) (pure scoring math, no wall clock)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcSitescore = { DEFAULTS: DEFAULTS, sitescore: sitescore };
})();
