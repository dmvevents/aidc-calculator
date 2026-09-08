// Land development — grading / earthwork sub-domain. PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_landdev.py — landdev() ported 1:1 (same names, inputs,
// outputs, output key order, notes). DISTURBED AREA composes over the land core
// (A.calcLand.footprint(...).parcel_m2 for the same scenario — the graded site).
// The load-bearing cut-fill BALANCE identity:
//   net_import_export_cy = cut_cy*swell_factor - fill_cy/shrink_compaction_factor
// (a signed LOOSE volume: + = EXPORT surplus, - = IMPORT deficit). Pure geometric +
// money arithmetic, so a run byte-matches the python core to the cubic yard.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    cut_depth_ft: q(2.0, "ft", "[A]",
                    "average CUT depth over the cut portion of the graded parcel — " +
                    "planning assumption for a greenfield pad-on-grade site"),
    fill_depth_ft: q(1.5, "ft", "[A]",
                     "average FILL depth over the fill portion of the graded parcel — " +
                     "planning assumption"),
    cut_area_frac: q(0.55, "frac", "[A]",
                     "fraction of the disturbed parcel in CUT (the rest is fill) — " +
                     "balanced-grading planning assumption (fill fraction = 1 - this)"),
    swell_factor: q(1.25, "x", "[S]",
                    "bank -> loose SWELL (loose volume = bank x this): ~25% for common " +
                    "earth (Caterpillar Performance Handbook / RSMeans soil factors)"),
    shrink_compaction_factor: q(0.72, "x", "[S]",
                               "loose -> COMPACTED (compacted = loose x this): " +
                               "(1 - 0.10 shrink) / (1 + 0.25 swell) = 0.72 from the " +
                               "standard 25% swell / 10% shrinkage bank-to-compacted " +
                               "(Caterpillar Performance Handbook / RSMeans soil factors)"),
    earthwork_unit_cost_per_cy: q(12.0, "US$/CY", "[S]",
                                  "blended bulk site earthwork (excavate + place + compact) " +
                                  "in-place move rate — RSMeans-class 31 23 xx, typical " +
                                  "$8-15/CY for common earth mass grading"),
    production_rate_cy_per_day: q(2400.0, "CY/day", "[A]",
                                  "grading fleet production (scraper / excavator + dozer " +
                                  "spread) — planning assumption"),
    working_days_per_week: q(5.0, "day/wk", "[A]",
                            "working days per week for the grading crew — planning " +
                            "assumption (single day shift, weather down-days excluded)"),
  };

  const SQFT_PER_M2 = 10.763910417; // [S] exact-basis conversion, 6 s.f. (matches calc_land)
  const CY_PER_CF = 1.0 / 27.0;     // [S] 27 cubic feet per cubic yard, exact

  function landdev(kw) {
    kw = kw || {};
    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    // DISTURBED AREA composes over the land core (do NOT hardcode site area) — call
    // calc_land and read the graded parcel (developed pads x circulation/setback factor).
    const land = globalThis.AIDC.calcLand.footprint(itGiven ? { it_mw: kw.it_mw } : {});
    const disturbedM2 = land.outputs.parcel_m2.value;

    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    const lay = {
      cut_depth_ft: kw.cut_depth_ft, fill_depth_ft: kw.fill_depth_ft,
      cut_area_frac: kw.cut_area_frac, swell_factor: kw.swell_factor,
      shrink_compaction_factor: kw.shrink_compaction_factor,
      earthwork_unit_cost_per_cy: kw.earthwork_unit_cost_per_cy,
      production_rate_cy_per_day: kw.production_rate_cy_per_day,
      working_days_per_week: kw.working_days_per_week,
    };
    for (const k of Object.keys(lay)) if (lay[k] !== null && lay[k] !== undefined) p[k] = lay[k];

    const cutDepth = Number(p.cut_depth_ft);
    const fillDepth = Number(p.fill_depth_ft);
    const cutFrac = Number(p.cut_area_frac);
    const swell = Number(p.swell_factor);
    const shrink = Number(p.shrink_compaction_factor);
    const unitCost = Number(p.earthwork_unit_cost_per_cy);
    const prod = Number(p.production_rate_cy_per_day);
    const daysWk = Number(p.working_days_per_week);
    if (cutDepth < 0.0) throw new Error("cut_depth_ft must be >= 0");
    if (fillDepth < 0.0) throw new Error("fill_depth_ft must be >= 0");
    if (!(cutFrac >= 0.0 && cutFrac <= 1.0)) throw new Error("cut_area_frac must be between 0 and 1");
    if (swell <= 0.0) throw new Error("swell_factor must be > 0");
    if (shrink <= 0.0) throw new Error("shrink_compaction_factor must be > 0");
    if (unitCost < 0.0) throw new Error("earthwork_unit_cost_per_cy must be >= 0");
    if (prod <= 0.0) throw new Error("production_rate_cy_per_day must be > 0");
    if (daysWk <= 0.0) throw new Error("working_days_per_week must be > 0");

    const fillFrac = 1.0 - cutFrac;
    const disturbedSf = disturbedM2 * SQFT_PER_M2;
    const disturbedAcres = disturbedM2 / globalThis.AIDC.calcLand.ACRE_M2;

    // ---- cut / fill quantities: area x fraction x average depth, cf -> cy ----------
    const cutCy = disturbedSf * cutFrac * cutDepth * CY_PER_CF;   // in-situ BANK cy
    const fillCy = disturbedSf * fillFrac * fillDepth * CY_PER_CF; // COMPACTED cy placed

    // ---- the load-bearing cut-fill BALANCE identity (loose / hauled basis) ---------
    //   cut produces loose (swell), fill consumes loose (compacts by shrink) ->
    //   net_import_export_cy = cut_cy*swell - fill_cy/shrink   (+ = EXPORT, - = IMPORT)
    const cutLooseCy = cutCy * swell;
    const fillLooseRequiredCy = fillCy / shrink;
    const netImportExportCy = cutLooseCy - fillLooseRequiredCy;

    // ---- cost + duration: the total handled (cut + fill) earthwork quantity --------
    const gradedVolumeCy = cutCy + fillCy;
    const earthworkCostM = gradedVolumeCy * unitCost / 1.0e6;
    const gradingDurationDays = gradedVolumeCy / prod;
    const gradingDurationWeeks = gradingDurationDays / daysWk;

    const out = {
      disturbed_area_acres: q(disturbedAcres, "acres", "[D]",
                              "calc_land parcel_m2 / 4,046.856 — the graded site " +
                              "(developed pads x [A] circulation/setback factor), " +
                              "composed live over the land core"),
      cut_cy: q(cutCy, "bank CY", "[D]",
                "disturbed_sf x cut_area_frac x cut_depth_ft / 27 — rests on [A] cut " +
                "depth + [A] cut-area fraction over the [D] composed parcel"),
      fill_cy: q(fillCy, "compacted CY", "[D]",
                 "disturbed_sf x (1 - cut_area_frac) x fill_depth_ft / 27 — rests on " +
                 "[A] fill depth + [A] fill-area fraction over the [D] composed parcel"),
      cut_loose_cy: q(cutLooseCy, "loose CY", "[D]",
                      "cut_cy x swell_factor — loose volume the cut yields ([S] swell " +
                      "1.25, Caterpillar/RSMeans)"),
      fill_loose_required_cy: q(fillLooseRequiredCy, "loose CY", "[D]",
                                "fill_cy / shrink_compaction_factor — loose volume the " +
                                "fill consumes ([S] loose->compacted 0.72, Caterpillar/" +
                                "RSMeans)"),
      net_import_export_cy: q(netImportExportCy, "loose CY", "[D]",
                              "cut_loose_cy - fill_loose_required_cy (+ = EXPORT surplus, " +
                              "- = IMPORT deficit) — rests on [S] swell 1.25 / [S] " +
                              "loose->compacted 0.72"),
      graded_volume_cy: q(gradedVolumeCy, "CY", "[D]",
                          "cut_cy + fill_cy — total handled earthwork quantity (the cost " +
                          "+ duration basis); rests on the [A] cut/fill depth + fraction " +
                          "assumptions"),
      earthwork_cost_m: q(earthworkCostM, "US$M", "[D]",
                          "graded_volume_cy x unit cost / 1e6 — [S] blended in-place move " +
                          "rate 12 $/CY (RSMeans-class 31 23 xx); haul/disposal excluded"),
      grading_duration_weeks: q(gradingDurationWeeks, "wk", "[D]",
                                "graded_volume_cy / production / working-days-per-week — " +
                                "[A] production 2,400 CY/day, [A] 5 working days/wk"),
    };

    const notes = [
      "SIGN CONVENTION — net_import_export_cy = cut_cy*swell_factor - " +
      "fill_cy/shrink_compaction_factor (a signed LOOSE/hauled volume). The cut yields " +
      "loose material (bank swells by swell_factor); the fill consumes loose material " +
      "(loose compacts by shrink_compaction_factor, so the loose required to place " +
      "fill_cy is fill_cy/shrink_compaction_factor). POSITIVE = EXPORT the surplus, " +
      "NEGATIVE = IMPORT the deficit. Break either factor's role and the golden net pin " +
      "and the per-term identity row both fail.",
      "DISTURBED AREA composes over the land core: the graded area is " +
      "calc_land.footprint(...) parcel_m2 for the same scenario (developed pads x " +
      "circulation/setback factor), so a change in the site geometry or scale flows " +
      "straight into the earthwork quantities — nothing about the area is hardcoded here.",
      "PROVENANCE — [S] swell_factor 1.25 (bank->loose ~25%, Caterpillar Performance " +
      "Handbook / RSMeans soil factors); [S] shrink_compaction_factor 0.72 (loose->" +
      "compacted from the standard 25% swell / 10% shrinkage); [S] earthwork_unit_cost " +
      "12 $/CY (RSMeans-class 31 23 xx bulk earthwork, band $8-15/CY). [A] cut_depth 2.0 " +
      "ft, fill_depth 1.5 ft, cut_area_frac 0.55, production 2,400 CY/day, 5 working " +
      "days/wk — planning assumptions, override per site. Outputs are [D] derived from " +
      "these; every output names its [S]/[A] basis in its source.",
      "DETERMINISTIC: pure geometric + money arithmetic — no wall clock, no randomness — " +
      "so a double run is byte-identical and the JS port matches to the cubic yard.",
      "Scope: a single-snapshot planning ROM, not a grading design. Mass-haul bands from " +
      "an average cut/fill depth and a cut-area split over the whole parcel — NOT a " +
      "triangulated cut-fill from a survey DTM; no topsoil strip/respread, rock, " +
      "over-excavation, dewatering, or haul-distance / off-site disposal fees (the cost " +
      "is the blended in-place move rate; net export/import is a quantity band so " +
      "haul/disposal can be priced separately).",
    ];

    const itMwEcho = itGiven ? Number(kw.it_mw) : globalThis.AIDC.calcLand.DEFAULTS.it_mw.value;
    const inputs = {
      it_mw: q(itMwEcho, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale — forwarded to calc_land for the disturbed parcel area"),
    };
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (lay[k] !== null && lay[k] !== undefined)
        ? q(lay[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "landdev — grading / earthwork planning bands (cut / fill / balance / cost / duration)",
      "disturbed parcel composed over calc_land.footprint (parcel_m2); cut/fill = area x " +
      "fraction x depth / 27; net_import_export_cy = cut_cy*swell - fill_cy/shrink " +
      "(pure geometric + money math, no wall clock)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcLanddev = { DEFAULTS: DEFAULTS, landdev: landdev };
})();
