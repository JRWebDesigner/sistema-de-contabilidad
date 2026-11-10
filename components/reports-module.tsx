'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, Search } from 'lucide-react'
import { renderReportPdf } from './reports-pdf'
import { saveArchivedReport } from './report-archive-client'

type ReportType = 'ventas' | 'vendedores' | 'compras' | 'clientes' | 'cxc' | 'cxp' | 'caja' | 'inventario' | 'proveedores'

type TableRow = {
  [key: string]: string | number | boolean | null
}

type CashAccountSummary = { name: string; type: string; balance: number }
type Pagination = { page: number; pageSize: number; total: number; totalPages: number }
type PerformanceRow = {
  id: string
  name: string
  saleCount: number
  quantity: number
  revenue: number
  discounts: number
  margin: number | null
  marginPercent: number | null
}
type ProformaFunnelStage = { count: number; amount: number }
type CommercialSummary = {
  from: string | null
  to: string | null
  saleCount: number
  quantity: number
  revenue: number
  discounts: number
  margin: number | null
  averageTicket: number
  byCustomer: PerformanceRow[]
  byProduct: PerformanceRow[]
  bySegment: PerformanceRow[]
  byPromotion: PerformanceRow[]
  proformaFunnel: {
    issued: ProformaFunnelStage
    converted: ProformaFunnelStage
    pending: ProformaFunnelStage
    expired: ProformaFunnelStage
    rejected: ProformaFunnelStage
    conversionRate: number
  }
}
type SellerDailyRow = {
  id: string
  sellerName: string
  alias: string
  role: string | null
  salesCount: number
  cancelledSales: number
  cancelledAmount: number
  units: number
  grossSales: number
  discounts: number
  refunds: number
  netSales: number
  cost: number | null
  grossProfit: number | null
}
type SellerDailySummary = {
  date: string
  sellerCount: number
  sellersWithActivity: number
  salesCount: number
  cancelledSales: number
  cancelledAmount: number
  grossSales: number
  discounts: number
  refunds: number
  netSales: number
  cost: number | null
  grossProfit: number | null
}

function dateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatReportPeriod(from: string | null, to: string | null) {
  if (!from && !to) return 'Todo el historial'
  if (!from) return `Hasta ${to}`
  if (!to) return `Desde ${from}`
  return `${from} a ${to}`
}

const money = (value: number | string | null | undefined) => {
  const numeric = Number(value ?? 0)
  return `Bs ${Number.isFinite(numeric) ? numeric.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}`
}

const labels: Record<ReportType, string> = {
  ventas: 'Ventas',
  vendedores: 'Ventas por vendedor (diario)',
  compras: 'Compras',
  clientes: 'Clientes',
  cxc: 'Cuentas por cobrar',
  cxp: 'Cuentas por pagar',
  caja: 'Caja y bancos',
  inventario: 'Inventario',
  proveedores: 'Proveedores',
}

const reportOptions: Array<{ value: ReportType; label: string }> = [
  { value: 'ventas', label: 'Ventas' },
  { value: 'vendedores', label: 'Ventas por vendedor (diario)' },
  { value: 'compras', label: 'Compras' },
  { value: 'clientes', label: 'Clientes' },
  { value: 'cxc', label: 'Cuentas por cobrar' },
  { value: 'cxp', label: 'Cuentas por pagar' },
  { value: 'caja', label: 'Caja y bancos' },
  { value: 'inventario', label: 'Inventario' },
  { value: 'proveedores', label: 'Proveedores' },
]

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ padding: '.75rem', background: '#fbfaf9' }}>
      <small className="muted">{label}</small>
      <strong style={{ display: 'block', fontSize: 18 }}>{value}</strong>
    </div>
  )
}

