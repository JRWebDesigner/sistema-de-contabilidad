export type ArchivedReportType =
  | 'CUSTOMER_STATEMENT_DETAILED'
  | 'CUSTOMER_STATEMENT_SUMMARY'
  | 'CUSTOMER_DEBTS'
  | 'SALES_REPORT'
  | 'INVENTORY_REPORT'
  | 'CONTACTS_REPORT'
  | 'FINANCE_REPORT'

export async function saveArchivedReport(input: {
  blob: Blob
  title: string
  fileName: string
  type: ArchivedReportType
  customerId?: string
  periodStart?: string
  periodEnd?: string
}) {
  const formData = new FormData()
  formData.set('file', input.blob, input.fileName)
  formData.set('title', input.title)
  formData.set('type', input.type)
  formData.set('source', 'GENERATED')
  if (input.customerId) formData.set('customerId', input.customerId)
  if (input.periodStart) formData.set('periodStart', input.periodStart)
  if (input.periodEnd) formData.set('periodEnd', input.periodEnd)

  const response = await fetch('/api/report-archive', { method: 'POST', body: formData })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'No se pudo guardar el PDF en el archivo.')
  return result as { id: string; title: string; type: ArchivedReportType; source: 'GENERATED' }
}
