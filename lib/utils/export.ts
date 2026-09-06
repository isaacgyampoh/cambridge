/**
 * Export rows to a downloadable .xlsx file.
 *
 * ── WHY THE IMPORT IS DYNAMIC ──────────────────────────────────────────────
 *
 * This module used `import * as XLSX from 'xlsx'` at the top level. That is a
 * 268 KB library, and importing it here put it in the bundle of every page
 * that offers an Export button — the leads list, student records, finance
 * registrations and certificates — for everyone, on every visit, whether or
 * not they ever exported anything.
 *
 * Exporting is a deliberate action taken occasionally. The library is now
 * fetched when somebody actually clicks, which costs a moment on that click
 * and saves 268 KB on every page load that does not.
 */
export async function exportToExcel(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = 'Sheet1'
): Promise<void> {
  const XLSX = await import('xlsx')

  const ws = XLSX.utils.json_to_sheet(rows)

  // Auto-size columns based on content.
  ws['!cols'] = Object.keys(rows[0] || {}).map(key => {
    const maxLen = Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length))
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
