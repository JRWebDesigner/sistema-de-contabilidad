import { Document, Font, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

// Evita cortes raros de palabras con tildes (ej. "Descripci ón")
Font.registerHyphenationCallback((word) => [word])

export type OperationNotePdfData = {
  title: string
  number: string
  date: string
  partyName: string
  partyDocument: string
  branchName: string
  branchAddress: string | null
  branchPhone: string | null
  service: {
    code: string
    contracted: string
    observation: string
    frequency: string
    startDate: string
    initialPayment: string
    outstandingBalance: string
  }
}

const ORANGE = '#ff7900'
const BORDER = '#eadfd2'

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 56,
    color: '#332719',
    fontFamily: 'Helvetica',
    fontSize: 10,
  },

  // Cabecera
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 20,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: ORANGE,
  },
  brand: { color: '#332719', fontSize: 20, fontWeight: 700 },
  brandSuffix: { color: ORANGE },
  branch: { marginTop: 3, color: '#75685a', fontSize: 9, lineHeight: 1.4 },
  branchFirst: { marginTop: 6 },
  titleBlock: { alignItems: 'flex-end', maxWidth: '48%' },
  title: { color: ORANGE, fontSize: 15, fontWeight: 700, textAlign: 'right' },
  subtitle: { marginTop: 4, color: '#897966', fontSize: 8, textAlign: 'right' },
  number: { marginTop: 8, color: '#332719', fontSize: 11, fontWeight: 700 },

  // Datos generales (rejilla de 2 columnas)
  infoGrid: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  infoField: { width: '48%', marginBottom: 12 },
  fieldLabel: { color: '#897966', fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldValue: { marginTop: 3, color: '#332719', fontSize: 11, lineHeight: 1.3 },

  // Títulos de sección
  sectionTitle: {
    marginTop: 22,
    marginBottom: 10,
    color: '#9b4b00',
    fontSize: 11,
    fontWeight: 700,
  },

  // Tabla del servicio
  table: { borderBottomWidth: 1, borderBottomColor: BORDER, border: '1px solid #eadfd2' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#c0c0c0' },
  tableHeaderCell: { paddingVertical: 8, paddingHorizontal: 8, color: '#332719', fontSize: 9, fontWeight: 700 },
  tableRow: { flexDirection: 'row' },
  tableCell: { paddingVertical: 11, paddingHorizontal: 8, color: '#332719', fontSize: 10, lineHeight: 1.35 },

  // Resumen de pagos (a la derecha, como los totales de la nota de venta)
  summaryWrap: { marginTop: 16, alignItems: 'flex-end' },
  summary: { width: '52%' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  summaryLabel: { fontSize: 10, color: '#4c4033' },
  summaryValue: { fontSize: 10, color: '#332719' },
  balanceRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 3,
    backgroundColor: ORANGE,
  },
  balanceLabel: { fontSize: 10, fontWeight: 500, color: '#000000' },
  balanceValue: { fontSize: 10, fontWeight: 500, color: '#000000' },

  // Observaciones
  observationBox: {
    marginTop: 22,
    paddingVertical: 10,
    backgroundColor: '#fff7ee',
  },
  observationText: { marginTop: 4, fontSize: 10, lineHeight: 1.4, color: '#2b2b2b' },

  legal: { marginTop: 18, color: '#75685a', fontSize: 8, lineHeight: 1.4 },

  // Firmas
  signatures: { marginTop: 56, flexDirection: 'row', justifyContent: 'space-between', gap: 48 },
  signature: { width: '45%', alignItems: 'center' },
  signatureLine: { width: '100%', height: 1, borderTopWidth: 1, borderTopColor: '#75685a' },
  signatureLabel: { marginTop: 7, color: '#332719', fontSize: 9, fontWeight: 700, textAlign: 'center' },
  signatureSubtitle: { marginTop: 3, color: '#897966', fontSize: 8, textAlign: 'center' },

  // Pie de página
  footer: {
    position: 'absolute',
    left: 40,
    right: 40,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 7,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    color: '#897966',
    fontSize: 8,
  },
})

// Evita el desfase de un día por zona horaria cuando la fecha viene como YYYY-MM-DD
function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match) {
    const [, y, m, d] = match
    return `${d}/${m}/${y}`
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('es-BO')
}

// Columnas de la tabla del servicio (suman 100%)
const COLS = {
  code: '18%',
  service: '42%',
  frequency: '20%',
  start: '20%',
}

