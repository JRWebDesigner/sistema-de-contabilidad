import { createElement } from 'react'
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from '@react-pdf/renderer'

type ReportRow = { [key: string]: string | number | boolean | null }

type ReportPdfOptions = {
  title: string
  columns: string[]
  rows: ReportRow[]
  summaryRows: string[][]
  generatedAt: string
  period: string
  filter: string
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingHorizontal: 34,
    paddingBottom: 42,
    color: '#332719',
    fontFamily: 'Helvetica',
    fontSize: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#087f5b',
  },
  brand: { fontSize: 18, fontWeight: 700, color: '#332719' },
  brandSuffix: { color: '#1484a6', fontSize: 11 },
  subtitle: { marginTop: 4, color: '#897966', fontSize: 7 },
  titleBlock: { alignItems: 'flex-end', maxWidth: '60%' },
  title: { fontSize: 16, fontWeight: 700, textAlign: 'right' },
  description: { marginTop: 4, color: '#897966', fontSize: 8 },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 24,
    rowGap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eadfd2',
  },
  metadataItem: { minWidth: 100, maxWidth: '48%' },
  metadataLabel: { color: '#897966', fontSize: 6, textTransform: 'uppercase' },
  metadataValue: { marginTop: 3, color: '#332719', fontSize: 8 },
  table: { marginTop: 12 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#087f5b',
    color: '#24170b',
  },
  headerCell: { padding: 5, fontWeight: 700, color: '#24170b' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#eadfd2',
  },
  alternateRow: { backgroundColor: '#fff8f0' },
  cell: { padding: 5, color: '#4c4033' },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: '#fff2e6',
    borderTopWidth: 1,
    borderTopColor: '#1484a6',
  },
  totalLabel: { padding: 5, fontWeight: 700, textAlign: 'right' },
  summary: { marginTop: 18 },
  summaryTitle: {
    marginBottom: 6,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#1484a6',
    color: '#1484a6',
    fontSize: 11,
    fontWeight: 700,
  },
  summaryRow: { flexDirection: 'row', paddingVertical: 3 },
  summaryKey: { width: '48%', paddingRight: 10, fontWeight: 700 },
  summaryValue: { flexGrow: 1 },
  footer: {
    position: 'absolute',
    right: 34,
    bottom: 18,
    left: 34,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 5,
    borderTopWidth: 0.5,
    borderTopColor: '#eadfd2',
    color: '#897966',
    fontSize: 7,
  },
})

function formatCell(value: string | number | boolean | null) {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return String(value)
}

function getTotalGeneral(rows: ReportRow[]) {
  if (rows.length === 0) return '$ 0.00'

  const numericColumns = ['Total', 'Saldo', 'Precio', 'Stock', 'Mínimo', 'Subtotal', 'Total venta', 'Saldo pendiente', 'Ingreso', 'Egreso', 'Saldo del movimiento']
  for (const column of numericColumns) {
    const sum = rows.reduce((accumulator, row) => {
      const value = Number(row[column] ?? 0)
      return Number.isFinite(value) ? accumulator + value : accumulator
    }, 0)

    if (sum !== 0 || rows.some((row) => String(row[column] ?? '').trim() !== '')) {
      if (column === 'Stock' || column === 'Mínimo') return sum.toLocaleString('en-US')
      return `$ ${sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  }

  return `${rows.length} registros`
}

function ReportDocument({ title, columns, rows, summaryRows, generatedAt, period, filter }: ReportPdfOptions) {
  const cellWidth = `${100 / Math.max(columns.length, 1)}%`
  const summary = summaryRows[0]?.[0] === 'Resumen financiero' ? summaryRows.slice(1) : summaryRows
  const metadata = [
    ...(period ? [{ label: 'Período', value: period }] : []),
    ...(filter ? [{ label: 'Filtro aplicado', value: filter }] : []),
    { label: 'Registros', value: rows.length.toLocaleString('es-BO') },
    { label: 'Generado', value: generatedAt },
  ]

  return (
    <Document title={`${title} · Importlilimlab`} author="Importlilimlab" language="es">
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>Importlilimlab</Text>
            <Text style={styles.subtitle}>SISTEMA ADMINISTRATIVO</Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.description}>Reporte administrativo</Text>
          </View>
        </View>
        <View style={styles.metadata}>
          {metadata.map((item) => (
            <View key={item.label} style={styles.metadataItem}>
              <Text style={styles.metadataLabel}>{item.label}</Text>
              <Text style={styles.metadataValue}>{item.value}</Text>
            </View>
          ))}
        </View>
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            {columns.map((column) => (
              <Text key={column} style={[styles.headerCell, { width: cellWidth }]}>{column}</Text>
            ))}
          </View>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.row, ...(rowIndex % 2 === 1 ? [styles.alternateRow] : [])]} wrap={false}>
              {columns.map((column) => (
                <Text key={column} style={[styles.cell, { width: cellWidth }]}>{formatCell(row[column])}</Text>
              ))}
            </View>
          ))}
          {rows.length > 0 && (
            <View style={styles.totalRow} wrap={false}>
              <Text style={[styles.totalLabel, { width: `${100 - 100 / Math.max(columns.length, 1)}%` }]}>Total general</Text>
              <Text style={[styles.headerCell, { width: cellWidth }]}>{getTotalGeneral(rows)}</Text>
            </View>
          )}
        </View>
        {summary.length > 0 && (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Resumen financiero</Text>
            {summary.map((summaryRow, index) => {
              const isSection = summaryRow.length < 2 || !summaryRow[1]
              return (
                <View key={`${summaryRow[0]}-${index}`} style={styles.summaryRow} wrap={false}>
                  <Text style={[styles.summaryKey, ...(isSection ? [styles.summaryTitle] : [])]}>{summaryRow[0]}</Text>
                  {summaryRow[1] ? <Text style={styles.summaryValue}>{summaryRow.slice(1).join(' · ')}</Text> : null}
                </View>
              )
            })}
          </View>
        )}
        <View style={styles.footer} fixed>
          <Text>Importlilimlab · Reporte generado el {generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export function renderReportPdf(options: ReportPdfOptions) {
  return pdf(createElement(ReportDocument, options)).toBlob()
}
