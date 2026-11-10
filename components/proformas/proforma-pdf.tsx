import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from '@react-pdf/renderer'

export type ProformaPdfData = {
  number: string
  createdAt: string
  validUntil?: string
  customerName: string
  customerDocument: string
  saleNumber?: string
  notes: string
  items: Array<{
    name: string
    sku: string
    quantity: number
    unitPrice: number
    discountPercent: number
    lineTotal: number
  }>
  subtotal: number
  discountTotal: number
  total: number
}

const currency = new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFormat = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'long',
  timeZone: 'America/La_Paz',
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingHorizontal: 42,
    paddingBottom: 56,
    color: '#332719',
    fontFamily: 'Helvetica',
    fontSize: 9,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#ff7900',
  },
  brand: { color: '#332719', fontSize: 20, fontWeight: 700 },
  brandSuffix: { color: '#9b4b00', fontSize: 12 },
  brandCaption: { marginTop: 4, color: '#897966', fontSize: 7, letterSpacing: 1 },
  titleBlock: { alignItems: 'flex-end' },
  documentLabel: { color: '#897966', fontSize: 8, textTransform: 'uppercase', letterSpacing: 1 },
  documentNumber: { marginTop: 4, fontSize: 7, fontWeight: 700 },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 28,
    rowGap: 14,
    marginTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eadfd2',
  },
  metadataItem: { width: '45%' },
  label: { color: '#897966', fontSize: 7, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { marginTop: 4, color: '#332719', fontSize: 9 },
  sectionTitle: { marginTop: 22, marginBottom: 9, color: '#9b4b00', fontSize: 10, fontWeight: 700 },
  table: { marginTop: 8 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#ff7900',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  headerCell: { paddingVertical: 8, paddingHorizontal: 6, color: '#24170b', fontSize: 8, fontWeight: 700 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#eadfd2',
  },
  alternateRow: { backgroundColor: '#fff8f0' },
  cell: { paddingVertical: 8, paddingHorizontal: 6, color: '#4c4033', fontSize: 8 },
  productName: { fontWeight: 700 },
  productSku: { marginTop: 3, color: '#968471', fontSize: 7 },
  alignRight: { textAlign: 'right' },
  totals: { width: '42%', alignSelf: 'flex-end', marginTop: 16 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#eadfd2',
  },
  grandTotal: {
    marginTop: 3,
    paddingVertical: 9,
    paddingHorizontal: 10,
    backgroundColor: '#ff7900',
    borderRadius: 3,
  },
  totalLabel: { color: '#4c4033', fontSize: 9 },
  totalValue: { color: '#332719', fontSize: 9, textAlign: 'right' },
  grandTotalText: { color: '#24170b', fontSize: 11, fontWeight: 700 },
  notes: {
    marginTop: 22,
    padding: 12,
    backgroundColor: '#fff8f0',
    borderLeftWidth: 3,
    borderLeftColor: '#ff7900',
  },
  notesLabel: { marginBottom: 5, color: '#897966', fontSize: 7, textTransform: 'uppercase' },
  notesText: { color: '#4c4033', fontSize: 8, lineHeight: 1.4 },
  footer: {
    position: 'absolute',
    right: 42,
    bottom: 22,
    left: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 7,
    borderTopWidth: 0.5,
    borderTopColor: '#eadfd2',
    color: '#897966',
    fontSize: 7,
  },
})

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metadataItem}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

function ProformaDocument({ proforma }: { proforma: ProformaPdfData }) {
  const productWidth = '42%'
  const quantityWidth = '12%'
  const unitPriceWidth = '17%'
  const discountWidth = '12%'
  const totalWidth = '17%'

  return (
    <Document title={`Proforma ${proforma.number} · Businessman S.R.L.`} author="Businessman S.R.L." language="es">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>Businessman <Text style={styles.brandSuffix}>S.R.L.</Text></Text>
            <Text style={styles.brandCaption}>COTIZACIÓN COMERCIAL</Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.documentLabel}>Proforma</Text>
            <Text style={styles.documentNumber}>{proforma.number}</Text>
          </View>
        </View>

        <View style={styles.metadata}>
          <MetadataItem label="Fecha de emisión" value={dateFormat.format(new Date(proforma.createdAt))} />
          {proforma.validUntil && <MetadataItem label="Válida hasta" value={dateFormat.format(new Date(proforma.validUntil))} />}
          <MetadataItem label="Cliente" value={proforma.customerName} />
          {proforma.customerDocument && <MetadataItem label="Documento / NIT" value={proforma.customerDocument} />}
          {proforma.saleNumber && <MetadataItem label="Venta asociada" value={proforma.saleNumber} />}
        </View>

        <Text style={styles.sectionTitle}>Detalle de productos</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.headerCell, { width: productWidth }]}>Producto</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: quantityWidth }]}>Cant.</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: unitPriceWidth }]}>Precio unitario</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: discountWidth }]}>Desc.</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: totalWidth }]}>Importe</Text>
          </View>
          {proforma.items.map((item, index) => (
            <View key={`${item.sku}-${index}`} style={[styles.row, ...(index % 2 === 1 ? [styles.alternateRow] : [])]} wrap={false}>
              <View style={[styles.cell, { width: productWidth }]}>
                <Text style={styles.productName}>{item.name}</Text>
                {item.sku && <Text style={styles.productSku}>Código: {item.sku}</Text>}
              </View>
              <Text style={[styles.cell, styles.alignRight, { width: quantityWidth }]}>{item.quantity.toLocaleString('es-BO')}</Text>
              <Text style={[styles.cell, styles.alignRight, { width: unitPriceWidth }]}>{currency.format(item.unitPrice)}</Text>
              <Text style={[styles.cell, styles.alignRight, { width: discountWidth }]}>{item.discountPercent}%</Text>
              <Text style={[styles.cell, styles.alignRight, { width: totalWidth }]}>{currency.format(item.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{currency.format(proforma.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Descuentos</Text>
            <Text style={styles.totalValue}>-{currency.format(proforma.discountTotal)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={styles.grandTotalText}>TOTAL</Text>
            <Text style={styles.grandTotalText}>{currency.format(proforma.total)}</Text>
          </View>
        </View>

        <View style={styles.notes} wrap={false}>
          <Text style={styles.notesLabel}>Observaciones</Text>
          <Text style={styles.notesText}>{proforma.notes || 'Sin observaciones'}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>Businessman S.R.L. · Precios expresados en bolivianos (Bs)</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

async function createProformaPdfBlob(proforma: ProformaPdfData) {
  return pdf(ProformaDocument({ proforma })).toBlob()
}

export async function downloadProformaPdf(proforma: ProformaPdfData) {
  const blob = await createProformaPdfBlob(proforma)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeNumber = proforma.number.replace(/[^a-zA-Z0-9_-]/g, '-')
  link.href = url
  link.download = `proforma-${safeNumber}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function previewProformaPdf(proforma: ProformaPdfData) {
  const previewWindow = window.open('about:blank', '_blank')
  if (!previewWindow) {
    throw new Error('El navegador bloqueó la vista previa. Permite las ventanas emergentes e inténtalo otra vez.')
  }

  try {
    const blob = await createProformaPdfBlob(proforma)
    const url = URL.createObjectURL(blob)
    previewWindow.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (error) {
    previewWindow.close()
    throw error
  }
}