function OperationNoteDocument({ note }: { note: OperationNotePdfData }) {
  let totalPayment = 0 // totalPayment = initialPayment - outstandingBalance
  if (note.service.initialPayment) {
    totalPayment = parseFloat(note.service.initialPayment.replace(/[^0-9.-]+/g, '')) - parseFloat(note.service.outstandingBalance.replace(/[^0-9.-]+/g, ''))
  }
  return (
    <Document
      title={`${note.title} ${note.number} · Businessman S.R.L.`}
      author="Businessman S.R.L."
      language="es"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>
              Businessman <Text style={styles.brandSuffix}>S.R.L.</Text>
            </Text>
            <Text style={[styles.branch, styles.branchFirst]}>{note.branchName}</Text>
            {note.branchAddress ? <Text style={styles.branch}>{note.branchAddress}</Text> : null}
            {note.branchPhone ? <Text style={styles.branch}>Tel. {note.branchPhone}</Text> : null}
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{note.title}</Text>
            <Text style={styles.subtitle}>Constancia de contratación de servicio</Text>
            <Text style={styles.number}>{note.number}</Text>
          </View>
        </View>

        {/* Datos del cliente */}
        <View style={styles.infoGrid}>
          <View style={styles.infoField}>
            <Text style={styles.fieldLabel}>Fecha de emisión</Text>
            <Text style={styles.fieldValue}>{formatDate(note.date)}</Text>
          </View>
          <View style={styles.infoField}>
            <Text style={styles.fieldLabel}>Cliente</Text>
            <Text style={styles.fieldValue}>{note.partyName}</Text>
          </View>
          <View style={styles.infoField}>
            <Text style={styles.fieldLabel}>Documento / NIT</Text>
            <Text style={styles.fieldValue}>{note.partyDocument || 'No registrado'}</Text>
          </View>
        </View>

        {/* Tabla del servicio */}
        <View wrap={false}>
          <Text style={styles.sectionTitle}>Detalle del servicio contratado</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { width: COLS.code }]}>Código</Text>
              <Text style={[styles.tableHeaderCell, { width: COLS.service }]}>Servicio</Text>
              <Text style={[styles.tableHeaderCell, { width: COLS.frequency }]}>Frecuencia</Text>
              <Text style={[styles.tableHeaderCell, { width: COLS.start }]}>Fecha de inicio</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { width: COLS.code }]}>{note.service.code}</Text>
              <Text style={[styles.tableCell, { width: COLS.service }]}>{note.service.contracted}</Text>
              <Text style={[styles.tableCell, { width: COLS.frequency }]}>{note.service.frequency}</Text>
              <Text style={[styles.tableCell, { width: COLS.start }]}>{note.service.startDate}</Text>
            </View>
          </View>

          {/* Resumen de pagos */}
          <View style={styles.summaryWrap}>
            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Pago inicial</Text>
                <Text style={styles.summaryValue}>{note.service.initialPayment}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Saldo pendiente</Text>
                <Text style={styles.summaryValue}>{note.service.outstandingBalance}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Pago total</Text>
                <Text style={styles.balanceValue}>{totalPayment.toFixed(2)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Observaciones */}
        <View style={styles.observationBox} wrap={false}>
          <Text style={styles.fieldLabel}>Observaciones</Text>
          <Text style={styles.observationText}>{note.service.observation || 'Sin observaciones'}</Text>
        </View>

        <Text style={styles.legal}>
          El cliente declara haber revisado y aceptado el detalle del servicio contratado descrito en esta constancia.
        </Text>

        {/* Firmas */}
        <View style={styles.signatures} wrap={false}>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Businessman S.R.L.</Text>
            <Text style={styles.signatureSubtitle}>Firma del representante</Text>
          </View>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{note.partyName}</Text>
            <Text style={styles.signatureSubtitle}>Firma del cliente</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Businessman S.R.L. · Valores expresados en bolivianos (Bs)</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function openOperationNotePdf(note: OperationNotePdfData, previewWindow: Window) {
  const blob = await pdf(OperationNoteDocument({ note })).toBlob()
  const url = URL.createObjectURL(blob)
  const safeNumber = note.number.replace(/[^a-zA-Z0-9_-]/g, '-')
  previewWindow.document.title = `${note.title} ${safeNumber}`
  previewWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000)
}