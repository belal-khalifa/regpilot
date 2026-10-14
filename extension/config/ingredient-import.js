// RegPilot extension - builds the ingredient spreadsheet Montaji's "Import" button expects.
//
// Montaji publishes an "Ingredient_sample.xlsx" template (kept in ../assets). Rather than generate a
// workbook from scratch, this fills the template's own sheet so everything else in the file (hidden
// catalogue, styles, validation rules) stays exactly as Montaji shipped it. Rows start at row 3
// (row 1 is a note, row 2 the headers: Ingredient | Other | Percentage | Weight).
//
// Every ingredient is written as "***Other***" with its real name in the Other column. Montaji swaps
// in its own master-list entry when the name already exists there, so no matching is done here.
//
// Needs JSZip (vendor/jszip.min.js) and the browser's DOMParser/XMLSerializer.

;(function () {
  const RP = (globalThis.RegPilot = globalThis.RegPilot || {})

  const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const OTHER = '***Other***'
  const FIRST_DATA_ROW = 3
  // The template's table spans A2:D115, i.e. 113 data rows.
  const MAX_ROWS = 113

  function numberFrom(value) {
    const match = String(value ?? '').match(/\d+(\.\d+)?/)
    if (!match) return null
    const n = Number(match[0])
    return n >= 0 && n <= 1000 ? n : null
  }

  // Strings go through the workbook's shared-string table, exactly as Excel itself writes them. An
  // importer built on a spreadsheet library reads these reliably; inline strings are less certain.
  function makeSharedStrings(doc) {
    const root = doc.documentElement
    let next = root.getElementsByTagNameNS(MAIN_NS, 'si').length
    const added = new Map()
    return {
      index(text) {
        if (added.has(text)) return added.get(text)
        const si = doc.createElementNS(MAIN_NS, 'si')
        const t = doc.createElementNS(MAIN_NS, 't')
        t.textContent = text
        if (/^\s|\s$/.test(text)) t.setAttribute('xml:space', 'preserve')
        si.appendChild(t)
        root.appendChild(si)
        added.set(text, next)
        return next++
      },
      finish(usedCount) {
        root.setAttribute('uniqueCount', String(next))
        root.setAttribute('count', String(Number(root.getAttribute('count') || 0) + usedCount))
      },
    }
  }

  function stringCell(doc, strings, ref, style, text) {
    const c = doc.createElementNS(MAIN_NS, 'c')
    c.setAttribute('r', ref)
    c.setAttribute('s', String(style))
    c.setAttribute('t', 's')
    const v = doc.createElementNS(MAIN_NS, 'v')
    v.textContent = String(strings.index(text))
    c.appendChild(v)
    return c
  }

  function numberCell(doc, ref, style, n) {
    const c = doc.createElementNS(MAIN_NS, 'c')
    c.setAttribute('r', ref)
    c.setAttribute('s', String(style))
    const v = doc.createElementNS(MAIN_NS, 'v')
    v.textContent = String(n)
    c.appendChild(v)
    return c
  }

  async function findIngredientSheetPath(zip) {
    try {
      const workbook = new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml')
      const sheet = Array.from(workbook.getElementsByTagNameNS(MAIN_NS, 'sheet')).find(
        (s) => s.getAttribute('name') === 'Ingredient Details',
      )
      const rid = sheet && (sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))
      if (rid) {
        const rels = new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml')
        const rel = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)
        if (rel) return 'xl/' + rel.getAttribute('Target').replace(/^\/?(xl\/)?/, '')
      }
    } catch (_) {
      // fall through to the known location
    }
    return 'xl/worksheets/sheet1.xml'
  }

  // ingredients: [{ inci_name, percentage? }]; templateBytes: ArrayBuffer | Uint8Array of the template.
  // Returns { bytes: Uint8Array, count, skipped: string[], approximated: string[] }.
  async function buildWorkbook(ingredients, templateBytes) {
    const zip = await JSZip.loadAsync(templateBytes)
    const sheetPath = await findIngredientSheetPath(zip)
    const doc = new DOMParser().parseFromString(await zip.file(sheetPath).async('string'), 'application/xml')
    const sheetData = doc.getElementsByTagNameNS(MAIN_NS, 'sheetData')[0]
    const sharedDoc = new DOMParser().parseFromString(await zip.file('xl/sharedStrings.xml').async('string'), 'application/xml')
    const strings = makeSharedStrings(sharedDoc)
    let stringsUsed = 0

    const rowsByNumber = new Map()
    for (const row of Array.from(sheetData.childNodes)) {
      if (row.nodeType === 1 && row.getAttribute('r')) rowsByNumber.set(Number(row.getAttribute('r')), row)
    }

    const usable = (ingredients || []).filter((i) => i && String(i.inci_name || '').trim())
    const skipped = usable.slice(MAX_ROWS).map((i) => i.inci_name)
    // Percentages like "<1%" or "0.5-1%" have no single exact number; they are written as the
    // first number found and reported so a person can check them.
    const approximated = usable
      .slice(0, MAX_ROWS)
      .filter((i) => /[<>~\-]/.test(String(i.percentage ?? '')) && numberFrom(i.percentage) !== null)
      .map((i) => `${i.inci_name} (${i.percentage})`)

    usable.slice(0, MAX_ROWS).forEach((ingredient, index) => {
      const n = FIRST_DATA_ROW + index
      let row = rowsByNumber.get(n)
      if (!row) {
        row = doc.createElementNS(MAIN_NS, 'row')
        row.setAttribute('r', String(n))
        // keep rows in numeric order
        const after = Array.from(rowsByNumber.keys()).filter((k) => k > n).sort((a, b) => a - b)[0]
        sheetData.insertBefore(row, after ? rowsByNumber.get(after) : null)
        rowsByNumber.set(n, row)
      }

      const cells = [
        stringCell(doc, strings, `A${n}`, 1, OTHER),
        stringCell(doc, strings, `B${n}`, 1, String(ingredient.inci_name).trim()),
      ]
      stringsUsed += 2
      const pct = numberFrom(ingredient.percentage)
      if (pct !== null) cells.push(numberCell(doc, `C${n}`, 5, pct))

      // Cells must stay in column order; the template's own cell in this row is column Z.
      for (const old of Array.from(row.childNodes)) {
        if (old.nodeType === 1 && /^[A-D]\d+$/.test(old.getAttribute('r') || '')) row.removeChild(old)
      }
      const anchor = row.firstChild
      for (const cell of cells) row.insertBefore(cell, anchor)
    })

    strings.finish(stringsUsed)
    zip.file(sheetPath, new XMLSerializer().serializeToString(doc))
    zip.file('xl/sharedStrings.xml', new XMLSerializer().serializeToString(sharedDoc))
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    return { bytes, count: Math.min(usable.length, MAX_ROWS), skipped, approximated }
  }

  RP.ingredientImport = { buildWorkbook, MAX_ROWS }
})()
