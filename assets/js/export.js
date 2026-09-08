// Export glue: adds "Download .xlsx" / "Download .pdf" next to every section's
// Copy-as-Markdown button. Both exports serialize the SAME result payload the
// copy path uses (state.results[sec.id].res) via the same fmt() — numbers on
// paper match the page by construction. Writers: export_xlsx.js / export_pdf.js
// (deterministic: same state -> byte-identical files).
"use strict";
(function () {
  const A = globalThis.AIDC;
  if (!A || !A.appState || !A.res || !A.exportXlsx || !A.exportPdf) return;
  const fmt = A.res.fmt;
  const DISCLAIMER = "Engineering estimator, not an offer or a design of record - verify with " +
    "licensed engineers, vendor submittals and your utility before committing money or metal.";

  function pageSlug() {
    const p = location.pathname.split("/").pop() || "index.html";
    return p.replace(/\.html$/, "");
  }
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

  // ---- invest cash-flow sheet: LIVE FORMULA cells (PMT/NPV/IRR) --------------
  // Lays out the invest engine's DRIVERS as editable input cells and rebuilds
  // the annual cash-flow model as FORMULA cells that reference them, so an
  // investor who edits an input IN EXCEL sees IRR/NPV/PMT recompute. The Excel
  // formulas mirror calc_invest.py exactly (verified to 1e-6 by a headless
  // LibreOffice recalc in tools/check_invest_xlsx_formulas.py):
  //   rate_y   = rate*(1-decay/100)^(y-1)   revenue = gpus*8760*util*rate_y/1e6
  //   ebitda   = revenue - (opex_fixed + energy*hours/1e6)
  //   unlev_y  = ebitda + (terminal at y=N);  unlev_0 = -capex
  //   PMT      = PMT(debt_rate/100/12, n_m, -loan)   (== calc_colo's pmt_m)
  //   NPV      = unlev_0 + NPV(discount/100, unlev_1..unlev_N)   (year-0 OUTSIDE
  //              NPV — Excel discounts its first arg at period 1, the engine at 0)
  //   IRR      = IRR(unlev_0..unlev_N)      (Excel treats the first as period 0)
  // Each returns row carries a static ENGINE REFERENCE cell (col C) = the value
  // calc_invest already computed, so the recalc check has a per-cell oracle.
  const COL = (i) => { let s = "", n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const num = (x) => (typeof x === "number" && isFinite(x)) ? x : null;

  function buildCashflow(res) {
    const o = res.outputs, i = res.inputs;
    if (!o || !i || !o.irr_unlevered_pct || !i.rate_usd_per_gpu_hr) return null;  // not the invest screen
    const rate = num(i.rate_usd_per_gpu_hr.value);
    if (rate === null) return null;  // no sell rate -> no returns to model
    const gpus = num(o.gpus.value), capex = num(o.capex_total_m.value);
    const N = Math.max(1, Math.trunc(num(i.horizon_yr.value) || 5));
    const loan = num(o.loan_m.value);
    const levered = loan !== null && loan > 0;
    const nM = levered ? Math.round(num(i.debt_term_yr.value) * 12) : 0;
    const mExit = levered ? Math.min(N * 12, nM) : 0;

    const rows = [];
    const put = (cells) => { rows.push(cells); return rows.length; };  // 1-based row number
    const inp = (label, val) => "B" + put([{ v: label }, { v: val, s: 2 }]);  // editable input, returns its addr
    const B = { s: 1 };  // bold style marker

    put([{ v: "Cash-flow model — edit the INPUT cells (col B); PMT/NPV/IRR recompute on open", s: 1 }]);
    put([]);
    put([Object.assign({ v: "INPUTS (editable)" }, B)]);
    const a = {};
    a.gpus = inp("gpus", gpus);
    a.hpy = inp("hours_per_year", 8760);
    a.u1 = inp("util_y1", num(i.util_y1.value));
    a.us = inp("util_steady", num(i.util_steady.value));
    a.rate = inp("rate_usd_per_gpu_hr", rate);
    a.decay = inp("rate_decay_pct_yr", num(i.rate_decay_pct_yr.value) || 0);
    a.opex = inp("opex_fixed_m_yr", num(i.opex_fixed_m_yr.value));
    a.energy = inp("energy_usd_per_gpu_hr", num(i.energy_usd_per_gpu_hr.value));
    a.capex = inp("capex_total_m", capex);
    a.term = inp("terminal_value_m", num(o.terminal_value_m.value));
    a.disc = inp("discount_rate_pct", num(i.discount_rate_pct.value));
    if (levered) {
      a.loan = inp("loan_m", loan);
      a.drate = inp("debt_rate_pct", num(i.debt_rate_pct.value));
      a.nm = inp("debt_term_months", nM);
    }

    // A returns/debt row: label (col A) | live formula (col B, cached) | static
    // engine reference (col C). The verifier keys on the col-A label token,
    // asserts col B is a formula, and (recalc leg) checks col B ~= col C to 1e-6.
    const ret = (label, formula, ref) =>
      "B" + put([{ v: label }, { f: formula, v: num(ref), s: 2 }, { v: num(ref), s: 2 }]);

    // ---- debt block (formulas from the inputs; defined BEFORE the table so the
    //      table's debt_service/levered columns reference real cells) ----------
    if (levered) {
      put([]);
      put([Object.assign({ v: "DEBT (monthly-amortizing annuity — calc_colo)" }, B),
           Object.assign({ v: "live (recomputes)" }, B),
           Object.assign({ v: "engine reference" }, B)]);
      a.rm = ret("debt_rate_monthly", a.drate + "/100/12", num(i.debt_rate_pct.value) / 100 / 12);
      a.pmtm = ret("pmt_monthly", "IF(" + a.rm + "=0," + a.loan + "/" + a.nm + ",PMT(" +
                   a.rm + "," + a.nm + ",-" + a.loan + "))", num(o.debt_service_m_yr.value) / 12);
      a.ads = ret("debt_service_m_yr", "12*" + a.pmtm, num(o.debt_service_m_yr.value));
      a.payoff = ret("exit_payoff_m", "IF(" + a.rm + "=0,MAX(0," + a.loan + "-" + a.pmtm + "*" + mExit +
                     "),MAX(0," + a.loan + "*(1+" + a.rm + ")^" + mExit + "-" + a.pmtm +
                     "*((1+" + a.rm + ")^" + mExit + "-1)/" + a.rm + "))", null);
    }

    // ---- annual cash-flow table (formula cells reference the inputs above) ----
    put([]);
    put([Object.assign({ v: "CASH FLOWS BY YEAR" }, B)]);
    const hdr = ["year", "util", "hours", "rate_y", "revenue_m", "opex_m", "ebitda_m",
                 "terminal_m", "unlevered_m"].concat(levered ? ["debt_service_m", "levered_m"] : []);
    put(hdr.map((h) => Object.assign({ v: h }, B)));
    const yr0 = put([{ v: 0 }, null, null, null, null, null, null, null,
                     { f: "-" + a.capex, s: 2 }].concat(
                     levered ? [null, { f: "-(" + a.capex + "-" + a.loan + ")", s: 2 }] : []));
    const yRows = [yr0];
    for (let y = 1; y <= N; y++) {
      const RR = rows.length + 1;  // this row's 1-based number (before push)
      const A = "A" + RR;
      const cells = [
        { v: y },
        { f: "IF(" + A + "=1," + a.u1 + "," + a.us + ")", s: 2 },                 // util
        { f: a.gpus + "*" + a.hpy + "*B" + RR, s: 2 },                            // hours
        { f: a.rate + "*(1-" + a.decay + "/100)^(" + A + "-1)", s: 2 },           // rate_y
        { f: "C" + RR + "*D" + RR + "/1000000", s: 2 },                           // revenue_m
        { f: a.opex + "+" + a.energy + "*C" + RR + "/1000000", s: 2 },            // opex_m
        { f: "E" + RR + "-F" + RR, s: 2 },                                        // ebitda_m
        { f: "IF(" + A + "=" + N + "," + a.term + ",0)", s: 2 },                  // terminal_m
        { f: "G" + RR + "+H" + RR, s: 2 },                                        // unlevered_m
      ];
      if (levered) {
        cells.push({ f: "IF(" + A + "*12<=" + a.nm + "," + a.ads + "," + a.pmtm +
                        "*MAX(0,MIN(12," + a.nm + "-(" + A + "-1)*12)))", s: 2 });  // debt_service_m
        cells.push({ f: "G" + RR + "-J" + RR + "+H" + RR + "-IF(" + A + "=" + N + "," +
                        a.payoff + ",0)", s: 2 });                                 // levered_m
      }
      yRows.push(put(cells));
    }
    const unlevRange = "I" + yRows[0] + ":I" + yRows[yRows.length - 1];
    const unlev1 = "I" + yRows[1] + ":I" + yRows[yRows.length - 1];
    const levRange = "K" + yRows[0] + ":K" + yRows[yRows.length - 1];

    // ---- returns (formula outputs referencing the table above) ---------------
    put([]);
    put([Object.assign({ v: "RETURNS" }, B),
         Object.assign({ v: "live (recomputes)" }, B),
         Object.assign({ v: "engine reference" }, B)]);
    ret("irr_unlevered_pct", "IRR(" + unlevRange + ")*100", num(o.irr_unlevered_pct.value));
    ret("npv_unlevered_m", "I" + yRows[0] + "+NPV(" + a.disc + "/100," + unlev1 + ")",
        num(o.npv_unlevered_m.value));
    if (levered) {
      ret("irr_levered_pct", "IRR(" + levRange + ")*100", num(o.irr_levered_pct.value));
    }

    const widths = [22, 16, 16, 12, 12, 12, 12, 12, 14].concat(levered ? [14, 14] : []);
    return { name: "Cash flow", rows: rows, widths: widths };
  }

  function buildXlsx(res) {
    const about = [
      [{ v: res.title, s: 1 }],
      ["method", res.method],
      ["generated by", "AI-DC calculator - " + location.href],
      ["provenance legend", "[S] stated (published source) - [D] derived (arithmetic shown) - [A] assumed (engineering default)"],
      ["disclaimer", DISCLAIMER],
    ];
    const sheets = [
      { name: "About", rows: about, widths: [22, 110] },
      { name: "Inputs", rows: rowsOf(res.inputs), widths: [28, 14, 10, 8, 80] },
      { name: "Outputs", rows: rowsOf(res.outputs), widths: [32, 14, 10, 8, 80] },
      { name: "Notes", rows: res.notes.map((n, i) => [{ v: i + 1, s: 2 }, n]), widths: [4, 130] },
    ];
    // invest screen: a LIVE cash-flow sheet (PMT/NPV/IRR as formulas an investor
    // can edit) in addition to the static Outputs snapshot.
    const cf = buildCashflow(res);
    if (cf) sheets.push(cf);
    return A.exportXlsx.build(sheets);
  }

  function buildPdf(res) {
    const d = A.exportPdf.Doc();
    const M = 48, W = 595.28 - 2 * M;
    const cols = (k, v, u, l, s) => [
      { x: M, w: 118, txt: k, font: "F3", size: 7.5 },
      { x: M + 122, w: 66, txt: v, font: "F3", size: 7.5 },
      { x: M + 192, w: 40, txt: u, size: 7.5 },
      { x: M + 236, w: 26, txt: l, font: "F2", size: 7.5 },
      { x: M + 266, w: W - 266, txt: s, size: 7.5 },
    ];
    d.title(res.title);
    d.meta("AI-DC calculator - reproduce: " + location.href);
    d.meta("method: " + res.method);
    for (const [name, map] of [["Inputs", res.inputs], ["Outputs", res.outputs]]) {
      d.h2(name);
      d.row(cols("key", "value", "unit", "", "source / derivation"), 7.5);
      for (const [k, qv] of Object.entries(map)) {
        d.row(cols(k, fmt(qv.value), qv.unit || "", qv.label || "", qv.source || ""), 7.5);
      }
    }
    if (res.notes && res.notes.length) {
      d.h2("Notes");
      for (const n of res.notes) d.note(n);
    }
    return d.finish(DISCLAIMER);
  }

  function download(bytes, name, mime) {
    const blob = new Blob([bytes], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  // exposed for the smoke harness (bytes without touching the DOM/download)
  A.exportBytes = function (secId, kind) {
    const st = A.appState.results[secId];
    if (!st) return null;
    return kind === "pdf" ? buildPdf(st.res) : buildXlsx(st.res);
  };
  A.download = download;

  for (const sec of A.appState.sections || []) {
    const copyBtn = document.getElementById(sec.id + "-copy");
    if (!copyBtn) continue;
    const mk = (label, kind, mime, ext) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.id = sec.id + "-" + kind;
      b.textContent = label;
      b.addEventListener("click", () => {
        const bytes = A.exportBytes(sec.id, kind);
        if (bytes) download(bytes, "aidc-" + pageSlug() + "-" + sec.id + "." + ext, mime);
      });
      copyBtn.after(b);
      return b;
    };
    // insert PDF first so final order reads: Copy | .xlsx | .pdf
    mk("Download .pdf", "pdf", "application/pdf", "pdf");
    mk("Download .xlsx", "xlsx",
       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
  }
})();
