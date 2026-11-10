import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from '@react-pdf/renderer'

export type SaleNotePdfData = {
  number: string
  createdAt: string
  customerName: string
  customerDocument: string
  branch: { name: string; address: string | null; phone: string | null } | null
  sellerName: string
  paymentMethod: string
  paymentReference: string | null
  receivable: { paidAmount: number; balance: number } | null
  notes: string
  copyType: 'ORIGINAL' | 'COPIA'
  subtotal: number
  discountTotal: number
  taxAmount: number
  total: number
  items: Array<{
    name: string
    sku: string
    type: 'PRODUCT' | 'SERVICE'
    quantity: number
    unitPrice: number
    discountPercent: number
    lineTotal: number
  }>
}

const currency = new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFormat = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/La_Paz',
})

const paymentLabels: Record<string, string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  CARD: 'Tarjeta',
  QR: 'QR',
  CREDIT: 'Crédito',
  OTHER: 'Otro',
}

const styles = StyleSheet.create({
  page: { padding: 38, color: '#332719', fontFamily: 'Helvetica', fontSize: 9 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: '#ff7900',
  },
  brand: { color: '#332719', fontSize: 19, fontWeight: 700 },
  brandSuffix: { color: '#ff7900', fontSize: 12 },
  branch: { marginTop: 5, color: '#75685a', fontSize: 8 },
  titleBlock: { alignItems: 'flex-end' },
  title: { color: '#ff7900', fontSize: 13, fontWeight: 700 },
  copyType: {
    marginTop: 7,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#ff7900',
    borderRadius: 3,
    color: '#9b4b00',
    fontSize: 9,
    fontWeight: 700,
  },
  number: { marginTop: 5, color: '#75685a', fontSize: 8 },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 22,
    rowGap: 12,
    marginTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eadfd2',
  },
  metadataItem: { width: '45%' },
  label: { color: '#897966', fontSize: 7, textTransform: 'uppercase' },
  value: { marginTop: 4, color: '#332719', fontSize: 9 },
  sectionTitle: { marginTop: 20, marginBottom: 8, color: '#9b4b00', fontSize: 10, fontWeight: 700 },
  table: { marginTop: 5 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#ff7900' },
  headerCell: { paddingVertical: 7, paddingHorizontal: 5, color: '#24170b', fontSize: 7, fontWeight: 700 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eadfd2' },
  alternateRow: { backgroundColor: '#fff8f0' },
  cell: { paddingVertical: 7, paddingHorizontal: 5, color: '#4c4033', fontSize: 7.5 },
  alignRight: { textAlign: 'right' },
  totals: { width: '43%', alignSelf: 'flex-end', marginTop: 14 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#eadfd2',
  },
  totalLabel: { color: '#675747', fontSize: 9 },
  totalValue: { color: '#332719', fontSize: 9, textAlign: 'right' },
  grandTotal: { marginTop: 4, padding: 9, backgroundColor: '#ff7900', borderRadius: 3 },
  grandTotalText: { color: '#24170b', fontSize: 11, fontWeight: 700 },
  notes: { marginTop: 20, padding: 10, backgroundColor: '#fff8f0', borderLeftWidth: 3, borderLeftColor: '#ff7900' },
  notesLabel: { marginBottom: 4, color: '#897966', fontSize: 7, textTransform: 'uppercase' },
  notesText: { color: '#4c4033', fontSize: 8, lineHeight: 1.4 },
  footer: {
    position: 'absolute',
    right: 38,
    bottom: 20,
    left: 38,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 7,
    borderTopWidth: 0.5,
    borderTopColor: '#eadfd2',
    color: '#897966',
    fontSize: 7,
  },
})

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metadataItem}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || '-'}</Text>
    </View>
  )
}

