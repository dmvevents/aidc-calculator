// Parametric site-layout solver: (platform, GPU count) -> a massing-grade
// 3D scene spec whose EQUIPMENT COUNTS come from the same parity-locked
// engines the calculator pages run (calc_power, calc_cooling, calc_land) and
// whose arrangement follows the reference scene's conventions (rows of one
// SU, west mechanical gallery, east electrical rooms + MV yard, north genset
// pad, west heat-rejection pad, parcel + fence from the land model).
// Pure and deterministic: same inputs -> same spec. Massing [A] conventions
// carry their labels in the stats rows; no solver is claimed.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;

  // massing conventions (the reference scene's [A] constants)
  const GAP = 0.05, END_CLEAR = 1.2, WALL = 0.2, GALLERY_W = 2.5, ELEC_W = 4.0;
  const COLD = 1.8, HOT = 1.2, CLEAR_H = 5.0;
  const BUSWAY_Y = [3.8, 4.2], TRAY_Y = 3.0;
  const CRAH_CLASS_KW = 150.0;         // [A] CRAH unit class (reference convention)
  const DRYCOOLER_CLASS_MW = 1.2;      // [A] ~1.2 MW-class dry cooler per unit
  const DISPLAY_CAPS = { crah: 12, cdu: 12, drycooler: 10, tower: 12, genset: 8, ups: 6, transformer: 4 };

  const ceil = Math.ceil, max = Math.max, min = Math.min, abs = Math.abs, sqrt = Math.sqrt;

  // ---- F2b: two-wing L/T massing (real geometry, not a label) --------------
  // A wing plan is two row segments stacked along z — (rowsN × perRowN) north and
  // (rowsS × perRowS) south — whose HALL WIDTHS differ, so the narrower one reads
  // as a leg/spine and the wider one as the elbow leg/cross-hall. The rows keep the
  // reference pitch exactly (COLD/HOT aisles, rd rack depth, END_CLEAR at both row
  // ends): only the row LENGTH and the count per segment change, which is why the
  // equipment counts cannot move.
  //
  // Wall + service accounting matches the DRAWN shell: a hall block carries its own
  // two walls (2·WALL), each service strip one further wall on its outer face. The
  // reference (auto) cross-section is therefore hallW + 0.4 + 2.7 + 4.2 = hallW +
  // 7.3 m, and every wing block below uses the same rule — so built areas are
  // directly comparable across shapes.
  const RACK_W = 0.6, RACK_D = 1.2;      // rack width/depth (the planner is pure)
  const GAL_STRIP = GALLERY_W + WALL;    // 2.7  mechanical gallery + its outer wall
  const ELEC_STRIP = ELEC_W + WALL;      // 4.2  electrical rooms + their outer wall
  const HALL_WALLS = 2 * WALL;           // 0.4  a hall block's own two walls
  // service-room placements searched per shape. L always keeps the mechanical gallery
  // in the inner elbow (spec §F2); T puts it in a re-entrant corner or across an end
  // face. The electrical rooms are the free variable in both.
  const LT_GAL = { L: ["elbowZ", "crossX"], T: ["cornerW", "outerN", "outerW"] };
  const LT_ELEC = { L: ["elbow", "wideE", "fullE", "endN", "endW"],
                    T: ["cornerE", "endN", "endW"] };
  const T_SHARE_LO = 0.5, T_SHARE_HI = 0.7, T_SHARE_AIM = 0.6;  // "spine ≈60% of rows"

  function ltAisle(i) { return i % 2 === 0 ? COLD : HOT; }
  function ltHallW(perRow) { return perRow * RACK_W + (perRow - 1) * GAP + 2 * END_CLEAR; }
  // Depth a wing consumes: its row bands (aisle + rack depth, reference pitch), the
  // closing cold aisle, and — for whichever wing carries the support/management row
  // — that row plus the end clearance. Each wing starts on a COLD aisle, exactly as
  // the reference hall does; the aisle phase is per hall, not carried across a wall.
  function ltStack(n, hasSupport) {
    let z = 0;
    for (let i = 0; i < n; i++) z += ltAisle(i) + RACK_D;
    z += COLD;
    if (hasSupport) z += RACK_D + END_CLEAR;
    return z;
  }
  // the reference (auto) building's gross built area, same wall rule as the wings
  function ltAutoBuilt(racks, perRowDef) {
    const n = ceil(racks / perRowDef), hallZ = ltStack(n, true);
    return { rows: n, hallZ: hallZ,
             built: (ltHallW(perRowDef) + HALL_WALLS + GAL_STRIP + ELEC_STRIP) * (hallZ + 2 * WALL) };
  }
  // --- exact rect predicates: the disjointness and adjacency criteria are ENFORCED
  // numerically on every candidate, not argued case by case.
  function ltOverlap(a, b) {
    const w = min(a.x1, b.x1) - max(a.x0, b.x0);
    const d = min(a.z1, b.z1) - max(a.z0, b.z0);
    return w > 1e-9 && d > 1e-9 ? w * d : 0;
  }
  function ltTouches(a, b) {           // share a wall face of positive length
    const xo = min(a.x1, b.x1) - max(a.x0, b.x0);
    const zo = min(a.z1, b.z1) - max(a.z0, b.z0);
    const xAdj = abs(a.x1 - b.x0) < 1e-9 || abs(b.x1 - a.x0) < 1e-9;
    const zAdj = abs(a.z1 - b.z0) < 1e-9 || abs(b.z1 - a.z0) < 1e-9;
    return (xAdj && zo > 1e-9) || (zAdj && xo > 1e-9);
  }

  // Exact footprint rectangles + row schedule for one candidate. These rects ARE the
  // definition of the built area (the emitter draws them and nothing else), so every
  // reported delta is measured rather than estimated. Returns null when the variant's
  // clearances do not fit, when any two rooms would overlap, or when a service room
  // would float free of the halls.
  //
  // c = { mode, nA, pA, nB, pB, racksA, racksB, sup:"A"|"B", gal, elec }
  // Wing A is the north wing and owns all four of its walls; wing B abuts it from the
  // south and adopts A's south wall as its own north wall, so no wall is paid twice.
  function ltRects(c) {
    const isT = c.mode === "T";
    const stackA = ltStack(c.nA, c.sup === "A"), stackB = ltStack(c.nB, c.sup === "B");
    const ZA = stackA + 2 * WALL, ZB = stackB + WALL;
    const hwA = ltHallW(c.pA), hwB = ltHallW(c.pB);
    if (abs(hwA - hwB) < 1e-9) return null;      // equal widths -> no elbow, just a bar
    const WA = hwA + 2 * WALL, WB = hwB + 2 * WALL;
    const aIsNarrow = hwA < hwB;
    // wing frames: {x0,x1,z0,z1} outer, plus the interior origin the rows start from
    const xOf = (w) => (isT ? [-w / 2, w / 2] : [0, w]);   // T centres the halls, L west-aligns
    const xa = xOf(WA), xb = xOf(WB);
    const hallA = { x0: xa[0], x1: xa[1], z0: 0, z1: ZA, kind: "hall-a" };
    const hallB = { x0: xb[0], x1: xb[1], z0: ZA, z1: ZA + ZB, kind: "hall-b" };
    const narrow = aIsNarrow ? hallA : hallB, wide = aIsNarrow ? hallB : hallA;
    const voidW = (wide.x1 - wide.x0) - (narrow.x1 - narrow.x0);   // re-entrant width (L: one side)
    const side = voidW / 2;                                        // T: one corner's width
    // each wing's OUTER z face (the one that is not the shared wall) and its direction
    const outer = (h) => (h === hallA ? { z: 0, s: -1 } : { z: ZA + ZB, s: +1 });
    const zBand = (e, w) => (e.s < 0 ? [e.z - w, e.z] : [e.z, e.z + w]);
    const rects = [hallA, hallB];
    let gallery = null, elec = null;
    // ---- mechanical gallery ------------------------------------------------
    if (c.gal === "elbowZ") {
      // L: in the inner elbow, on the narrow wing's east face (spec §F2)
      if (voidW < GAL_STRIP) return null;
      gallery = { x0: narrow.x1, x1: narrow.x1 + GAL_STRIP, z0: narrow.z0, z1: narrow.z1,
                  kind: "gallery", axis: "z", run: narrow.z1 - narrow.z0 - 2 * WALL };
    } else if (c.gal === "crossX") {
      // L: in the elbow, as a bar along the wide wing's inner face
      if (voidW < GALLERY_W + WALL) return null;
      if (narrow.z1 - narrow.z0 < GAL_STRIP + 2 * WALL) return null;
      const e = outer(narrow);
      const zr = e.s < 0 ? [narrow.z1 - GAL_STRIP, narrow.z1] : [narrow.z0, narrow.z0 + GAL_STRIP];
      gallery = { x0: narrow.x1, x1: wide.x1, z0: zr[0], z1: zr[1],
                  kind: "gallery", axis: "x", run: voidW - WALL };
    } else if (c.gal === "cornerW") {
      // T: in the west re-entrant corner, on the spine's west face
      if (side < GAL_STRIP) return null;
      gallery = { x0: narrow.x0 - GAL_STRIP, x1: narrow.x0, z0: narrow.z0, z1: narrow.z1,
                  kind: "gallery", axis: "z", run: narrow.z1 - narrow.z0 - 2 * WALL };
    } else {
      // T: as a bar across the spine's or the crossbar's outer end face
      const host = c.gal === "outerN" ? narrow : wide;
      const zr = zBand(outer(host), GAL_STRIP);
      gallery = { x0: host.x0, x1: host.x1, z0: zr[0], z1: zr[1],
                  kind: "gallery", axis: "x", run: host.x1 - host.x0 - 2 * WALL };
    }
    rects.push(gallery);
    // ---- electrical rooms --------------------------------------------------
    if (c.elec === "elbow") {
      if (c.gal !== "elbowZ" || voidW < GAL_STRIP + ELEC_STRIP) return null;
      elec = { x0: gallery.x1, x1: gallery.x1 + ELEC_STRIP, z0: narrow.z0, z1: narrow.z1,
               kind: "elec", axis: "z", run: narrow.z1 - narrow.z0 - 2 * WALL };
    } else if (c.elec === "wideE") {
      elec = { x0: wide.x1, x1: wide.x1 + ELEC_STRIP, z0: wide.z0, z1: wide.z1,
               kind: "elec", axis: "z", run: wide.z1 - wide.z0 - 2 * WALL };
    } else if (c.elec === "fullE") {
      // one electrical spine down the whole east side of the building
      elec = { x0: wide.x1, x1: wide.x1 + ELEC_STRIP, z0: 0, z1: ZA + ZB,
               kind: "elec", axis: "z", run: ZA + ZB - 2 * WALL };
    } else if (c.elec === "cornerE") {
      if (side < ELEC_STRIP) return null;
      elec = { x0: narrow.x1, x1: narrow.x1 + ELEC_STRIP, z0: narrow.z0, z1: narrow.z1,
               kind: "elec", axis: "z", run: narrow.z1 - narrow.z0 - 2 * WALL };
    } else {
      // as a bar across one wing's outer end face, stacked beyond the gallery if the
      // gallery already occupies that face
      const host = c.elec === "endN" ? narrow : wide;
      const e = outer(host);
      const stacked = gallery.axis === "x" && abs(gallery.x0 - host.x0) < 1e-9 &&
                      (e.s < 0 ? abs(gallery.z1 - e.z) < 1e-9 : abs(gallery.z0 - e.z) < 1e-9);
      const from = stacked ? { z: e.s < 0 ? gallery.z0 : gallery.z1, s: e.s } : e;
      const zr = zBand(from, ELEC_STRIP);
      elec = { x0: host.x0, x1: host.x1, z0: zr[0], z1: zr[1],
               kind: "elec", axis: "x", run: host.x1 - host.x0 - 2 * WALL };
    }
    rects.push(elec);
    // ---- enforce disjointness and adjacency numerically --------------------
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) if (ltOverlap(rects[i], rects[j]) > 1e-9) return null;
    }
    for (const svc of [gallery, elec]) {
      if (!ltTouches(svc, hallA) && !ltTouches(svc, hallB) &&
          !(svc === elec && ltTouches(elec, gallery))) return null;
    }
    let built = 0, bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const r of rects) {
      built += (r.x1 - r.x0) * (r.z1 - r.z0);
      bx0 = min(bx0, r.x0); bx1 = max(bx1, r.x1); bz0 = min(bz0, r.z0); bz1 = max(bz1, r.z1);
    }
    // ---- row schedule: reference pitch, per wing --------------------------
    const rows = [];
    const wingRows = (h, n, p, nRacks, hasSup) => {
      const x0 = h.x0 + WALL + END_CLEAR;                 // interior + end clearance
      let z = h === hallA ? WALL : ZA;                    // B's north wall is A's south wall
      let left = nRacks;
      for (let i = 0; i < n; i++) {
        z += ltAisle(i);
        const cap = min(p, left);
        if (cap > 0) rows.push({ z: z, face: i % 2 === 0 ? -1 : +1, x0: x0, cap: cap,
                                 rowLen: cap * RACK_W + (cap - 1) * GAP, wing: h.kind });
        left -= cap;
        z += RACK_D;
      }
      z += COLD;
      return hasSup ? { supportZ: z, supportX: (h.x0 + h.x1) / 2 } : null;
    };
    const supA = wingRows(hallA, c.nA, c.pA, c.racksA, c.sup === "A");
    const supB = wingRows(hallB, c.nB, c.pB, c.racksB, c.sup === "B");
    const support = supA || supB;
    return { rects: rects, gallery: gallery, elec: elec, built: built, rows: rows,
             support: support, hallA: hallA, hallB: hallB, narrow: narrow, wide: wide,
             aIsNarrow: aIsNarrow, voidW: voidW, side: side,
             bbox: { x0: bx0, x1: bx1, z0: bz0, z1: bz1 } };
  }

  // Search the wing plans and keep the best one. Built-area parity with `auto`
  // (±2%) is a HARD filter; ranking WITHIN the feasible set is by massing quality
  // (balanced legs / spine share near 60%, no empty rack slots, a gallery long
  // enough for the units it must hold) — never by driving the delta toward zero, so
  // the reported delta stays an independent measurement of the chosen form.
  function ltPlan(racks, perRowDef, mode, galleryNeedM) {
    const auto = ltAutoBuilt(racks, perRowDef);
    const PRMAX = min(max(racks, 4), 64);          // [A] longest row we will draw
    const NMAX = min(max(racks, 2), 48);           // [A] deepest wing we will draw
    let best = null, bestKey = null, closest = null;
    const consider = (c) => {
      const g = ltRects(c);
      if (!g) return;
      const delta = g.built / auto.built - 1;
      const cand = { c: c, g: g, delta: delta };
      if (!closest || abs(delta) < abs(closest.delta)) closest = cand;
      if (abs(delta) > 0.02) return;               // hard parity gate
      const surplus = (c.nA * c.pA + c.nB * c.pB - racks) / racks;
      const galShort = max(0, galleryNeedM - g.gallery.run) / max(1, galleryNeedM);
      const spineRows = g.aIsNarrow ? c.nA : c.nB;
      const key = mode === "T"
        ? [abs(spineRows / (c.nA + c.nB) - T_SHARE_AIM) + galShort, surplus,
           g.aIsNarrow ? 1 : 0, abs(delta)]
        : [abs(c.racksA / racks - 0.5) + surplus + galShort, g.gallery.axis === "z" ? 0 : 1,
           abs(delta), 0];
      if (!bestKey || lexLess(key, bestKey)) { best = cand; bestKey = key; }
    };
    for (let nA = 1; nA <= NMAX; nA++) {
      for (let pA = 1; pA <= PRMAX; pA++) {
        const racksA = nA * pA;
        if (racksA >= racks) break;                // the south wing must get racks too
        const racksB = racks - racksA;
        for (let pBv = 1; pBv <= PRMAX; pBv++) {
          const nB = ceil(racksB / pBv);
          if (nB > NMAX) continue;
          const pB = nB === 1 ? racksB : pBv;      // a single row is sized to its racks
          if (mode === "T") {
            const spine = ltHallW(pA) < ltHallW(pB) ? nA : nB;
            const share = spine / (nA + nB);
            if (share < T_SHARE_LO || share > T_SHARE_HI) continue;
          }
          for (const gal of LT_GAL[mode]) {
            for (const el of LT_ELEC[mode]) {
              for (const sup of ["A", "B"]) {
                consider({ mode: mode, nA: nA, pA: pA, nB: nB, pB: pB,
                           racksA: racksA, racksB: racksB, sup: sup, gal: gal, elec: el });
              }
            }
          }
        }
      }
    }
    const pick = best || closest;                  // no parity-feasible plan -> closest, flagged
    if (!pick) return null;
    pick.autoBuilt = auto.built;
    pick.autoRows = auto.rows;
    pick.feasible = abs(pick.delta) <= 0.02;
    return pick;
  }
  function lexLess(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i] - 1e-12) return true;
      if (a[i] > b[i] + 1e-12) return false;
    }
    return false;
  }

  function solve(platform, gpus, rejector, shape) {
    const v = DB[platform];
    // heat-rejection mode drives calc_cooling's F7b tower fleet + the F5 verdict;
    // unknown/absent -> dry (the engine throws on an invalid rejector).
    const REJ = (A.calcCooling && A.calcCooling.REJECTORS) || ["dry", "tower", "adiabatic"];
    const rej = REJ.indexOf(rejector) >= 0 ? rejector : "dry";
    // F2: shape parameter (auto | square | rect-2:1 | rect-3:1 | L | T)
    const SHAPES = ["auto", "square", "rect-2:1", "rect-3:1", "L", "T"];
    const shp = SHAPES.indexOf(shape) >= 0 ? shape : "auto";
    const gpr = v.gpus_per_rack, rackKw = v.nameplate_kw;
    const rw = 0.6, rd = 1.2, rh = (v.height_mm || 2258) / 1000.0;
    const racks = max(1, ceil(gpus / gpr));
    const perRowDef = v.racks_per_su || 8;
    let perRow = perRowDef, rows = ceil(racks / perRowDef);
    let isL = false, isT = false;

    // F2 shape solver: compute perRow/rows to hit target aspect or wing arrangement
    if (shp === "square") {
      // minimize |hallX/hallZ - 1|: solve for perRow that gives closest to 1:1 hall aspect
      let best = perRowDef, bestErr = Infinity;
      for (let pr = 1; pr <= racks; pr++) {
        const r = ceil(racks / pr);
        const rowLenX = pr * rw + (pr - 1) * GAP;
        const hallX = rowLenX + 2 * END_CLEAR;
        // estimate hallZ: each pair of rows adds rd + COLD + rd + HOT, final +COLD +rd +END
        const pairZ = (rd + COLD + rd + HOT), oddZ = (rd + COLD);
        const hallZ = (r % 2 === 0) ? (r / 2) * pairZ + COLD + rd + END_CLEAR :
                                       Math.floor(r / 2) * pairZ + oddZ + rd + END_CLEAR;
        const asp = hallX / hallZ;
        const err = abs(asp - 1.0);
        if (err < bestErr) { bestErr = err; best = pr; }
      }
      perRow = best;
      rows = ceil(racks / perRow);
    } else if (shp === "rect-2:1") {
      // target hallX/hallZ ≈ 2.0
      let best = perRowDef, bestErr = Infinity;
      for (let pr = 1; pr <= racks; pr++) {
        const r = ceil(racks / pr);
        const rowLenX = pr * rw + (pr - 1) * GAP;
        const hallX = rowLenX + 2 * END_CLEAR;
        const pairZ = (rd + COLD + rd + HOT), oddZ = (rd + COLD);
        const hallZ = (r % 2 === 0) ? (r / 2) * pairZ + COLD + rd + END_CLEAR :
                                       Math.floor(r / 2) * pairZ + oddZ + rd + END_CLEAR;
        const asp = hallX / hallZ;
        const err = abs(asp - 2.0);
        if (err < bestErr) { bestErr = err; best = pr; }
      }
      perRow = best;
      rows = ceil(racks / perRow);
    } else if (shp === "rect-3:1") {
      // target hallX/hallZ ≈ 3.0
      let best = perRowDef, bestErr = Infinity;
      for (let pr = 1; pr <= racks; pr++) {
        const r = ceil(racks / pr);
        const rowLenX = pr * rw + (pr - 1) * GAP;
        const hallX = rowLenX + 2 * END_CLEAR;
        const pairZ = (rd + COLD + rd + HOT), oddZ = (rd + COLD);
        const hallZ = (r % 2 === 0) ? (r / 2) * pairZ + COLD + rd + END_CLEAR :
                                       Math.floor(r / 2) * pairZ + oddZ + rd + END_CLEAR;
        const asp = hallX / hallZ;
        const err = abs(asp - 3.0);
        if (err < bestErr) { bestErr = err; best = pr; }
      }
      perRow = best;
      rows = ceil(racks / perRow);
    } else if (shp === "L") {
      // L-shape: two wings at right angles. The actual split (rows and row
      // length per wing, and which wing is the narrow leg) is the wing planner's
      // job — ltPlan is consulted below, once the engines have fixed the counts.
      isL = true;
      rows = ceil(racks / perRowDef);
    } else if (shp === "T") {
      // T-shape: spine + cross-hall, spine ~60% of the rows. Same planner, with
      // the spine-share window it enforces (T_SHARE_LO/HI).
      isT = true;
      rows = ceil(racks / perRowDef);
    }
    const itMw = racks * rackKw / 1000.0;

    // ---- the engines own every count -------------------------------------
    const power = A.calcPower.sizing({
      it_mw: itMw, pue: v.pue_target, rack_kw: rackKw,
      dist_v: v.distribution_voltage_v, gpus: racks * gpr,
      racks_per_path: (v.row_plan && v.row_plan.compute) || null,
    }).outputs;
    const coolKw = { it_kw: itMw * 1000.0, liquid_frac: (v.liquid_pct || 0) / 100.0, rejector: rej };
    if (v.liquid_pct > 0) {
      coolKw.rack_liquid_kw = v.liquid_kw;
      coolKw.cdu_kw = v.cdu_nominal_kw;
      coolKw.tcs_inlet_c = v.design_inlet_c;
    }
    const cooling = A.calcCooling.loads(coolKw).outputs;
    const land = A.calcLand.footprint({ it_mw: itMw }).outputs;

    const facilityMw = power.facility_mw.value;
    const nGenset = power.genset_units_installed.value;
    const nTx = power.transformer_units.value;
    const nUpsPerPath = power.ups_modules_n.value;
    const nCdu = cooling.cdu_units_installed.value;
    const qAirKw = cooling.air_load_kw.value;
    const nCrah = max(2, ceil(qAirKw / CRAH_CLASS_KW) + 1);        // N+1 [A class]
    const nDry = max(2, ceil(facilityMw / DRYCOOLER_CLASS_MW) + 1); // [A class]
    const tesM3 = cooling.tes_volume_m3.value;
    const verdict = cooling.cooling_verdict.value;                  // dry-only | wetted-assist | infeasible
    const nTower = rej === "tower" ? cooling.tower_cells_installed.value : 0;   // F7b (engine-bound)
    const towerMakeup = rej === "tower" ? cooling.tower_makeup_m3_day.value : null; // m3/day, duty basis

    // ---- F2b: consult the wing planner (DSX-68) ---------------------------
    // DSX-28 built ltPlan/ltRects but solve() never called it: the L/T branch of
    // the geometry below was byte-identical to the else branch, so L, T and auto
    // emitted the SAME rack centres on every platform. The plan is consulted
    // HERE, after the engines have fixed every count, so it can only move racks
    // and rooms — it can never change engineering.
    //
    // A hall of ONE rack row has nothing to fold: there is no second wing to put
    // at right angles, so an L or a T over one row IS the reference stack and the
    // planner is not consulted (the F2 lt gate asserts EQUALITY for that case).
    const crahShown = min(nCrah, DISPLAY_CAPS.crah);
    const cduShown = min(nCdu, DISPLAY_CAPS.cdu);
    // the gallery must be long enough to line the units up along it: CRAH at the
    // ~1.4 m pitch and CDU at the 1.6 m pitch the emitters below actually use.
    const galleryNeedM = max(crahShown * 1.4, cduShown * 1.6);
    const plan = (isL || isT) && rows >= 2
      ? ltPlan(racks, perRowDef, isL ? "L" : "T", galleryNeedM)
      : null;

    // ---- hall geometry -----------------------------------------------------
    // Both branches end at ONE description that every emitter below reads: the
    // row schedule (rowsZ, in FINAL scene coordinates), the room rects that make
    // the shell (rooms + galR/elecR), and the shell extents (bx0..bz1).
    // auto/square/rect keep the reference single-hall z-stack exactly as it was;
    // L/T take theirs from the wing plan.
    let rowLen = perRow * rw + (perRow - 1) * GAP;
    let hallX = rowLen + 2 * END_CLEAR;
    const rowsZ = [];        // {z: north edge of the rack band, face, x0, cap, len, wing}
    let hallZ = 0, supportZ = 0, supportX = 0;
    let rooms = [], galR = null, elecR = null;
    let bx0 = 0, bx1 = 0, bz0 = 0, bz1 = 0, builtM2 = 0;

    if (plan) {
      // centre the plan's bounding box on the origin; every rect and every row is
      // then read straight off the plan — there is no second copy of the geometry
      const bb = plan.g.bbox;
      const dx = -(bb.x0 + bb.x1) / 2, dz = -(bb.z0 + bb.z1) / 2;
      const mv = (r) => ({ x0: r.x0 + dx, x1: r.x1 + dx, z0: r.z0 + dz, z1: r.z1 + dz,
                           kind: r.kind, axis: r.axis });
      rooms = plan.g.rects.map(mv);
      galR = rooms[plan.g.rects.indexOf(plan.g.gallery)];
      elecR = rooms[plan.g.rects.indexOf(plan.g.elec)];
      for (const r of plan.g.rows) {
        rowsZ.push({ z: r.z + dz, face: r.face, x0: r.x0 + dx,
                     cap: r.cap, len: r.rowLen, wing: r.wing });
      }
      supportZ = plan.g.support.supportZ + dz;
      supportX = plan.g.support.supportX + dx;
      bx0 = bb.x0 + dx; bx1 = bb.x1 + dx; bz0 = bb.z0 + dz; bz1 = bb.z1 + dz;
      builtM2 = plan.g.built;            // gross built area: the drawn rects, summed
      // reported hall dimensions: the widest wing's interior width, and the two
      // wings' stacked interior depth — what an operator reads off the plan
      hallX = max(ltHallW(plan.c.pA), ltHallW(plan.c.pB));
      hallZ = (bz1 - bz0) - 2 * WALL;
      rowLen = rowsZ.reduce((m, r) => max(m, r.len), 0);
      rows = rowsZ.length;
      perRow = rowsZ.reduce((m, r) => max(m, r.cap), 0);
    } else {
      // auto/square/rect: the reference z-stack, unchanged
      let z = 0;
      for (let i = 0; i < rows; i++) {
        if (i % 2 === 0) { z += COLD; rowsZ.push({ z: z, face: -1, x0: -rowLen / 2.0 }); z += rd; }
        else { z += HOT; rowsZ.push({ z: z, face: +1, x0: -rowLen / 2.0 }); z += rd; }
      }
      z += COLD;
      supportZ = z;
      z += rd + END_CLEAR;
      hallZ = z;
      const zOff = -hallZ / 2.0;         // center the hall at origin
      for (const r of rowsZ) { r.z += zOff; r.cap = perRow; r.len = rowLen; }
      supportZ += zOff;
      bx0 = -hallX / 2 - WALL - GALLERY_W - WALL; bx1 = hallX / 2 + WALL + ELEC_W + WALL;
      bz0 = zOff - WALL; bz1 = zOff + hallZ + WALL;
      galR = { x0: bx0, x1: bx0 + GAL_STRIP, z0: bz0, z1: bz1, kind: "gallery", axis: "z" };
      elecR = { x0: bx1 - ELEC_STRIP, x1: bx1, z0: bz0, z1: bz1, kind: "elec", axis: "z" };
      rooms = [galR,
               { x0: bx0 + GAL_STRIP, x1: bx1 - ELEC_STRIP, z0: bz0, z1: bz1, kind: "hall-a" },
               elecR];
      builtM2 = (bx1 - bx0) * (bz1 - bz0);
    }
    const hallZC = 0;

    // ---- room-face helpers: service placement is MEASURED off the rooms -----
    // An interior lane is the room inset by WALL on every face that is EXTERIOR
    // (no other room on the far side). For the reference building this reproduces
    // the previous hardcoded galX/elecX/txX to the millimetre — the gallery's west
    // face is exterior and its east face is the hall partition, so the lane centre
    // is bx0 + WALL + GALLERY_W/2 — while also placing the equipment correctly in
    // an L or a T, where the gallery is in an elbow or across an end face.
    const faceOpen = (r, f) => {
      for (const o of rooms) {
        if (o === r) continue;
        const zo = min(o.z1, r.z1) - max(o.z0, r.z0);
        const xo = min(o.x1, r.x1) - max(o.x0, r.x0);
        if (f === "x0" && abs(o.x1 - r.x0) < 1e-9 && zo > 1e-9) return false;
        if (f === "x1" && abs(o.x0 - r.x1) < 1e-9 && zo > 1e-9) return false;
        if (f === "z0" && abs(o.z1 - r.z0) < 1e-9 && xo > 1e-9) return false;
        if (f === "z1" && abs(o.z0 - r.z1) < 1e-9 && xo > 1e-9) return false;
      }
      return true;
    };
    const lane = (r) => {
      const ix0 = r.x0 + (faceOpen(r, "x0") ? WALL : 0);
      const ix1 = r.x1 - (faceOpen(r, "x1") ? WALL : 0);
      const iz0 = r.z0 + (faceOpen(r, "z0") ? WALL : 0);
      const iz1 = r.z1 - (faceOpen(r, "z1") ? WALL : 0);
      return (r.axis || "z") === "z"
        ? { axis: "z", a0: iz0, a1: iz1, len: iz1 - iz0, c: (ix0 + ix1) / 2 }
        : { axis: "x", a0: ix0, a1: ix1, len: ix1 - ix0, c: (iz0 + iz1) / 2 };
    };
    // the exterior face a room presents to the yard, across its own short axis
    const outerFace = (r) => {
      if ((r.axis || "z") === "z") {
        return faceOpen(r, "x1") ? { n: "x", s: +1, at: r.x1 }
             : faceOpen(r, "x0") ? { n: "x", s: -1, at: r.x0 } : null;
      }
      return faceOpen(r, "z1") ? { n: "z", s: +1, at: r.z1 }
           : faceOpen(r, "z0") ? { n: "z", s: -1, at: r.z0 } : null;
    };
    const galLane = lane(galR), elecLane = lane(elecR);

    const S = [];                        // scene spec: boxes
    const box = (group, mat, x, y, zc, w, h, d) =>
      S.push({ g: group, m: mat, x: x, y: y, z: zc, w: w, h: h, d: d });
    // place a box on a service lane: `a` along the lane axis, `p` across it;
    // wa = size along the lane, wp = size across it. One call site per equipment
    // type serves a z-running gallery and an x-running end-face gallery alike.
    const onLane = (L, group, mat, a, p, y, wa, h, wp) => {
      if (L.axis === "z") box(group, mat, L.c + p, y, a, wp, h, wa);
      else box(group, mat, a, y, L.c + p, wa, h, wp);
    };

    // ---- DSX-70: service runs carry their CHAIN IDENTITY ------------------
    // A run made of touching-but-not-joined boxes looks identical to a jointed
    // one unless the scene says which box follows which. So every service
    // segment declares:
    //   r  run id       — the chain it belongs to
    //   q  sequence     — 0-based position in that chain; consecutive q must
    //                     MEET surface-to-surface on ALL THREE axes
    //   j  join         — the run this chain taps; the q=0 segment must meet
    //                     some segment of run j (branches off a backbone)
    // Additive only: the geometry fields are untouched and the viewer reads
    // g/m/x/y/z/w/h/d, so annotating cannot move a box.
    const runQ = {};
    const seg = (group, mat, runId, joinId, x, y, zc, w, h, d) => {
      const q = runQ[runId] || 0;
      runQ[runId] = q + 1;
      const b = { g: group, m: mat, x: x, y: y, z: zc, w: w, h: h, d: d,
                  r: runId, q: q };
      if (joinId && q === 0) b.j = joinId;
      S.push(b);
      return b;
    };

    // racks + doors (instanced by the viewer) — track positions for service drops
    const rackPositions = [];            // { x, y, z, w, h, d, rowIdx }
    let placed = 0;
    for (let ri = 0; ri < rowsZ.length && placed < racks; ri++) {
      const r = rowsZ[ri];
      const inRow = min(r.cap, racks - placed);
      for (let i = 0; i < inRow; i++) {
        const cx = r.x0 + rw / 2 + i * (rw + GAP);
        const zc = r.z + rd / 2;
        box("racks", "rack", cx, rh / 2, zc, rw, rh, rd);
        box("racks", "door", cx, rh / 2, zc + r.face * (rd / 2 + 0.012), rw - 0.08, rh - 0.12, 0.02);
        rackPositions.push({ x: cx, y: rh / 2, z: zc, w: rw, h: rh, d: rd, rowIdx: ri });
      }
      placed += inRow;
    }
    // support/mgmt row — centred on whichever wing the plan gave it (auto: x=0)
    for (let i = 0; i < 6; i++) {
      box("racks", "fabric", supportX - (6 * 0.6 + 5 * GAP) / 2 + 0.3 + i * 0.65, 1.1,
          supportZ + rd / 2, 0.6, 2.2, 1.2);
    }
    // containment over each hot aisle: a face -1 row immediately followed by a
    // face +1 row in the SAME wing (a hot aisle never crosses a wall).
    for (let i = 0; i + 1 < rowsZ.length; i++) {
      const a = rowsZ[i], b = rowsZ[i + 1];
      if (a.wing !== b.wing || a.face !== -1 || b.face !== +1) continue;
      const cx0 = min(a.x0, b.x0), cx1 = max(a.x0 + a.len, b.x0 + b.len);
      box("racks", "containment", (cx0 + cx1) / 2, rh + 0.03,
          a.z + rd + HOT / 2, cx1 - cx0, 0.06, HOT);
    }

    // ---- F4: Service connections (power, fiber, liquid) with anchored endpoints ----
    // Busway backbone per row (short segments, not full-hall spans)
    for (let ri = 0; ri < rowsZ.length; ri++) {
      const zc = rowsZ[ri].z + rd / 2;
      const rowRacks = rackPositions.filter(rp => rp.rowIdx === ri);
      if (rowRacks.length === 0) continue;
      const rowX0 = Math.min(...rowRacks.map(rp => rp.x)) - rw/2 - 0.3;
      const rowX1 = Math.max(...rowRacks.map(rp => rp.x)) + rw/2 + 0.3;
      const busLen = rowX1 - rowX0;
      // Dual busway A/B per row (backbone segments)
      for (let fi = 0; fi < BUSWAY_Y.length; fi++) {
        seg("power", "busway", "bus-" + ri + "-" + fi, null,
            (rowX0 + rowX1)/2, BUSWAY_Y[fi], zc, busLen, 0.15, 0.15);
      }
      // Fiber tray backbone per row
      seg("fiber", "tray", "tray-" + ri, null,
          (rowX0 + rowX1)/2, TRAY_Y, zc, busLen, 0.10, 0.45);
    }
    // Support row fiber tray
    seg("fiber", "tray", "tray-support", null,
        supportX, TRAY_Y, supportZ + rd / 2, 6 * 0.6 + 5 * GAP + 0.6, 0.10, 0.45);

    // Power drops: busway → rack (dual A/B feed per rack)
    const POWER_DROP_W = 0.04;           // [A] drop whip diameter
    for (let rIdx = 0; rIdx < rackPositions.length; rIdx++) {
      const rack = rackPositions[rIdx];
      const rackTop = rack.y + rack.h/2;
      const rackZ = rack.z;
      // Dual feed: A (busway[0]) and B (busway[1])
      for (let feedIdx = 0; feedIdx < 2; feedIdx++) {
        const busY = BUSWAY_Y[feedIdx];
        const dropX = rack.x + (feedIdx === 0 ? -0.15 : 0.15);  // offset for dual feed
        const dropH = busY - rackTop;
        const dropY = (busY + rackTop) / 2;
        seg("power", "drop", "pdrop-" + rIdx + "-" + feedIdx,
            "bus-" + rack.rowIdx + "-" + feedIdx,
            dropX, dropY, rackZ, POWER_DROP_W, dropH, POWER_DROP_W);
      }
    }

    // Fiber drops: tray → rack top-of-rack
    const FIBER_DROP_W = 0.03;           // [A] fiber bundle diameter
    for (let rIdx = 0; rIdx < rackPositions.length; rIdx++) {
      const rack = rackPositions[rIdx];
      const rackTop = rack.y + rack.h/2;
      const dropH = TRAY_Y - rackTop;
      const dropY = (TRAY_Y + rackTop) / 2;
      seg("fiber", "drop", "fdrop-" + rIdx, "tray-" + rack.rowIdx,
          rack.x, dropY, rack.z, FIBER_DROP_W, dropH, FIBER_DROP_W);
    }

    // ---- mechanical gallery: CRAH + CDU rows, capped display --------------
    // Placed ALONG the gallery lane measured off the gallery room, so the units
    // follow the room wherever the wing plan put it (west strip for auto, inner
    // elbow for L, re-entrant corner or end face for T).
    //
    // The reference spacing is used wherever it fits. A SHORT wing-plan gallery
    // gets the lane split between the two banks in proportion to the length each
    // needs, each bank's pitch compressed to its own units, and the DRAWN count
    // reduced to what fits at unit pitch — so no unit is ever drawn through the
    // room's own wall or on top of its neighbour. The same clamp discipline the
    // cooler pad applies on the apron. Engineering counts (nCrah/nCdu) are
    // untouched: only the display is capped, and the stats line says so.
    const CRAH_D = 0.9, CDU_D = 1.24;    // unit footprint ALONG the gallery lane
    const crahWant = [], cduWant = [];
    for (let i = 0; i < crahShown; i++) {
      crahWant.push(galLane.a0 + 1.6 + i * ((galLane.len - 3.2) / max(1, crahShown - 1) || 1));
    }
    for (let i = 0; i < cduShown; i++) cduWant.push(galLane.a1 - 2.0 - i * 1.6);
    const inGal = (a, sz) =>
      a >= galLane.a0 + sz / 2 - 1e-9 && a <= galLane.a1 - sz / 2 + 1e-9;
    const bank = (n, sz, b0, b1) => {    // <=n centres inside [b0,b1], pitch >= sz
      const k = min(n, max(0, Math.floor((b1 - b0) / sz)));
      const lo = b0 + sz / 2, hi = b1 - sz / 2, st = k > 1 ? (hi - lo) / (k - 1) : 0;
      const out = [];
      for (let i = 0; i < k; i++) out.push(k > 1 ? lo + i * st : (b0 + b1) / 2);
      return out;
    };
    let crahAt = crahWant, cduAt = cduWant;
    if (!(crahWant.every((a) => inGal(a, CRAH_D)) && cduWant.every((a) => inGal(a, CDU_D)))) {
      const needC = crahShown * CRAH_D, needD = cduShown * CDU_D;
      const mid = galLane.a0 + galLane.len * (needC / max(1e-9, needC + needD));
      crahAt = bank(crahShown, CRAH_D, galLane.a0, mid);
      cduAt = bank(cduShown, CDU_D, mid, galLane.a1);
    }
    for (const a of crahAt) onLane(galLane, "liquid", "crah", a, 0, 1.0, CRAH_D, 2.0, 1.0);
    const cduPositions = [];             // track CDU positions for liquid runs
    for (const a of cduAt) {
      onLane(galLane, "liquid", "cdu", a, 0, 1.03, CDU_D, 2.07, 0.9);
      const u = S[S.length - 1];
      cduPositions.push({ x: u.x, y: u.y, z: u.z, w: u.w, h: u.h, d: u.d });
    }
    const crahDrawn = crahAt.length, cduDrawn = cduAt.length;
    // ---- electrical rooms + MV yard ---------------------------------------
    const upsShown = min(nUpsPerPath, DISPLAY_CAPS.ups);
    for (const [tag, a] of [["A", elecLane.a0 + elecLane.len * 0.25],
                            ["B", elecLane.a0 + elecLane.len * 0.75]]) {
      onLane(elecLane, "power", "swgr", a + (tag === "A" ? -1.6 : 1.6), -1.3, 1.1, 2.6, 2.2, 0.9);
      for (let i = 0; i < upsShown; i++) {
        onLane(elecLane, "power", "ups", a + (i - (upsShown - 1) / 2) * 1.1, 0.4, 1.0, 0.9, 2.0, 2.0);
      }
      onLane(elecLane, "power", "ups", a + (tag === "A" ? -2.6 : 2.6), 0.4, 0.8, 0.9, 1.6, 2.0);
    }
    // MV yard: outboard of the electrical rooms' own exterior face, spread along
    // that face. For the reference building this is x = bx1 + 1.6 with the units
    // marching south — the same coordinates as before, now derived, not restated.
    const MV_CLEAR = 1.6;                // [A] MV yard <-> electrical room gap
    const ef = outerFace(elecR) || { n: "x", s: +1, at: bx1 };
    const txLane = ef.n === "x"
      ? { axis: "z", a0: elecR.z0, a1: elecR.z1, len: elecR.z1 - elecR.z0, c: ef.at + ef.s * MV_CLEAR }
      : { axis: "x", a0: elecR.x0, a1: elecR.x1, len: elecR.x1 - elecR.x0, c: ef.at + ef.s * MV_CLEAR };
    const txShown = min(max(nTx, 2), DISPLAY_CAPS.transformer);
    for (let i = 0; i < txShown; i++) {
      const a = txLane.a0 + 2.8 + i * ((txLane.len - 5.6) / max(1, txShown - 1) || 1);
      onLane(txLane, "power", "transformer", a, 0, 0.9, 2.0, 1.8, 1.4);
      for (let k = 0; k < 3; k++) {
        onLane(txLane, "power", "transformer", a, 0.95 + k * 0.22, 0.7, 1.6, 1.4, 0.10);
      }
    }
    // east edge of the MV yard (the apron reads it below)
    const txX = txLane.axis === "z" ? txLane.c : bx1 + MV_CLEAR;
    // ---- shell -------------------------------------------------------------
    const bw = bx1 - bx0, bd = bz1 - bz0, bxc = (bx0 + bx1) / 2;
    if (plan) {
      // An L or a T is not a rectangle, so it cannot be drawn as four walls and
      // one slab: every room gets an exterior wall on each OPEN face and its own
      // roof, and each shared face gets exactly ONE partition (drawn once).
      for (const r of rooms) {
        const rwx = r.x1 - r.x0, rdz = r.z1 - r.z0;
        const cxr = (r.x0 + r.x1) / 2, czr = (r.z0 + r.z1) / 2;
        if (faceOpen(r, "z0")) box("shell", "shell", cxr, CLEAR_H / 2, r.z0 + WALL / 2, rwx, CLEAR_H, WALL);
        if (faceOpen(r, "z1")) box("shell", "shell", cxr, CLEAR_H / 2, r.z1 - WALL / 2, rwx, CLEAR_H, WALL);
        if (faceOpen(r, "x0")) box("shell", "shell", r.x0 + WALL / 2, CLEAR_H / 2, czr, WALL, CLEAR_H, rdz);
        if (faceOpen(r, "x1")) box("shell", "shell", r.x1 - WALL / 2, CLEAR_H / 2, czr, WALL, CLEAR_H, rdz);
        box("shell", "shell", cxr, CLEAR_H + 0.125, czr, rwx, 0.25, rdz);
      }
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i], b = rooms[j];
          const zo0 = max(a.z0, b.z0), zo1 = min(a.z1, b.z1);
          const xo0 = max(a.x0, b.x0), xo1 = min(a.x1, b.x1);
          if (zo1 - zo0 > 1e-9 && (abs(a.x1 - b.x0) < 1e-9 || abs(b.x1 - a.x0) < 1e-9)) {
            box("shell", "shell", abs(a.x1 - b.x0) < 1e-9 ? a.x1 : b.x1, CLEAR_H / 2,
                (zo0 + zo1) / 2, WALL, CLEAR_H, zo1 - zo0);
          }
          if (xo1 - xo0 > 1e-9 && (abs(a.z1 - b.z0) < 1e-9 || abs(b.z1 - a.z0) < 1e-9)) {
            box("shell", "shell", (xo0 + xo1) / 2, CLEAR_H / 2,
                abs(a.z1 - b.z0) < 1e-9 ? a.z1 : b.z1, xo1 - xo0, CLEAR_H, WALL);
          }
        }
      }
    } else {
      box("shell", "shell", bxc, CLEAR_H / 2, bz0 + WALL / 2, bw, CLEAR_H, WALL);
      box("shell", "shell", bxc, CLEAR_H / 2, bz1 - WALL / 2, bw, CLEAR_H, WALL);
      box("shell", "shell", bx0 + WALL / 2, CLEAR_H / 2, hallZC, WALL, CLEAR_H, bd - 2 * WALL);
      box("shell", "shell", bx1 - WALL / 2, CLEAR_H / 2, hallZC, WALL, CLEAR_H, bd - 2 * WALL);
      box("shell", "shell", bxc, CLEAR_H + 0.125, hallZC, bw, 0.25, bd);
    }

    // ---- yard geometry + heat-rejection cell positions (SINGLE SOURCE) -----
    // Hoisted above the liquid block because TWO consumers need it: the F4
    // heat-rejection headers below (which have to terminate on a cell that is
    // actually drawn) and the yard render loop further down (which draws them).
    // DSX-70: the header block used to route to
    //     yardCoolerX = bx0 - WALL - GALLERY_W/2 - 1.2
    // an abscissa with NO cooler at it — so "dry cooler → gallery → CDU" was a
    // pipe ending in mid-air that no gate could tell from a real one. The cells
    // the yard draws are the only cooler positions now, and rejCells.length is
    // the only shown-count, read by the render loop AND the stats label.
    const YARD_CLEAR = 1.7;                                    // [A] tower ↔ shell ground gap
    const TWR_BODY = { w: 3.4, d: 3.6 }, TWR_DECK = { w: 3.0, d: 3.2 }, TWR_BASIN = { w: 3.8, d: 4.0 };
    const GEN_BODY = { w: 4.2, d: 1.6 };
    const TWR_PITCH = max(TWR_BODY.d, TWR_BASIN.d) + 0.6;      // cell-to-cell pitch (=4.6) > deepest footprint
    // basin (widest tower element) sits YARD_CLEAR west of the shell west face
    const dcX = bx0 - (TWR_BASIN.w / 2 + YARD_CLEAR);          // = bx0 - 3.6
    // Apron z-extent (genZ/apZ0/apZ1) — SINGLE SOURCE, computed once here so it
    // dominates both use-sites: the dry/adiabatic cooler-pad clamp bounds (below,
    // in the rej !== "tower" branch) and the rendered floor box (land model). One
    // edit to these literals now moves the clamp and the drawn apron together, so
    // they cannot drift (F-02 follow-up). Independent of the tower branch.
    const GEN_CLEAR = 2.6;                                     // [A] genset body ↔ shell ground gap
    const genZ = bz0 - (GEN_BODY.d / 2 + GEN_CLEAR);          // = bz0 - 3.4
    const apZ0 = genZ - 2.4, apZ1 = bz1 + 3.4;                // apron z-extent shared by clamp + floor box
    // Pitch-fit cap on the dry/adiabatic cooler pad — SINGLE SOURCE, computed once here so
    // BOTH the render loop (rej !== "tower", below) and the stats label read ONE maxSafeCells;
    // depends only on apZ0/apZ1 + literals (all in scope). One edit moves the drawn pad count
    // and the label's shown count together, so the scene can't silently undercount (F-02 follow-up).
    const cellHalfD = 2.5;
    const apZSpan = apZ1 - apZ0;
    const minPitch = 2 * cellHalfD;  // collision-free floor: pitch >= cell depth
    // Max cells that fit with minPitch: (N-1)*minPitch + 2*cellHalfD <= apZSpan
    const maxSafeCells = max(1, Math.floor(1 + (apZSpan - 2 * cellHalfD) / minPitch));
    // Every heat-rejection cell the yard will draw, plus the point on its WATER
    // side that a facility-water header taps. connX is the cell's east face (the
    // side facing the building); connY is the elevation at which a riser standing
    // on that face TOUCHES the drawn cell — the tap point has to be on a box that
    // exists, or the header starts in mid-air:
    //   tower -> the cold-water basin (y 0..0.7), tapped at mid-height
    //   dry/adiabatic -> the top of the cell body (y 0..2.4), tapped at its east
    //     edge. NOT the coil bank at y 2.46: those boxes are only 1.6 m wide
    //     (x dcX+-0.8) and so are 0.27 m inboard of this face. [D]
    const rejCells = [];               // [{ z, connX, connY }]
    if (rej === "tower") {
      const towerShown = min(nTower, DISPLAY_CAPS.tower);
      for (let i = 0; i < towerShown; i++) {
        rejCells.push({
          z: hallZC - ((towerShown - 1) * TWR_PITCH) / 2 + i * TWR_PITCH,
          connX: dcX + TWR_BASIN.w / 2, connY: 0.35,
        });
      }
    } else {
      // Clamp cooler pad z-extent within apron bounds (F-02): each cell has depth d=5.0,
      // so its z-extent is [dz-2.5, dz+2.5]. Cap shown count to what fits with collision-
      // free pitch (>= cell depth), then compress pitch and recenter if still needed.
      const dryShown = min(nDry, DISPLAY_CAPS.drycooler, maxSafeCells);
      const rawPitch = 5.4;
      const rawSpan = dryShown > 1 ? (dryShown - 1) * rawPitch : 0;
      const rawZ0 = hallZC - rawSpan / 2 - cellHalfD;
      const rawZ1 = hallZC + rawSpan / 2 + cellHalfD;
      const apZC = (apZ0 + apZ1) / 2;
      const padRequiredZSpan = rawZ1 - rawZ0;
      let pitch = rawPitch, padZC = hallZC;
      if (padRequiredZSpan > apZSpan) {
        // Compress pitch to fit within apron, but never below cell depth (collision-free floor)
        const maxCellSpan = apZSpan - 2 * cellHalfD;  // available for (n-1) gaps
        pitch = dryShown > 1 ? max(minPitch, maxCellSpan / (dryShown - 1)) : 0;
        padZC = apZC;  // recenter on apron
      } else if (rawZ0 < apZ0 || rawZ1 > apZ1) {
        // Raw span fits but is off-center; recenter on apron
        padZC = apZC;
      }
      for (let i = 0; i < dryShown; i++) {
        rejCells.push({
          z: padZC - ((dryShown - 1) * pitch) / 2 + i * pitch,
          connX: dcX + 2.2 / 2, connY: 2.4,   // cell body: y 1.2 +- 2.4/2
        });
      }
    }

    // ---- F4: Liquid runs (CDU ports → row manifolds → racks) [S] endpoints, [A] routing ----
    // USD port coordinates relative to CDU center (from xdu1350_cdu_ConnectionPoints.usda)
    const CDU_PORTS = {
      fws_supply: { x: -0.27, y: 0.6215, z: 0.30 },   // facility water supply
      fws_return: { x: -0.07, y: 0.6215, z: 0.30 },   // facility water return
      tcs_supply: { x: 0.13, y: 0.6215, z: 0.30 },    // tech cooling supply (to racks)
      tcs_return: { x: 0.33, y: 0.6215, z: 0.30 },    // tech cooling return (from racks)
    };
    const PIPE_W = 0.05;                 // [A] pipe diameter for visibility
    const LIQUID_Y = 0.45;               // [A] liquid runs at low elevation (below tray, above floor)
    const SUP_Y = LIQUID_Y;              // [A] TCS supply elevation
    const RET_Y = LIQUID_Y + 0.14;       // [A] TCS return runs 140 mm above supply, so
                                         //     the two sides never share a lane
    const QD_W = PIPE_W * 0.7;           // [A] rack whip diameter
    const QD_CLEAR = 0.05;               // [A] pipe-to-rack-face standoff
    const QD_RET_PITCH = 0.14;           // [A] the return whip stands this much further off
                                         //     the rack face than the supply whip, so the two
                                         //     row manifolds occupy different planes

    // ---- where the trunks run: MEASURED off the gallery room ----------------
    // DSX-70 put the TCS trunk at a hardcoded `-hallX/2 - WALL - 0.1`, which is
    // the aisle between the CRAH/CDU line and the hall's west wall — true for a
    // single-rectangle hall, and only for that. DSX-68's wing plans put the
    // gallery in an inner elbow (L) or across an END FACE, running along x (T),
    // so the same literal lands INSIDE hall-a for an L and OUTSIDE the shell
    // entirely for a T: pipes through racks, and pipes in mid-air, which is the
    // exact class of defect DSX-70 exists to remove. DSX-70's gate runs one
    // scenario at `auto` shape and cannot see either.
    //
    // The lane is therefore derived: the trunk hugs the gallery's HALL-SIDE
    // partition face, offset TRUNK_OFF into the gallery, and runs along the
    // gallery's own axis. For the reference building this reproduces DSX-70's
    // literal to the millimetre — galR.x1 is the hall partition at -hallX/2 -
    // WALL, so galR.x1 - 0.1 IS -hallX/2 - WALL - 0.1 — while following the
    // gallery wherever the wing plan put it. [D]
    // 0.1 m off the gallery's hall-side face. NOTE, and see
    // workstations/twin/CARD-72-F4-WING-ROUTING-GAP.md for the measurements: an
    // L/T plan draws its interior partitions CENTRED on
    // the shared room face, so that wall intrudes WALL/2 into the gallery and a
    // 0.1 m standoff puts a 50 mm pipe 25 mm inside it. Widening the standoff is
    // NOT the fix — an L's rows sit on the far side of that partition from its
    // elbow gallery, so the trunk-to-row runs have to cross the wall line however
    // far off it the trunk stands. F4 needs a partition-crossing mechanism for the
    // wing plans (DSX-70 already built one for the yard wall: a below-grade
    // trench), which is a design change beyond this integration and is reported,
    // not half-applied. Kept at DSX-70's reviewed value so every shape that does
    // pass keeps DSX-70's exact geometry.
    const TRUNK_OFF = 0.1;
    const neighbourOn = (r, f) => {
      for (const o of rooms) {
        if (o === r) continue;
        const zo = min(o.z1, r.z1) - max(o.z0, r.z0);
        const xo = min(o.x1, r.x1) - max(o.x0, r.x0);
        if (f === "x0" && abs(o.x1 - r.x0) < 1e-9 && zo > 1e-9) return o;
        if (f === "x1" && abs(o.x0 - r.x1) < 1e-9 && zo > 1e-9) return o;
        if (f === "z0" && abs(o.z1 - r.z0) < 1e-9 && xo > 1e-9) return o;
        if (f === "z1" && abs(o.z0 - r.z1) < 1e-9 && xo > 1e-9) return o;
      }
      return null;
    };
    const isHallRoom = (o) => !!o && String(o.kind).indexOf("hall") === 0;
    // the gallery face that looks at a hall, and the sign that points from it
    // INTO the gallery. Checked hall-first, not merely closed-first: a T's end-
    // face gallery is closed on BOTH z faces (hall to the north, electrical to
    // the south) and only one of them is the side the racks are on.
    const faceAt = (r, f) => (f === "x0" ? r.x0 : f === "x1" ? r.x1
                            : f === "z0" ? r.z0 : r.z1);
    // the two faces across a room's SHORT axis, each with the sign that points
    // from it INTO the room
    const crossFaces = (r) => ((r.axis || "z") === "z" ? [["x1", -1], ["x0", +1]]
                                                      : [["z0", +1], ["z1", -1]]);
    const crossFace = (r, wantHall) => {
      for (const f of crossFaces(r)) {
        if (isHallRoom(neighbourOn(r, f[0])) !== wantHall) continue;
        return { at: faceAt(r, f[0]), s: f[1] };
      }
      return null;
    };
    const hallFace = (r) => crossFace(r, true);
    const galPart = hallFace(galR);
    const galFar = crossFace(galR, false);               // the gallery's far side
    const TRUNK_AX = galLane.axis;                       // "z" for auto/L, "x" for T
    // perpendicular coordinate of the trunk lane
    const TRUNK_P = galPart ? galPart.at + galPart.s * TRUNK_OFF : galLane.c;

    // Axis-aligned run emitters. A Manhattan run's turns are where continuity
    // breaks, so the turns are all these compute: each leg spans CENTRE to CENTRE
    // of the turn points, which makes consecutive legs overlap at the corner
    // instead of merely aiming at it. A zero-length leg is skipped — a 0-dimension
    // box is not geometry — and because seg() numbers q as it emits, skipping one
    // never leaves a hole in the chain.
    const EPS_LEN = 1e-9;
    // Racks that actually received a supply+return whip. The stats line used to
    // claim rackPositions.length * 2 liquid drops whether or not a CDU reached
    // them; it now counts what was drawn (DSX-70).
    let qdPairs = 0;
    const runX = (mat, runId, joinId, x0v, x1v, yv, zv, wdt) => {
      if (abs(x1v - x0v) < EPS_LEN) return;
      seg("liquid", mat, runId, joinId, (x0v + x1v) / 2, yv, zv, abs(x1v - x0v), wdt, wdt);
    };
    const runZ = (mat, runId, joinId, xv, yv, z0v, z1v, wdt) => {
      if (abs(z1v - z0v) < EPS_LEN) return;
      seg("liquid", mat, runId, joinId, xv, yv, (z0v + z1v) / 2, wdt, wdt, abs(z1v - z0v));
    };
    const runY = (mat, runId, joinId, xv, y0v, y1v, zv, wdt) => {
      if (abs(y1v - y0v) < EPS_LEN) return;
      seg("liquid", mat, runId, joinId, xv, (y0v + y1v) / 2, zv, wdt, abs(y1v - y0v), wdt);
    };
    // The same two emitters expressed in LANE coordinates, so one body of routing
    // code serves a z-running gallery (auto, L) and an x-running end-face gallery
    // (T) alike: `a` is along the lane axis, `p` is across it. For TRUNK_AX="z"
    // these reduce to runZ/runX exactly as DSX-70 wrote them.
    const runAlong = (mat, runId, joinId, a0, a1, yv, p, wdt) =>
      TRUNK_AX === "z" ? runZ(mat, runId, joinId, p, yv, a0, a1, wdt)
                       : runX(mat, runId, joinId, a0, a1, yv, p, wdt);
    const runAcross = (mat, runId, joinId, p0, p1, yv, a, wdt) =>
      TRUNK_AX === "z" ? runX(mat, runId, joinId, p0, p1, yv, a, wdt)
                       : runZ(mat, runId, joinId, a, yv, p0, p1, wdt);
    // a point's coordinate along / across the lane axis
    const cA = (x, z) => (TRUNK_AX === "z" ? z : x);
    const cP = (x, z) => (TRUNK_AX === "z" ? x : z);
    // A route stated as its TURN POINTS, emitted leg by leg. Each leg moves along
    // exactly one axis; runLeg picks that axis from the two points, so a turn
    // cannot be described inconsistently with the leg that reaches it. joinId is
    // passed to every leg because seg() records it only on q === 0 — that way a
    // skipped zero-length first leg still leaves the tap on whichever leg is
    // actually first. A route whose turn list contains a repeated point (an
    // unused turn for this shape) therefore degenerates cleanly.
    const runLeg = (mat, runId, joinId, a, b, wdt) => {
      if (abs(b.x - a.x) > EPS_LEN) runX(mat, runId, joinId, a.x, b.x, a.y, a.z, wdt);
      else if (abs(b.y - a.y) > EPS_LEN) runY(mat, runId, joinId, a.x, a.y, b.y, a.z, wdt);
      else runZ(mat, runId, joinId, a.x, a.y, a.z, b.z, wdt);
    };
    const runPath = (mat, runId, joinId, pts, wdt) => {
      for (let i = 1; i < pts.length; i++) runLeg(mat, runId, joinId, pts[i - 1], pts[i], wdt);
    };

    if (v.liquid_pct > 0 && cduPositions.length > 0) {
      // ---- who serves which row --------------------------------------------
      // DSX-70. This used to be a +-2.0 m window per CDU, which is not a
      // partition: it double-served and it under-served at the same time. At
      // b200-liquid/2048/dry/auto that produced three COINCIDENT manifolds on
      // row 7 (one per CDU, same y, same z, same x-span) and duplicate whips on
      // its racks, while rows 0-5 — six of eight — got no liquid at all. [D]
      // Every row is now owned by exactly ONE CDU, the nearest in z, so a
      // manifold is never drawn twice and no row is left dry.
      const rowOwner = {};                      // rowIdx -> ci
      const rowsOf = cduPositions.map(() => []);
      const rowIdxs = [];
      for (const r of rackPositions) {
        if (rowIdxs.indexOf(r.rowIdx) < 0) rowIdxs.push(r.rowIdx);
      }
      rowIdxs.sort((a, b) => a - b);
      for (const rowIdx of rowIdxs) {
        const rowZ = rackPositions.filter(r => r.rowIdx === rowIdx)[0].z;
        let owner = 0;
        for (let ci = 1; ci < cduPositions.length; ci++) {
          if (abs(cduPositions[ci].z - rowZ) < abs(cduPositions[owner].z - rowZ)) owner = ci;
        }
        rowOwner[rowIdx] = owner;
        rowsOf[owner].push(rowIdx);
      }
      // A CDU with no row is a free-floating CDU, which F4 forbids. Take one
      // from whichever CDU holds the most — a transfer, not a copy, so the
      // partition survives. If there are fewer rows than CDUs there is nothing
      // to transfer and the leftover CDU keeps its trunk but gains no manifold.
      for (let ci = 0; ci < cduPositions.length; ci++) {
        if (rowsOf[ci].length > 0) continue;
        let donor = -1;
        for (let dj = 0; dj < cduPositions.length; dj++) {
          if (rowsOf[dj].length > 1 && (donor < 0 || rowsOf[dj].length > rowsOf[donor].length)) donor = dj;
        }
        if (donor < 0) continue;
        let take = rowsOf[donor][0];
        for (const rowIdx of rowsOf[donor]) {
          const z = (i) => rackPositions.filter(r => r.rowIdx === i)[0].z;
          if (abs(z(rowIdx) - cduPositions[ci].z) < abs(z(take) - cduPositions[ci].z)) take = rowIdx;
        }
        rowsOf[donor] = rowsOf[donor].filter(i => i !== take);
        rowsOf[ci].push(take);
        rowOwner[take] = ci;
      }

      // For each CDU, generate supply and return runs to the rows it owns
      for (let ci = 0; ci < cduPositions.length; ci++) {
        const cdu = cduPositions[ci];
        const supRun = "tcs_sup-" + ci, retRun = "tcs_ret-" + ci;
        // CDU base is at y = cdu.y - cdu.h/2 = 1.03 - 1.035 = -0.005
        const cduBase = cdu.y - cdu.h/2;

        // TCS (tech cooling) supply: CDU → rack row manifold
        const tcsSupplyPort = {
          x: cdu.x + CDU_PORTS.tcs_supply.x,
          y: cduBase + CDU_PORTS.tcs_supply.y,
          z: cdu.z + CDU_PORTS.tcs_supply.z - 0.62,  // CDU z-offset
        };

        // TCS return: rack row manifold → CDU
        const tcsReturnPort = {
          x: cdu.x + CDU_PORTS.tcs_return.x,
          y: cduBase + CDU_PORTS.tcs_return.y,
          z: cdu.z + CDU_PORTS.tcs_return.z - 0.62,
        };

        // The rows this CDU owns, from the partition above.
        // A CDU may legitimately own no row: the engine's CDU count is not tied to
        // the row count, and where rows < CDUs the donor transfer above has nothing
        // left to hand over. DSX-70 skipped such a CDU with `continue`, which left
        // it with NO piping at all — a free-floating CDU, the very thing §F4
        // forbids, and the reason rect-2:1 and rect-3:1 fail DSX-70's own gate
        // (measured: 2 failures each, "no tcs_supply/tcs_return run endpoint within
        // 1 mm of the USD port"). It is not reachable at `auto`, the only shape
        // DSX-70's gate runs, so DSX-70 could not see it. Its trunk is drawn either
        // way; only the manifolds are conditional on owning a row.
        const rowsServed = rowsOf[ci].slice().sort((a, b) => a - b);
        const nearbyRacks = rackPositions.filter(r => rowOwner[r.rowIdx] === ci);

        // Pass 1: the QD plane of every row this CDU serves.
        //
        // DSX-70. `manifoldX`/`manifoldZ` used to be routing TARGETS with no box
        // at them: the trunk aimed at the middle of the row and stopped, and the
        // per-rack whips were drawn at the rack faces. Nothing joined the two, so
        // every whip floated 0.18-1.83 m from the nearest pipe. A row manifold is
        // now a DRAWN run, and the whips tap it.
        //
        // One expression decides the plane the manifold AND every whip on the row
        // stand off the rack face at, so they cannot drift apart. Rows always run
        // along x in this engine (a rowsZ entry is a z + a face + an x span), so
        // the QD plane is a Z offset in every shape.
        const rowPlanes = rowsServed.map((rowIdx) => {
          const rowRacks = nearbyRacks.filter(r => r.rowIdx === rowIdx);
          const rack = rowRacks[0];      // a row's racks share z and depth
          const face = (rowsZ[rowIdx] && rowsZ[rowIdx].face) || -1;
          const qdZ = rack.z + face * (rack.d / 2 + QD_CLEAR);
          return {
            rowIdx: rowIdx, racks: rowRacks, zSup: qdZ,
            zRet: qdZ + face * QD_RET_PITCH,
            xEast: Math.max(...rowRacks.map(r => r.x + r.w / 2)) + 0.3,
            xWest: Math.min(...rowRacks.map(r => r.x - r.w / 2)) - 0.3,
          };
        });

        // Pass 2: the trunk. CDU port → down to run elevation → across to the
        // gallery trunk lane → along that lane far enough to reach every row it
        // feeds, so each row manifold has trunk to tap at its own tap point.
        //
        // Rows always run along x. So a z-running gallery (auto, square, rect-*, L)
        // puts the trunk PERPENDICULAR to its rows and each row taps it at that
        // row's own QD plane — DSX-70's routing verbatim. A T's end-face gallery
        // runs along x, PARALLEL to its rows, so a row taps the trunk at its own
        // west end instead and the manifold turns once to reach its QD plane. [D]
        const qdPlane = (p, ret) => (ret ? p.zRet : p.zSup);
        const tapA = (p, ret) => (TRUNK_AX === "z" ? qdPlane(p, ret) : p.xWest);
        const trunkSpan = (port, ret) => {
          const as = rowPlanes.map(p => tapA(p, ret)).concat([cA(port.x, port.z)]);
          return { lo: Math.min(...as), hi: Math.max(...as) };
        };
        const supSpan = trunkSpan(tcsSupplyPort, false);
        const retSpan = trunkSpan(tcsReturnPort, true);

        runY("tcs_supply", supRun, null, tcsSupplyPort.x,
             tcsSupplyPort.y, SUP_Y, tcsSupplyPort.z, PIPE_W);
        runAcross("tcs_supply", supRun, null,
                  cP(tcsSupplyPort.x, tcsSupplyPort.z), TRUNK_P, SUP_Y,
                  cA(tcsSupplyPort.x, tcsSupplyPort.z), PIPE_W);
        runAlong("tcs_supply", supRun, null, supSpan.lo, supSpan.hi, SUP_Y,
                 TRUNK_P, PIPE_W);

        runY("tcs_return", retRun, null, tcsReturnPort.x,
             tcsReturnPort.y, RET_Y, tcsReturnPort.z, PIPE_W);
        runAcross("tcs_return", retRun, null,
                  cP(tcsReturnPort.x, tcsReturnPort.z), TRUNK_P, RET_Y,
                  cA(tcsReturnPort.x, tcsReturnPort.z), PIPE_W);
        runAlong("tcs_return", retRun, null, retSpan.lo, retSpan.hi, RET_Y,
                 TRUNK_P, PIPE_W);

        // Pass 3: one supply + one return manifold per row, tapping the trunk,
        // then the per-rack quick disconnects tapping their own row's manifold.
        // The whips stand OFF the rack's aisle face — drawn at rack.z they sat
        // INSIDE the rack volume, which the F4 no-intersection gate forbids.
        // A manifold has to do two things: REACH the trunk and SPAN its row. When
        // the trunk is perpendicular to the row, one leg does both — provided the
        // leg spans the row's full x extent and the trunk, whichever side of the
        // row the gallery is on. DSX-70 wrote it as TRUNK_X -> xEast, which is only
        // both when the gallery is WEST of the racks; an L's gallery sits in the
        // elbow EAST of its long hall, so that leg ran from the trunk to the row's
        // east end and covered none of it (measured: 41 whips floating 0.38-3.0 m
        // off their manifold on L). min/max over the trunk and both row ends is
        // side-agnostic, and reduces to DSX-70's leg exactly on the reference
        // building. When the trunk is PARALLEL to the row (T) one leg cannot do
        // both, so the manifold turns: across to the QD plane, then along the row.
        for (const p of rowPlanes) {
          const supMfd = "mfd_sup-" + ci + "-" + p.rowIdx;
          const retMfd = "mfd_ret-" + ci + "-" + p.rowIdx;
          for (const m of [{ id: supMfd, tap: supRun, mat: "tcs_supply", y: SUP_Y, ret: false },
                           { id: retMfd, tap: retRun, mat: "tcs_return", y: RET_Y, ret: true }]) {
            if (TRUNK_AX === "z") {
              runAcross(m.mat, m.id, m.tap, Math.min(TRUNK_P, p.xWest),
                        Math.max(TRUNK_P, p.xEast), m.y, qdPlane(p, m.ret), PIPE_W);
            } else {
              runAcross(m.mat, m.id, m.tap, TRUNK_P, qdPlane(p, m.ret), m.y,
                        p.xWest, PIPE_W);
              runAlong(m.mat, m.id, null, p.xWest, p.xEast, m.y,
                       qdPlane(p, m.ret), PIPE_W);
            }
          }
          for (let k = 0; k < p.racks.length; k++) {
            const rack = p.racks[k];
            const rackBase = rack.y - rack.h / 2;
            const tag = ci + "-" + p.rowIdx + "-" + k;
            runY("tcs_supply", "qd_sup-" + tag, supMfd,
                 rack.x - 0.1, SUP_Y, rackBase, p.zSup, QD_W);
            runY("tcs_return", "qd_ret-" + tag, retMfd,
                 rack.x + 0.1, RET_Y, rackBase, p.zRet, QD_W);
            qdPairs += 1;
          }
        }
      }

      // ---- Heat-rejection headers: yard coolers → CDU facility-water ports ----
      // DSX-70 rewrote this for two defects, both of which drew a pipe that had
      // no counterpart in the field:
      //
      //  1. The yard→gallery run was TWO bars that stopped on the two faces of
      //     the west wall and called the gap a "sleeved penetration". A sleeve is
      //     not a drawn pipe, and nothing was drawn. Every shell box spans
      //     y 0..CLEAR_H, so the only elevation at which a pipe can cross the
      //     line of a wall without being driven through a wall box is below grade.
      //     The run dips into a trench, crosses, and rises again: both risers are
      //     visible, and the buried length is buried for the same reason it is
      //     buried in the field.
      //
      //  2. The route ended at a fabricated abscissa
      //         yardCoolerX = bx0 - WALL - GALLERY_W/2 - 1.2
      //     which had no cooler at it — §F4's "traceable dry cooler → gallery →
      //     CDU" was a pipe into thin air. It now starts on rejCells, i.e. on the
      //     cells the yard actually draws.
      const HEADER_Y = 2.8;            // [A] header elevation (high in gallery)
      const HDR_W = PIPE_W * 1.3;
      const TRENCH_Y = -0.45;          // [A] below-grade FWS trench, 450 mm to pipe
                                       //     centre: clear of the 60 mm apron slab
                                       //     (y -0.06..0) and of every shell box (y>=0)
      const DIP_CLEAR = 0.3;           // [A] riser standoff from each wall face
      const xOut = bx0 - DIP_CLEAR;              // yard-side riser, outboard of the shell
      const xIn = bx0 + WALL + DIP_CLEAR;        // inboard of the west wall
      // The gallery header hugs the gallery's FAR side — the cross face that is
      // NOT the hall side — so it can never share a volume with the TCS trunk,
      // which hugs the hall side (TRUNK_P). Measured off the room, like the trunk:
      // for the reference building the far side IS the west exterior wall, so this
      // reproduces DSX-70's literal bx0 + WALL + DIP_CLEAR exactly, while an L's
      // notch-side gallery and a T's end-face gallery get their own correct lane.
      const HDR_P = galFar ? galFar.at + galFar.s * (WALL + DIP_CLEAR) : galLane.c;
      // ONE supply and ONE return trunk from the yard into the gallery, then a
      // branch per CDU — a common facility-water loop, which is both how a plant
      // is actually piped and 24 boxes instead of 48 for three CDUs (§F4 keeps
      // the face count within 110% of the pre-change budget).
      // Each side gets its own lane: dy separates the two headers in elevation,
      // dz separates their yard/trench legs, so no two pipes share a volume.
      // The return runs ABOVE the supply so its gallery branch crosses over the
      // supply branch's drop rather than through it.
      const FWS_SIDES = [
        { key: "fws_sup-", port: CDU_PORTS.fws_supply, dy: 0.0, dz: -0.14 },
        { key: "fws_ret-", port: CDU_PORTS.fws_return, dy: 0.14, dz: 0.14 },
      ];
      // A header needs a cooler to start AT. If the yard drew no cells there is
      // nothing to connect to and none is drawn — a pipe to nowhere is exactly
      // what this fix removes.
      if (rejCells.length > 0) {
        // trunk root: the drawn cell nearest the CDU block's z centre
        const cduZMean = cduPositions.reduce((s, c) => s + c.z, 0) / cduPositions.length;
        const cell = rejCells.reduce((best, c) =>
          abs(c.z - cduZMean) < abs(best.z - cduZMean) ? c : best, rejCells[0]);

        for (const side of FWS_SIDES) {
          const hdrY = HEADER_Y + side.dy;
          const trY = TRENCH_Y + side.dy;
          const cellZ = cell.z + side.dz;
          // The trench crosses the shell line in x — the yard is west of it in
          // every shape. Where it SURFACES depends on which axis the gallery runs
          // along, because the header spine has to end up inside the gallery:
          //   gallery along z (auto, L): the crossing itself carries the run to
          //     the spine's abscissa HDR_P, at the cell's own z. For the reference
          //     building HDR_P is xIn and this is DSX-70's route leg for leg.
          //   gallery along x (T): the gallery is an END FACE, so the spine's
          //     cross-coordinate is a z. The trench slides to it in the yard —
          //     below grade and outboard of the shell, where there is nothing to
          //     hit — then crosses at xIn and surfaces on the spine. [D]
          const alongZ = TRUNK_AX === "z";
          const zCross = alongZ ? cellZ : HDR_P;
          const xRise = alongZ ? HDR_P : xIn;
          const trunk = side.key + "trunk";
          runPath("header", trunk, null, [
            { x: cell.connX, y: cell.connY, z: cellZ },  // tap the cooler's water side
            { x: cell.connX, y: hdrY, z: cellZ },        // riser
            { x: xOut, y: hdrY, z: cellZ },              // east over the yard
            { x: xOut, y: trY, z: cellZ },               // down into the trench
            { x: xOut, y: trY, z: zCross },              // (T only) slide to the spine line
            { x: xRise, y: trY, z: zCross },             // under the wall
            { x: xRise, y: hdrY, z: zCross },            // up into the gallery
          ], HDR_W);
          // the spine, along the gallery axis, long enough to reach every tap
          const portAs = cduPositions.map(c =>
            cA(c.x + side.port.x, c.z + side.port.z - 0.62));
          const aEnter = cA(xRise, cellZ);
          runAlong("header", trunk, null, Math.min(aEnter, ...portAs),
                   Math.max(aEnter, ...portAs), hdrY, HDR_P, HDR_W);

          // Branch per CDU: off the spine, across to the port, then down onto it.
          for (let ci = 0; ci < cduPositions.length; ci++) {
            const cdu = cduPositions[ci];
            const portX = cdu.x + side.port.x;
            const portY = (cdu.y - cdu.h / 2) + side.port.y;
            const portZ = cdu.z + side.port.z - 0.62;
            runPath("header", side.key + ci, trunk, [
              { x: alongZ ? HDR_P : portX, y: hdrY, z: alongZ ? portZ : HDR_P },
              { x: portX, y: hdrY, z: portZ },
              // final drop: its lower face centre IS the USD port, to 1 mm
              { x: portX, y: portY, z: portZ },
            ], HDR_W);
          }
        }
      }
    }

    // ---- yard: heat rejection (W), gensets (N), TES (SW) -------------------
    // mode-driven: tower -> the engine's tower_cells_installed as tower cells
    // (taller cell body + fan deck + cold-water basin); dry/adiabatic -> the
    // dry-cooler pad (adiabatic reuses the massing with a distinct tint).
    // yard massing sizes ([A]) + named ground clearances that keep the yard
    // collision-free BY CONSTRUCTION: a cell is pitched by its widest footprint
    // (the basin) plus a gap, and every yard element is offset from the shell by
    // a clearance derived from its own size — so the invariants hold for any
    // engine-bound count, not by coincidence of the literals.
    // The sizes, clearances, apron extent and CELL POSITIONS are computed above
    // the liquid block (SINGLE SOURCE) because the F4 headers route to them;
    // this block only DRAWS what rejCells already decided.
    if (rej === "tower") {
      for (const c of rejCells) {
        box("liquid", "tower", dcX, 2.3, c.z, TWR_BODY.w, 4.6, TWR_BODY.d);   // cell body
        box("liquid", "tower", dcX, 4.75, c.z, TWR_DECK.w, 0.3, TWR_DECK.d);  // fan deck
        box("liquid", "fws", dcX, 0.35, c.z, TWR_BASIN.w, 0.7, TWR_BASIN.d);  // cold-water basin
      }
    } else {
      const dryMat = rej === "adiabatic" ? "adiabatic" : "drycooler";
      for (const c of rejCells) {
        box("liquid", dryMat, dcX, 1.2, c.z, 2.2, 2.4, 5.0);
        for (let k = 0; k < 3; k++) box("liquid", "fws", dcX, 2.46, c.z - 1.7 + k * 1.7, 1.6, 0.12, 1.6);
      }
    }
    // gensets on the north apron; the enclosure body is the element nearest the
    // shell, so its north face is held GEN_CLEAR clear of the north wall (the
    // shallower exhaust + day-tank blocks sit within that gap). genZ/GEN_CLEAR are
    // the single shared source computed above the rej branch.
    const genShown = min(nGenset, DISPLAY_CAPS.genset);
    for (let i = 0; i < genShown; i++) {
      const gx = bxc - ((genShown - 1) * 5.2) / 2 + i * 5.2;
      box("power", "genset", gx, 1.25, genZ, GEN_BODY.w, 2.5, GEN_BODY.d);
      box("power", "genset", gx + 1.6, 3.4, genZ + 0.5, 0.35, 1.8, 0.35);
      box("power", "genset", gx - 2.9, 0.5, genZ, 1.2, 1.0, 1.2);
    }
    // TES sphere: sits due WEST of the heat-rejection pad's widest west face, at
    // the yard's z-center (hallZC), pushed out by its own radius + TES_CLEAR — so
    // the sphere surface clears the westmost pad by >= TES_CLEAR in every mode and
    // at every scale, and moves further out as the pad widens or the sphere grows
    // (yard-relative, not a fixed literal). y unchanged (rests on the ground).
    const TES_CLEAR = 1.7;                                    // [A] TES sphere ↔ heat-rejection pad ground gap
    const tesR = max(0.9, Math.cbrt((tesM3 || 1) / Math.PI) * 1.1);
    const yardWestX = dcX - (rej === "tower" ? TWR_BASIN.w : 2.2) / 2;  // widest pad element's west edge
    box("liquid", "tes", yardWestX - TES_CLEAR - tesR, tesR, hallZC, tesR * 2, tesR * 2, tesR * 2);

    // ---- ground: apron + parcel + fence (land model) -----------------------
    const apX0 = dcX - 2.4, apX1 = txX + 2.4;
    // apZ0/apZ1 are the single shared apron z-extent computed above the rej branch;
    // the clamp bounds (dry/adiabatic) read the same consts, so they cannot drift.
    box("site", "floor", (apX0 + apX1) / 2, -0.03, (apZ0 + apZ1) / 2, apX1 - apX0, 0.06, apZ1 - apZ0);
    const parcelM2 = land.parcel_m2.value;
    const pW = max(Math.sqrt(parcelM2 * 1.25), apX1 - apX0 + 6);
    const pD = max(parcelM2 / pW, apZ1 - apZ0 + 6);
    box("site", "site", 0, -0.10, 0, pW, 0.05, pD);
    const fx0 = apX0 + 0.3, fx1 = apX1 - 0.3, fz0 = apZ0 + 0.3, fz1 = apZ1 - 0.3;
    box("site", "fence", (fx0 + fx1) / 2, 0.6, fz0, fx1 - fx0, 1.2, 0.06);
    box("site", "fence", (fx0 + fx1) / 2, 0.6, fz1, fx1 - fx0, 1.2, 0.06);
    box("site", "fence", fx0, 0.6, (fz0 + fz1) / 2, 0.06, 1.2, fz1 - fz0);
    box("site", "fence", fx1, 0.6, (fz0 + fz1) / 2, 0.06, 1.2, fz1 - fz0);

    // ---- ground grid at 10 m pitch (F5 scale reference) -------------------
    const gridPitch = 10;  // meters
    const gridExt = max(pW, pD) * 0.6;  // grid extends beyond building
    const gridX0 = Math.floor(-gridExt / gridPitch) * gridPitch;
    const gridX1 = Math.ceil(gridExt / gridPitch) * gridPitch;
    const gridZ0 = Math.floor(-gridExt / gridPitch) * gridPitch;
    const gridZ1 = Math.ceil(gridExt / gridPitch) * gridPitch;
    // Grid lines stored as special "grid" group for conditional rendering
    for (let gx = gridX0; gx <= gridX1; gx += gridPitch) {
      if (abs(gx) < 0.1) continue;  // skip origin lines (avoid z-fighting with axes)
      box("grid", "gridline", gx, -0.08, 0, 0.02, 0.01, gridZ1 - gridZ0);
    }
    for (let gz = gridZ0; gz <= gridZ1; gz += gridPitch) {
      if (abs(gz) < 0.1) continue;
      box("grid", "gridline", 0, -0.08, gz, gridX1 - gridX0, 0.01, 0.02);
    }

    // ---- F2: envelope calculations (needed for dimension lines and stats) ---
    // MEASURED off the shell that was actually drawn above (bx0..bx1, bz0..bz1),
    // never re-derived from the part list. The previous X form recounted the wall
    // stack as `hallX + GALLERY_W + ELEC_W + 3 * WALL` and missed one wall — the
    // building has FOUR walls across X (west exterior, hall/gallery partition,
    // hall/elec partition, east exterior) — so the width dimension line was drawn
    // 0.2 m shorter than the shell its own witness marks bracketed, and the
    // reported footprint was one wall thinner than the building (DSX-60/D3).
    const envelopeX = bx1 - bx0;
    const envelopeZ = bz1 - bz0;
    const footprintM2 = envelopeX * envelopeZ;
    const footprintFt2 = footprintM2 * 10.7639;  // 1 m² = 10.7639 ft²
    // MEASURED off the gallery lane, so it tracks the room the units are drawn in
    // (for the reference building this is exactly hallZ, as before).
    const galleryRunM = galLane.len;
    // GROSS BUILT AREA is not the envelope for a non-rectangular building: an L
    // occupies only part of its bounding box. footprintM2 stays the envelope
    // product (the dimension lines bracket the bounding box); builtM2 is the sum
    // of the rooms actually drawn, which is what the ±2% parity gate compares.
    const builtFt2 = builtM2 * 10.7639;
    const builtDelta = plan ? plan.delta : 0;

    // ---- hall footprint dimension lines (L-shaped: width at south, length at west) ---
    // Dimensions reference the BUILDING ENVELOPE (hall + walls + gallery/elec), not just the hall
    const dimW = envelopeX;  // building width (X)
    const dimD = envelopeZ;  // building depth (Z)
    const dimY = -0.05;      // dimension lines at ground level
    // Width dimension (south edge of building): witness marks + line
    const dimZ = bz0 - 0.8;  // offset south of building
    box("dimensions", "dimline", bx0, dimY, dimZ, 0.02, 0.01, 0.6);  // west witness
    box("dimensions", "dimline", bx1, dimY, dimZ, 0.02, 0.01, 0.6);  // east witness
    box("dimensions", "dimline", bxc, dimY, dimZ, dimW, 0.01, 0.02);  // dimension line
    // Length dimension (west edge of building): witness marks + line
    const dimX = bx0 - 0.8;  // offset west of building
    box("dimensions", "dimline", dimX, dimY, bz0, 0.6, 0.01, 0.02);  // south witness
    box("dimensions", "dimline", dimX, dimY, bz1, 0.6, 0.01, 0.02);  // north witness
    box("dimensions", "dimline", dimX, dimY, (bz0 + bz1) / 2, 0.02, 0.01, dimD);  // dimension line
    // NOTE: dimension VALUES are rendered as text overlays by the viewer (page_3d.js),
    // reading dimW/dimD from the returned stats — single source, never stale.

    // ---- human-scale reference figure (1.75 m tall, near building entrance) ---
    const humanX = bx0 + 2.0;  // west of building, near entrance
    const humanZ = hallZC;     // centered on hall
    const humanH = 1.75;       // typical human height (meters)
    box("reference", "human", humanX, humanH / 2, humanZ, 0.5, humanH, 0.3);

    // ---- stats (every count names its engine; caps stated, never silent) ---
    const capNote = (shown, n) => (shown < n ? " (showing " + shown + " — massing cap)" : "");
    // (envelope/footprint/galleryRunM computed above for dimension lines)
    const shapeLabel = shp === "auto" ? "auto" : shp === "square" ? "square" :
                       shp === "rect-2:1" ? "rect 2:1" : shp === "rect-3:1" ? "rect 3:1" :
                       shp === "L" ? "L-shape" : shp === "T" ? "T-shape" : "auto";
    // L/T: name the wings and the MEASURED built-area delta against auto. The
    // delta is reported, never minimised — ltPlan ranks on massing quality, so
    // this number stays an independent measurement of the chosen form.
    const wingNote = plan
      ? " · wings " + plan.c.nA + "×" + plan.c.pA + " / " + plan.c.nB + "×" + plan.c.pB +
        " · built " + Math.round(builtM2).toLocaleString("en-US") + " m² (" +
        (builtDelta >= 0 ? "+" : "") + (builtDelta * 100).toFixed(2) + "% vs auto" +
        (plan.feasible ? "" : ", OUTSIDE ±2% — no parity-feasible wing plan") + ")"
      : "";
    // heat-rejection line: mode-aware, engine-bound counts + the F5 site verdict
    let rejectStr;
    // The shown-count is rejCells.length — the cells the yard actually DREW —
    // not a recomputation of the same min() that could drift from it.
    if (rej === "tower") {
      rejectStr = nTower + " tower cell" + (nTower !== 1 ? "s" : "") + " (N+1)" +
        capNote(rejCells.length, nTower) +
        (towerMakeup != null ? " · makeup " + Math.round(towerMakeup).toLocaleString("en-US") + " m³/day" : "") +
        " · " + verdict;
    } else {
      const dryLabel = rej === "adiabatic" ? " adiabatic-assist dry coolers [A class]" : " dry coolers [A class]";
      rejectStr = nDry + dryLabel + capNote(rejCells.length, nDry) + " · " + verdict;
    }
    // F4: Service connection counts
    const powerDrops = rackPositions.length * 2;  // dual A/B feed per rack
    const fiberDrops = rackPositions.length;      // one per rack
    // qdPairs counts the racks a CDU actually reached, so the label cannot claim
    // whips that were never drawn (it claimed rackPositions.length * 2 = 64 on a
    // scene where 16 racks were piped — DSX-70).
    const liquidDrops = qdPairs * 2;              // TCS supply + return per served rack
    const totalDrops = powerDrops + fiberDrops + liquidDrops;

    const stats = [
      ["shape", shapeLabel + " · " + envelopeX.toFixed(1) + " × " + envelopeZ.toFixed(1) + " m envelope · " +
        Math.round(footprintM2).toLocaleString("en-US") + " m² (" + Math.round(footprintFt2).toLocaleString("en-US") +
        " ft²) · gallery " + galleryRunM.toFixed(1) + " m" + wingNote, "A", "scene3d-method"],
      ["fleet", racks + " racks · " + (racks * gpr).toLocaleString("en-US") + " GPUs · " +
        rows + " row" + (rows > 1 ? "s" : "") + " of ≤" + perRow, "D", "variants"],
      ["power", facilityMw.toFixed(2) + " MW facility · " + nGenset + " gensets" +
        capNote(genShown, nGenset) + " · " + nUpsPerPath + " UPS modules/path" +
        capNote(upsShown, nUpsPerPath) + " · " + nTx + " transformers" +
        capNote(txShown, max(nTx, 2)) + " · " + powerDrops + " drops (dual A/B)", "D", "dossiers"],
      // capNote reads the count actually DRAWN, so a gallery that could not hold
      // the whole capped bank reports the smaller number rather than implying it
      ["cooling", (v.liquid_pct ? nCdu + " CDUs" + capNote(cduDrawn, nCdu) + " · " : "") +
        nCrah + " CRAH class" + capNote(crahDrawn, nCrah) + " · " + rejectStr +
        (liquidDrops > 0 ? " · " + liquidDrops + " liquid drops [S ports] [A routing]" : ""), "D", "dossiers"],
      ["network", fiberDrops + " fiber drops (tray → rack ToR)", "A", "scene3d-method"],
      ["land", land.site_acres.value.toFixed(2) + " acres parcel · " +
        Math.round(land.developed_m2.value).toLocaleString("en-US") + " m² developed", "D", "land-model"],
    ];

    // frame the DEVELOPED zone (apron diagonal), not the whole parcel — the
    // parcel stays visible as ground; vision pass: parcel-framing read as
    // "tiny building in a void"
    const apDiag = Math.sqrt((apX1 - apX0) ** 2 + (apZ1 - apZ0) ** 2);
    return { spec: S, stats: stats,
             camera: { r: apDiag * 0.82, targetY: 1.2 },
             shape: shp,
             hall: { x: hallX, z: hallZ },
             envelope: { x: envelopeX, z: envelopeZ },
             footprint: { m2: footprintM2, ft2: footprintFt2 },
             built: { m2: builtM2, ft2: builtFt2, deltaVsAuto: builtDelta,
                      feasible: plan ? plan.feasible : true },
             // the room rects the shell was drawn from — the built form itself,
             // exposed so a gate can measure it instead of inferring it from boxes
             rooms: rooms.map((r) => ({ kind: r.kind, axis: r.axis || "z",
                                        x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 })),
             wings: plan ? { mode: plan.c.mode, nA: plan.c.nA, pA: plan.c.pA,
                             nB: plan.c.nB, pB: plan.c.pB, support: plan.c.sup,
                             gallery: plan.c.gal, elec: plan.c.elec } : null,
             galleryRunM: galleryRunM,
             counts: { racks: racks, rows: rows, gensets: nGenset, cdus: nCdu,
                       crah: nCrah, dry: nDry, tower: nTower, rejector: rej,
                       verdict: verdict, facilityMw: facilityMw,
                       transformers: nTx, upsModules: nUpsPerPath,
                       acres: land.site_acres.value } };
  }

  globalThis.AIDC = globalThis.AIDC || {};
  A.sceneLayout = { solve: solve, CAPS: DISPLAY_CAPS };
})();
