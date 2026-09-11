// PROPOSAL PACK — the journey's integrated export (card AIDC#160 / DSX-51, S4).
// ONE scenario in, ONE workbook + ONE PDF out, covering every stage the guided
// journey walks (sizing → land → hall → network → TCO → risk) plus the capex
// and schedule appendices. Composition only: every number is computed by the
// SAME engine the per-page calculator runs, seeded EXACTLY as the shared
// scenario bar seeds that page (the FEEDS mapping in scenario.js), with the
// page's own defaults for every other input — so a row in the pack equals the
// far-end page opened with the same s.* deep-link, by construction.
//
// Gates are reported, never faked: a stage whose engine is not loaded on the
// hosting page is emitted as NOT INCLUDED with the reason, never with numbers.
// Writers: export_xlsx.js / export_pdf.js (deterministic — same scenario ->
// byte-identical files; no wall clock, no random ids).
"use strict";
(function () {
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  if (!A || !DB || !A.res) return;
  const { q, result, fmt } = A.res;

  const DISCLAIMER = "Engineering estimator, not an offer or a design of record - verify with " +
    "licensed engineers, vendor submittals and your utility before committing money or metal.";
  const LEGEND = "[S] stated (published source) - [D] derived (arithmetic shown) - [A] assumed (engineering default)";

  const nz = (x) => x !== null && x !== undefined && (typeof x !== "number" || isFinite(x));
  const put = (o, k, v) => { if (nz(v)) o[k] = v; return o; };

  // ---- per-stage input seeds — MIRROR scenario.js FEEDS (same keys, same
  //      skip-null rule: setNum ignores null/undefined, so a null platform value
  //      leaves the page default in force — and so do we) -----------------------
  function seeds(scen) {
    const d = A.scenario.deriveScenario(scen.platform, scen.driver, scen.target);
    const v = DB[scen.platform];
    const rps = v.racks_per_su || 8;
    const su = Math.max(1, Math.floor(d.racks / rps));

    const power = {};
    put(power, "it_mw", d.it_mw);
    put(power, "pue", v.pue_target);
    put(power, "dist_v", v.distribution_voltage_v);
    put(power, "gpus", d.gpus);
    put(power, "rack_kw", v.nameplate_kw);
    put(power, "rack_edpp_kw", v.edpp2_kw);
    put(power, "ramp_w_per_sec_per_gpu", v.ramp_w_per_sec_per_gpu);
    put(power, "racks_per_path", v.row_plan && v.row_plan.compute);

    const cool = {};
    put(cool, "it_kw", d.it_mw * 1000.0);
    put(cool, "liquid_frac", v.liquid_pct / 100.0);
    if (v.liquid_pct > 0) {
      put(cool, "rack_liquid_kw", v.liquid_kw);
      put(cool, "cdu_kw", v.cdu_nominal_kw);
      put(cool, "tcs_inlet_c", v.design_inlet_c);
      cool.flow_basis = v.liquid_flow_curve ? "vendor" : "formula";
    }

    const fiber = {};
    put(fiber, "su", su);
    put(fiber, "racks_per_su", rps);
    put(fiber, "rails", v.rails);
    put(fiber, "trays_per_rack", v.trays_per_rack);
    fiber.ib_twin_modules = String(v.scale_out || "").indexOf("infiniband") === 0;

    // tco: page_tco.withPlatform resolves gpus_per_rack / rack_kw / pue from the
    // platform; the bar feeds gpus (driver=gpus) else racks
    const tco = { platform: scen.platform, gpus_per_rack: v.gpus_per_rack,
                  rack_kw: v.nameplate_kw, pue: v.pue_target };
    if (scen.driver === "gpus") tco.gpus = d.gpus; else tco.racks = d.racks;

    // capex: page_capex.resolvePlatform -> kw_per_gpu = nameplate / gpus_per_rack, pue
    const capex = { it_mw: d.it_mw, kw_per_gpu: v.nameplate_kw / v.gpus_per_rack, pue: v.pue_target };

    const land = { it_mw: d.it_mw };
    // schedule: the plan page's call — fixed NTP epoch, never the wall clock
    const sched = { ntp_date: A.calcSchedule ? A.calcSchedule.NTP_DEFAULT : "2026-09-01", it_mw: d.it_mw };

    return { d: d, v: v, su: su, rps: rps, power: power, cool: cool, fiber: fiber,
             tco: tco, capex: capex, land: land, sched: sched };
  }

  // ---- the risk stage: the corpus summary the risks explorer renders ----------
  function riskResult() {
    const R = globalThis.RISKSDATA;
    if (!R) return null;
    const out = {};
    out.modes_total = q(R.meta.modes, "", "[S]", "generic failure-mode corpus — " + R.meta.basis);
    out.systems_n = q(R.systems.length, "", "[S]", "building systems in the corpus");
    out.phases_n = q(R.phases.length, "", "[S]", "lifecycle phases: " + R.phases.join(" / "));
    for (const ph of R.phases) {
      let n = 0;
      for (const s of R.systems) n += (R.matrix[s.id] && R.matrix[s.id][ph]) || 0;
      out["modes_in_" + ph.toLowerCase()] = q(n, "", "[D]", "sum over systems of the matrix column " + ph +
        " (a mode spanning phases counts in each)");
    }
    const ranked = R.systems.slice().sort((a, b) =>
      ((R.matrix[b.id] || {}).modes || 0) - ((R.matrix[a.id] || {}).modes || 0) || (a.id < b.id ? -1 : 1));
    for (const s of ranked) {
      const m = R.matrix[s.id] || {};
      out["modes_" + s.id] = q(m.modes || 0, "", "[S]", s.name + " — " + s.scope + " — " +
        R.phases.map((p) => p + " " + (m[p] || 0)).join(" · "));
    }
    const t = R.meta.tally || {};
    out.corpus_provenance_s = q(t.S || 0, "", "[D]", "modes whose governing citation is [S] stated");
    out.corpus_provenance_d = q(t.D || 0, "", "[D]", "modes whose governing citation is [D] derived");
    out.corpus_provenance_a = q(t.A || 0, "", "[D]", "modes whose governing citation is [A] assumed");
    return result(
      "risk — failure-mode corpus, systems × phases",
      "counts read from the generated RISKSDATA corpus (gen_risks_json.py); per-mode detection / " +
      "prevention / recovery text lives on the risks page",
      { corpus: q("risksdata.js", "", "[S]", R.meta.basis) },
      out,
      ["Failure-mode counts are corpus-wide and do not scale with the scenario — the risk register " +
       "for a specific project is a subset chosen by its systems and phase.",
       "Open the risks page for the 6-field row of every mode (mechanism, presents, detection, " +
       "prevention, recovery, source) with citation links."]);
  }

  // ---- stage table -----------------------------------------------------------
  // Each stage: id, title, page (journey deep-link target), engine (A.<name>
  // must exist or the stage is GATED), run(seeds) -> result, headline(res) ->
  // [[label, value]] for the cover.
  const disp = (v) => A.res.disp(v);
  const O = (r, k) => (r && r.outputs && r.outputs[k]) ? r.outputs[k].value : null;
  const STAGES = [
    { id: "sizing", title: "GPUs / Sizing", page: "journey.html", engine: "scenario",
      run: (s, scen) => result(
        "sizing — the scenario every stage carries",
        "deriveScenario(platform, driver, target): racks = ceil(target / GPUs-per-rack) [gpus] | " +
        "ceil(MW×1000 / nameplate) [mw] | target [racks]; gpus = racks × GPUs/rack; MW-IT = racks × nameplate / 1000",
        { platform: q(scen.platform, "", "[S]", "rack-matrix variant — " + s.v.platform),
          driver: q(scen.driver, "", "[S]", "scenario size driver (gpus | mw | racks)"),
          target: q(Number(scen.target), scen.driver === "mw" ? "MW-IT" : "", "[S]", "scenario target in driver units"),
          gpus_per_rack: q(s.v.gpus_per_rack, "", "[S]", "rack matrix"),
          nameplate_kw: q(s.v.nameplate_kw, "kW", "[S]", "rack matrix nameplate") },
        { racks: q(s.d.racks, "", "[D]", "deriveScenario — racks"),
          gpus_installed: q(s.d.gpus, "", "[D]", "racks × GPUs/rack"),
          it_mw: q(s.d.it_mw, "MW-IT", "[D]", "racks × nameplate (compute basis)"),
          scalable_units: q(s.su, "", "[D]", "floor(racks / " + s.rps + " racks-per-SU) — fabric models whole SUs") },
        ["One scenario, carried end-to-end: every stage below is seeded from these three numbers exactly " +
         "as the scenario bar seeds that stage's own page."]),
      headline: (r) => [["racks", disp(O(r, "racks"))], ["GPUs", disp(O(r, "gpus_installed"))], ["MW-IT", disp(O(r, "it_mw"))]] },
    { id: "land", title: "Land", page: "land.html", engine: "calcLand",
      run: (s) => A.calcLand.footprint(s.land),
      headline: (r) => [["site acres", disp(O(r, "site_acres"))], ["MW-IT/acre", disp(O(r, "mw_it_per_acre"))]] },
    { id: "hall_power", title: "Hall / Designs — power one-line", page: "designs.html", engine: "calcPower",
      run: (s) => A.calcPower.sizing(s.power),
      headline: (r) => [["facility MW", disp(O(r, "facility_mw"))], ["service MVA", disp(O(r, "utility_service_mva"))],
                        ["gensets", disp(O(r, "genset_units_installed"))]] },
    { id: "hall_cooling", title: "Hall / Designs — cooling schematic", page: "designs.html", engine: "calcCooling",
      run: (s) => A.calcCooling.loads(s.cool),
      headline: (r) => [["liquid kW", disp(O(r, "liquid_load_kw"))], ["CDUs", disp(O(r, "cdu_units_installed"))],
                        ["verdict", String(O(r, "cooling_verdict"))]] },
    { id: "network", title: "Network / Fiber", page: "fiber.html", engine: "calcFiber",
      run: (s) => A.calcFiber.plant(s.fiber),
      headline: (r) => [["fabric links", disp(O(r, "links_fabric_total"))], ["pluggables", disp(O(r, "pluggables_total"))]] },
    { id: "tco", title: "TCO", page: "tco.html", engine: "calcTco",
      run: (s) => A.calcTco.tco(s.tco),
      headline: (r) => [["levelized $/GPU-h", disp(O(r, "levelized_usd_per_gpu_hr"))], ["upfront US$", disp(O(r, "upfront_usd"))]] },
    { id: "risk", title: "Risk Explorer", page: "risks.html", engine: "RISKSDATA",
      run: () => riskResult(),
      headline: (r) => [["failure modes", disp(O(r, "modes_total"))], ["systems", disp(O(r, "systems_n"))]] },
    { id: "capex", title: "Appendix — Capex", page: "capex.html", engine: "calcCapex",
      run: (s) => A.calcCapex.costs(s.capex),
      headline: (r) => [["capex US$M", disp(O(r, "capex_total_m"))], ["floor $/GPU-h", disp(O(r, "cost_floor_per_gpu_hr"))]] },
    { id: "schedule", title: "Appendix — Schedule (plan-page model)", page: "plan.html", engine: "calcSchedule",
      run: (s) => A.calcSchedule.schedule(s.sched),
      headline: (r) => [["energize", String(O(r, "energize_date"))], ["GPUs live", String(O(r, "gpus_live_date"))]] },
  ];

  function engineLoaded(name) {
    if (name === "scenario") return !!(A.scenario && A.scenario.deriveScenario);
    if (name === "RISKSDATA") return !!globalThis.RISKSDATA;
    return !!A[name];
  }

  function hashFor(scen) {
    const enc = encodeURIComponent;
    return "s.platform=" + enc(scen.platform) + "&s.driver=" + enc(scen.driver) + "&s.target=" + enc(String(scen.target));
  }

  // ---- build the pack model ----------------------------------------------------
  function build(scenIn) {
    const scen = scenIn || (A.scenario && A.scenario.current && A.scenario.current());
    if (!scen || !DB[scen.platform]) throw new Error("proposal pack needs a scenario (platform + size)");
    const s = seeds(scen);
    const hash = hashFor(scen);
    const stages = [];
    for (const st of STAGES) {
      const entry = { id: st.id, title: st.title, page: st.page, link: st.page + "#" + hash };
      if (!engineLoaded(st.engine)) {
        entry.gated = "NOT INCLUDED — engine " + st.engine + " is not loaded on this page (no numbers fabricated)";
      } else {
        try {
          entry.res = st.run(s, scen);
          entry.headline = st.headline(entry.res);
        } catch (e) {
          entry.gated = "NOT INCLUDED — engine " + st.engine + " threw: " + String(e && e.message || e);
        }
      }
      stages.push(entry);
    }
    let tally = { S: 0, D: 0, A: 0 };
    for (const st of stages) {
      if (!st.res) continue;
      for (const map of [st.res.inputs, st.res.outputs]) {
        for (const k of Object.keys(map)) {
          const l = String(map[k].label || "").replace(/[\[\]]/g, "");
          if (tally[l] !== undefined) tally[l] += 1;
        }
      }
    }
    return {
      title: "Proposal pack — " + s.v.platform + " · " + s.d.gpus + " GPUs · " + s.d.racks + " racks · " +
             disp(s.d.it_mw) + " MW-IT",
      scenario: { platform: scen.platform, platform_name: s.v.platform, driver: scen.driver,
                  target: Number(scen.target), racks: s.d.racks, gpus: s.d.gpus, it_mw: s.d.it_mw },
      reproduce: "journey.html#" + hash,
      href: (typeof location !== "undefined" && location && location.href) ? location.href : null,
      stages: stages,
      tally: tally,
      included: stages.filter((x) => !!x.res).length,
      gated: stages.filter((x) => !!x.gated).length,
    };
  }

  // ---- writers -------------------------------------------------------------------
  function rowsOf(map) {
    const rows = [[{ v: "key", s: 1 }, { v: "value", s: 1 }, { v: "unit", s: 1 },
                   { v: "provenance", s: 1 }, { v: "source / derivation", s: 1 }]];
    for (const [k, qv] of Object.entries(map)) {
      const val = (typeof qv.value === "number" && isFinite(qv.value)) ? qv.value
        : (qv.value === null || qv.value === undefined) ? "" : String(qv.value);
      rows.push([k, { v: val, s: 2 }, qv.unit || "", qv.label || "", qv.source || ""]);
    }
    return rows;
  }
  // Excel sheet names: <= 31 chars, none of : \ / ? * [ ] — the stage's short
  // name, numbered in journey order, so the tab strip reads as the journey.
  const SHEET_SHORT = { sizing: "Sizing", land: "Land", hall_power: "Hall power", hall_cooling: "Hall cooling",
                        network: "Network fiber", tco: "TCO", risk: "Risk", capex: "Capex", schedule: "Schedule" };
  function sheetName(i, st) {
    const short = SHEET_SHORT[st.id] || st.title;
    const t = String(i).padStart(2, "0") + " " + short.replace(/[:\\/?*\[\]]/g, "-");
    return t.slice(0, 31);
  }

  function xlsx(model) {
    if (!A.exportXlsx) throw new Error("export_xlsx.js not loaded");
    const cover = [
      [{ v: model.title, s: 1 }],
      ["scenario platform", model.scenario.platform + " (" + model.scenario.platform_name + ")"],
      ["scenario driver / target", model.scenario.driver + " / " + model.scenario.target],
      ["racks", { v: model.scenario.racks, s: 2 }],
      ["GPUs installed", { v: model.scenario.gpus, s: 2 }],
      ["MW-IT (compute basis)", { v: model.scenario.it_mw, s: 2 }],
      ["reproduce", model.reproduce],
      ["generated by", "AI-DC calculator" + (model.href ? " - " + model.href : "")],
      ["stages included / gated", model.included + " / " + model.gated],
      ["provenance tally (rows)", "[S] " + model.tally.S + " · [D] " + model.tally.D + " · [A] " + model.tally.A],
      ["provenance legend", LEGEND],
      ["basis", "every stage is computed by the same engine its calculator page runs, seeded exactly as the " +
                "scenario bar seeds that page; all other inputs are that page's defaults (open the deep-link " +
                "to change them)"],
      ["disclaimer", DISCLAIMER],
      [],
      [{ v: "stage", s: 1 }, { v: "sheet", s: 1 }, { v: "headline", s: 1 }, { v: "open with this scenario", s: 1 }],
    ];
    const sheets = [{ name: "Cover", rows: cover, widths: [26, 60, 60, 60] }];
    model.stages.forEach((st, i) => {
      const name = sheetName(i + 1, st);
      if (st.gated) {
        cover.push([st.title, name, st.gated, st.link]);
        sheets.push({ name: name, rows: [[{ v: st.title, s: 1 }], ["status", st.gated], ["open", st.link]], widths: [22, 110] });
        return;
      }
      const r = st.res;
      cover.push([st.title, name, st.headline.map(([k, v]) => k + " " + v).join(" · "), st.link]);
      const rows = [
        [{ v: r.title, s: 1 }],
        ["method", r.method],
        ["open with this scenario", st.link],
        [],
        [{ v: "INPUTS (as seeded by the scenario bar; others = page defaults)", s: 1 }],
      ].concat(rowsOf(r.inputs), [[], [{ v: "OUTPUTS", s: 1 }]], rowsOf(r.outputs), [[], [{ v: "NOTES", s: 1 }]],
        (r.notes || []).map((n, j) => [{ v: j + 1, s: 2 }, n]));
      sheets.push({ name: name, rows: rows, widths: [32, 16, 10, 8, 90] });
    });
    return A.exportXlsx.build(sheets);
  }

  function pdf(model) {
    if (!A.exportPdf) throw new Error("export_pdf.js not loaded");
    const d = A.exportPdf.Doc();
    const M = 48, W = 595.28 - 2 * M;
    const cols = (k, v, u, l, s) => [
      { x: M, w: 118, txt: k, font: "F3", size: 7.5 },
      { x: M + 122, w: 66, txt: v, font: "F3", size: 7.5 },
      { x: M + 192, w: 40, txt: u, size: 7.5 },
      { x: M + 236, w: 26, txt: l, font: "F2", size: 7.5 },
      { x: M + 266, w: W - 266, txt: s, size: 7.5 },
    ];
    d.title(model.title);
    d.meta("AI-DC calculator proposal pack - reproduce: " + model.reproduce + (model.href ? "  (" + model.href + ")" : ""));
    d.meta("scenario: " + model.scenario.platform + " · " + model.scenario.driver + " = " + model.scenario.target +
           " -> " + model.scenario.racks + " racks · " + model.scenario.gpus + " GPUs · " + fmt(model.scenario.it_mw) + " MW-IT");
    d.meta("stages included " + model.included + " / gated " + model.gated + " · provenance rows [S] " + model.tally.S +
           " [D] " + model.tally.D + " [A] " + model.tally.A + " · " + LEGEND);
    d.h2("Headlines");
    for (const st of model.stages) {
      d.row([{ x: M, w: 190, txt: st.title, font: "F2", size: 8 },
             { x: M + 194, w: W - 194, txt: st.gated ? st.gated : st.headline.map(([k, v]) => k + " " + v).join(" · "), size: 8 }], 8);
    }
    d.note("Every stage is computed by the same engine its calculator page runs, seeded exactly as the scenario " +
           "bar seeds that page; all other inputs are that page's defaults. Open the stage link (carrying the " +
           "s.* scenario) to change them.");
    model.stages.forEach((st, i) => {
      d.h2((i + 1) + ". " + st.title);
      d.meta("open with this scenario: " + st.link);
      if (st.gated) { d.note(st.gated); return; }
      const r = st.res;
      d.meta(r.title);
      d.meta("method: " + r.method);
      for (const [name, map] of [["Inputs", r.inputs], ["Outputs", r.outputs]]) {
        d.row([{ x: M, w: W, txt: name, font: "F2", size: 8.5 }], 8.5);
        d.row(cols("key", "value", "unit", "", "source / derivation"), 7.5);
        for (const [k, qv] of Object.entries(map)) {
          d.row(cols(k, fmt(qv.value), qv.unit || "", qv.label || "", qv.source || ""), 7.5);
        }
        d.gap(4);
      }
      if (r.notes && r.notes.length) {
        d.row([{ x: M, w: W, txt: "Notes", font: "F2", size: 8.5 }], 8.5);
        for (const n of r.notes) d.note(n);
      }
    });
    return d.finish(DISCLAIMER);
  }

  function bytes(kind, scen) {
    const model = build(scen);
    return kind === "pdf" ? pdf(model) : xlsx(model);
  }
  function fileName(kind, scen) {
    const sc = scen || (A.scenario && A.scenario.current && A.scenario.current());
    const tag = sc ? sc.platform + "-" + sc.driver + sc.target : "scenario";
    return "aidc-proposal-pack-" + tag + "." + (kind === "pdf" ? "pdf" : "xlsx");
  }

  A.proposalPack = { STAGES: STAGES, seeds: seeds, build: build, xlsx: xlsx, pdf: pdf,
                     bytes: bytes, fileName: fileName, engineLoaded: engineLoaded };
  // export.js routes A.exportBytes("journey-pack", kind) here (smoke harness seam)
  A.exportProviders = A.exportProviders || {};
  A.exportProviders["journey-pack"] = (kind) => bytes(kind);
})();