function SaleNoteDocument({ note }: { note: SaleNotePdfData }) {
  return (
    <Document title={`Nota de venta ${note.number} ${note.copyType} · Businessman S.R.L.`} author="Businessman S.R.L." language="es">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>Businessman <Text style={styles.brandSuffix}>S.R.L.</Text></Text>
            {note.branch && <Text style={styles.branch}>{note.branch.name}{note.branch.address ? ` · ${note.branch.address}` : ''}{note.branch.phone ? ` · ${note.branch.phone}` : ''}</Text>}
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>NOTA DE VENTA</Text>
            <Text style={styles.copyType}>{note.copyType}</Text>
            <Text style={styles.number}>{note.number}</Text>
          </View>
        </View>

        <View style={styles.metadata}>
          <Field label="Fecha" value={dateFormat.format(new Date(note.createdAt))} />
          <Field label="Cliente" value={note.customerName} />
          <Field label="Documento / NIT" value={note.customerDocument} />
          <Field label="Medio de pago" value={paymentLabels[note.paymentMethod] ?? note.paymentMethod} />
          {note.paymentReference && <Field label="Referencia de pago" value={note.paymentReference} />}
          {note.sellerName && <Field label="Atendido por" value={note.sellerName} />}
          {note.receivable && <Field label="Pagado a la fecha" value={currency.format(note.receivable.paidAmount)} />}
          {note.receivable && <Field label="Saldo pendiente" value={currency.format(note.receivable.balance)} />}
        </View>

        <Text style={styles.sectionTitle}>Detalle de productos y servicios</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.headerCell, { width: '43%' }]}>DescripciÃ³n</Text>
            <Text style={[styles.headerCell, { width: '10%' }]}>Tipo</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: '9%' }]}>Cant.</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: '14%' }]}>Precio</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: '9%' }]}>Desc.</Text>
            <Text style={[styles.headerCell, styles.alignRight, { width: '15%' }]}>Importe</Text>
          </View>
          {note.items.map((item, index) => (
            <View key={`${item.sku}-${index}`} style={[styles.row, index % 2 ? styles.alternateRow : {}]} wrap={false}>
              <Text style={[styles.cell, { width: '43%' }]}>{item.name}{item.sku ? ` · ${item.sku}` : ''}</Text>
              <Text style={[styles.cell, { width: '10%' }]}>{item.type === 'SERVICE' ? 'Servicio' : 'Producto'}</Text>
              <Text style={[styles.cell, styles.alignRight, { width: '9%' }]}>{item.quantity}</Text>
              <Text style={[styles.cell, styles.alignRight, { width: '14%' }]}>{currency.format(item.unitPrice)}</Text>
              <Text style={[styles.cell, styles.alignRight, { width: '9%' }]}>{item.discountPercent > 0 ? `${item.discountPercent}%` : '-'}</Text>
              <Text style={[styles.cell, styles.alignRight, { width: '15%' }]}>{currency.format(item.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{currency.format(note.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Descuentos</Text>
            <Text style={styles.totalValue}>-{currency.format(note.discountTotal)}</Text>
          </View>
          {note.taxAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Impuestos</Text>
              <Text style={styles.totalValue}>{currency.format(note.taxAmount)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={styles.grandTotalText}>TOTAL</Text>
            <Text style={styles.grandTotalText}>{currency.format(note.total)}</Text>
          </View>
        </View>

        <View style={styles.notes} wrap={false}>
          <Text style={styles.notesLabel}>Observaciones</Text>
          <Text style={styles.notesText}>{note.notes || 'Sin observaciones'}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>Businessman S.R.L. · Precios expresados en bolivianos (Bs)</Text>
          <Text render={({ pageNumber, totalPages }) => `PÃ¡gina ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function openSaleNotePdf(note: SaleNotePdfData, previewWindow: Window) {
  const blob = await pdf(SaleNoteDocument({ note })).toBlob()
  const url = URL.createObjectURL(blob)
  const safeNumber = note.number.replace(/[^a-zA-Z0-9_-]/g, '-')
  previewWindow.document.title = `Nota de venta ${safeNumber} ${note.copyType}`
  previewWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000)
}
