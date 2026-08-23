// Page config: TCO calculator (colo + GPUs, cost per GPU-hour over time).
// Engine math lives in calc_tco.js (1:1 port of the frozen cli core, T1-T8);
// this file is UI only: the input form config, the derivation-chain lines,
// the cumulative-cash SVG curve, the cost-split bars and the sensitivity
// strip. The curve re-reads calc_tco's own ledger() so the chart can never
// drift from the parity-tested arithmetic. Cost estimator only — no ROI/IRR.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  const NS = "http://www.w3.org/2000/svg";
  const VARIANT_ORDER = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];
  const M$ = (x) => d(x / 1e6) + " M";

  // Platform resolution mirrors the cli wrapper: --platform pulls GPUs/rack and
  // kW/rack from the rack matrix unless the user overrides them.
  function withPlatform(kw) {
    const k2 = Object.assign({}, kw);
    const name = k2.platform || A.calcTco.DEFAULTS.platform.value;
    k2.platform = name;
    const v = globalThis.RACKDB[name];
    // == null (not === undefined): a blanked advanced field arrives as null and
    // must fall back to the PLATFORM value, not the GB200 engine basis (v3.1 MED)
    if (k2.gpus_per_rack == null) k2.gpus_per_rack = v.gpus_per_rack;
    if (k2.rack_kw == null) k2.rack_kw = v.nameplate_kw;
    if (k2.pue == null) k2.pue = v.pue_target;   // TCO-H1 (v3.1): PUE follows the platform
    return k2;
  }

  // Resolved plain-params view (defaults + kwargs + mode/tier/platform bands),
  // the same seeding tco() itself performs — used only to re-run ledger() for
  // the chart series.
  function resolvedP(kw) {
    const T = A.calcTco;
    const p = {};
    for (const k of Object.keys(T.DEFAULTS)) p[k] = T.DEFAULTS[k].value;
    for (const k of Object.keys(kw)) {
      if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];
    }
    if (p.gpu_price_usd === null || p.gpu_price_usd === undefined) {
      p.gpu_price_usd = T.GPU_PRICE_USD[p.platform].value;
    }
    if (p.opex_usd_per_kw_yr === null || p.opex_usd_per_kw_yr === undefined) {
      p.opex_usd_per_kw_yr = T.OPEX_DEFAULT[p.mode].value;
    }
    if (p.mode === "lease" &&
        (p.lease_usd_per_kw_month === null || p.lease_usd_per_kw_month === undefined)) {
      p.lease_usd_per_kw_month = T.LEASE_DEFAULT[p.lease_tier].value;
    }
    return p;
  }

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- cumulative cash curve (T7) vs cumulative rental (T8) -----------------
  function renderCurve(host, p) {
    const L = A.calcTco.ledger(p, Number(p.utilization), Number(p.power_usd_per_kwh));
    const months = L.months;
    const mkt = p.market_usd_per_gpu_hr !== null && p.market_usd_per_gpu_hr !== undefined
      ? Number(p.market_usd_per_gpu_hr) : null;
    const rentalTotal = mkt !== null ? mkt * L.hours_m * months : 0;
    const yMax = Math.max(L.cum_cash[months - 1], rentalTotal) * 1.05;
    const W = 860, H = 250, x0 = 78, x1 = W - 24, y0 = H - 34, y1 = 18;
    const X = (m) => x0 + (m / months) * (x1 - x0);
    const Y = (usd) => y0 - (usd / yMax) * (y0 - y1);

    let be = null;
    if (mkt !== null) {
      const rentalM = mkt * L.hours_m;
      for (let m = 1; m <= months; m++) {
        if (rentalM * m >= L.cum_cash[m - 1]) { be = m; break; }
      }
    }
    const label = "Cumulative cash out (T7), no terminal credit: " + M$(L.upfront) +
      " US$ upfront rising to " + M$(L.cum_cash[months - 1]) + " US$ at month " + months +
      (mkt !== null
        ? ". Cumulative rental at " + d(mkt) + " $/GPU-h reaches " + M$(rentalTotal) +
          " US$; " + (be ? "break-even at month " + be + "." : "no break-even within the horizon.")
        : ".");
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "dg", role: "img",
                            "aria-label": label });

    svg.appendChild(el("text", { x: x0, y: 12, "class": "dg-name", "text-anchor": "start" },
                       "CUMULATIVE CASH OUT — T7 (NO RESALE CREDIT) VS RENTAL"));
    // y gridlines + $M labels
    for (const f of [0, 0.5, 1]) {
      const y = Y(yMax * f);
      svg.appendChild(el("line", { x1: x0, y1: y, x2: x1, y2: y, "class": "dg-grid" }));
      svg.appendChild(el("text", { x: x0 - 8, y: y + 4, "class": "dg-val",
                                   "text-anchor": "end" }, M$(yMax * f)));
    }
    // x year ticks
    for (let m = 12; m <= months; m += 12) {
      svg.appendChild(el("line", { x1: X(m), y1: y0, x2: X(m), y2: y0 + 4, "class": "dg-grid" }));
      svg.appendChild(el("text", { x: X(m), y: y0 + 16, "class": "dg-name" }, "Y" + (m / 12)));
    }
    // cash curve: upfront at m=0, then the monthly ledger
    let pts = X(0) + "," + Y(L.upfront);
    for (let m = 1; m <= months; m++) pts += " " + X(m) + "," + Y(L.cum_cash[m - 1]);
    svg.appendChild(el("polyline", { points: pts, "class": "dg-curve" }));
    // rental line (starts at zero — renting has no upfront)
    if (mkt !== null) {
      svg.appendChild(el("polyline", {
        points: X(0) + "," + Y(0) + " " + X(months) + "," + Y(rentalTotal),
        "class": "dg-curve-rental" }));
      if (be) {
        svg.appendChild(el("line", { x1: X(be), y1: y1, x2: X(be), y2: y0, "class": "dg-be" }));
        svg.appendChild(el("text", { x: Math.min(X(be) + 4, x1 - 90), y: y1 + 10,
                                     "class": "dg-val dg-good", "text-anchor": "start" },
                           "break-even mo " + be));
      } else {
        svg.appendChild(el("text", { x: x1, y: y1 + 10, "class": "dg-name",
                                     "text-anchor": "end" }, "NO BREAK-EVEN IN HORIZON"));
      }
    }
    // line legend (identity by labelled sample stroke, never color alone)
    const ly = H - 8;
    svg.appendChild(el("line", { x1: x0, y1: ly - 4, x2: x0 + 26, y2: ly - 4, "class": "dg-curve" }));
    svg.appendChild(el("text", { x: x0 + 32, y: ly, "class": "dg-name", "text-anchor": "start" },
                       "YOUR CASH OUT"));
    if (mkt !== null) {
      svg.appendChild(el("line", { x1: x0 + 170, y1: ly - 4, x2: x0 + 196, y2: ly - 4,
                                   "class": "dg-curve-rental" }));
      svg.appendChild(el("text", { x: x0 + 202, y: ly, "class": "dg-name", "text-anchor": "start" },
                         "RENTAL @ " + d(mkt) + " $/GPU-H (YOUR INPUT)"));
    }
    host.replaceChildren(svg);
  }

  // ---- cost split bars (magnitude by LENGTH, one hue) ------------------------
  function renderSplit(host, r, build) {
    const names = ["gpu", build ? "facility" : "lease", "power", "opex"];
    const rows = names.map((n) => ({
      name: n,
      pct: r.outputs["split_" + n + "_pct"].value,
      usd: r.outputs["cost_" + n + "_usd"].value,
    }));
    const rowH = 26, labelW = 120, W = 860, H = rows.length * rowH + 26;
    const x0 = labelW, x1 = W - 150;
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "dg", role: "img",
                            "aria-label": "Horizon cost split: " + rows.map((s) =>
                              s.name + " " + d(s.pct) + " percent").join(", ") + "." });
    svg.appendChild(el("text", { x: x0, y: 12, "class": "dg-name", "text-anchor": "start" },
                       "HORIZON COST SPLIT — CAPITAL CONSUMED + CASH (T6 NUMERATOR)"));
    rows.forEach((s, i) => {
      const y = 20 + i * rowH;
      const w = Math.max(2, (x1 - x0) * Math.min(1, (s.pct || 0) / 100));
      svg.appendChild(el("text", { x: x0 - 8, y: y + 15, "class": "dg-name",
                                   "text-anchor": "end" }, s.name.toUpperCase()));
      svg.appendChild(el("rect", { x: x0, y: y + 2, width: w, height: rowH - 8, rx: 3,
                                   "class": "dg-bar" }));
      svg.appendChild(el("text", { x: x0 + w + 8, y: y + 15, "class": "dg-val",
                                   "text-anchor": "start" },
                         d(s.pct) + "% · " + M$(s.usd) + "$"));
    });
    host.replaceChildren(svg);
  }

  // ---- sensitivity strip (6 cells re-run through the same ledger) ------------
  function renderSens(host, r) {
    const cells = [
      ["util −10 pt", "sens_util_minus10pt"],
      ["util +10 pt", "sens_util_plus10pt"],
      ["power −25%", "sens_power_minus25"],
      ["power +25%", "sens_power_plus25"],
      ["worst (both)", "sens_worst"],
      ["best (both)", "sens_best"],
    ];
    const tbl = document.createElement("table");
    tbl.className = "matrix";
    const cap = document.createElement("caption");
    cap.textContent = "levelized US$/GPU-h — sensitivity, same fleet through the same ledger [D]";
    tbl.appendChild(cap);
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const [label] of cells) {
      const th = document.createElement("th");
      th.textContent = label;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tb = document.createElement("tbody");
    const tr = document.createElement("tr");
    for (const [, key] of cells) {
      const td = document.createElement("td");
      td.className = "num";
      td.textContent = d(r.outputs[key].value);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
    tbl.appendChild(tb);
    host.replaceChildren(tbl);
  }

  const show = (key, on) => {
    const ctl = document.getElementById("tco." + key);
    if (ctl) ctl.closest(".field").hidden = !on;
  };
  const holder = (key, v) => {
    const ctl = document.getElementById("tco." + key);
    if (ctl && v !== null && v !== undefined) ctl.placeholder = String(v);
  };

  A.SECTIONS.push({
    id: "tco",
    defaults: A.calcTco.DEFAULTS,
    compute: (kw) => A.calcTco.tco(withPlatform(kw)),
    hero: "levelized_usd_per_gpu_hr",
    heroLabel: "levelized cost per delivered GPU-hour — an estimate, not a price",
    heroSrc: "tco-model",
    fields: [
      { key: "mode", label: "deployment mode", src: "tco-model", type: "select",
        options: [["build", "BUILD — own the facility"], ["lease", "LEASE — colo space"]] },
      { key: "platform", label: "GPU platform", src: "variants", type: "select",
        options: VARIANT_ORDER.map((n) => [n, globalThis.RACKDB[n].platform]) },
      { key: "racks", label: "fleet size (racks)", src: "legend", step: 1, min: 1 },
      { key: "gpus", label: "fleet size (GPUs — wins over racks)", src: "legend", step: 8, min: 1,
        placeholder: "optional" },
      { key: "power_usd_per_kwh", label: "power price", src: "eia", step: 0.005, min: 0 },
      { key: "utilization", label: "billable utilization (conservative)", src: "tco-util",
        step: 0.05, min: 0.05, max: 1 },
      { key: "horizon_years", label: "horizon (1–6 yr)", src: "legend", step: 0.5, min: 1, max: 6 },
      { key: "gpu_price_usd", label: "GPU acquisition (all-in IT)", src: "tco-gpu-price",
        step: 500, min: 0, placeholder: "platform band" },
      { key: "lease_tier", label: "colo tier", src: "cbre-colo", type: "select",
        options: [["retail", "retail (published asking)"], ["wholesale", "wholesale (quote-only)"]] },
      { key: "depreciation", label: "GPU value curve", src: "tco-resale", type: "select",
        options: [["straight", "straight-line to salvage"], ["resale", "resale-decay band"]] },
      { key: "market_usd_per_gpu_hr", label: "market rental $/GPU-h (optional — unlocks break-even)",
        src: "rental-anchors", step: 0.05, min: 0, placeholder: "e.g. 10.50" },
      { key: "consumables_usd_per_kw_yr", label: "consumables anchor $/kW-yr (optional — FMEA slice)",
        src: "fm-consumables", step: 5, min: 0, placeholder: "off — band 30–60" },
      { key: "availability_pct", label: "delivered availability % (optional haircut)",
        src: "fm-availability", step: 0.1, min: 50, max: 100, placeholder: "off — band 98.5–99.5" },
      { key: "build_usd_per_w_it", label: "build capex $/W-IT", src: "jll",
        step: 0.1, min: 0, advanced: true },
      { key: "facility_life_years", label: "facility life (yr)", src: "legend",
        step: 1, min: 1, advanced: true },
      { key: "lease_usd_per_kw_month", label: "colo rate $/kW-mo", src: "cbre-colo",
        step: 5, min: 0, advanced: true, placeholder: "tier band" },
      { key: "pue", label: "PUE", src: "dsx-kpi", step: 0.01, min: 1, advanced: true },
      { key: "idle_power_frac", label: "idle power frac (of nameplate)", src: "aif-template",
        step: 0.05, min: 0, max: 1, advanced: true },
      { key: "gpus_per_rack", label: "GPUs per rack (override)", src: "variants",
        step: 1, min: 1, advanced: true },
      { key: "rack_kw", label: "rack nameplate kW (override)", src: "variants",
        step: 1, min: 1, advanced: true },
      { key: "gpu_life_years", label: "GPU life (yr)", src: "sec-gpu-life",
        step: 0.5, min: 1, advanced: true },
      { key: "salvage_frac", label: "salvage frac (straight)", src: "legend",
        step: 0.05, min: 0, max: 1, advanced: true },
      { key: "resale_decline_pct_yr", label: "resale decline %/yr", src: "tco-resale",
        step: 1, min: 0, advanced: true },
      { key: "resale_floor_frac", label: "resale floor frac", src: "tco-resale",
        step: 0.05, min: 0, max: 1, advanced: true },
      { key: "opex_usd_per_kw_yr", label: "opex ex-power $/kW-IT-yr", src: "tco-opex",
        step: 10, min: 0, advanced: true, placeholder: "940 build / 235 lease" },
      { key: "wacc_pct", label: "cost of capital %/yr (optional)", src: "legend",
        step: 0.5, min: 0, advanced: true },
    ],
    derive: (r, kw) => {
      const o = r.outputs, i = r.inputs;
      const build = !o.lease_usd_month;
      const L = [
        "T1 · fleet = " + o.racks.value + " racks × " + i.gpus_per_rack.value + " = " +
          d(o.gpus_installed.value) + " GPUs · IT = " + o.racks.value + " × " +
          d(i.rack_kw.value) + " kW = " + d(o.it_mw.value) + " MW-IT",
        "T2 · GPU-h/mo = " + d(o.gpus_installed.value) + " × 730 × " + d(i.utilization.value) +
          (i.availability_pct ? " × " + d(i.availability_pct.value) + "% avail" : "") +
          " = " + d(o.gpu_hours_month.value) + " → " + d(o.gpu_hours_horizon.value) +
          " over the horizon" +
          (o.gpu_hours_lost_to_downtime
            ? " (downtime removes " + d(o.gpu_hours_lost_to_downtime.value) +
              " GPU-h — the 0.5–1.5% expected-downtime band [D], FM evidence)"
            : ""),
        "T3 · LF = " + d(i.utilization.value) + " + (1−" + d(i.utilization.value) + ")×" +
          d(i.idle_power_frac.value) + " = " + d(o.energy_load_factor.value) + " → energy = " +
          d(o.energy_kwh_month.value) + " kWh/mo × " + d(i.power_usd_per_kwh.value) + " $/kWh = " +
          d(o.power_cost_usd_month.value) + " $/mo" +
          (o.consumables_usd_month
            ? " · consumables anchor + " + d(o.consumables_usd_month.value) +
              " $/mo (optics AFR + break-fix [FM-NET-001])"
            : ""),
        (build
          ? "T5 · facility = " + d(i.build_usd_per_w_it.value) + " $/W × " + d(o.it_mw.value) +
            " MW = " + M$(o.facility_capex_usd.value) + "$ · upfront = " + M$(o.upfront_usd.value) + "$"
          : "T5 · lease = " + d(o.it_mw.value * 1000) + " kW × " + d(i.lease_usd_per_kw_month.value) +
            " $/kW-mo = " + d(o.lease_usd_month.value) + " $/mo · upfront = " + M$(o.upfront_usd.value) + "$"),
        "T6 · levelized = (GPU consumed " + M$(o.cost_gpu_usd.value) + " + " +
          (build ? "facility " + M$(o.cost_facility_usd.value) : "lease " + M$(o.cost_lease_usd.value)) +
          " + power " + M$(o.cost_power_usd.value) + " + opex " + M$(o.cost_opex_usd.value) +
          ")$ ÷ " + d(o.gpu_hours_horizon.value) + " GPU-h = " +
          d(o.levelized_usd_per_gpu_hr.value) + " $/GPU-h",
      ];
      if (o.levelized_wacc_usd_per_gpu_hr) {
        L.push("T6+WACC · at " + d(i.wacc_pct.value) + "%/yr: " +
               d(o.levelized_wacc_usd_per_gpu_hr.value) + " $/GPU-h (discounted, terminal value credited)");
      }
      if (o.breakeven_month) {
        L.push("T8 · rental " + d(i.market_usd_per_gpu_hr.value) + " $/GPU-h × delivered hours vs the cash curve → " +
               (typeof o.breakeven_month.value === "number"
                 ? "break-even month " + o.breakeven_month.value
                 : o.breakeven_month.value) + " (both sides are estimates)");
      }
      return L;
    },
    after: (r, kw) => {
      const k2 = withPlatform(kw);
      const p = resolvedP(k2);
      const build = p.mode === "build";
      // mode/curve-dependent inputs: hide what the current mode ignores
      show("build_usd_per_w_it", build);
      show("facility_life_years", build);
      show("lease_tier", !build);
      show("lease_usd_per_kw_month", !build);
      const straight = p.depreciation === "straight";
      show("salvage_frac", straight);
      show("resale_decline_pct_yr", !straight);
      show("resale_floor_frac", !straight);
      // platform-following placeholders on the overridable bands
      const v = globalThis.RACKDB[p.platform];
      holder("gpus_per_rack", v.gpus_per_rack);
      holder("rack_kw", v.nameplate_kw);
      holder("pue", v.pue_target);
      holder("gpu_price_usd", A.calcTco.GPU_PRICE_USD[p.platform].value);
      holder("lease_usd_per_kw_month", A.calcTco.LEASE_DEFAULT[p.lease_tier].value);
      holder("opex_usd_per_kw_yr", A.calcTco.OPEX_DEFAULT[p.mode].value);
      const curve = document.getElementById("tco-curve");
      if (curve) renderCurve(curve, p);
      const split = document.getElementById("tco-split");
      if (split) renderSplit(split, r, build);
      const sens = document.getElementById("tco-sens");
      if (sens) renderSens(sens, r);
    },
  });

  A.boot();
})();
