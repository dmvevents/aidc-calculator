// Minimal deterministic PDF writer — no vendor lib. Uses the base-14 fonts
// (Helvetica / Helvetica-Bold / Courier), so nothing is embedded and the
// output is tiny. Content streams are uncompressed (grep-able in smoke) and
// no /CreationDate or /ID is written, so the same payload always produces
// byte-identical files. WinAnsi text only — unsupported glyphs get ASCII
// fallbacks via SAN below (the units/notes vocabulary of this site).
"use strict";
(function () {
  const ENC = new TextEncoder();
  const PAGE_W = 595.28, PAGE_H = 841.89;               // A4 portrait, pt
  const M = 48, BOTTOM = 64;                            // margins

  // unicode -> WinAnsi-safe replacements (site vocabulary)
  const SAN = [
    [/—/g, "\x97"], [/–/g, "\x96"], [/‘/g, "\x91"], [/’/g, "\x92"],
    [/“/g, "\x93"], [/”/g, "\x94"], [/…/g, "\x85"], [/€/g, "\x80"],
    [/×/g, "\xd7"], [/·/g, "\xb7"], [/°/g, "\xb0"], [/±/g, "\xb1"],
    [/²/g, "\xb2"], [/³/g, "\xb3"], [/µ/g, "\xb5"], [/½/g, "\xbd"],
    [/≤/g, "<="], [/≥/g, ">="], [/→/g, "->"], [/←/g, "<-"],
    [/↑/g, "^"], [/↓/g, "v"], [/✓|✔/g, "OK"], [/✕|✖|✗/g, "x"],
    [/√/g, "sqrt"], [/≈/g, "~"], [/π/g, "pi"], [/Δ/g, "delta-"],
    [/₂/g, "2"], [/’/g, "'"],
  ];
  function winAnsi(s) {
    let t = String(s);
    for (const [re, sub] of SAN) t = t.replace(re, sub);
    let out = "";
    for (const ch of t) { const c = ch.codePointAt(0); out += (c >= 32 && c <= 255) ? ch : "?"; }
    return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }
  // width estimate (pt) — Helvetica ~0.51 em average, Courier fixed 0.60 em.
  function w(str, size, mono) { return str.length * size * (mono ? 0.6 : 0.51); }
  function clip(str, size, mono, maxW) {
    let s = String(str);
    if (w(s, size, mono) <= maxW) return s;
    while (s.length > 1 && w(s + "...", size, mono) > maxW) s = s.slice(0, -1);
    return s + "...";
  }
  function wrap(str, size, mono, maxW) {
    const words = String(str).split(/\s+/), lines = [];
    let cur = "";
    for (const word of words) {
      const cand = cur ? cur + " " + word : word;
      if (w(cand, size, mono) <= maxW || !cur) cur = cand;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ---- document builder -----------------------------------------------------
  // doc API: title(t) meta(t) h2(t) row(cols) note(t) gap() — auto-paginates.
  function Doc() {
    const pages = [];
    let buf = [], y = 0;
    function newPage() { buf = []; pages.push(buf); y = PAGE_H - M; }
    newPage();
    function need(h) { if (y - h < BOTTOM) newPage(); }
    function text(x, yy, font, size, str) {
      buf.push("BT /" + font + " " + size + " Tf 1 0 0 1 " + x.toFixed(2) + " " +
               yy.toFixed(2) + " Tm (" + winAnsi(str) + ") Tj ET");
    }
    function hr(yy) {
      buf.push("0.75 w 0.62 0.66 0.72 RG " + M + " " + yy.toFixed(2) + " m " +
               (PAGE_W - M) + " " + yy.toFixed(2) + " l S");
    }
    return {
      title(t) { need(26); text(M, y - 14, "F2", 15, t); y -= 26; },
      meta(t)  { need(12); text(M, y - 9, "F1", 7.5, clip(t, 7.5, false, PAGE_W - 2 * M)); y -= 12; },
      h2(t)    { need(28); y -= 10; text(M, y - 10, "F2", 10.5, t); hr(y - 14); y -= 20; },
      // cols: [{x, w, txt, font?, size?}] one table line
      row(cols, size) {
        const s = size || 8;
        need(s + 5);
        for (const c of cols) text(c.x, y - s, c.font || "F1", c.size || s, clip(c.txt, c.size || s, (c.font || "F1") === "F3", c.w));
        y -= s + 4;
      },
      note(t) {
        const lines = wrap(t, 8, false, PAGE_W - 2 * M - 10);
        for (let i = 0; i < lines.length; i++) {
          need(12);
          text(M + (i ? 10 : 0), y - 8, "F1", 8, (i ? "" : "- ") + lines[i]);
          y -= 11;
        }
        y -= 2;
      },
      gap(h) { y -= h || 8; },
      finish(footer) {
        const n = pages.length;
        pages.forEach((p, i) => {
          p.push("BT /F1 7 Tf 1 0 0 1 " + M + " 30 Tm (" + winAnsi(clip(footer, 7, false, PAGE_W - 2 * M - 60)) + ") Tj ET");
          p.push("BT /F1 7 Tf 1 0 0 1 " + (PAGE_W - M - 40) + " 30 Tm (page " + (i + 1) + " / " + n + ") Tj ET");
        });
        return emit(pages);
      },
    };
  }

  function emit(pages) {
    const objs = [];                     // 1-indexed bodies (strings/bytes)
    const nPages = pages.length;
    // 1 catalog, 2 pages tree, 3..5 fonts, then per page: page obj + stream
    objs.push("<< /Type /Catalog /Pages 2 0 R >>");
    const kids = pages.map((_, i) => (6 + i * 2) + " 0 R").join(" ");
    objs.push("<< /Type /Pages /Count " + nPages + " /Kids [" + kids + "] >>");
    objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
    for (let i = 0; i < nPages; i++) {
      const stream = pages[i].join("\n");
      objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] " +
                "/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents " +
                (7 + i * 2) + " 0 R >>");
      objs.push("<< /Length " + ENC.encode(stream).length + " >>\nstream\n" + stream + "\nendstream");
    }
    let out = "%PDF-1.4\n%\xb5\xb7\n";
    const xref = [0];
    objs.forEach((body, i) => {
      xref.push(out.length);
      out += (i + 1) + " 0 obj\n" + body + "\nendobj\n";
    });
    const xrefPos = out.length;
    out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
    for (let i = 1; i <= objs.length; i++) out += String(xref[i]).padStart(10, "0") + " 00000 n \n";
    out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF";
    // latin-1 string -> bytes
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.exportPdf = { Doc: Doc };
})();
