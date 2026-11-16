import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

export type PayablePaymentReceiptPdfData = {
  number: string
  paymentDate: string
  supplierName: string
  supplierDocument: string
  branchName: string
  purchaseNumber: string
  amount: number
  balanceRemaining: number
  items: Array<{
    name: string
    type: 'PRODUCT' | 'SERVICE'
    quantity: number
  }>
}

const COLORS = {
  green: '#0e7d5f',
  greenSoft: '#def7ee',
  blue: '#1d7cb5',
  ink: '#1a2d2d',
  muted: '#61736f',
  line: '#dfe8e5',
  panel: '#f7fbfd',
}

const styles = StyleSheet.create({
  page: { padding: 38, color: COLORS.ink, fontFamily: 'Helvetica', fontSize: 11 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: COLORS.green },
  brand: { fontSize: 20, fontWeight: 700, color: COLORS.ink },
  muted: { marginTop: 4, color: COLORS.muted, fontSize: 9 },
  title: { marginTop: 18, marginBottom: 12, color: COLORS.green, fontSize: 16, fontWeight: 700 },
  metadata: { padding: 11, backgroundColor: COLORS.panel, lineHeight: 1.6, color: '#2b4b49', fontSize: 10 },
  sectionTitle: { marginTop: 18, marginBottom: 7, color: COLORS.blue, fontSize: 11, fontWeight: 700 },
  table: { width: '100%', borderWidth: 1, borderColor: COLORS.line },
  tableHeader: { flexDirection: 'row', backgroundColor: COLORS.greenSoft, borderBottomWidth: 1, borderBottomColor: COLORS.line, paddingVertical: 8 },
  tableRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  cellProduct: { width: '65%', paddingHorizontal: 7, color: COLORS.ink },
  cellType: { width: '20%', paddingHorizontal: 7, color: COLORS.ink },
  cellQuantity: { width: '15%', paddingHorizontal: 7, textAlign: 'right', color: COLORS.ink },
  headerText: { fontSize: 9, fontWeight: 700, color: COLORS.ink },
  summary: { width: '55%', alignSelf: 'flex-end', marginTop: 14 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: COLORS.line },
  summaryLabel: { color: '#4d5d5a', fontSize: 10 },
  summaryValue: { color: COLORS.ink, fontSize: 10, textAlign: 'right' },
  balanceRow: { marginTop: 5, padding: 9, backgroundColor: COLORS.greenSoft },
  balanceText: { color: COLORS.ink, fontSize: 11, fontWeight: 700 },
  signatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 52 },
  signature: { width: '44%', alignItems: 'center' },
  signatureLine: { width: '100%', borderTopWidth: 1, borderTopColor: COLORS.ink, marginBottom: 7 },
  signatureLabel: { fontSize: 9, fontWeight: 700, textAlign: 'center' },
  signatureDetail: { marginTop: 4, color: COLORS.muted, fontSize: 8, textAlign: 'center' },
  footer: { position: 'absolute', left: 38, right: 38, bottom: 24, color: COLORS.muted, fontSize: 8, textAlign: 'center' },
})

const paymentDateFormat = new Intl.DateTimeFormat('es-BO', {
  timeZone: 'America/La_Paz',
  dateStyle: 'short',
  timeStyle: 'short',
})

const amountFormat = new Intl.NumberFormat('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatBolivianos = (amount: number) => `Bs ${amountFormat.format(amount)}`

function PayablePaymentReceiptDocument({ receipt }: { receipt: PayablePaymentReceiptPdfData }) {
  return (
    <Document title={`Nota de cobro ${receipt.number}`} author="Importlilimlab" language="es">
      <Page size="A4" style={styles.page} wrap>
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

        <Text style={styles.title}>Comprobante de pago a proveedor</Text>
        <View style={styles.metadata}>
          <Text>Proveedor: {receipt.supplierName}</Text>
          <Text>Documento / NIT: {receipt.supplierDocument || 'S/D'}</Text>
          <Text>Fecha del pago: {paymentDateFormat.format(new Date(receipt.paymentDate))}</Text>
          <Text>Compra: {receipt.purchaseNumber}</Text>
        </View>

        <Text style={styles.sectionTitle}>Productos / servicios de la compra</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.cellProduct, styles.headerText]}>PRODUCTO / SERVICIO</Text>
            <Text style={[styles.cellType, styles.headerText]}>TIPO</Text>
            <Text style={[styles.cellQuantity, styles.headerText]}>CANT.</Text>
          </View>
          {receipt.items.map((item, index) => (
            <View key={`${item.name}-${index}`} style={styles.tableRow} wrap={false}>
              <Text style={styles.cellProduct}>{item.name}</Text>
              <Text style={styles.cellType}>{item.type === 'SERVICE' ? 'Servicio' : 'Producto'}</Text>
              <Text style={styles.cellQuantity}>{item.quantity}</Text>
            </View>
          ))}
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Pago realizado</Text>
            <Text style={styles.summaryValue}>{formatBolivianos(receipt.amount)}</Text>
          </View>
          <View style={[styles.summaryRow, styles.balanceRow]}>
            <Text style={styles.balanceText}>Saldo restante</Text>
            <Text style={styles.balanceText}>{formatBolivianos(receipt.balanceRemaining)}</Text>
          </View>
        </View>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Firma del proveedor · Recibí conforme</Text>
            <Text style={styles.signatureDetail}>{receipt.supplierName}</Text>
            <Text style={styles.signatureDetail}>Documento: {receipt.supplierDocument || 'S/D'}</Text>
          </View>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Firma del representante</Text>
            <Text style={styles.signatureDetail}>Importlilimlab · Pago entregado</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>Importlilimlab · Comprobante de pago a proveedor</Text>
      </Page>
    </Document>
  )
}

export async function openPayablePaymentReceiptPdf(receipt: PayablePaymentReceiptPdfData, previewWindow: Window) {
  const blob = await pdf(PayablePaymentReceiptDocument({ receipt })).toBlob()
  const url = URL.createObjectURL(blob)
  previewWindow.document.title = `Nota de cobro ${receipt.number}`
  previewWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000)
}
