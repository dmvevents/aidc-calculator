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

  const ceil = Math.ceil, max = Math.max, min = Math.min;

  function solve(platform, gpus, rejector) {
    const v = DB[platform];
    // heat-rejection mode drives calc_cooling's F7b tower fleet + the F5 verdict;
    // unknown/absent -> dry (the engine throws on an invalid rejector).
    const REJ = (A.calcCooling && A.calcCooling.REJECTORS) || ["dry", "tower", "adiabatic"];
    const rej = REJ.indexOf(rejector) >= 0 ? rejector : "dry";
    const gpr = v.gpus_per_rack, rackKw = v.nameplate_kw;
    const rw = 0.6, rd = 1.2, rh = (v.height_mm || 2258) / 1000.0;
    const racks = max(1, ceil(gpus / gpr));
    const perRow = v.racks_per_su || 8;
    const rows = ceil(racks / perRow);
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

    // ---- hall geometry (reference z-stack, generalized to N rows) --------
    const rowLen = perRow * rw + (perRow - 1) * GAP;
    const hallX = rowLen + 2 * END_CLEAR;
    const rowsZ = [];                    // {z (north edge), face}
    let z = 0;
    for (let i = 0; i < rows; i++) {
      if (i % 2 === 0) { z += COLD; rowsZ.push({ z: z, face: -1 }); z += rd; }
      else { z += HOT; rowsZ.push({ z: z, face: +1 }); z += rd; }
    }
    z += COLD;                           // trailing aisle
    const supportZ = z;
    z += rd + END_CLEAR;
    const hallZ = z;
    const x0 = -rowLen / 2.0;
    const zOff = -hallZ / 2.0;           // center the hall at origin
    const hallZC = 0;

    const S = [];                        // scene spec: boxes
    const box = (group, mat, x, y, zc, w, h, d) =>
      S.push({ g: group, m: mat, x: x, y: y, z: zc, w: w, h: h, d: d });

    // racks + doors (instanced by the viewer)
    let placed = 0;
    for (let ri = 0; ri < rows && placed < racks; ri++) {
      const r = rowsZ[ri];
      const inRow = min(perRow, racks - placed);
      for (let i = 0; i < inRow; i++) {
        const cx = x0 + rw / 2 + i * (rw + GAP);
        const zc = zOff + r.z + rd / 2;
        box("racks", "rack", cx, rh / 2, zc, rw, rh, rd);
        box("racks", "door", cx, rh / 2, zc + r.face * (rd / 2 + 0.012), rw - 0.08, rh - 0.12, 0.02);
      }
      placed += inRow;
    }
    // support/mgmt row
    for (let i = 0; i < 6; i++) {
      box("racks", "fabric", -(6 * 0.6 + 5 * GAP) / 2 + 0.3 + i * 0.65, 1.1,
          zOff + supportZ + rd / 2, 0.6, 2.2, 1.2);
    }
    // containment over each hot aisle (between face -1/+1 pairs)
    for (let i = 0; i + 1 < rows; i += 2) {
      const hz = zOff + rowsZ[i].z + rd + HOT / 2;
      box("racks", "containment", 0, rh + 0.03, hz, rowLen, 0.06, HOT);
    }
    // busway A/B + tray per row
    for (let ri = 0; ri < rows; ri++) {
      const zc = zOff + rowsZ[ri].z + rd / 2;
      for (const by of BUSWAY_Y) box("power", "busway", 0, by, zc, hallX, 0.15, 0.15);
      box("fiber", "tray", 0, TRAY_Y, zc, hallX, 0.10, 0.45);
    }
    box("fiber", "tray", 0, TRAY_Y, zOff + supportZ + rd / 2, hallX, 0.10, 0.45);

    // ---- gallery (west): CRAH + CDU rows, capped display ------------------
    const galX = -hallX / 2 - WALL - GALLERY_W / 2;
    const crahShown = min(nCrah, DISPLAY_CAPS.crah);
    for (let i = 0; i < crahShown; i++) {
      box("liquid", "crah", galX, 1.0, zOff + 1.6 + i * ((hallZ - 3.2) / max(1, crahShown - 1) || 1), 1.0, 2.0, 0.9);
    }
    const cduShown = min(nCdu, DISPLAY_CAPS.cdu);
    for (let i = 0; i < cduShown; i++) {
      box("liquid", "cdu", galX, 1.03, zOff + hallZ - 2.0 - i * 1.6, 0.9, 2.07, 1.24);
    }
    // ---- electrical rooms (east) + MV yard --------------------------------
    const elecX = hallX / 2 + WALL + ELEC_W / 2;
    const upsShown = min(nUpsPerPath, DISPLAY_CAPS.ups);
    for (const [tag, zc] of [["A", zOff + hallZ * 0.25], ["B", zOff + hallZ * 0.75]]) {
      box("power", "swgr", elecX - 1.3, 1.1, zc + (tag === "A" ? -1.6 : 1.6), 0.9, 2.2, 2.6);
      for (let i = 0; i < upsShown; i++) {
        box("power", "ups", elecX + 0.4, 1.0, zc + (i - (upsShown - 1) / 2) * 1.1, 2.0, 2.0, 0.9);
      }
      box("power", "ups", elecX + 0.4, 0.8, zc + (tag === "A" ? -2.6 : 2.6), 2.0, 1.6, 0.9);
    }
    const txX = hallX / 2 + WALL + ELEC_W + WALL + 1.6;
    const txShown = min(max(nTx, 2), DISPLAY_CAPS.transformer);
    for (let i = 0; i < txShown; i++) {
      const tz = zOff + 2.6 + i * ((hallZ - 5.2) / max(1, txShown - 1) || 1);
      box("power", "transformer", txX, 0.9, tz, 1.4, 1.8, 2.0);
      for (let k = 0; k < 3; k++) box("power", "transformer", txX + 0.95 + k * 0.22, 0.7, tz, 0.10, 1.4, 1.6);
    }
    // ---- shell -------------------------------------------------------------
    const bx0 = -hallX / 2 - WALL - GALLERY_W - WALL, bx1 = hallX / 2 + WALL + ELEC_W + WALL;
    const bz0 = zOff - WALL, bz1 = zOff + hallZ + WALL;
    const bw = bx1 - bx0, bd = bz1 - bz0, bxc = (bx0 + bx1) / 2;
    box("shell", "shell", bxc, CLEAR_H / 2, bz0 + WALL / 2, bw, CLEAR_H, WALL);
    box("shell", "shell", bxc, CLEAR_H / 2, bz1 - WALL / 2, bw, CLEAR_H, WALL);
    box("shell", "shell", bx0 + WALL / 2, CLEAR_H / 2, hallZC, WALL, CLEAR_H, bd - 2 * WALL);
    box("shell", "shell", bx1 - WALL / 2, CLEAR_H / 2, hallZC, WALL, CLEAR_H, bd - 2 * WALL);
    box("shell", "shell", bxc, CLEAR_H + 0.125, hallZC, bw, 0.25, bd);

    // ---- yard: heat rejection (W), gensets (N), TES (SW) -------------------
    // mode-driven: tower -> the engine's tower_cells_installed as tower cells
    // (taller cell body + fan deck + cold-water basin); dry/adiabatic -> the
    // dry-cooler pad (adiabatic reuses the massing with a distinct tint).
    const dcX = bx0 - 3.6;
    if (rej === "tower") {
      const towerShown = min(nTower, DISPLAY_CAPS.tower);
      for (let i = 0; i < towerShown; i++) {
        const tz = hallZC - ((towerShown - 1) * 4.6) / 2 + i * 4.6;
        box("liquid", "tower", dcX, 2.3, tz, 3.4, 4.6, 3.6);   // cell body
        box("liquid", "tower", dcX, 4.75, tz, 3.0, 0.3, 3.2);  // fan deck
        box("liquid", "fws", dcX, 0.35, tz, 3.8, 0.7, 4.0);    // cold-water basin
      }
    } else {
      const dryMat = rej === "adiabatic" ? "adiabatic" : "drycooler";
      const dryShown = min(nDry, DISPLAY_CAPS.drycooler);
      for (let i = 0; i < dryShown; i++) {
        const dz = hallZC - ((dryShown - 1) * 5.4) / 2 + i * 5.4;
        box("liquid", dryMat, dcX, 1.2, dz, 2.2, 2.4, 5.0);
        for (let k = 0; k < 3; k++) box("liquid", "fws", dcX, 2.46, dz - 1.7 + k * 1.7, 1.6, 0.12, 1.6);
      }
    }
    const genZ = bz0 - 3.4;
    const genShown = min(nGenset, DISPLAY_CAPS.genset);
    for (let i = 0; i < genShown; i++) {
      const gx = bxc - ((genShown - 1) * 5.2) / 2 + i * 5.2;
      box("power", "genset", gx, 1.25, genZ, 4.2, 2.5, 1.6);
      box("power", "genset", gx + 1.6, 3.4, genZ + 0.5, 0.35, 1.8, 0.35);
      box("power", "genset", gx - 2.9, 0.5, genZ, 1.2, 1.0, 1.2);
    }
    const tesR = max(0.9, Math.cbrt((tesM3 || 1) / Math.PI) * 1.1);
    box("liquid", "tes", bx0 - 1.9, tesR, bz1 + 1.4, tesR * 2, tesR * 2, tesR * 2);

    // ---- ground: apron + parcel + fence (land model) -----------------------
    const apX0 = dcX - 2.4, apX1 = txX + 2.4;
    const apZ0 = genZ - 2.4, apZ1 = bz1 + 3.4;
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

    // ---- stats (every count names its engine; caps stated, never silent) ---
    const capNote = (shown, n) => (shown < n ? " (showing " + shown + " — massing cap)" : "");
    // heat-rejection line: mode-aware, engine-bound counts + the F5 site verdict
    let rejectStr;
    if (rej === "tower") {
      const towerShown = min(nTower, DISPLAY_CAPS.tower);
      rejectStr = nTower + " tower cell" + (nTower !== 1 ? "s" : "") + " (N+1)" +
        capNote(towerShown, nTower) +
        (towerMakeup != null ? " · makeup " + Math.round(towerMakeup).toLocaleString("en-US") + " m³/day" : "") +
        " · " + verdict;
    } else {
      const dryShown = min(nDry, DISPLAY_CAPS.drycooler);
      const dryLabel = rej === "adiabatic" ? " adiabatic-assist dry coolers [A class]" : " dry coolers [A class]";
      rejectStr = nDry + dryLabel + capNote(dryShown, nDry) + " · " + verdict;
    }
    const stats = [
      ["fleet", racks + " racks · " + (racks * gpr).toLocaleString("en-US") + " GPUs · " +
        rows + " row" + (rows > 1 ? "s" : "") + " of ≤" + perRow, "D", "variants"],
      ["hall", (hallX + GALLERY_W + ELEC_W + 3 * WALL).toFixed(1) + " × " + (hallZ + 2 * WALL).toFixed(1) +
        " m envelope", "A", "scene3d-method"],
      ["power", facilityMw.toFixed(2) + " MW facility · " + nGenset + " gensets" +
        capNote(genShown, nGenset) + " · " + nUpsPerPath + " UPS modules/path" +
        capNote(upsShown, nUpsPerPath) + " · " + nTx + " transformers" +
        capNote(txShown, max(nTx, 2)), "D", "dossiers"],
      ["cooling", (v.liquid_pct ? nCdu + " CDUs" + capNote(cduShown, nCdu) + " · " : "") +
        nCrah + " CRAH class" + capNote(crahShown, nCrah) + " · " + rejectStr, "D", "dossiers"],
      ["land", land.site_acres.value.toFixed(2) + " acres parcel · " +
        Math.round(land.developed_m2.value).toLocaleString("en-US") + " m² developed", "D", "land-model"],
    ];

    // frame the DEVELOPED zone (apron diagonal), not the whole parcel — the
    // parcel stays visible as ground; vision pass: parcel-framing read as
    // "tiny building in a void"
    const apDiag = Math.sqrt((apX1 - apX0) ** 2 + (apZ1 - apZ0) ** 2);
    return { spec: S, stats: stats,
             camera: { r: apDiag * 0.82, targetY: 1.2 },
             counts: { racks: racks, rows: rows, gensets: nGenset, cdus: nCdu,
                       crah: nCrah, dry: nDry, tower: nTower, rejector: rej,
                       verdict: verdict, facilityMw: facilityMw,
                       acres: land.site_acres.value } };
  }

  globalThis.AIDC = globalThis.AIDC || {};
  A.sceneLayout = { solve: solve, CAPS: DISPLAY_CAPS };
})();
