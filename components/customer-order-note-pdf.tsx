import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

export type CustomerOrderPdfData = {
  number: string
  createdAt: string
  deliveredAt: string | null
  status: 'PENDING' | 'DELIVERED' | 'CANCELLED'
  customer: { name: string; document: string }
  seller: { name: string; alias: string } | null
  receivedByName: string | null
  notes: string | null
  subtotal: number
  discountTotal: number
  total: number
  items: Array<{
    name: string
    sku: string
    type: 'PRODUCT' | 'SERVICE'
    serviceBillingPeriod: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL' | null
    quantity: number
    unitPrice: number
    discountPercent: number
    lineTotal: number
  }>
}

const money = new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFormat = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'medium',
  timeZone: 'America/La_Paz',
})

const statusLabels = {
  PENDING: 'PENDIENTE DE ENTREGA',
  DELIVERED: 'ENTREGADO',
  CANCELLED: 'CANCELADO',
} as const

const styles = StyleSheet.create({
  page: { paddingTop: 38, paddingHorizontal: 40, paddingBottom: 52, color: '#332719', fontFamily: 'Helvetica', fontSize: 9 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 2, borderBottomColor: '#ff7900' },
  brand: { fontSize: 20, fontWeight: 700 },
  brandCaption: { marginTop: 4, color: '#897966', fontSize: 7, letterSpacing: 1 },
  titleBlock: { alignItems: 'flex-end' },
  title: { color: '#9b4b00', fontSize: 15, fontWeight: 700 },
  orderNumber: { marginTop: 5, fontSize: 10, fontWeight: 700 },
  status: { marginTop: 5, color: '#75685a', fontSize: 7 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 12, marginTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#eadfd2' },
  metadataItem: { width: '45%' },
  label: { color: '#897966', fontSize: 7, textTransform: 'uppercase' },
  value: { marginTop: 4, color: '#332719', fontSize: 9 },
  sectionTitle: { marginTop: 20, marginBottom: 8, color: '#9b4b00', fontSize: 10, fontWeight: 700 },
  table: { marginTop: 5 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#ff7900' },
  headerCell: { paddingVertical: 7, paddingHorizontal: 5, color: '#24170b', fontSize: 7, fontWeight: 700 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eadfd2' },
  alternateRow: { backgroundColor: '#fff8f0' },
  cell: { paddingVertical: 7, paddingHorizontal: 5, color: '#4c4033', fontSize: 8 },
  product: { width: '38%' },
  quantity: { width: '10%', textAlign: 'right' },
  price: { width: '17%', textAlign: 'right' },
  discount: { width: '12%', textAlign: 'right' },
  lineTotal: { width: '23%', textAlign: 'right' },
  itemMeta: { marginTop: 3, color: '#897966', fontSize: 7 },
  totals: { width: '43%', alignSelf: 'flex-end', marginTop: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#eadfd2' },
  totalLabel: { color: '#4c4033', fontSize: 9 },
  totalValue: { color: '#332719', fontSize: 9, textAlign: 'right' },
  grandTotal: { marginTop: 4, padding: 9, backgroundColor: '#ff7900', borderRadius: 3 },
  grandTotalText: { color: '#24170b', fontSize: 11, fontWeight: 700 },
  notes: { marginTop: 18, padding: 10, backgroundColor: '#fff8f0', borderLeftWidth: 3, borderLeftColor: '#ff7900' },
  notesLabel: { marginBottom: 4, color: '#897966', fontSize: 7, textTransform: 'uppercase' },
  notesText: { color: '#4c4033', fontSize: 8, lineHeight: 1.4 },
  signatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 58 },
  signature: { width: '42%', alignItems: 'center' },
  signatureLine: { width: '100%', borderTopWidth: 1, borderTopColor: '#332719', marginBottom: 7 },
  signatureLabel: { fontSize: 8, fontWeight: 700, textAlign: 'center' },
  signatureName: { marginTop: 4, color: '#75685a', fontSize: 8, textAlign: 'center' },
  footer: { position: 'absolute', right: 40, bottom: 20, left: 40, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 0.5, borderTopColor: '#eadfd2', color: '#897966', fontSize: 7 },
})

function CustomerOrderDocument({ order }: { order: CustomerOrderPdfData }) {
  return (
    <Document title={`Nota de pedido ${order.number} · Businessman S.R.L.`} author="Businessman S.R.L." language="es">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Businessman S.R.L.</Text>
            <Text style={styles.brandCaption}>NOTA DE PEDIDO</Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>PEDIDO</Text>
            <Text style={styles.orderNumber}>{order.number}</Text>
            <Text style={styles.status}>{statusLabels[order.status]}</Text>
          </View>
        </View>

        <View style={styles.metadata}>
          <View style={styles.metadataItem}>
            <Text style={styles.label}>Cliente</Text>
            <Text style={styles.value}>{order.customer.name}</Text>
          </View>
          <View style={styles.metadataItem}>
            <Text style={styles.label}>Documento / NIT</Text>
            <Text style={styles.value}>{order.customer.document || 'S/D'}</Text>
          </View>
          <View style={styles.metadataItem}>
            <Text style={styles.label}>Fecha</Text>
            <Text style={styles.value}>{dateFormat.format(new Date(order.createdAt))}</Text>
          </View>
          {order.deliveredAt && (
            <View style={styles.metadataItem}>
              <Text style={styles.label}>Fecha de entrega</Text>
              <Text style={styles.value}>{dateFormat.format(new Date(order.deliveredAt))}</Text>
            </View>
          )}
          <View style={styles.metadataItem}>
            <Text style={styles.label}>Vendedor</Text>
            <Text style={styles.value}>{order.seller?.name ?? order.seller?.alias ?? 'S/D'}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Detalle del pedido</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.headerCell, styles.product]}>PRODUCTO / SERVICIO</Text>
            <Text style={[styles.headerCell, styles.quantity]}>CANT.</Text>
            <Text style={[styles.headerCell, styles.price]}>PRECIO</Text>
            <Text style={[styles.headerCell, styles.discount]}>DESC. %</Text>
            <Text style={[styles.headerCell, styles.lineTotal]}>TOTAL</Text>
          </View>
          {order.items.map((item, index) => (
            <View key={`${item.sku}-${index}`} style={[styles.row, ...(index % 2 === 1 ? [styles.alternateRow] : [])]} wrap={false}>
              <View style={[styles.cell, styles.product]}>
                <Text>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  {item.sku} · {item.type === 'SERVICE'
                    ? item.serviceBillingPeriod === 'MONTHLY' ? 'Servicio mensual' : item.serviceBillingPeriod === 'ANNUAL' ? 'Servicio anual' : 'Servicio'
                    : 'Producto'}
                </Text>
              </View>
              <Text style={[styles.cell, styles.quantity]}>{item.quantity}</Text>
              <Text style={[styles.cell, styles.price]}>{money.format(item.unitPrice)}</Text>
              <Text style={[styles.cell, styles.discount]}>{item.discountPercent}%</Text>
              <Text style={[styles.cell, styles.lineTotal]}>{money.format(item.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{money.format(order.subtotal)}</Text>
          </View>
          {order.discountTotal > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Descuento</Text>
              <Text style={styles.totalValue}>-{money.format(order.discountTotal)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={styles.grandTotalText}>TOTAL</Text>
            <Text style={styles.grandTotalText}>{money.format(order.total)}</Text>
          </View>
        </View>

        <View style={styles.notes} wrap={false}>
          <Text style={styles.notesLabel}>Observaciones</Text>
          <Text style={styles.notesText}>{order.notes || 'Sin observaciones'}</Text>
        </View>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Firma del vendedor</Text>
            <Text style={styles.signatureName}>{order.seller?.name ?? order.seller?.alias ?? 'Nombre y firma'}</Text>
          </View>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Firma de quien recibe</Text>
            <Text style={styles.signatureName}>{order.receivedByName || 'Nombre y firma'}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Businessman S.R.L. · Documento de pedido; no constituye factura</Text>
          <Text>Pedido {order.number}</Text>
        </View>
      </Page>
    </Document>
  )
}

export async function openCustomerOrderPdf(order: CustomerOrderPdfData, previewWindow: Window) {
  const blob = await pdf(CustomerOrderDocument({ order })).toBlob()
  const url = URL.createObjectURL(blob)
  previewWindow.document.title = `Nota de pedido ${order.number}`
  previewWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000)
}
