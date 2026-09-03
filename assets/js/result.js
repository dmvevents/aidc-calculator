// The one result shape every calculator returns, plus format helpers.
// parity: cli/aidc/core/result.py (q, result, defaults_of, _fmt ported 1:1;
// render() is replaced by the DOM layer in app.js).
//
// quantity = {value, unit, label: "[S]"|"[D]"|"[A]", source}
// result   = {title, method, inputs: {name: quantity},
//             outputs: {name: quantity}, notes: [str]}
"use strict";
(function () {
  const LABELS = ["[S]", "[D]", "[A]"];

  function q(value, unit, label, source) {
    unit = unit || "";
    label = label || "[A]";
    source = source || "";
    if (!LABELS.includes(label)) {
      throw new Error("label must be one of " + LABELS.join(", ") + ", got " + label);
    }
    return { value: value, unit: unit, label: label, source: source };
  }

  function result(title, method, inputs, outputs, notes) {
    return { title: title, method: method, inputs: inputs, outputs: outputs,
             notes: (notes || []).slice() };
  }

  function defaultsOf(table) {
    const out = {};
    for (const k of Object.keys(table)) out[k] = table[k].value;
    return out;
  }

  // Round-half-to-EVEN to nearest integer — matches Python's native round()/
  // "{:,.0f}"/"%.*f" (banker's), unlike JS Math.round (half-up) and toFixed
  // (half-away). Python's _fmt is the source of truth; this makes fmt byte-
  // identical on exact ties (e.g. 12672.5 -> 12672, not 12673).
  function bankersRound(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1; // exact .5 tie -> even
  }

  // Fixed-point to `digits` decimals, round-half-to-even — matches Python
  // "%.<digits>f". toFixed is correctly rounded for every non-tie value, so it
  // is the base; only EXACT decimal ties are corrected to even. A genuine
  // d-decimal tie is a dyadic value equal to an odd multiple of 1/2^(d+1)
  // (e.g. 1.0625 = 17/16 at d=3), so value*2^(d+1) is an ODD integer — a test
  // that never rounds (multiplying a double by a power of two is exact), unlike
  // value*10^d which can fabricate a phantom .5 (0.000125*1e5 -> 12.5, though
  // the true double sits above 0.000125 and Python rounds it up to "0.00013").
  function bankersFixed(value, digits) {
    const t = value * Math.pow(2, digits + 1);
    if (Number.isInteger(t) && (t % 2 !== 0)) { // exact .5 tie -> round to even
      const fl = Math.floor(Math.abs(value) * Math.pow(10, digits));
      const n = (fl % 2 === 0) ? fl : fl + 1;
      let s = String(n);
      if (digits > 0) {
        while (s.length <= digits) s = "0" + s;
        s = s.slice(0, -digits) + "." + s.slice(-digits);
      }
      return (value < 0 && n !== 0 ? "-" : "") + s;
    }
    return value.toFixed(digits);
  }

  // parity: result.py _fmt — used verbatim by the "Copy as Markdown" blocks.
  // The renderer is a pure function of the JSON-preserved numeric VALUE (JSON
  // erases int/float: 864.0 -> 864), so Number.isInteger mirrors Python's
  // int-branch + float.is_integer() short-circuit (A5: whole floats -> grouped
  // int). All rounding goes through the banker's helpers so fmt == _fmt byte-
  // for-byte, including ties (A6).
  function fmt(value) {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number") {
      if (value === 0) value = 0;  // D1: normalize -0 -> +0 so a JSON-preserved -0.0 renders "0" like _fmt (Python int(-0.0)==0 drops the sign; (-0).toLocaleString() would give "-0")
      if (Number.isInteger(value)) return value.toLocaleString("en-US");
      if (value !== 0 && Math.abs(value) < 0.01) return bankersFixed(value, 5);
      if (Math.abs(value) >= 10000) {
        return bankersRound(value).toLocaleString("en-US");
      }
      return bankersFixed(value, 3);
    }
    return String(value);
  }

  // Display formatter for the live UI (adaptive precision, keeps mono columns tidy).
  function disp(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number") {
      if (!isFinite(value)) return "—";
      if (Number.isInteger(value)) return value.toLocaleString("en-US");
      const a = Math.abs(value);
      if (a >= 1000) return Math.round(value).toLocaleString("en-US");
      if (a >= 100) return value.toFixed(1);
      if (a >= 1) return value.toFixed(2);
      if (a >= 0.01) return value.toFixed(3);
      return value.toFixed(5);
    }
    return String(value);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.res = { q: q, result: result, defaultsOf: defaultsOf, fmt: fmt, disp: disp };
})();
