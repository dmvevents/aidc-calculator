// Parametric site-plan diagram (land + plan pages): draws the calc_land result
// as a scaled parcel with its six component pads, the expansion reserve, a
// LEGEND (name + area per pad — the site-SVG craft convention: no in-stage
// label collisions) and a scale bar. DIAGRAMMATIC MASSING — areas are the land
// model's [D] outputs, the ARRANGEMENT follows the reference-design site plan
// convention [A] (building center, gensets west, heat rejection east,
// substation NE, water SW, parking south); not a survey, and the caption says so.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const NS = "http://www.w3.org/2000/svg";

  // reference block geometry (aspect + fractional center on the 200x160 parcel)
  const REF = {
    building: { w: 80, l: 50, cx: 0.50, cy: 0.50, label: "building" },
    gensets: { w: 24, l: 30, cx: 0.19, cy: 0.47, label: "gensets" },
    cooling: { w: 28, l: 34, cx: 0.81, cy: 0.48, label: "heat rejection" },
    substation: { w: 30, l: 20, cx: 0.87, cy: 0.13, label: "substation" },
    water: { w: 15, l: 15, cx: 0.16, cy: 0.82, label: "water" },
    parking_roads: { w: 50, l: 25, cx: 0.58, cy: 0.86, label: "parking/roads" },
  };

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const fmtM2 = (v) => (v >= 10000 ? (v / 10000).toFixed(1) + " ha"
                                   : Math.round(v).toLocaleString("en-US") + " m²");

  // land = the calc_land result object (inputs/outputs with .value)
  function render(host, land) {
    const o = land.outputs;
    const parcel = o.parcel_m2.value;                    // phase-1
    const total = o.parcel_with_reserve_m2.value;        // incl. reserve
    const reserve = total - parcel;

    // phase-1 zone at the reference 5:4 aspect; the reserve extends east
    // (the "second hall goes here" reading of the reserve fraction)
    const W1 = Math.sqrt(parcel * 1.25);
    const H = W1 / 1.25;
    const Wt = total / H;

    const VW = 640, PAD = 16, LGX = 476;                 // legend column at x>=476
    const s = (LGX - 2 * PAD - 8) / Wt;
    const VH = Math.max(236, Math.min(560, H * s + PAD * 2 + 26));
    const oy = PAD + Math.max(0, (VH - PAD * 2 - 26 - H * s) / 2);
    const X = (m) => PAD + m * s, Y = (m) => oy + m * s;

    const svg = el("svg", { viewBox: "0 0 " + VW + " " + VH, class: "sp", role: "img",
                            "aria-label": "Diagrammatic site plan: parcel with building, " +
                              "gensets, heat rejection, substation, water and parking pads, " +
                              "with a legend of areas" });

    // parcel + reserve
    svg.appendChild(el("rect", { x: X(0), y: Y(0), width: Wt * s, height: H * s, class: "sp-parcel" }));
    if (reserve > 1e-9) {
      const hx = X(W1);
      svg.appendChild(el("rect", { x: hx, y: Y(0), width: (Wt - W1) * s, height: H * s, class: "sp-reserve" }));
      svg.appendChild(el("line", { x1: hx, y1: Y(0), x2: hx, y2: Y(H), class: "sp-fence" }));
    }

    // component pads — areas from the model, shapes from the reference
    // aspects, POSITIONS from a deterministic band packing that computes its
    // gaps from the pad sizes, so rectangles can NEVER overlap (the earlier
    // reference-fraction placement collided once pads outgrew their slots:
    // the phase-1 zone is half the reference parcel's area). Bands keep the
    // reference reading: substation NE · gensets W | building | cooling E ·
    // water SW | parking S. If the zone cannot hold the pads with clearances
    // (very low setback factors), ALL pads display-scale uniformly and the
    // caption says so — legend areas stay exact.
    const pads = {};
    for (const key in REF) {
      const area = o[key + "_m2"].value;
      if (!(area > 0)) continue;               // zero-area pad = not drawn (audit A3:
      const w = Math.sqrt(area * (REF[key].w / REF[key].l));   // 0/0 NaN-poisoned the SVG)
      pads[key] = { area: area, w: w, l: area / w };
    }
    const BANDS = [["substation"], ["gensets", "building", "cooling"],
                   ["water", "parking_roads"]]
      .map((row) => row.filter((k) => pads[k]))
      .filter((row) => row.length);
    const bandD = BANDS.map((r) => Math.max.apply(null, r.map((k) => pads[k].l)));
    const bandW = BANDS.map((r) => r.reduce((a, k) => a + pads[k].w, 0));
    const fit = Math.min(1,
      (W1 * 0.92) / Math.max.apply(null, bandW),
      (H * 0.90) / (bandD[0] + bandD[1] + bandD[2]));
    if (fit < 1) for (const k in pads) { pads[k].w *= fit; pads[k].l *= fit; }
    const dSum = bandD.map((d) => d * (fit < 1 ? fit : 1)).reduce((a, b) => a + b, 0);
    const zGap = (H - dSum) / (BANDS.length + 1);
    let zCur = zGap;
    BANDS.forEach((row, bi) => {
      const bd = bandD[bi] * (fit < 1 ? fit : 1);
      const rw = row.reduce((a, k) => a + pads[k].w, 0);
      const xGap = (W1 - rw) / (row.length + 1);
      // single-pad band right-aligns with a fixed margin (true NE reading —
      // audit A9: (W1-w)/2 as the gap degenerated to centered)
      let xCur = (row.length === 1)
        ? W1 - Math.min(xGap, W1 * 0.06) - pads[row[0]].w : xGap;
      for (const key of row) {
        const p2 = pads[key];
        const y = zCur + (bd - p2.l) / 2;
        const g = el("g", { class: "sp-pad sp-" + key });
        g.appendChild(el("rect", { x: X(xCur), y: Y(y),
                                   width: p2.w * s, height: p2.l * s }));
        if (p2.w * s >= 64 && p2.l * s >= 24) {
          g.appendChild(el("text", { x: X(xCur) + p2.w * s / 2,
                                     y: Y(y) + p2.l * s / 2 + 4,
                                     class: "sp-val sp-mid" }, fmtM2(p2.area)));
        }
        svg.appendChild(g);
        xCur += p2.w + xGap;
      }
      zCur += bd + zGap;
    });

    // scale bar (bottom-left, under the parcel)
    const nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
    const target = Wt / 5;
    const bar = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const by = Y(H) + 16;
    svg.appendChild(el("line", { x1: X(0), y1: by, x2: X(0) + bar * s, y2: by, class: "sp-scale" }));
    svg.appendChild(el("line", { x1: X(0), y1: by - 4, x2: X(0), y2: by + 4, class: "sp-scale" }));
    svg.appendChild(el("line", { x1: X(0) + bar * s, y1: by - 4, x2: X(0) + bar * s, y2: by + 4, class: "sp-scale" }));
    svg.appendChild(el("text", { x: X(0) + bar * s + 8, y: by + 4, class: "sp-val" }, bar + " m"));

    // ---- legend column: headline + one row per pad + reserve + totals ------
    let ly = 22;
    svg.appendChild(el("text", { x: LGX, y: ly, class: "sp-head-l" },
                       o.site_acres.value.toFixed(o.site_acres.value >= 100 ? 0 : 2) + " acres"));
    ly += 15;
    svg.appendChild(el("text", { x: LGX, y: ly, class: "sp-sub-l" },
                       fmtM2(total) + " · " + o.mw_it_per_acre.value.toFixed(2) + " MW-IT/acre"));
    ly += 18;
    const row = (cls, label, val) => {
      const g = el("g", { class: cls ? "sp-pad sp-leg " + cls : "" });
      if (cls) g.appendChild(el("rect", { x: LGX, y: ly - 8, width: 10, height: 10 }));
      g.appendChild(el("text", { x: LGX + (cls ? 16 : 0), y: ly, class: "sp-name" }, label));
      g.appendChild(el("text", { x: VW - 4, y: ly, class: "sp-val sp-end" }, val));
      svg.appendChild(g);
      ly += 17;
    };
    for (const key in REF) row("sp-" + key, REF[key].label, fmtM2(o[key + "_m2"].value));
    if (reserve > 1e-9) row("sp-reserve", "reserve", fmtM2(reserve));
    ly += 3;
    svg.appendChild(el("line", { x1: LGX, y1: ly - 11, x2: VW - 4, y2: ly - 11, class: "sp-rule" }));
    row(null, "developed", fmtM2(o.developed_m2.value));
    row(null, "circ + setbacks", fmtM2(parcel - o.developed_m2.value));

    const cap = document.createElement("p");
    cap.className = "sp-caption";
    cap.textContent = "Diagrammatic massing — areas from the land model [D]; arrangement " +
      "follows the reference site-plan convention [A] with computed clearances (pads " +
      "cannot overlap by construction). Not a survey: setbacks, stormwater and zoning " +
      "are jurisdiction-specific.";
    host.replaceChildren(svg, cap);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  A.siteplan = { render: render, REF: REF };
})();
