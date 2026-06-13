import * as XLSX from 'xlsx'

/**
 * Export an array of row objects to a downloadable .xlsx file.
 * @param rows   array of flat objects (keys become column headers)
 * @param filename  without extension
 * @param sheetName  worksheet tab name
 */
export function exportToExcel(rows: Record<string, any>[], filename: string, sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows)
  // Auto-size columns based on content
  const cols = Object.keys(rows[0] || {}).map(key => {
    const maxLen = Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length))
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) }
  })
  ws['!cols'] = cols
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
