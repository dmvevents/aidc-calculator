// Page config: colo-developer economics (calc_colo.js) — build the facility,
// lease the kW, own no GPUs. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  A.SECTIONS.push({
    id: "colo",
    defaults: A.calcColo.DEFAULTS,
    compute: (kw) => A.calcColo.costs(kw),
    hero: "cost_floor_usd_per_kw_month", heroLabel: "landlord cost floor (not a price)",
    heroSrc: "colo-model",
    fields: [
      { key: "it_mw", label: "leasable critical IT", src: "legend", step: 0.5, min: 0.1 },
      { key: "lease_tier", label: "rate tier", src: "cbre-colo", type: "select",
        options: [["retail", "retail (published asking)"], ["wholesale", "wholesale (quote-only band)"]] },
      { key: "lease_usd_per_kw_month", label: "lease rate $/kW/mo (blank = tier anchor)",
        src: "cbre-colo", step: 5, min: 0, placeholder: "tier anchor" },
      { key: "occupancy", label: "stabilised occupancy", src: "colo-model", step: 0.05, min: 0.05, max: 1 },
      { key: "build_usd_per_w_it", label: "facility capex $/W-IT", src: "jll", step: 0.1, min: 0, advanced: true },
      { key: "substation_m", label: "substation $M (FEED)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "contingency_pct_of_facility", label: "named-risk contingency % of facility",
        src: "fm-contingency", step: 0.5, min: 0, advanced: true },
      { key: "opex_k_per_mw_it_yr", label: "opex ex-power $k/MW-IT/yr", src: "opex-band",
        step: 10, min: 0, advanced: true },
      { key: "facility_life_years", label: "facility life (yr)", src: "legend", step: 1, min: 1, advanced: true },
      { key: "ltc_pct", label: "FINANCING: loan-to-cost % (blank = unlevered)", src: "colo-model",
        step: 5, min: 1, max: 99, placeholder: "unlevered" },
      { key: "debt_rate_pct", label: "FINANCING: all-in debt rate %/yr", src: "colo-model",
        step: 0.25, min: 0, placeholder: "term-sheet" },
      { key: "amort_years", label: "FINANCING: amortization (yr)", src: "colo-model",
        step: 5, min: 1, advanced: true },
    ],
    derive: (r) => {
      const i = r.inputs, o = r.outputs;
      return [
        "capex = facility(" + d(o.capex_facility_m.value) + ")" +
          (o.capex_substation_m && o.capex_substation_m.value
            ? " + sub(" + d(o.capex_substation_m.value) + ")" : "") +
          " + contingency(" + d(o.capex_contingency_m.value) + ") = " +
          d(o.capex_total_m.value) + " US$M — NO IT/GPU line; the tenant brings the fleet",
        "revenue = leased kW × rate × 12 = " + d(o.leased_kw.value) + " × " +
          d(i.lease_usd_per_kw_month.value) + " × 12 = " + d(o.revenue_m_yr.value) +
          " US$M/yr (energy excluded — metered pass-through)",
        "NOI = revenue − opex = " + d(o.revenue_m_yr.value) + " − " + d(o.opex_m_yr.value) +
          " = " + d(o.noi_m_yr.value) + " US$M/yr (" + d(o.noi_margin_pct.value) + "% margin)",
        "cost floor = (amort + opex) ÷ (leased kW × 12) = (" + d(o.amortisation_m_yr.value) +
          " + " + d(o.opex_m_yr.value) + ")×10⁶ ÷ " + d(o.leased_kw.value) + "×12 = " +
          d(o.cost_floor_usd_per_kw_month.value) + " $/kW/mo — spread to the rate: " +
          d(o.rate_spread_usd_per_kw_month.value),
        "yield-on-cost = NOI ÷ capex = " + d(o.noi_m_yr.value) + " ÷ " + d(o.capex_total_m.value) +
          " = " + d(o.yield_on_cost_pct.value) + "% — break-even occupancy " +
          d(o.breakeven_occupancy_pct.value) + "%",
      ].concat(o.loan_m ? [
        "FINANCING: loan = capex × LTC = " + d(o.loan_m.value) + " US$M · equity " +
          d(o.equity_m.value) + " · debt service " + d(o.debt_service_m_yr.value) +
          " US$M/yr → DSCR " + d(o.dscr.value) + "x · debt yield " +
          d(o.debt_yield_pct.value) + "% · cash-on-cash " + d(o.cash_on_cash_pct.value) +
          "% (lenders covenant ~1.20–1.25x; quote-only market)",
      ] : []);
    },
    after: (r, kw) => {
      const host = document.getElementById("colo-sens");
      if (!host) return;
      // rate ±20% × occupancy ±10 pts — same grid convention as the capex page;
      // every cell re-runs costs() so the grid can never drift from the engine.
      const rate = (kw.lease_usd_per_kw_month !== null && kw.lease_usd_per_kw_month !== undefined)
        ? Number(kw.lease_usd_per_kw_month)
        : A.calcColo.LEASE_DEFAULT[kw.lease_tier || A.calcColo.DEFAULTS.lease_tier.value].value;
      const occ0 = (kw.occupancy !== null && kw.occupancy !== undefined)
        ? Number(kw.occupancy) : A.calcColo.DEFAULTS.occupancy.value;
      const rates = [rate * 0.8, rate, rate * 1.2];
      const occs = [Math.max(0.05, occ0 - 0.10), occ0, Math.min(1.0, occ0 + 0.10)];
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "yield-on-cost % — lease rate ±20% × occupancy ±10 pts [D]";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      const c0 = document.createElement("th");
      c0.textContent = "occ \\ rate";
      hr.appendChild(c0);
      for (const rt of rates) {
        const th = document.createElement("th");
        th.textContent = d(rt) + " $/kW·mo";
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      occs.forEach((oc, oi) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = (oc * 100).toFixed(0) + "%";
        tr.appendChild(th);
        rates.forEach((rt, ri) => {
          const y = A.calcColo.costs(Object.assign({}, kw, {
            lease_usd_per_kw_month: rt, occupancy: oc,
          })).outputs.yield_on_cost_pct.value;
          const td = document.createElement("td");
          td.className = "num" + (oi === 1 && ri === 1 ? " sens-base" : "");
          td.textContent = y.toFixed(1) + "%";
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      host.replaceChildren(tbl);
    },
  });

  A.boot();
})();
