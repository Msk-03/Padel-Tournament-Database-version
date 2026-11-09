/* Tiny Excel (.xlsx) writer: no libraries, works offline.
   XlsxWriter.build(sheets) → Blob. Each sheet:
     { name, title, subtitle, columns: [{ header, width, type: 'text'|'int'|'num1'|'pct'|'date' }], rows: [[...]],
       freezeHeader: true, autoFilter: true, totals: optional row array, zebra: true }
   The title (and subtitle) sit above the table; the header row is teal with white bold text. */
window.XlsxWriter = (() => {
    const enc = new TextEncoder();
    const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    /* ---------- zip (stored, no compression) ---------- */
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    function zip(files) {
        const parts = [], central = [];
        let offset = 0;
        const d = new Date();
        const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        for (const [name, text] of files) {
            const data = enc.encode(text), nameB = enc.encode(name), crc = crc32(data);
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
            local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
            local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
            local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
            parts.push(new Uint8Array(local.buffer), nameB, data);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
            cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
            cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
            cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
            central.push(new Uint8Array(cen.buffer), nameB);
            offset += 30 + nameB.length + data.length;
        }
        const cenSize = central.reduce((n, b) => n + b.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    /* ---------- styles ----------
       cellXfs index: 0 normal · 1 title · 2 subtitle · 3 header · 4 text · 5 int · 6 num1 · 7 pct · 8 date
                      9–13 = 4–8 on a shaded (zebra) row · 14 totals text · 15 totals int · 16 totals num1 */
    const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="d mmm yyyy"/></numFmts>
<fonts count="5">
<font><sz val="11"/><color rgb="FF142F32"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="18"/><color rgb="FF087D80"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF627A7D"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF142F32"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF087D80"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F6F5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD4EF78"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE7E5"/></bottom><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF087D80"/></top><bottom style="thin"><color rgb="FF087D80"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="1" fontId="4" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="164" fontId="4" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const TYPE_STYLE = { text: 4, int: 5, num1: 6, pct: 7, date: 8 };
    const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    // Excel serial date from "YYYY-MM-DD"
    const serial = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000 : null; };

    function cell(ref, value, type, style) {
        if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}"/>`;
        if (type === 'date') { const n = serial(value); return n === null ? `<c r="${ref}" s="${style - 4}" t="inlineStr"><is><t>${esc(value)}</t></is></c>` : `<c r="${ref}" s="${style}"><v>${n}</v></c>`; }
        if (type !== 'text' && typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    }

    function sheetXml(sh) {
        const cols = sh.columns, last = colName(cols.length - 1);
        const rows = [];
        let r = 1;
        rows.push(`<row r="${r}" ht="28" customHeight="1">${cell('A' + r, sh.title, 'text', 1)}</row>`); r++;
        if (sh.subtitle) { rows.push(`<row r="${r}">${cell('A' + r, sh.subtitle, 'text', 2)}</row>`); r++; }
        r++; // blank spacer row
        const headerRow = r;
        rows.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((c, i) => cell(colName(i) + r, c.header, 'text', 3)).join('')}</row>`); r++;
        sh.rows.forEach((row, n) => {
            const shade = sh.zebra !== false && n % 2 === 1 ? 5 : 0;
            rows.push(`<row r="${r}">${cols.map((c, i) => cell(colName(i) + r, row[i], c.type || 'text', TYPE_STYLE[c.type || 'text'] + shade)).join('')}</row>`);
            r++;
        });
        const lastDataRow = r - 1;
        if (sh.totals) {
            rows.push(`<row r="${r}">${cols.map((c, i) => cell(colName(i) + r, sh.totals[i], c.type === 'num1' ? 'num1' : (typeof sh.totals[i] === 'number' ? 'int' : 'text'), c.type === 'num1' ? 16 : typeof sh.totals[i] === 'number' ? 15 : 14)).join('')}</row>`);
        }
        const pane = sh.freezeHeader !== false
            ? `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/></sheetView></sheetViews>`
            : '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
        const widths = `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"/>`).join('')}</cols>`;
        const filter = sh.autoFilter !== false && sh.rows.length ? `<autoFilter ref="A${headerRow}:${last}${lastDataRow}"/>` : '';
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${Math.max(r, headerRow)}"/>${pane}<sheetFormatPr defaultRowHeight="18"/>${widths}<sheetData>${rows.join('')}</sheetData>${filter}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
    }

    function build(sheets) {
        const safe = n => String(n).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
        const files = [
            ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`],
            ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`],
            ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Padel Center backup</dc:title><dc:creator>Padel Center</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
</cp:coreProperties>`],
            ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheets.map((sh, i) => `<sheet name="${esc(safe(sh.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${sheets.map((sh, i) => sh.autoFilter !== false && sh.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(safe(sh.name)).replace(/'/g, "''")}'!$A$${sh.subtitle ? 4 : 3}:$${colName(sh.columns.length - 1)}$${(sh.subtitle ? 4 : 3) + sh.rows.length}</definedName>` : '').join('')}</definedNames>
</workbook>`],
            ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
            ['xl/styles.xml', STYLES],
            ...sheets.map((sh, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh)])
        ];
        return zip(files);
    }

    return { build };
})();
