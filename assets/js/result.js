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

  // parity: result.py _fmt — used verbatim by the "Copy as Markdown" blocks.
  function fmt(value) {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number") {
      if (Number.isInteger(value)) return value.toLocaleString("en-US");
      if (value !== 0 && Math.abs(value) < 0.01) return value.toFixed(5);
      if (Math.abs(value) >= 10000) {
        return Math.round(value).toLocaleString("en-US");
      }
      return value.toFixed(3);
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
