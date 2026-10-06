// CSV export of form submissions.
//
// Two things here are not optional.
//
// FORMULA INJECTION. Every cell in this file was written by a stranger on the
// internet, and Excel, Numbers and Google Sheets all EXECUTE a cell that
// begins with `=`, `+`, `-`, `@`, TAB or CR. `=HYPERLINK(...)` exfiltrates the
// sheet; `=cmd|'...'!A1` runs a command on some versions of Excel. A leading
// apostrophe makes the cell literal text, which is the standard mitigation and
// the only one that survives being opened by a double-click.
//
// RFC 4180 QUOTING. A comma, a quote or a newline in a value — all of which a
// message field will contain — must not shift the columns of the row, or the
// name of one lead ends up in another's email column.
import { formName } from '../../src/lib/shared/forms.js'

/** characters a spreadsheet treats as the start of a formula */
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value) {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'boolean'
        ? value
          ? 'yes'
          : 'no'
        : String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  // quote whenever the value could otherwise break the row, and double any
  // embedded quote (RFC 4180)
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * One form's submissions as CSV.
 *
 * Columns come from the MANIFEST, so every row has the same shape even when an
 * older submission predates a field — and a value whose name is no longer
 * declared still appears, in a trailing column, rather than being silently
 * dropped from someone's export.
 */
export function submissionsCsv(entry, records) {
  const declared = (entry?.fields ?? []).map((f) => f.name)
  const extra = []
  for (const record of records) {
    for (const name of Object.keys(record.values ?? {})) {
      if (!declared.includes(name) && !extra.includes(name)) extra.push(name)
    }
  }
  const columns = [...declared, ...extra]
  const header = ['Received', 'Route', ...(records.some((r) => r.entry) ? ['Entry'] : []), ...columns]
  const hasEntry = header.includes('Entry')

  const lines = [header.map(cell).join(',')]
  for (const record of records) {
    const row = [
      new Date(record.at ?? 0).toISOString(),
      record.route ?? '',
      ...(hasEntry ? [record.entry ?? ''] : []),
      ...columns.map((name) => record.values?.[name]),
    ]
    lines.push(row.map(cell).join(','))
  }
  // a UTF-8 BOM, or Excel on Windows reads an accented name as mojibake
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** a safe download filename for one form's export */
export function csvFilename(entry, id) {
  const base = formName(entry)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || id}-submissions.csv`
}
