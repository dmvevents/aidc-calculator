// Minimal deterministic XLSX writer — no vendor lib. An .xlsx is a ZIP of XML
// parts; we emit STORE (uncompressed) entries with a FIXED timestamp so the
// same result payload always produces byte-identical files (the repo-wide
// determinism contract; also makes smoke checks grep-able: values appear as
// plain bytes). Inline strings only (no sharedStrings table).
"use strict";
(function () {
  // ---- CRC-32 (IEEE) --------------------------------------------------------
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const ENC = new TextEncoder();
  // fixed DOS date: 2026-01-01 00:00:00 (determinism — real mtimes would make
  // every download unique bytes)
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const DOS_TIME = 0;

  function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
  function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

  // ---- ZIP (STORE only) -----------------------------------------------------
  function zip(files) {  // files: [{name, data: Uint8Array}]
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = ENC.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const local = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(n), ...u32(n),
        ...u16(name.length), ...u16(0)]);
      chunks.push(local, name, f.data);
      central.push(new Uint8Array([
        0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(n), ...u32(n),
        ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + n;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const eocd = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length),
      ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const total = offset + cdSize + eocd.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of [...chunks, ...central, eocd]) { out.set(c, p); p += c.length; }
    return out;
  }

  // ---- XLSX parts -----------------------------------------------------------
  function xml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");  // XML-illegal controls
  }
  function colRef(i) {  // 0 -> A, 26 -> AA
    let s = "";
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  // cell: string | number | boolean | null | {v, s(tyle 0=body 1=bold 2=mono)}
  function sheetXml(sheet) {
    const rows = sheet.rows || [];
    const widths = sheet.widths || [];
    let cols = "";
    if (widths.length) {
      cols = "<cols>" + widths.map((w, i) =>
        '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>";
    }
    const body = rows.map((row, ri) => {
      const cells = row.map((cell, ci) => {
        const o = (cell !== null && typeof cell === "object") ? cell : { v: cell };
        const ref = colRef(ci) + (ri + 1);
        const st = o.s ? ' s="' + o.s + '"' : "";
        if (o.v === null || o.v === undefined) return "";
        if (typeof o.v === "number" && isFinite(o.v)) return '<c r="' + ref + '"' + st + "><v>" + o.v + "</v></c>";
        if (typeof o.v === "boolean") return '<c r="' + ref + '"' + st + ' t="b"><v>' + (o.v ? 1 : 0) + "</v></c>";
        return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xml(o.v) + "</t></is></c>";
      }).join("");
      return '<row r="' + (ri + 1) + '">' + cells + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      cols + "<sheetData>" + body + "</sheetData></worksheet>";
  }

  const STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '<font><sz val="10"/><name val="Consolas"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" applyFont="1"/></cellXfs>' +
    "</styleSheet>";

  // sheets: [{name, rows, widths}]
  function build(sheets) {
    const n = sheets.length;
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
      "</Types>";
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>";
    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => '<sheet name="' + xml(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) +
        '" r:id="rId' + (i + 1) + '"/>').join("") +
      "</sheets></workbook>";
    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
        (i + 1) + '.xml"/>').join("") +
      '<Relationship Id="rId' + (n + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    const files = [
      { name: "[Content_Types].xml", data: ENC.encode(ct) },
      { name: "_rels/.rels", data: ENC.encode(rels) },
      { name: "xl/workbook.xml", data: ENC.encode(wb) },
      { name: "xl/_rels/workbook.xml.rels", data: ENC.encode(wbRels) },
      { name: "xl/styles.xml", data: ENC.encode(STYLES) },
    ];
    sheets.forEach((s, i) => files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: ENC.encode(sheetXml(s)) }));
    return zip(files);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.exportXlsx = { build: build, _crc32: crc32 };
})();
