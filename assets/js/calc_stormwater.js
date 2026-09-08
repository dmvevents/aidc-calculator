// Stormwater / detention — site-hydrology sub-domain. PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_stormwater.py — stormwater() ported 1:1 (same names, inputs,
// outputs, output key order, notes). DRAINAGE AREA composes over the land core
// (A.calcLand.footprint(...).parcel_m2 for the same scenario — the graded catchment).
// METHOD: Rational peak runoff Q = C*i*A; Modified-Rational detention. The load-bearing
// runoff-delta identity:
//   required_detention_volume_cf = (peak_runoff_post_cfs - peak_runoff_pre_cfs)*storm_duration_min*60
// (a signed volume: + = development ADDS peak the basin attenuates, <= 0 = no detention).
// Pure hydrologic + money arithmetic, so a run byte-matches the python core to the cubic foot.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    design_storm_intensity_in_hr: q(4.0, "in/hr", "[A]",
                                    "design-storm rainfall intensity for the Rational " +
                                    "Method — a single planning design point (band ~2-7 " +
                                    "in/hr regionally); set from your locale's NOAA " +
                                    "Atlas 14 IDF curve at the target return period"),
    storm_duration_min: q(60.0, "min", "[A]",
                          "critical design-storm duration for the Modified Rational " +
                          "detention volume — planning assumption; a full MRM sweeps " +
                          "durations for the maximum required storage"),
    impervious_frac: q(0.75, "frac", "[A]",
                       "impervious fraction of the graded parcel (roofs, equipment yards, " +
                       "access roads, parking) — datacenter sites are highly impervious, " +
                       "planning band ~0.65-0.85"),
    runoff_coeff_impervious: q(0.90, "C", "[S]",
                               "Rational-Method runoff coefficient for impervious surfaces " +
                               "(roofs / pavement) — standard 0.85-0.95 (ASCE / municipal " +
                               "drainage manuals)"),
    runoff_coeff_pervious: q(0.25, "C", "[S]",
                             "Rational-Method runoff coefficient for pervious surfaces " +
                             "(landscaped / lawn, flat) — standard 0.15-0.35 (ASCE / " +
                             "municipal drainage manuals)"),
    runoff_coeff_pre: q(0.25, "C", "[A]",
                        "pre-development (greenfield) area-weighted runoff coefficient — " +
                        "meadow / undeveloped planning assumption; the allowable-release " +
                        "basis the detention must not exceed"),
    avg_detention_depth_ft: q(4.0, "ft", "[A]",
                              "average effective detention depth used to convert the " +
                              "storage volume to a basin footprint — planning assumption " +
                              "(dry basin ~3-6 ft)"),
    detention_unit_cost_per_cf: q(2.5, "US$/CF", "[S]",
                                  "blended detention-basin construction (excavation + " +
                                  "embankment + outlet structure + spillway) per CF of " +
                                  "storage — planning band ~$1.5-4/CF for a dry basin " +
                                  "(RSMeans-class 33 40 00 storm drainage; underground " +
                                  "vaults run far higher)"),
  };

  const ACRE_SQFT = 43560.0; // [S] square feet per international acre, exact (US survey convention)
  const SEC_PER_MIN = 60.0;  // [S] exact

  function stormwater(kw) {
    kw = kw || {};
    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    // DRAINAGE AREA composes over the land core (do NOT hardcode site area) — call
    // calc_land and read the graded parcel (developed pads x circulation/setback factor).
    const land = globalThis.AIDC.calcLand.footprint(itGiven ? { it_mw: kw.it_mw } : {});
    const parcelM2 = land.outputs.parcel_m2.value;

    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    const lay = {
      design_storm_intensity_in_hr: kw.design_storm_intensity_in_hr,
      storm_duration_min: kw.storm_duration_min,
      impervious_frac: kw.impervious_frac,
      runoff_coeff_impervious: kw.runoff_coeff_impervious,
      runoff_coeff_pervious: kw.runoff_coeff_pervious,
      runoff_coeff_pre: kw.runoff_coeff_pre,
      avg_detention_depth_ft: kw.avg_detention_depth_ft,
      detention_unit_cost_per_cf: kw.detention_unit_cost_per_cf,
    };
    for (const k of Object.keys(lay)) if (lay[k] !== null && lay[k] !== undefined) p[k] = lay[k];

    const intensity = Number(p.design_storm_intensity_in_hr);
    const duration = Number(p.storm_duration_min);
    const impFrac = Number(p.impervious_frac);
    const cImp = Number(p.runoff_coeff_impervious);
    const cPerv = Number(p.runoff_coeff_pervious);
    const cPre = Number(p.runoff_coeff_pre);
    const depth = Number(p.avg_detention_depth_ft);
    const unitCost = Number(p.detention_unit_cost_per_cf);
    if (intensity < 0.0) throw new Error("design_storm_intensity_in_hr must be >= 0");
    if (duration <= 0.0) throw new Error("storm_duration_min must be > 0");
    if (!(impFrac >= 0.0 && impFrac <= 1.0)) throw new Error("impervious_frac must be between 0 and 1");
    if (!(cImp >= 0.0 && cImp <= 1.0)) throw new Error("runoff_coeff_impervious must be between 0 and 1");
    if (!(cPerv >= 0.0 && cPerv <= 1.0)) throw new Error("runoff_coeff_pervious must be between 0 and 1");
    if (!(cPre >= 0.0 && cPre <= 1.0)) throw new Error("runoff_coeff_pre must be between 0 and 1");
    if (depth <= 0.0) throw new Error("avg_detention_depth_ft must be > 0");
    if (unitCost < 0.0) throw new Error("detention_unit_cost_per_cf must be >= 0");

    const siteAreaAcres = parcelM2 / globalThis.AIDC.calcLand.ACRE_M2;
    const imperviousAreaAcres = siteAreaAcres * impFrac;

    // ---- post-development area-weighted runoff coefficient (Rational Method) --------
    const cPost = impFrac * cImp + (1.0 - impFrac) * cPerv;

    // ---- peak runoff pre / post: Q = C * i * A (cfs; acre-in/hr -> cfs folded to 1) --
    const peakPre = cPre * intensity * siteAreaAcres;
    const peakPost = cPost * intensity * siteAreaAcres;

    // ---- the load-bearing runoff-delta identity + Modified Rational detention -------
    //   the development raises the peak by (Q_post - Q_pre); the basin stores that
    //   surplus over the design-storm duration -> V = (Q_post - Q_pre) * td * 60
    const peakIncrease = peakPost - peakPre;
    const requiredDetentionVolumeCf = peakIncrease * duration * SEC_PER_MIN;

    // ---- footprint + cost: volume / depth -> area; volume x unit cost ---------------
    const detentionFootprintAcres = requiredDetentionVolumeCf / depth / ACRE_SQFT;
    const detentionCostM = requiredDetentionVolumeCf * unitCost / 1.0e6;

    const out = {
      site_area_acres: q(siteAreaAcres, "acres", "[D]",
                         "calc_land parcel_m2 / 4,046.856 — the graded parcel taken as " +
                         "the drainage catchment (developed pads x [A] circulation/" +
                         "setback factor), composed live over the land core"),
      impervious_area_acres: q(imperviousAreaAcres, "acres", "[D]",
                               "site_area_acres x impervious_frac — the hardscape " +
                               "(roofs / yards / roads / parking); rests on [A] " +
                               "impervious fraction over the [D] composed parcel"),
      runoff_coeff_post: q(cPost, "C", "[D]",
                           "impervious_frac x C_impervious + (1 - impervious_frac) x " +
                           "C_pervious — area-weighted post-development Rational " +
                           "coefficient ([S] 0.90 / 0.25 surface C's)"),
      peak_runoff_pre_cfs: q(peakPre, "cfs", "[D]",
                             "Rational Q = C_pre x intensity x site_area_acres — the " +
                             "allowable (pre-development) release; rests on [A] " +
                             "pre-development C and the [A] design intensity"),
      peak_runoff_post_cfs: q(peakPost, "cfs", "[D]",
                              "Rational Q = C_post x intensity x site_area_acres — the " +
                              "developed peak; rests on the [D] weighted C_post and the " +
                              "[A] design intensity"),
      peak_runoff_increase_cfs: q(peakIncrease, "cfs", "[D]",
                                  "peak_runoff_post_cfs - peak_runoff_pre_cfs (+ = the " +
                                  "development ADDS peak the basin must attenuate, " +
                                  "<= 0 = no detention required) — rests on the [A] " +
                                  "pre-development C and the [A] design intensity"),
      required_detention_volume_cf: q(requiredDetentionVolumeCf, "CF", "[D]",
                                      "Modified Rational: peak_runoff_increase_cfs x " +
                                      "storm_duration_min x 60 (cfs x s = cubic feet) — " +
                                      "the surplus held back over the [A] design-storm " +
                                      "duration; rests on [A] pre-development C"),
      detention_footprint_acres: q(detentionFootprintAcres, "acres", "[D]",
                                   "required_detention_volume_cf / avg_detention_depth_ft " +
                                   "/ 43,560 — basin plan area at the [A] effective depth"),
      detention_cost_m: q(detentionCostM, "US$M", "[D]",
                          "required_detention_volume_cf x unit cost / 1e6 — [S] blended " +
                          "dry-basin construction 2.5 $/CF (RSMeans-class 33 40 00)"),
    };

    const notes = [
      "METHOD — PEAK RUNOFF is the Rational Method Q = C*i*A (Q in cfs with A in acres, i " +
      "in in/hr; the 1.008 acre-in/hr -> cfs factor folded to 1.0, standard). C_post is " +
      "area-weighted from the impervious fraction: impervious_frac*C_impervious + " +
      "(1-impervious_frac)*C_pervious. DETENTION VOLUME is the Modified Rational Method " +
      "(MRM) rectangular-hydrograph approximation: required storage = (Q_post - Q_pre) x " +
      "storm duration.",
      "SIGN CONVENTION — required_detention_volume_cf = (peak_runoff_post_cfs - " +
      "peak_runoff_pre_cfs) * storm_duration_min * 60. peak_runoff_increase_cfs is SIGNED: " +
      "development normally RAISES the peak (C_post > C_pre) so it is positive and " +
      "detention is required; a NON-POSITIVE value means the post-development peak does " +
      "not exceed the pre-development rate, so no detention is needed (reported as a band, " +
      "not clamped). Drop or sign-flip the pre term and the golden volume pin and the " +
      "per-term identity row both fail.",
      "DRAINAGE AREA composes over the land core: the catchment is calc_land.footprint(...) " +
      "parcel_m2 for the same scenario (developed pads x circulation/setback factor), so a " +
      "change in the site geometry or scale flows straight into the runoff and the " +
      "detention volume — nothing about the area is hardcoded here.",
      "PROVENANCE — [S] runoff_coeff_impervious 0.90 and [S] runoff_coeff_pervious 0.25 " +
      "(standard Rational C's, ASCE / municipal drainage manuals); [S] detention_unit_cost " +
      "2.5 $/CF (RSMeans-class 33 40 00 dry-basin band $1.5-4/CF). [A] design intensity 4.0 " +
      "in/hr (set from your locale's NOAA Atlas 14 IDF), [A] storm duration 60 min, [A] " +
      "impervious_frac 0.75, [A] pre-development C 0.25, [A] detention depth 4.0 ft — " +
      "planning assumptions, override per site. Outputs are [D] derived from these; every " +
      "output names its [S]/[A] basis in its source.",
      "DETERMINISTIC: pure hydrologic + geometric + money arithmetic — no wall clock, no " +
      "randomness — so a double run is byte-identical and the JS port matches to the cubic " +
      "foot.",
      "Scope: a single-snapshot planning ROM, not permit-grade hydrology. One Rational " +
      "design point (no hydrograph route, no time-of-concentration), the MRM detention " +
      "volume at ONE assumed critical duration (no duration sweep, no reservoir routing), " +
      "the drainage area taken as the graded parcel (no delineated contributing catchment), " +
      "and a single [A] design intensity. No channel/pipe hydraulics, water-quality volume, " +
      "infiltration / green-infrastructure credit, or multi-stage outlet design.",
    ];

    const itMwEcho = itGiven ? Number(kw.it_mw) : globalThis.AIDC.calcLand.DEFAULTS.it_mw.value;
    const inputs = {
      it_mw: q(itMwEcho, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale — forwarded to calc_land for the drainage parcel area"),
    };
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (lay[k] !== null && lay[k] !== undefined)
        ? q(lay[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "stormwater — peak runoff + detention planning bands (Rational / Modified Rational)",
      "drainage parcel composed over calc_land.footprint (parcel_m2); Rational peak " +
      "Q = C*i*A; detention = (Q_post - Q_pre)*storm_duration_min*60 (Modified Rational, " +
      "pure hydrologic + money math, no wall clock)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcStormwater = { DEFAULTS: DEFAULTS, stormwater: stormwater };
})();
