import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

export type StatementPdfEntry = {
  rowNumber: number
  groupStart: boolean
  number: string
  date: string
  description: string
  details?: string[]
  debit: number
  credit: number
  balance: number
}

export type AccountStatementPdfData = {
  title: string
  partyName: string
  partyDocument: string
  from: string
  to: string
  openingBalance: number
  closingBalance: number
  debitTotal: number
  creditTotal: number
  entries: StatementPdfEntry[]
}

const COLORS = {
  green: '#0e7d5f',
  greenSoft: '#def7ee',
  blue: '#1d7cb5',
  blueSoft: '#eaf3fb',
  ink: '#1a2d2d',
  muted: '#61736f',
  line: '#dfe8e5',
  paper: '#ffffff',
  accent: '#0f5d8d',
}

const money = (value: number) =>
  `Bs ${value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const dateFormat = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'short',
  timeZone: 'America/La_Paz',
})

const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingHorizontal: 34, paddingBottom: 44, color: COLORS.ink, fontFamily: 'Helvetica', fontSize: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: COLORS.green },
  brand: { fontSize: 20, fontWeight: 700, color: COLORS.ink },
  subtitle: { marginTop: 4, color: COLORS.muted, fontSize: 10 },
  title: { maxWidth: '60%', color: COLORS.green, fontSize: 17, fontWeight: 700, textAlign: 'right' },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  metadataItem: { width: '48%' },
  metadataLabel: { color: COLORS.muted, fontSize: 8, textTransform: 'uppercase' },
  metadataValue: { marginTop: 3, color: COLORS.ink, fontSize: 10 },
  table: { marginTop: 12 },
  tableHeader: { flexDirection: 'row', backgroundColor: COLORS.green },
  headerCell: { paddingVertical: 7, paddingHorizontal: 4, color: '#ffffff', fontSize: 9, fontWeight: 700 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.line },
  alternateRow: { backgroundColor: '#f9fcfb' },
  groupStart: { borderTopWidth: 1, borderTopColor: '#cfe4df' },
  cell: { paddingVertical: 5, paddingHorizontal: 4, color: '#38514e', fontSize: 9 },
  alignRight: { textAlign: 'right' },
  number: { width: '6%' },
  document: { width: '18%' },
  date: { width: '12%' },
  concept: { width: '34%' },
  amount: { width: '10%' },
  detail: { marginTop: 3, color: COLORS.muted, fontSize: 8, lineHeight: 1.3 },
  totals: { flexDirection: 'row', marginTop: 4, backgroundColor: COLORS.greenSoft, borderTopWidth: 1, borderTopColor: COLORS.blue },
  totalLabel: { width: '70%', padding: 6, fontWeight: 700, textAlign: 'right', color: COLORS.ink },
  totalAmount: { width: '10%', padding: 6, fontSize: 9, textAlign: 'right', color: COLORS.ink },
  footer: { position: 'absolute', right: 34, bottom: 20, left: 34, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 0.5, borderTopColor: COLORS.line, color: COLORS.muted, fontSize: 8 },
})

function AccountStatementDocument({ statement }: { statement: AccountStatementPdfData }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Importlilimlab</Text>
            <Text style={styles.subtitle}>Estados de cuenta · Bolivia</Text>
          </View>
          <Text style={styles.title}>{statement.title}</Text>
        </View>

        <View style={styles.metadata}>
          <View style={styles.metadataItem}>
            <Text style={styles.metadataLabel}>Cliente / proveedor</Text>
            <Text style={styles.metadataValue}>{statement.partyName}</Text>
          </View>
          <View style={styles.metadataItem}>
            <Text style={styles.metadataLabel}>Documento</Text>
            <Text style={styles.metadataValue}>{statement.partyDocument || 'S/D'}</Text>
          </View>
          <View style={styles.metadataItem}>
            <Text style={styles.metadataLabel}>Período</Text>
            <Text style={styles.metadataValue}>{statement.from} a {statement.to}</Text>
          </View>
          <View style={styles.metadataItem}>
            <Text style={styles.metadataLabel}>Saldo inicial / final</Text>
            <Text style={styles.metadataValue}>{money(statement.openingBalance)} / {money(statement.closingBalance)}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.headerCell, styles.number]}>NRO</Text>
            <Text style={[styles.headerCell, styles.document]}>DOCUMENTO</Text>
            <Text style={[styles.headerCell, styles.date]}>FECHA</Text>
            <Text style={[styles.headerCell, styles.concept]}>CONCEPTO</Text>
            <Text style={[styles.headerCell, styles.amount, styles.alignRight]}>DEUDA</Text>
            <Text style={[styles.headerCell, styles.amount, styles.alignRight]}>HABER</Text>
            <Text style={[styles.headerCell, styles.amount, styles.alignRight]}>SALDO</Text>
          </View>
          {statement.entries.length === 0 ? (
            <View style={styles.row}>
              <Text style={styles.cell}>No hay movimientos en este período.</Text>
            </View>
          ) : statement.entries.map((entry, index) => (
            <View key={`${entry.number}-${index}`} style={[styles.row, index % 2 === 1 ? styles.alternateRow : {}, entry.groupStart ? styles.groupStart : {}]} wrap={false}>
              <Text style={[styles.cell, styles.number]}>{entry.groupStart ? entry.rowNumber : ''}</Text>
              <Text style={[styles.cell, styles.document]}>{entry.number}</Text>
              <Text style={[styles.cell, styles.date]}>{dateFormat.format(new Date(entry.date))}</Text>
              <View style={[styles.cell, styles.concept]}>
                <Text>{entry.description}</Text>
                {entry.details?.map((detail, detailIndex) => (
                  <Text key={detailIndex} style={styles.detail}>{detail}</Text>
                ))}
              </View>
              <Text style={[styles.cell, styles.amount, styles.alignRight]}>{money(entry.debit)}</Text>
              <Text style={[styles.cell, styles.amount, styles.alignRight]}>{money(entry.credit)}</Text>
              <Text style={[styles.cell, styles.amount, styles.alignRight]}>{money(entry.balance)}</Text>
            </View>
          ))}
          <View style={styles.totals} wrap={false}>
            <Text style={styles.totalLabel}>TOTALES:</Text>
            <Text style={[styles.totalAmount, styles.alignRight]}>{money(statement.debitTotal)}</Text>
            <Text style={[styles.totalAmount, styles.alignRight]}>{money(statement.creditTotal)}</Text>
            <Text style={[styles.totalAmount, styles.alignRight]}>{money(statement.closingBalance)}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Importlilimlab · Valores expresados en bolivianos (Bs)</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function openAccountStatementPdf(statement: AccountStatementPdfData, previewWindow: Window) {
  const blob = await pdf(AccountStatementDocument({ statement })).toBlob()
  openAccountStatementPdfBlob(blob, statement.title, statement.partyName, previewWindow)
  return blob
}

export function openAccountStatementPdfBlob(blob: Blob, title: string, partyName: string, previewWindow: Window) {
  const url = URL.createObjectURL(blob)
  previewWindow.document.title = `${title} - ${partyName}`
  previewWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000)
}