function PerformanceTable({ title, rows, showMargin }: { title: string; rows: PerformanceRow[]; showMargin: boolean }) {
  return (
    <div className="panel" style={{ padding: '1rem' }}>
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">Sin datos en el período seleccionado.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Nombre</th><th>Ventas</th><th>Unidades netas</th><th>Ingresos netos</th><th>Descuentos</th>{showMargin && <th>Margen</th>}</tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.saleCount}</td>
                <td>{row.quantity}</td>
                <td>{money(row.revenue)}</td>
                <td>{money(row.discounts)}</td>
                {showMargin && <td>{money(row.margin)}{row.marginPercent == null ? '' : ` (${row.marginPercent}%)`}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function ReportsModule({ permissions }: { permissions: string[] }) {
  const permissionForReport: Record<ReportType, string> = {
    ventas: 'sales:read', vendedores: 'sales:read', compras: 'finance:read', clientes: 'contacts:read',
    cxc: 'finance:read', cxp: 'finance:read', caja: 'finance:read',
    inventario: 'inventory:read', proveedores: 'contacts:read',
  }
  const availableReports = useMemo(
    () => reportOptions.filter((option) => permissions.includes(permissionForReport[option.value])),
    [permissions],
  )
  const [reportType, setReportType] = useState<ReportType>(availableReports[0]?.value ?? 'ventas')
  const [rows, setRows] = useState<TableRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [archiveNotice, setArchiveNotice] = useState('')
  const [salesSummary, setSalesSummary] = useState({ receivables: 0, cash: 0 })
  const [cashAccountsSummary, setCashAccountsSummary] = useState<CashAccountSummary[]>([])
  const [commercialSummary, setCommercialSummary] = useState<CommercialSummary | null>(null)
  const [sellerDailySummary, setSellerDailySummary] = useState<SellerDailySummary | null>(null)
  const [sellerDailyDate, setSellerDailyDate] = useState(() => dateInputValue(new Date()))
  const [accountStatusFilter, setAccountStatusFilter] = useState('ALL')
  const [agingFilter, setAgingFilter] = useState('ALL')
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date()
    return dateInputValue(new Date(now.getFullYear(), now.getMonth(), 1))
  })
  const [toDate, setToDate] = useState(() => dateInputValue(new Date()))
  const [fullReport, setFullReport] = useState(false)

  useEffect(() => {
    if (!availableReports.some((option) => option.value === reportType)) {
      setReportType(availableReports[0]?.value ?? 'ventas')
      setPage(1)
      return
    }
    let active = true
    async function load() {
      setLoading(true)
      setError('')

      try {
        const params = new URLSearchParams({ type: reportType, page: String(page), pageSize: String(pageSize), q: query })
        if (reportType === 'ventas' && !fullReport) {
          params.set('from', fromDate)
          params.set('to', toDate)
        }
        if (reportType === 'cxc' || reportType === 'cxp') {
          params.set('from', fromDate)
          params.set('to', toDate)
          params.set('status', accountStatusFilter)
          params.set('aging', agingFilter)
        }
        if (reportType === 'vendedores') params.set('date', sellerDailyDate)
        const response = await fetch(`/api/reports?${params}`)
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'No se pudo cargar el reporte solicitado.')

        if (!active) return

        const normalized = normalizeRows(reportType, result.data, permissions.includes('finance:read'))
        setColumns(normalized.columns)
        setRows(normalized.rows)
        setPagination(result.pagination)
        setSalesSummary(result.salesSummary ?? { receivables: 0, cash: 0 })
        setCashAccountsSummary(result.cashAccountsSummary ?? [])
        setCommercialSummary(reportType === 'ventas' ? result.commercialSummary ?? null : null)
        setSellerDailySummary(reportType === 'vendedores' ? result.sellerDailySummary ?? null : null)
      } catch (reason) {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar el reporte.')
        setRows([])
        setColumns([])
        setPagination({ page: 1, pageSize, total: 0, totalPages: 0 })
        setCommercialSummary(null)
        setSellerDailySummary(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [reportType, page, pageSize, query, availableReports, fromDate, toDate, fullReport, sellerDailyDate, accountStatusFilter, agingFilter, permissions])

  const totalGeneral = useMemo(() => getTotalGeneral(rows), [rows])
  const totalCollectible = useMemo(() => salesSummary.receivables + salesSummary.cash, [salesSummary])

  const exportTable = async (format: 'csv' | 'excel' | 'pdf') => {
    setExporting(true)
    setError('')
    setArchiveNotice('')
    try {
      const firstParams = new URLSearchParams({ type: reportType, page: '1', pageSize: '100', q: query })
      if (reportType === 'ventas' && !fullReport) {
        firstParams.set('from', fromDate)
        firstParams.set('to', toDate)
      }
      if (reportType === 'cxc' || reportType === 'cxp') {
        firstParams.set('from', fromDate)
        firstParams.set('to', toDate)
        firstParams.set('status', accountStatusFilter)
        firstParams.set('aging', agingFilter)
      }
      if (reportType === 'vendedores') firstParams.set('date', sellerDailyDate)
      const firstResponse = await fetch(`/api/reports?${firstParams}`)
      const firstResult = await firstResponse.json()
      if (!firstResponse.ok) throw new Error(firstResult.error ?? 'No se pudo cargar el reporte para exportar.')

      const allRecords = [...firstResult.data]
      for (let firstPage = 2; firstPage <= firstResult.pagination.totalPages; firstPage += 8) {
        const pages = Array.from({ length: Math.min(8, firstResult.pagination.totalPages - firstPage + 1) }, (_, index) => firstPage + index)
        const pageResults = await Promise.all(pages.map(async (exportPage) => {
          const params = new URLSearchParams({ type: reportType, page: String(exportPage), pageSize: '100', q: query })
          if (reportType === 'ventas' && !fullReport) {
            params.set('from', fromDate)
            params.set('to', toDate)
          }
          if (reportType === 'cxc' || reportType === 'cxp') {
            params.set('from', fromDate)
            params.set('to', toDate)
            params.set('status', accountStatusFilter)
            params.set('aging', agingFilter)
          }
          if (reportType === 'vendedores') params.set('date', sellerDailyDate)
          const response = await fetch(`/api/reports?${params}`)
          const result = await response.json()
          if (!response.ok) throw new Error(result.error ?? 'No se pudo cargar el reporte completo.')
          return result.data
        }))
        allRecords.push(...pageResults.flat())
      }
      const sourceRows = normalizeRows(reportType, allRecords, permissions.includes('finance:read')).rows
      const exportColumns = normalizeRows(reportType, firstResult.data, permissions.includes('finance:read')).columns
      if (sourceRows.length === 0) {
        return
      }

      const exportSalesSummary = firstResult.salesSummary ?? salesSummary
      const exportCashAccounts = firstResult.cashAccountsSummary ?? cashAccountsSummary
      const exportCommercialSummary: CommercialSummary | null = firstResult.commercialSummary ?? null
      const exportSellerDailySummary: SellerDailySummary | null = firstResult.sellerDailySummary ?? null
      const summaryRows = reportType === 'ventas'
        ? [
            ['Resumen financiero', ''],
            ['Clientes por cobrar', money(exportSalesSummary.receivables)],
            ['Dinero disponible', money(exportSalesSummary.cash)],
            ['Total al cobrar', money(exportSalesSummary.receivables + exportSalesSummary.cash)],
            ...(exportCommercialSummary ? [
              ['Período', formatReportPeriod(exportCommercialSummary.from, exportCommercialSummary.to)],
              ['Ventas completadas', String(exportCommercialSummary.saleCount)],
              ['Cantidad neta vendida', String(exportCommercialSummary.quantity)],
              ['Ingresos netos tras devoluciones', money(exportCommercialSummary.revenue)],
              ['Descuentos aplicados', money(exportCommercialSummary.discounts)],
              ['Ticket promedio neto', money(exportCommercialSummary.averageTicket)],
              ...(exportCommercialSummary.margin == null ? [] : [['Margen neto', money(exportCommercialSummary.margin)]]),
              ['Rendimiento por segmento', ''],
              ...exportCommercialSummary.bySegment.map((row) => [row.name, money(row.revenue)]),
              ['Rendimiento por promoción', ''],
              ...exportCommercialSummary.byPromotion.map((row) => [row.name, money(row.revenue)]),
              ['Embudo de proformas', ''],
              ['Proformas emitidas', `${exportCommercialSummary.proformaFunnel.issued.count} · ${money(exportCommercialSummary.proformaFunnel.issued.amount)}`],
              ['Convertidas en venta', `${exportCommercialSummary.proformaFunnel.converted.count} · ${money(exportCommercialSummary.proformaFunnel.converted.amount)}`],
              ['Pendientes vigentes', `${exportCommercialSummary.proformaFunnel.pending.count} · ${money(exportCommercialSummary.proformaFunnel.pending.amount)}`],
              ['Vencidas', `${exportCommercialSummary.proformaFunnel.expired.count} · ${money(exportCommercialSummary.proformaFunnel.expired.amount)}`],
              ['Rechazadas', `${exportCommercialSummary.proformaFunnel.rejected.count} · ${money(exportCommercialSummary.proformaFunnel.rejected.amount)}`],
              ['Tasa de conversión', `${exportCommercialSummary.proformaFunnel.conversionRate}%`],
            ] : []),
          ]
        : reportType === 'vendedores' && exportSellerDailySummary
          ? [
              ['Reporte diario por vendedor', ''],
              ['Fecha (America/La_Paz)', exportSellerDailySummary.date],
              ['Vendedores incluidos', String(exportSellerDailySummary.sellerCount)],
              ['Vendedores con actividad', String(exportSellerDailySummary.sellersWithActivity)],
              ['Ventas completadas', String(exportSellerDailySummary.salesCount)],
              ['Ventas anuladas', String(exportSellerDailySummary.cancelledSales)],
              ['Importe de ventas anuladas', money(exportSellerDailySummary.cancelledAmount)],
              ['Venta bruta', money(exportSellerDailySummary.grossSales)],
              ['Descuentos', money(exportSellerDailySummary.discounts)],
              ['Devoluciones', money(exportSellerDailySummary.refunds)],
              ['Venta neta', money(exportSellerDailySummary.netSales)],
              ...(exportSellerDailySummary.cost == null ? [] : [['Costo de productos', money(exportSellerDailySummary.cost)]]),
              ...(exportSellerDailySummary.grossProfit == null ? [] : [['Ganancia bruta', money(exportSellerDailySummary.grossProfit)]]),
            ]
        : reportType === 'caja'
          ? [
              ['Saldos actuales por cuenta', ''],
              ...exportCashAccounts.map((account: CashAccountSummary) => [account.name, money(account.balance)]),
              ['Total actual de caja y bancos', money(exportCashAccounts.reduce((sum: number, account: CashAccountSummary) => sum + account.balance, 0))],
            ]
        : []

      if (format === 'pdf') {
        const generatedAt = new Intl.DateTimeFormat('es-BO', {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: 'America/La_Paz',
        }).format(new Date())
        const period = reportType === 'ventas'
          ? formatReportPeriod(exportCommercialSummary?.from ?? (fullReport ? null : fromDate), exportCommercialSummary?.to ?? (fullReport ? null : toDate))
          : reportType === 'vendedores'
            ? sellerDailyDate
            : ''
        const blob = await renderReportPdf({
          title: labels[reportType],
          columns: exportColumns,
          rows: sourceRows,
          summaryRows,
          generatedAt,
          period,
          filter: query.trim(),
        })
        const periodStart = reportType === 'ventas'
          ? exportCommercialSummary?.from ?? (fullReport ? undefined : fromDate)
          : reportType === 'vendedores'
            ? sellerDailyDate
            : reportType === 'cxc' || reportType === 'cxp'
              ? fromDate
              : undefined
        const periodEnd = reportType === 'ventas'
          ? exportCommercialSummary?.to ?? (fullReport ? undefined : toDate)
          : reportType === 'vendedores'
            ? sellerDailyDate
            : reportType === 'cxc' || reportType === 'cxp'
              ? toDate
              : undefined
        try {
          await saveArchivedReport({
            blob,
            title: labels[reportType],
            fileName: `${labels[reportType].toLowerCase().replace(/\s+/g, '-')}.pdf`,
            type: reportType === 'ventas' || reportType === 'vendedores'
              ? 'SALES_REPORT'
              : reportType === 'inventario'
                ? 'INVENTORY_REPORT'
                : reportType === 'clientes' || reportType === 'proveedores'
                  ? 'CONTACTS_REPORT'
                  : 'FINANCE_REPORT',
            periodStart,
            periodEnd,
          })
          setArchiveNotice('El PDF se descargó y quedó guardado en el archivo de reportes.')
        } catch (archiveError) {
          console.error('ERROR_ARCHIVING_REPORT_PDF', archiveError)
          setError(archiveError instanceof Error
            ? `El PDF se descargó, pero no se pudo guardar en el archivo: ${archiveError.message}`
            : 'El PDF se descargó, pero no se pudo guardar en el archivo.')
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${labels[reportType].toLowerCase().replace(/\s+/g, '-')}.pdf`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        return
      }

      const content = buildExportContent(exportColumns, sourceRows, format === 'excel' ? 'excel' : 'csv', summaryRows)
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${labels[reportType].toLowerCase().replace(/\s+/g, '-')}.${format === 'excel' ? 'xls' : format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo exportar el reporte completo.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Análisis · Bolivia</p>
          <h1>Reportes</h1>
          <p className="muted">Consulta los datos por tipo de reporte y filtra la información.</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <div className="module-toolbar" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ minWidth: 220 }}>
            Tipo de reporte
            <select value={reportType} onChange={(event) => { setReportType(event.target.value as ReportType); setPage(1) }} style={{ display: 'block', width: '100%', marginTop: 6 }}>
              {availableReports.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {reportType === 'ventas' && (
            <>
              {!fullReport && (
                <>
                  <label>
                    Desde
                    <input type="date" value={fromDate} max={toDate} onChange={(event) => { setFromDate(event.target.value); setPage(1) }} />
                  </label>
                  <label>
                    Hasta
                    <input type="date" value={toDate} min={fromDate} max={dateInputValue(new Date())} onChange={(event) => { setToDate(event.target.value); setPage(1) }} />
                  </label>
                </>
              )}
              <button
                className="outline-button"
                type="button"
                aria-pressed={fullReport}
                onClick={() => { setFullReport((current) => !current); setPage(1) }}
              >
                {fullReport ? 'Filtrar por fechas' : 'Ver reporte completo'}
              </button>
            </>
          )}
          {reportType === 'vendedores' && (
            <label>
              Día del reporte
              <input
                type="date"
                value={sellerDailyDate}
                max={dateInputValue(new Date())}
                onChange={(event) => { setSellerDailyDate(event.target.value); setPage(1) }}
              />
            </label>
          )}
          {(reportType === 'cxc' || reportType === 'cxp') && (
            <>
              <label>
                Estado
                <select value={accountStatusFilter} onChange={(event) => { setAccountStatusFilter(event.target.value); setPage(1) }}>
                  <option value="ALL">Todos</option><option value="PENDING">Pendiente</option><option value="PARTIAL">Parcial</option><option value="OVERDUE">Vencida</option><option value="PAID">Pagada</option><option value="CANCELLED">Cancelada</option>
                </select>
              </label>
              <label>
                Antigüedad
                <select value={agingFilter} onChange={(event) => { setAgingFilter(event.target.value); setPage(1) }}>
                  <option value="ALL">Todas</option><option value="CURRENT">Al día</option><option value="1-30">1–30 días</option><option value="31-60">31–60 días</option><option value="61-90">61–90 días</option><option value="90+">Más de 90 días</option>
                </select>
              </label>
              <label>Vence desde<input type="date" value={fromDate} max={toDate} onChange={(event) => { setFromDate(event.target.value); setPage(1) }} /></label>
              <label>Vence hasta<input type="date" value={toDate} min={fromDate} onChange={(event) => { setToDate(event.target.value); setPage(1) }} /></label>
            </>
          )}

          <div className="search-box" style={{ flex: 1, minWidth: 220 }}>
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1) }}
              placeholder={`Filtrar ${labels[reportType].toLowerCase()}...`}
            />
          </div>

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="outline-button" type="button" disabled={exporting} onClick={() => void exportTable('csv')}><Download size={15} /> CSV</button>
            <button className="outline-button" type="button" disabled={exporting} onClick={() => void exportTable('excel')}><Download size={15} /> Excel</button>
            <button className="outline-button" type="button" disabled={exporting} onClick={() => void exportTable('pdf')}><FileText size={15} /> PDF</button>
          </div>
        </div>
      </div>

      {error && <p className="module-message">{error}</p>}
      {archiveNotice && <div className="notice" role="status">{archiveNotice}</div>}

      {reportType === 'vendedores' && sellerDailySummary && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
          <SummaryValue label="Fecha (hora Bolivia)" value={sellerDailySummary.date} />
          <SummaryValue label="Vendedores incluidos" value={String(sellerDailySummary.sellerCount)} />
          <SummaryValue label="Con actividad" value={String(sellerDailySummary.sellersWithActivity)} />
          <SummaryValue label="Ventas completadas" value={String(sellerDailySummary.salesCount)} />
          <SummaryValue label="Ventas anuladas" value={String(sellerDailySummary.cancelledSales)} />
          <SummaryValue label="Importe anulado" value={money(sellerDailySummary.cancelledAmount)} />
          <SummaryValue label="Venta bruta" value={money(sellerDailySummary.grossSales)} />
          <SummaryValue label="Descuentos" value={money(sellerDailySummary.discounts)} />
          <SummaryValue label="Devoluciones" value={money(sellerDailySummary.refunds)} />
          <SummaryValue label="Venta neta" value={money(sellerDailySummary.netSales)} />
          {sellerDailySummary.cost != null && <SummaryValue label="Costo de productos" value={money(sellerDailySummary.cost)} />}
          {sellerDailySummary.grossProfit != null && <SummaryValue label="Ganancia bruta" value={money(sellerDailySummary.grossProfit)} />}
        </section>
      )}

      <article className="panel module-table">
        <div className="table-scroll">
          {loading ? (
            <p className="muted" style={{ padding: '1rem' }}>Cargando reporte...</p>
          ) : columns.length === 0 ? (
            <p className="muted" style={{ padding: '1rem' }}>No hay datos para este reporte.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length}>No hay coincidencias para este filtro.</td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${reportType}-${index}`}>
                      {columns.map((column) => (
                        <td key={`${reportType}-${index}-${column}`}>{formatCell(row[column])}</td>
                      ))}
                    </tr>
                  ))
                )}
                {rows.length > 0 && (
                  <tr style={{ fontWeight: 700, background: '#fbfaf9' }}>
                    <td colSpan={Math.max(columns.length - 1, 1)} style={{ textAlign: 'right' }}>Total de página</td>
                    <td>{totalGeneral}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {reportType === 'ventas' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
              <div className="panel" style={{ padding: '0.75rem 0.9rem', background: '#fbfaf9' }}>
                <div style={{ color: '#80766b', fontSize: 12 }}>Clientes por cobrar</div>
                <strong style={{ fontSize: 20 }}>{money(salesSummary.receivables)}</strong>
              </div>
              <div className="panel" style={{ padding: '0.75rem 0.9rem', background: '#fbfaf9' }}>
                <div style={{ color: '#80766b', fontSize: 12 }}>Dinero disponible</div>
                <strong style={{ fontSize: 20 }}>{money(salesSummary.cash)}</strong>
              </div>
              <div className="panel" style={{ padding: '0.75rem 0.9rem', background: '#ecfdf5' }}>
                <div style={{ color: '#047857', fontSize: 12 }}>Total al cobrar</div>
                <strong style={{ fontSize: 20, color: '#047857' }}>{money(totalCollectible)}</strong>
              </div>
            </div>
          )}

          {reportType === 'ventas' && commercialSummary && (
            <section style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
              <div className="panel" style={{ padding: '1rem' }}>
                <h2>Rendimiento comercial · {formatReportPeriod(commercialSummary.from, commercialSummary.to)}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem', marginTop: '.75rem' }}>
                  <SummaryValue label="Ventas completadas" value={String(commercialSummary.saleCount)} />
                  <SummaryValue label="Unidades netas" value={String(commercialSummary.quantity)} />
                  <SummaryValue label="Ingresos netos" value={money(commercialSummary.revenue)} />
                  <SummaryValue label="Descuentos" value={money(commercialSummary.discounts)} />
                  <SummaryValue label="Ticket promedio" value={money(commercialSummary.averageTicket)} />
                  {commercialSummary.margin != null && <SummaryValue label="Margen neto" value={money(commercialSummary.margin)} />}
                </div>
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
                  <h3 style={{ margin: 0 }}>Embudo de proformas</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '.75rem', marginTop: '.75rem' }}>
                    {([
                      { label: 'Emitidas', stage: commercialSummary.proformaFunnel.issued, color: '#eb8825' },
                      { label: 'Convertidas', stage: commercialSummary.proformaFunnel.converted, color: '#059669' },
                      { label: 'Pendientes vigentes', stage: commercialSummary.proformaFunnel.pending, color: '#d97706' },
                      { label: 'Vencidas', stage: commercialSummary.proformaFunnel.expired, color: '#dc2626' },
                      { label: 'Rechazadas', stage: commercialSummary.proformaFunnel.rejected, color: '#8b7764' },
                    ]).map(({ label, stage, color }) => (
                      <div className="panel" key={label} style={{ padding: '.75rem', background: '#fbfaf9' }}>
                        <small className="muted">{label}</small>
                        <strong style={{ display: 'block', fontSize: 18 }}>{stage.count}</strong>
                        <span style={{ fontSize: 13 }}>{money(stage.amount)}</span>
                        <div role="progressbar" aria-label={`${label} respecto a proformas emitidas`} aria-valuemin={0} aria-valuemax={commercialSummary.proformaFunnel.issued.count} aria-valuenow={stage.count} style={{ height: 5, marginTop: 8, borderRadius: 5, background: '#ebe8e5' }}>
                          <div style={{ width: `${commercialSummary.proformaFunnel.issued.count ? Math.min(100, stage.count / commercialSummary.proformaFunnel.issued.count * 100) : 0}%`, height: '100%', borderRadius: 5, background: color }} />
                        </div>
                      </div>
                    ))}
                    <SummaryValue label="Tasa de conversión" value={`${commercialSummary.proformaFunnel.conversionRate}%`} />
                  </div>
                  <small className="muted">Conversión: proformas aceptadas y vinculadas a una venta, sobre el total emitido en el período.</small>
                </div>
                {commercialSummary.margin == null && <small className="muted">El margen solo se muestra a usuarios con acceso financiero.</small>}
              </div>
              <PerformanceTable title="Principales clientes" rows={commercialSummary.byCustomer} showMargin={commercialSummary.margin != null} />
              <PerformanceTable title="Productos más vendidos" rows={commercialSummary.byProduct} showMargin={commercialSummary.margin != null} />
              <PerformanceTable title="Rendimiento por segmento" rows={commercialSummary.bySegment} showMargin={commercialSummary.margin != null} />
              <PerformanceTable title="Rendimiento por promoción" rows={commercialSummary.byPromotion} showMargin={commercialSummary.margin != null} />
            </section>
          )}

          {reportType === 'caja' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
              {cashAccountsSummary.map((account) => (
                <div className="panel" style={{ padding: '0.75rem 0.9rem', background: '#fbfaf9' }} key={account.name}>
                  <div style={{ color: '#80766b', fontSize: 12 }}>{account.name}</div>
                  <small>{account.type === 'CASH' ? 'Caja' : account.type === 'BANK' ? 'Banco' : 'POS'}</small>
                  <strong style={{ display: 'block', fontSize: 20 }}>{money(account.balance)}</strong>
                </div>
              ))}
              <div className="panel" style={{ padding: '0.75rem 0.9rem', background: '#ecfdf5' }}>
                <div style={{ color: '#047857', fontSize: 12 }}>Total actual</div>
                <strong style={{ display: 'block', fontSize: 20, color: '#047857' }}>{money(cashAccountsSummary.reduce((sum, account) => sum + account.balance, 0))}</strong>
              </div>
            </div>
          )}
        </div>
      </article>
      <div className="module-toolbar" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
        <span className="muted">
          {pagination.total === 0 ? '0 registros' : `${(pagination.page - 1) * pagination.pageSize + 1}-${Math.min(pagination.page * pagination.pageSize, pagination.total)} de ${pagination.total} registros`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label>
            Filas
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} style={{ marginLeft: 6 }}>
              {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button className="icon-button" type="button" aria-label="Página anterior" title="Página anterior" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            <ChevronLeft size={17} />
          </button>
          <span className="muted">Página {pagination.page} de {Math.max(pagination.totalPages, 1)}</span>
          <button className="icon-button" type="button" aria-label="Página siguiente" title="Página siguiente" disabled={loading || page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}

function normalizeRows(reportType: ReportType, data: unknown, canReadFinance = false): { columns: string[]; rows: TableRow[] } {
  if (reportType === 'ventas') {
    const sales = Array.isArray(data) ? data : []
    const columns = ['Venta', 'Cliente', 'Segmento', 'Producto', 'Promoción', 'Cantidad', 'Devuelto', 'Precio unitario', 'Subtotal', 'Importe devuelto', 'Total venta', 'Venta neta', 'Saldo pendiente', 'Detalle de devolución', 'Fecha', 'Método', 'Comprobante', 'Estado']
    const rows: TableRow[] = []

    for (const sale of sales) {
      const saleItems = Array.isArray(sale.items) && sale.items.length > 0 ? sale.items : [{
        product: { name: 'Sin producto' },
        quantity: 0,
        unitPrice: sale.total ?? 0,
        lineTotal: sale.total ?? 0,
      }]

      const subtotalSale = Number(sale.subtotal ?? 0)
      const saleTotal = Number(sale.total ?? 0)
      const balancePendiente = sale.paymentMethod === 'CREDIT'
        ? Number(sale?.receivable?.balance ?? 0)
        : 0
      const returnedByItem = new Map<string, { quantity: number; amount: number; details: string[] }>()
      for (const saleReturn of Array.isArray(sale.returns) ? sale.returns : []) {
        for (const returnedItem of Array.isArray(saleReturn.items) ? saleReturn.items : []) {
          const current = returnedByItem.get(returnedItem.saleItemId) ?? { quantity: 0, amount: 0, details: [] }
          current.quantity += Number(returnedItem.quantity ?? 0)
          current.amount += Number(returnedItem.lineTotal ?? 0)
          current.details.push(`${returnedItem.quantity} unid. · ${saleReturn.reason ?? 'Devolución registrada'}${saleReturn.number ? ` · ${saleReturn.number}` : ''}`)
          returnedByItem.set(returnedItem.saleItemId, current)
        }
      }
      const totalReturnedAmount = Array.from(returnedByItem.values()).reduce((sum, item) => sum + item.amount, 0)

      for (const [itemIndex, item] of saleItems.entries()) {
        const itemReturn = returnedByItem.get(item.id) ?? { quantity: 0, amount: 0, details: [] }
        const returnedQuantity = itemReturn.quantity
        const returnedAmount = itemReturn.amount
        const returnDetails = itemReturn.details.length > 0
          ? itemReturn.details.join(' | ')
          : 'Sin devolución'

        rows.push({
          Venta: sale.number ?? sale.id ?? '-',
          Cliente: sale.customer?.name ?? 'Consumidor final',
          Segmento: sale.priceListName ?? 'Sin segmento registrado',
          Producto: item.product?.name ?? item.name ?? 'Sin producto',
          Promoción: item.promotionName ?? '—',
          Cantidad: Number(item.quantity ?? 0),
          Devuelto: returnedQuantity,
          'Precio unitario': Number(item.unitPrice ?? item.price ?? 0),
          Subtotal: Number(item.lineTotal ?? subtotalSale ?? 0),
          'Importe devuelto': returnedAmount,
          'Total venta': itemIndex === 0 ? saleTotal : null,
          'Venta neta': itemIndex === 0 && sale.status !== 'CANCELLED' ? saleTotal - totalReturnedAmount : itemIndex === 0 ? 0 : null,
          'Saldo pendiente': itemIndex === 0 ? balancePendiente : null,
          'Detalle de devolución': returnDetails,
          Fecha: sale.createdAt ? new Date(sale.createdAt).toLocaleDateString('es-BO') : '-',
          Método: translatePaymentMethod(sale.paymentMethod),
          Comprobante: sale.paymentReference ?? '-',
          Estado: translateSaleStatus(sale),
        })
      }
    }

    return { columns, rows }
  }

  if (reportType === 'vendedores') {
    const sellers = Array.isArray(data) ? data as SellerDailyRow[] : []
    const columns = [
      'Vendedor',
      'Actividad',
      'Ventas completadas',
      'Ventas anuladas',
      'Importe anulado',
      'Unidades',
      'Venta bruta',
      'Descuentos',
      'Devoluciones',
      'Venta neta',
      ...(canReadFinance ? ['Costo de productos', 'Ganancia bruta'] : []),
    ]
    const rows = sellers.map((seller) => ({
      Vendedor: seller.alias ? `${seller.sellerName} (${seller.alias})` : seller.sellerName,
      Actividad: seller.salesCount + seller.cancelledSales > 0 ? 'Con ventas' : 'Sin ventas',
      'Ventas completadas': seller.salesCount,
      'Ventas anuladas': seller.cancelledSales,
      'Importe anulado': seller.cancelledAmount,
      Unidades: seller.units,
      'Venta bruta': seller.grossSales,
      Descuentos: seller.discounts,
      Devoluciones: seller.refunds,
      'Venta neta': seller.netSales,
      ...(canReadFinance ? {
        'Costo de productos': seller.cost,
        'Ganancia bruta': seller.grossProfit,
      } : {}),
    }))
    return { columns, rows }
  }

  if (reportType === 'compras') {
    const purchases = Array.isArray(data) ? data : []
    const columns = ['Número', 'Proveedor', 'Fecha', 'Método', 'Total']
    const rows = purchases.map((purchase: any) => ({
      Número: purchase.number ?? purchase.id ?? '-',
      Proveedor: purchase.supplier?.name ?? 'Sin proveedor',
      Fecha: purchase.createdAt ? new Date(purchase.createdAt).toLocaleDateString('es-BO') : '-',
      Método: purchase.paymentMethod ?? '-',
      Total: Number(purchase.total ?? 0),
    }))
    return { columns, rows }
  }

  if (reportType === 'clientes') {
    const customers = Array.isArray(data) ? data : []
    const columns = ['Nombre', 'Documento', 'Tipo', 'Correo', 'Estado']
    const rows = customers.map((customer: any) => ({
      Nombre: customer.name ?? '-',
      Documento: customer.document ?? '-',
      Tipo: customer.type ?? 'PERSON',
      Correo: customer.email ?? 'Sin correo',
      Estado: customer.isActive === false ? 'Inactivo' : 'Activo',
    }))
    return { columns, rows }
  }

  if (reportType === 'cxc') {
    const receivables = Array.isArray(data) ? data : []
    const columns = ['Número', 'Cliente', 'Vence', 'Saldo', 'Estado']
    const rows = receivables.map((receivable: any) => ({
      Número: receivable.number ?? receivable.id ?? '-',
      Cliente: receivable.customer?.name ?? 'Sin cliente',
      Vence: receivable.dueDate ? new Date(receivable.dueDate).toLocaleDateString('es-BO') : '-',
      Saldo: Number(receivable.balance ?? 0),
      Estado: translateStatus(receivable.status),
    }))
    return { columns, rows }
  }

  if (reportType === 'cxp') {
    const payables = Array.isArray(data) ? data : []
    const columns = ['Número', 'Proveedor', 'Vence', 'Saldo', 'Estado']
    const rows = payables.map((payable: any) => ({
      Número: payable.number ?? payable.id ?? '-',
      Proveedor: payable.supplier?.name ?? 'Sin proveedor',
      Vence: payable.dueDate ? new Date(payable.dueDate).toLocaleDateString('es-BO') : '-',
      Saldo: Number(payable.balance ?? 0),
      Estado: translateStatus(payable.status),
    }))
    return { columns, rows }
  }

  if (reportType === 'caja') {
    const accounts = Array.isArray(data) ? data : []
    const columns = ['Fecha', 'Cuenta', 'Tipo', 'Descripción', 'Referencia', 'Ingreso', 'Egreso', 'Saldo del movimiento']
    const rows = accounts.flatMap((account: any) => (Array.isArray(account.movements) ? account.movements : []).map((movement: any) => {
      const amount = Number(movement.amount ?? 0)
      const isIncome = movement.type === 'IN'
      return {
        Fecha: movement.createdAt ? new Date(movement.createdAt).toLocaleString('es-BO') : '-',
        Cuenta: account.name ?? '-',
        Tipo: isIncome ? 'Ingreso' : 'Egreso',
        Descripción: movement.description ?? '-',
        Referencia: movement.reference ?? '-',
        Ingreso: isIncome ? amount : 0,
        Egreso: isIncome ? 0 : amount,
        'Saldo del movimiento': isIncome ? amount : -amount,
      }
    }))
    return { columns, rows }
  }

  if (reportType === 'inventario') {
    const products = Array.isArray(data) ? data : []
    const columns = ['Producto', 'SKU', 'Categoría', 'Stock', 'Precio', 'Mínimo']
    const rows = products.map((product: any) => ({
      Producto: product.name ?? '-',
      SKU: product.sku ?? '-',
      Categoría: product.category?.name ?? product.categoryName ?? '-',
      Stock: Number(product.currentStock ?? 0),
      Precio: Number(product.price ?? 0),
      Mínimo: Number(product.minimumStock ?? 0),
    }))
    return { columns, rows }
  }

  const suppliers = Array.isArray(data) ? data : []
  const columns = ['Proveedor', 'Documento', 'Correo', 'Teléfono', 'Estado']
  const rows = suppliers.map((supplier: any) => ({
    Proveedor: supplier.name ?? '-',
    Documento: supplier.document ?? '-',
    Correo: supplier.email ?? 'Sin correo',
    Teléfono: supplier.phone ?? 'Sin teléfono',
    Estado: supplier.isActive === false ? 'Inactivo' : 'Activo',
  }))
  return { columns, rows }
}

function translateSaleStatus(sale: { paymentMethod?: string | null; status?: string | null }) {
  if (String(sale.status ?? '').toUpperCase() === 'CANCELLED') return 'Anulada'
  if (String(sale.paymentMethod ?? '').toUpperCase() === 'CREDIT') return 'Crédito pendiente'
  const status = String(sale.status ?? '').toUpperCase()
  const map: Record<string, string> = {
    COMPLETED: 'Completada',
    PENDING: 'Pendiente',
    PARTIAL: 'Parcial',
    PAID: 'Pagada',
    OVERDUE: 'Vencida',
    ACTIVE: 'Activo',
    INACTIVE: 'Inactivo',
    CANCELLED: 'Anulada',
  }
  return (map[status] ?? status) || 'Sin estado'
}

function translateStatus(value: string | null | undefined) {
  const status = String(value ?? '').toUpperCase()
  const map: Record<string, string> = {
    COMPLETED: 'Completada',
    PENDING: 'Pendiente',
    PARTIAL: 'Parcial',
    PAID: 'Pagada',
    OVERDUE: 'Vencida',
    ACTIVE: 'Activo',
    INACTIVE: 'Inactivo',
    CANCELLED: 'Anulada',
    CASH: 'Efectivo',
  }
  return (map[status] ?? status) || 'Sin estado'
}

function translatePaymentMethod(value: string | null | undefined) {
  const method = String(value ?? '').toUpperCase()
  const map: Record<string, string> = {
    CASH: 'Efectivo',
    BANK_TRANSFER: 'Transferencia bancaria',
    OTHER: 'Otro',
    CARD: 'Tarjeta',
    QR: 'QR',
    CREDIT: 'Crédito',
  }
  return (map[method] ?? method) || 'Sin método'
}

function getTotalGeneral(rows: TableRow[]) {
  if (rows.length === 0) return '$ 0.00'

  const numericColumns = ['Total', 'Saldo', 'Precio', 'Stock', 'Mínimo', 'Subtotal', 'Total venta', 'Saldo pendiente', 'Ingreso', 'Egreso', 'Saldo del movimiento']
  for (const column of numericColumns) {
    const sum = rows.reduce((accumulator, row) => {
      const value = Number(row[column] ?? 0)
      return Number.isFinite(value) ? accumulator + value : accumulator
    }, 0)

    if (sum !== 0 || rows.some((row) => String(row[column] ?? '').trim() !== '')) {
      if (column === 'Stock' || column === 'Mínimo') return sum.toLocaleString('en-US')
      return money(sum)
    }
  }

  return `${rows.length} registros`
}

function buildExportContent(columns: string[], rows: TableRow[], format: 'csv' | 'excel', summaryRows: string[][] = []) {
  const escapedRows = rows.map((row) => columns.map((column) => escapeCell(formatCell(row[column]))))
  const output = [columns.map((column) => escapeCell(column)), ...escapedRows]

  if (summaryRows.length > 0) {
    output.push([])
    output.push(['Resumen financiero', ''])
    summaryRows.forEach((summaryRow) => output.push(summaryRow.map((cell) => escapeCell(cell))))
  }

  const rowText = output.map((line) => line.join(format === 'excel' ? '\t' : ',')).join('\n')
  return rowText
}

function escapeCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function formatCell(value: string | number | boolean | null) {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return String(value)
}
