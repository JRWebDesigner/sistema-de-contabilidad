import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

export type TableReportPdfData = {
  title: string
  subtitle: string
  headers?: string[]
  rows: string[][]
  sectionRows?: number[]
  totalRows?: number[]
  note?: string
}

const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingHorizontal: 34, paddingBottom: 44, color: '#332719', fontFamily: 'Helvetica', fontSize: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: '#ff7900' },
  brand: { color: '#332719', fontSize: 18, fontWeight: 700 },
  subtitle: { marginTop: 4, color: '#75685a', fontSize: 8 },
  title: { maxWidth: '60%', color: '#9b4b00', fontSize: 15, fontWeight: 700, textAlign: 'right' },
  table: { marginTop: 14 },
  headerRow: { flexDirection: 'row', backgroundColor: '#ff7900' },
  headerCell: { paddingVertical: 6, paddingHorizontal: 5, color: '#24170b', fontSize: 7, fontWeight: 700 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eadfd2' },
  alternateRow: { backgroundColor: '#fff8f0' },
  sectionRow: { marginTop: 4, backgroundColor: '#fff2e6', borderTopWidth: 1, borderTopColor: '#ff7900' },
  totalRow: { backgroundColor: '#fff2e6', borderTopWidth: 1, borderTopColor: '#ff7900' },
  cell: { paddingVertical: 6, paddingHorizontal: 5, color: '#4c4033', fontSize: 7.5 },
  emphasis: { fontWeight: 700 },
  note: { marginTop: 14, color: '#75685a', fontSize: 8, lineHeight: 1.4 },
  footer: { position: 'absolute', right: 34, bottom: 20, left: 34, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 0.5, borderTopColor: '#eadfd2', color: '#897966', fontSize: 7 },
})

function TableReportDocument({ report }: { report: TableReportPdfData }) {
  const columnCount = report.rows.reduce((max, row) => Math.max(max, row.length), report.headers?.length ?? 1)
  const columnWidth = `${100 / columnCount}%`

  return (
    <Document title={`${report.title} · Businessman S.R.L.`} author="Businessman S.R.L." language="es">
      <Page size="A4" orientation={columnCount > 4 ? 'landscape' : 'portrait'} style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>Businessman S.R.L.</Text>
            <Text style={styles.subtitle}>SISTEMA ADMINISTRATIVO</Text>
          </View>
          <Text style={styles.title}>{report.title}</Text>
        </View>
        <Text style={styles.subtitle}>{report.subtitle}</Text>
        <View style={styles.table}>
          {report.headers && (
            <View style={styles.headerRow} fixed>
              {report.headers.map((header, index) => (
                <Text key={`${header}-${index}`} style={[styles.headerCell, { width: columnWidth }]}>{header}</Text>
              ))}
            </View>
          )}
          {report.rows.length === 0 ? (
            <View style={styles.row}><Text style={styles.cell}>No hay registros para mostrar.</Text></View>
          ) : report.rows.map((row, rowIndex) => {
            const isSection = report.sectionRows?.includes(rowIndex) ?? false
            const isTotal = report.totalRows?.includes(rowIndex) ?? false
            return (
              <View
                key={rowIndex}
                style={[
                  styles.row,
                  ...(isSection ? [styles.sectionRow] : rowIndex % 2 === 1 ? [styles.alternateRow] : []),
                  ...(isTotal ? [styles.totalRow] : []),
                ]}
                wrap={false}
              >
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <Text
                    key={columnIndex}
                    style={[
                      styles.cell,
                      { width: columnWidth },
                      ...(isSection || isTotal ? [styles.emphasis] : []),
                    ]}
                  >
                    {row[columnIndex] ?? ''}
                  </Text>
                ))}
              </View>
            )
          })}
        </View>
        {report.note && <Text style={styles.note}>{report.note}</Text>}
        <View style={styles.footer} fixed>
          <Text>Businessman S.R.L. · Valores expresados en bolivianos (Bs)</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function openTableReportPdf(report: TableReportPdfData, previewWindow: Window) {
  const blob = await pdf(TableReportDocument({ report })).toBlob()
  const url = URL.createObjectURL(blob)
  previewWindow.document.title = report.title
  previewWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000)
}
