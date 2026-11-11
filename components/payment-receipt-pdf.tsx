import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

export type PaymentReceiptPdfData = {
  number: string
  paymentDate: string
  customerName: string
  customerDocument: string
  branchName: string
  saleNumber: string
  invoiceNumber: string
  concept: string | null
  amount: number
  paymentMethod: string
  cashAccountName: string
  externalReference: string
  recordedByAlias: string
}

const styles = StyleSheet.create({
  page: { padding: 38, color: '#332719', fontFamily: 'Helvetica', fontSize: 9 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: '#087f5b' },
  brand: { fontSize: 18, fontWeight: 700 },
  muted: { marginTop: 4, color: '#75685a', fontSize: 8 },
  title: { marginTop: 18, marginBottom: 12, color: '#332719', fontSize: 15, fontWeight: 700 },
  customer: { marginBottom: 12, lineHeight: 1.5 },
  table: { width: '100%', borderWidth: 1, borderColor: '#d8cec2' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#fff2e6', borderBottomWidth: 1, borderBottomColor: '#d8cec2', paddingVertical: 8 },
  tableRow: { flexDirection: 'row', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#eee7df' },
  cellConcept: { width: '43%', paddingHorizontal: 7 },
  cellDocument: { width: '23%', paddingHorizontal: 7 },
  cellFact: { width: '14%', paddingHorizontal: 7, textAlign: 'center' },
  cellPayment: { width: '20%', paddingHorizontal: 7, textAlign: 'right' },
  headerText: { fontSize: 8, fontWeight: 700 },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#332719' },
  totalLabel: { width: '80%', paddingHorizontal: 7, textAlign: 'right', fontWeight: 700 },
  totalAmount: { width: '20%', paddingHorizontal: 7, textAlign: 'right', fontWeight: 700 },
  paymentLine: { marginTop: 16, padding: 11, backgroundColor: '#faf7f3', lineHeight: 1.6 },
  metadata: { marginTop: 14, lineHeight: 1.6 },
  footer: { position: 'absolute', left: 38, right: 38, bottom: 24, color: '#9a8d7f', fontSize: 8, textAlign: 'center' },
})

const dateOnly = (value: string) =>
  new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz' }).format(new Date(value))

const timestamp = (value: Date) =>
  new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(value).replace(/\//g, '-')

const amountFormat = new Intl.NumberFormat('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function PaymentReceiptDocument({ receipt, printedAt }: { receipt: PaymentReceiptPdfData; printedAt: Date }) {
  const paymentLine = `Pago ${receipt.paymentMethod} (Bs): ${amountFormat.format(receipt.amount)}, ${receipt.cashAccountName} (Ref.: ${receipt.externalReference})`
  const concept = `DEUDA ACTUALIZADA AL ${dateOnly(receipt.paymentDate)} (${receipt.concept || 'S/D'})`

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Importlilimlab</Text>
            {receipt.branchName && <Text style={styles.muted}>{receipt.branchName}</Text>}
          </View>
          <View>
            <Text style={styles.headerText}>NOTA DE COBRO</Text>
            <Text style={styles.muted}>{receipt.number}</Text>
          </View>
        </View>

        <Text style={styles.title}>Comprobante de cobro</Text>
        <Text style={styles.customer}>
          Cliente: {receipt.customerName}{'\n'}
          Documento: {receipt.customerDocument || 'S/D'}{'\n'}
          Fecha del cobro: {dateOnly(receipt.paymentDate)}
        </Text>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.cellConcept, styles.headerText]}>CONCEPTO</Text>
            <Text style={[styles.cellDocument, styles.headerText]}>DOCUMENTO</Text>
            <Text style={[styles.cellFact, styles.headerText]}>FACT</Text>
            <Text style={[styles.cellPayment, styles.headerText]}>PAGO</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.cellConcept}>{concept}</Text>
            <Text style={styles.cellDocument}>{receipt.saleNumber}</Text>
            <Text style={styles.cellFact}>{receipt.invoiceNumber}</Text>
            <Text style={styles.cellPayment}>{amountFormat.format(receipt.amount)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTALES:</Text>
            <Text style={styles.totalAmount}>{amountFormat.format(receipt.amount)}</Text>
          </View>
        </View>

        <Text style={styles.paymentLine}>{paymentLine}</Text>
        <Text style={styles.metadata}>
          Elaborado por: {receipt.recordedByAlias}{'\n'}
          Impreso: {timestamp(printedAt)}
        </Text>
        <Text style={styles.footer} fixed>Importlilimlab · Comprobante de pago</Text>
      </Page>
    </Document>
  )
}

export async function openPaymentReceiptPdf(receipt: PaymentReceiptPdfData, previewWindow: Window) {
  const printedAt = new Date()
  const blob = await pdf(PaymentReceiptDocument({ receipt, printedAt })).toBlob()
  const url = URL.createObjectURL(blob)
  previewWindow.document.title = `Nota de cobro ${receipt.number}`
  previewWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000)
}
