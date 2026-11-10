'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Download, Eye, FileText, Plus, Trash2 } from 'lucide-react'

import Modal from './ui/modal'
import { usePermission } from './permissions-context'
import { downloadProformaPdf, previewProformaPdf, type ProformaPdfData } from './proformas/proforma-pdf'

type Product = {
  id: string
  name: string
  sku: string
  price: string
  currentStock: number
  type: 'PRODUCT' | 'SERVICE'
  serviceBillingPeriod: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL' | null
  catalogPrice?: string
  promotionDiscountPercent?: number
  promotionName?: string | null
}
type Customer = { id: string; name: string; document: string }
type CashAccount = { id: string; name: string; type: 'CASH' | 'BANK' | 'POS'; balance: string; custodianId?: string | null }
type ProformaRecord = {
  id: string
  number: string
  status: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'
  subtotal: string | number
  discountTotal: string | number
  total: string | number
  validUntil: string
  createdAt: string
  sales?: Array<{ id: string; number: string }>
  notes?: string | null
  customer?: { name?: string | null; document?: string | null } | null
  items?: Array<{ id: string; quantity: number; unitPrice: string | number; discountPercent: string | number; lineTotal: string | number; product?: { name?: string; sku?: string; serviceBillingPeriod?: Product['serviceBillingPeriod'] } | null }>
}

type ProformaLine = {
  id: string
  name: string
  sku: string
  type: Product['type']
  serviceBillingPeriod: Product['serviceBillingPeriod']
  currentStock: number
  quantity: number
  unitPrice: number
  discountPercent: number
  promotionDiscountPercent: number
  promotionName: string | null
}

const money = new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const lineDiscount = (amount: number, discountPercent: number) => roundMoney(amount * discountPercent / 100)

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { error: 'La respuesta del servidor no es válida.' }
  }
}

export default function ProformasModule() {
  const canWrite = usePermission('sales:write')
  const canDiscount = usePermission('sales:discount')
  const [products, setProducts] = useState<Product[]>([])
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [lines, setLines] = useState<ProformaLine[]>([])
  const [customerId, setCustomerId] = useState('')
  const [productId, setProductId] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [proformas, setProformas] = useState<ProformaRecord[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [pendingAcceptId, setPendingAcceptId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CARD' | 'QR' | 'CREDIT'>('CASH')
  const [pendingPaymentAmount, setPendingPaymentAmount] = useState('0')
  const [pendingPaymentReference, setPendingPaymentReference] = useState('')
  const [pendingCashAccountId, setPendingCashAccountId] = useState('')
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingError, setPricingError] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const selectableCashAccounts = useMemo(() => {
    if (pendingPaymentMethod === 'BANK_TRANSFER' || pendingPaymentMethod === 'QR') {
      return cashAccounts.filter((account) => account.type === 'BANK' && !account.custodianId)
    }
    if (pendingPaymentMethod === 'CARD') {
      return cashAccounts.filter((account) => account.type === 'POS' && !account.custodianId)
    }
    return []
  }, [cashAccounts, pendingPaymentMethod])

  const loadProformas = async () => {
    const response = await fetch('/api/proformas')
    const data = await parseJsonResponse(response)

    if (!response.ok) {
      setProformas([])
      if (response.status === 401 || response.status === 403) {
        setMessage('Sesión requerida. Inicia sesión para gestionar proformas.')
      }
      return
    }

    setProformas(Array.isArray(data) ? data : [])
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/products').then((response) => response.json()),
      fetch('/api/customers').then((response) => response.json()),
      fetch('/api/cash').then((response) => response.json()),
    ]).then(([productData, customerData, accountsData]) => {
      const catalog = productData
        .map((product: Product) => ({ ...product, catalogPrice: product.price }))
      setCatalogProducts(catalog)
      setProducts(catalog)
      setCustomers(customerData)
      setCashAccounts(Array.isArray(accountsData) ? accountsData : [])
    })

    void loadProformas()
  }, [])

  useEffect(() => {
    if (pendingPaymentMethod === 'CASH' || pendingPaymentMethod === 'CREDIT') {
      setPendingCashAccountId('')
      return
    }
    setPendingCashAccountId((current) =>
      selectableCashAccounts.some((account) => account.id === current)
        ? current
        : selectableCashAccounts[0]?.id ?? '',
    )
  }, [pendingPaymentMethod, selectableCashAccounts])
  const pendingAcceptProforma = proformas.find((proforma) => proforma.id === pendingAcceptId) ?? null
  const pendingProformaTotal = Number(pendingAcceptProforma?.total ?? 0)
  const pendingPayment = Number(pendingPaymentAmount)
  const pendingBalance = Math.max(0, pendingProformaTotal - (Number.isFinite(pendingPayment) ? pendingPayment : 0))

  useEffect(() => {
    if (!catalogProducts.length) return
    const controller = new AbortController()
    const query = customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''
    setPricingLoading(true)
    setPricingError('')
    fetch(`/api/sales/pricing${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !Array.isArray(data)) throw new Error(data.error ?? 'No se pudieron calcular los precios.')
        const prices = new Map<string, { price: string; promotionDiscountPercent: number; promotionName: string | null }>(
          data.map((item: { id: string; price: string; promotionDiscountPercent: number; promotionName: string | null }) => [item.id, item]),
        )
        const pricedProducts = catalogProducts.map((product) => {
          const effective = prices.get(product.id)
          return {
            ...product,
            price: effective?.price ?? product.catalogPrice ?? product.price,
            promotionDiscountPercent: effective?.promotionDiscountPercent ?? 0,
            promotionName: effective?.promotionName ?? null,
          }
        })
        setProducts(pricedProducts)
        setLines((current) => current.map((line) => {
          const latest = pricedProducts.find((product) => product.id === line.id)
          return latest ? {
            ...line,
            unitPrice: Number(latest.price),
            promotionDiscountPercent: latest.promotionDiscountPercent ?? 0,
            promotionName: latest.promotionName ?? null,
          } : line
        }))
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const message = error instanceof Error ? error.message : 'No se pudieron calcular los precios.'
        setPricingError(message)
        setMessage(message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false)
      })
    return () => controller.abort()
  }, [catalogProducts, customerId])

  const subtotal = useMemo(
    () => roundMoney(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)),
    [lines],
  )
  const discountTotal = useMemo(
    () => roundMoney(lines.reduce((sum, line) =>
      sum + lineDiscount(line.quantity * line.unitPrice, Math.max(line.discountPercent, line.promotionDiscountPercent)), 0)),
    [lines],
  )
  const total = Math.round((subtotal - discountTotal + Number.EPSILON) * 100) / 100

  function addLine() {
    const product = products.find((item) => item.id === productId)
    const qty = Number(quantity)
    if (!product || !Number.isFinite(qty) || qty < 1) {
      setMessage('Selecciona un producto o servicio válido y una cantidad mayor a 0.')
      return
    }

    setLines((current) => {
      const existing = current.find((line) => line.id === product.id)
      const requestedQuantity = existing ? existing.quantity + qty : qty
      if (existing) {
        return current.map((line) =>
          line.id === product.id
            ? { ...line, quantity: requestedQuantity }
            : line,
        )
      }

      return [...current, {
        id: product.id,
        name: product.name,
        sku: product.sku,
        type: product.type,
        serviceBillingPeriod: product.serviceBillingPeriod,
        currentStock: product.currentStock,
        quantity: requestedQuantity,
        unitPrice: Number(product.price),
        discountPercent: 0,
        promotionDiscountPercent: product.promotionDiscountPercent ?? 0,
        promotionName: product.promotionName ?? null,
      }]
    })

    setProductId('')
    setProductQuery('')
    setQuantity('1')
    setMessage('')
  }

  function removeLine(productIdToRemove: string) {
    setLines((current) => current.filter((line) => line.id !== productIdToRemove))
  }

  function changeDiscount(productIdToUpdate: string, value: number) {
    const discountPercent = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
    setLines((current) => current.map((line) =>
      line.id === productIdToUpdate ? { ...line, discountPercent } : line,
    ))
  }

  async function processProformaPdf(proforma: ProformaPdfData, action: 'preview' | 'download') {
    setExportingPdf(true)
    setMessage('')
    try {
      if (action === 'preview') {
        await previewProformaPdf(proforma)
      } else {
        await downloadProformaPdf(proforma)
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No se pudo generar el PDF de la proforma.')
    } finally {
      setExportingPdf(false)
    }
  }

  async function exportCurrentProforma(action: 'preview' | 'download') {
    if (lines.length === 0) {
      setMessage('Agrega productos o servicios para generar la proforma.')
      return
    }

    const customer = customers.find((item) => item.id === customerId)
    await processProformaPdf({
      number: 'BORRADOR',
      createdAt: new Date().toISOString(),
      customerName: customer?.name ?? 'Consumidor final',
      customerDocument: customer?.document ?? '',
      notes: notes || 'Sin observaciones',
      items: lines.map((line) => {
        const discountPercent = Math.max(line.discountPercent, line.promotionDiscountPercent)
        const grossAmount = line.quantity * line.unitPrice
        return {
          name: line.name,
          sku: line.sku,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent,
          lineTotal: grossAmount - lineDiscount(grossAmount, discountPercent),
        }
      }),
      subtotal,
      discountTotal,
      total,
    }, action)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (lines.length === 0) {
      setMessage('Agrega al menos un producto o servicio a la proforma.')
      return
    }
    if (pricingLoading || pricingError) {
      setMessage(pricingError || 'Espera a que termine el cálculo de precios.')
      return
    }

    const response = await fetch('/api/proformas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: customerId || undefined,
        notes: notes ? `${notes} · Proforma` : 'Proforma',
        items: lines.map((line) => ({
          productId: line.id,
          quantity: line.quantity,
          discountPercent: line.discountPercent,
        })),
      }),
    })

    const data = await parseJsonResponse(response)

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setMessage('Sesión requerida. Inicia sesión nuevamente para crear proformas.')
        return
      }
      setMessage(data.error ?? 'No se pudo guardar la proforma.')
      return
    }

    setLines([])
    setCustomerId('')
    setNotes('')
    setIsFormOpen(false)
    await loadProformas()
    setMessage(`Proforma ${data.number ?? 'registrada'} creada correctamente. Total estimado: ${money.format(Number(data.total ?? total))}`)
  }

  async function exportProforma(proforma: ProformaRecord, action: 'preview' | 'download') {
    await processProformaPdf({
      number: proforma.number,
      createdAt: proforma.createdAt,
      validUntil: proforma.validUntil,
      customerName: proforma.customer?.name ?? 'Consumidor final',
      customerDocument: proforma.customer?.document ?? '',
      saleNumber: proforma.sales?.map((sale) => sale.number).join(', '),
      notes: proforma.notes ?? 'Sin observaciones',
      items: (proforma.items ?? []).map((item) => ({
        name: `${item.product?.name ?? 'Producto'}${item.product?.serviceBillingPeriod === 'MONTHLY' ? ' · Servicio mensual' : item.product?.serviceBillingPeriod === 'ANNUAL' ? ' · Servicio anual' : ''}`,
        sku: item.product?.sku ?? '',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice ?? 0),
        discountPercent: Number(item.discountPercent ?? 0),
        lineTotal: Number(item.lineTotal ?? 0),
      })),
      subtotal: Number(proforma.subtotal ?? 0),
      discountTotal: Number(proforma.discountTotal ?? 0),
      total: Number(proforma.total ?? 0),
    }, action)
  }

  async function handleProformaDecision(proformaId: string, action: 'accept' | 'reject') {
    setMessage('')
    setIsSubmittingDecision(true)
    try {
      const response = await fetch('/api/proformas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proformaId,
          action,
          ...(action === 'accept' ? {
            paymentMethod: pendingPaymentMethod,
            paymentAmount: pendingPayment,
            paymentReference: pendingPaymentReference.trim() || undefined,
            cashAccountId: pendingCashAccountId || undefined,
          } : {}),
        }),
      })

      const data = await parseJsonResponse(response)
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setMessage('Sesión requerida para aceptar o rechazar proformas.')
        } else {
          setMessage(data.error ?? 'No se pudo actualizar la proforma.')
        }
        return
      }

      setPendingAcceptId(null)
      await loadProformas()
      setMessage(action === 'accept'
        ? 'La proforma fue aceptada; se generaron las ventas, se registró el abono y el saldo quedó en cuentas por cobrar.'
        : 'La proforma fue rechazada.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo conectar con el servidor.')
    } finally {
      setIsSubmittingDecision(false)
    }
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Cotizaciones · Bolivia</p>
          <h1>Proformas</h1>
          <p className="muted">Cotiza productos y servicios, incluidos los servicios mensuales y anuales.</p>
        </div>
        <div className="heading-actions"><span className="currency-note">Moneda: Bs</span>{canWrite && <button className="primary-button" type="button" onClick={() => { setMessage(''); setIsFormOpen(true) }}><Plus size={17} /> Nueva proforma</button>}</div>
      </div>

      {message && !isFormOpen && !pendingAcceptId && <p className="module-message">{message}</p>}

      {canWrite && (
        <Modal
          open={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          page="Cotizaciones · Bolivia"
          title="Nueva proforma"
          description="Prepara la cotización para el cliente y revisa sus productos, servicios y precios."
          className="sale-modal"
        >
          <form className="sale-form" onSubmit={handleSubmit}>
            <div className="sale-note-sheet">
              <header className="sale-note-editor-header">
                <div className="sale-note-editor-brand">
                  <strong>Businessman <span>S.R.L.</span></strong>
                  <small>Cotización de productos y servicios</small>
                </div>
                <div className="sale-note-editor-document">
                  <span>Documento comercial</span>
                  <strong>PROFORMA</strong>
                  <small>Borrador · Se asignará número al guardar</small>
                </div>
              </header>
              {message && <p className="module-message" role="alert">{message}</p>}

              <section className="sale-section">
                <h3 className="sale-section-title"><span>01</span> Datos de la cotización</h3>
                <div className="sale-note-fields">
                  <label>
                    <span>Cliente</span>
                    <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                      <option value="">Consumidor final</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.name} · {customer.document}</option>
                      ))}
                    </select>
                  </label>
                  <div className="sale-note-info-cell">
                    <span>Fecha de emisión</span>
                    <strong>{new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeZone: 'America/La_Paz' }).format(new Date())}</strong>
                  </div>
                  <div className="sale-note-info-cell">
                    <span>Moneda</span>
                    <strong>Bolivianos (Bs)</strong>
                  </div>
                </div>
              </section>

              <section className="sale-section">
                <h3 className="sale-section-title"><span>02</span> Detalle de productos y servicios</h3>
                <div className="sale-note-fields proforma-note-item-entry">
                  <label>
                    <span>Buscar por nombre o código</span>
                    <input
                      type="search"
                      value={productQuery}
                      onChange={(event) => setProductQuery(event.target.value)}
                      placeholder="Escribe nombre o código"
                    />
                  </label>
                  <label>
                    <span>Producto o servicio</span>
                    <select value={productId} onChange={(event) => setProductId(event.target.value)}>
                      <option value="">Selecciona un producto o servicio</option>
                      {products.filter((product) => {
                        const search = productQuery.trim().toLocaleLowerCase()
                        return !search || product.name.toLocaleLowerCase().includes(search) || product.sku.toLocaleLowerCase().includes(search)
                      }).map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} · {product.name} · {money.format(Number(product.price))}
                          {product.type === 'SERVICE'
                            ? ` · Servicio${product.serviceBillingPeriod === 'MONTHLY' ? ' mensual' : product.serviceBillingPeriod === 'ANNUAL' ? ' anual' : ''}`
                            : ` · stock ${product.currentStock}`}
                          {product.promotionName ? ` · ${product.promotionName} (-${product.promotionDiscountPercent}%)` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Cantidad</span>
                    <input min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                  </label>
                  <button className="outline-button" type="button" onClick={addLine}>
                    <Plus size={15} /> Agregar a la proforma
                  </button>
                </div>

                <div className="sale-note-table-wrap">
                  <table className="sale-note-table">
                    <thead>
                      <tr>
                        <th>Producto / servicio</th>
                        <th>Cantidad</th>
                        <th>Precio unitario</th>
                        <th>Desc. %</th>
                        <th>Importe</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 ? (
                        <tr><td className="sale-note-empty" colSpan={6}>Agrega productos o servicios para preparar la proforma.</td></tr>
                      ) : lines.map((line) => {
                        const discount = Math.max(line.discountPercent, line.promotionDiscountPercent)
                        const grossAmount = line.quantity * line.unitPrice
                        return (
                          <tr key={line.id}>
                            <td className="sale-note-item">
                              <strong>{line.name}</strong>
                              <small>
                                {line.sku}
                                {line.type === 'SERVICE'
                                  ? ` · ${line.serviceBillingPeriod === 'MONTHLY' ? 'Servicio mensual' : line.serviceBillingPeriod === 'ANNUAL' ? 'Servicio anual' : 'Servicio'}`
                                  : ` · Stock ${line.currentStock}`}
                              </small>
                              {line.promotionName && <small>{line.promotionName} · -{line.promotionDiscountPercent}%</small>}
                            </td>
                            <td>{line.quantity}</td>
                            <td className="sale-note-number">{money.format(line.unitPrice)}</td>
                            <td>{canDiscount ? (
                              <input
                                className="sale-note-discount"
                                aria-label={`Descuento para ${line.name}`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={line.discountPercent}
                                onChange={(event) => changeDiscount(line.id, Number(event.target.value))}
                              />
                            ) : `${discount}%`}</td>
                            <td className="sale-note-number">{money.format(grossAmount - lineDiscount(grossAmount, discount))}</td>
                            <td>
                              <button className="row-menu" type="button" aria-label={`Eliminar ${line.name}`} onClick={() => removeLine(line.id)}>
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="sale-note-item-count">{lines.length} {lines.length === 1 ? 'ítem' : 'ítems'} en la proforma</p>
              </section>

              <section className="sale-section sale-note-observations">
                <h3 className="sale-section-title"><span>03</span> Observaciones</h3>
                <label>
                  <span>Condiciones o información adicional</span>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional" />
                </label>
              </section>

              <footer className="sale-note-totals">
                <div className="sale-note-total-lines">
                  <div><span>Subtotal</span><strong>{money.format(subtotal)}</strong></div>
                  {discountTotal > 0 && <div><span>Descuentos</span><strong>-{money.format(discountTotal)}</strong></div>}
                  <div className="sale-note-total-due"><span>Total de la proforma</span><strong>{money.format(total)}</strong></div>
                </div>
                <div className="modal-actions">
                  <button
                    className="outline-button"
                    type="button"
                    disabled={exportingPdf || lines.length === 0}
                    onClick={() => void exportCurrentProforma('preview')}
                  >
                    <Eye size={15} /> {exportingPdf ? 'Preparando PDF…' : 'Ver PDF'}
                  </button>
                  <button
                    className="outline-button"
                    type="button"
                    disabled={exportingPdf || lines.length === 0}
                    onClick={() => void exportCurrentProforma('download')}
                  >
                    <Download size={15} /> Descargar PDF
                  </button>
                  <button className="primary-button" type="submit" disabled={pricingLoading || Boolean(pricingError) || lines.length === 0}>
                    <FileText size={15} /> Guardar proforma
                  </button>
                </div>
              </footer>
            </div>
          </form>
        </Modal>
      )}

      <Modal
        open={Boolean(pendingAcceptProforma)}
        onClose={() => {
          if (isSubmittingDecision) return
          setPendingAcceptId(null)
          setMessage('')
        }}
        page="Cotizaciones · Confirmar aceptación"
        title={`Aceptar proforma ${pendingAcceptProforma?.number ?? ''}`}
        description="Indica la forma de pago y cuánto abonará el cliente. El saldo pendiente se registrará en cuentas por cobrar."
        className="proforma-payment-modal"
      >
        {pendingAcceptProforma && (
          <form
            className="proforma-payment-form"
            onSubmit={(event) => {
              event.preventDefault()
              void handleProformaDecision(pendingAcceptProforma.id, 'accept')
            }}
          >
            <div className="proforma-payment-summary">
              <div><span>Cliente</span><strong>{pendingAcceptProforma.customer?.name ?? 'Consumidor final'}</strong></div>
              <div><span>Total de la proforma</span><strong>{money.format(pendingProformaTotal)}</strong></div>
            </div>

            <div className="proforma-payment-fields">
              <label>
                <span>Forma de pago <b>*</b></span>
                <select
                  value={pendingPaymentMethod}
                  onChange={(event) => {
                    const method = event.target.value as typeof pendingPaymentMethod
                    setPendingPaymentMethod(method)
                    if (method === 'CREDIT') setPendingPaymentAmount('0')
                    else if (pendingPaymentMethod === 'CREDIT') setPendingPaymentAmount(pendingProformaTotal.toFixed(2))
                    setMessage('')
                  }}
                >
                  <option value="CASH">Efectivo</option>
                  <option value="BANK_TRANSFER">Transferencia bancaria</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="QR">QR</option>
                  <option value="CREDIT">Crédito</option>
                </select>
              </label>
              <label>
                <span>Abono inicial (Bs) <b>*</b></span>
                <input
                  required
                  type="number"
                  min="0"
                  max={pendingProformaTotal}
                  step="0.01"
                  disabled={pendingPaymentMethod === 'CREDIT'}
                  value={pendingPaymentAmount}
                  onChange={(event) => {
                    setPendingPaymentAmount(event.target.value)
                    setMessage('')
                  }}
                />
                <small>
                  {pendingPaymentMethod === 'CREDIT'
                    ? 'Al elegir crédito, el total queda pendiente de cobro.'
                    : `Puedes abonar el total o una parte, hasta ${money.format(pendingProformaTotal)}.`}
                </small>
              </label>
              {pendingPaymentMethod !== 'CASH' && pendingPaymentMethod !== 'CREDIT' && pendingPayment > 0 && (
                <label>
                  <span>{pendingPaymentMethod === 'CARD' ? 'Cuenta POS' : 'Cuenta bancaria'} <b>*</b></span>
                  <select
                    required
                    value={pendingCashAccountId}
                    onChange={(event) => setPendingCashAccountId(event.target.value)}
                  >
                    <option value="">Selecciona la cuenta que recibió el pago</option>
                    {selectableCashAccounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                  {selectableCashAccounts.length === 0 && <small role="alert">No hay una cuenta activa disponible para esta forma de pago.</small>}
                </label>
              )}
              {(pendingPaymentMethod === 'BANK_TRANSFER' || pendingPaymentMethod === 'QR') && pendingPayment > 0 && (
                <label>
                  <span>Número de comprobante <b>*</b></span>
                  <input
                    required
                    maxLength={100}
                    value={pendingPaymentReference}
                    onChange={(event) => setPendingPaymentReference(event.target.value)}
                    placeholder="Ingresa el número del comprobante"
                  />
                </label>
              )}
            </div>

            <div className={`proforma-payment-balance${pendingBalance > 0 ? ' has-balance' : ''}`}>
              <span>{pendingBalance > 0 ? 'Saldo que quedará pendiente' : 'Saldo pendiente'}</span>
              <strong>{money.format(pendingBalance)}</strong>
            </div>
            {pendingPaymentMethod === 'CASH' && pendingPayment > 0 && (
              <p className="proforma-payment-hint">El efectivo se registrará bajo custodia del vendedor.</p>
            )}
            {pendingPaymentMethod === 'CREDIT' && (
              <p className="proforma-payment-hint">La aceptación a crédito requiere que el cliente tenga crédito habilitado y límite disponible.</p>
            )}
            {pendingBalance > 0 && !pendingAcceptProforma.customer && (
              <p className="proforma-payment-error" role="alert">Esta proforma no tiene un cliente asignado. Selecciona un cliente para registrar el saldo pendiente.</p>
            )}
            {message && <p className="proforma-payment-error" role="alert">{message}</p>}

            <div className="users-form-actions">
              <button
                type="button"
                className="outline-button"
                disabled={isSubmittingDecision}
                onClick={() => {
                  setPendingAcceptId(null)
                  setMessage('')
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={
                  isSubmittingDecision ||
                  !Number.isFinite(pendingPayment) ||
                  pendingPayment < 0 ||
                  pendingPayment > pendingProformaTotal ||
                  (pendingBalance > 0 && !pendingAcceptProforma.customer) ||
                  (pendingPaymentMethod !== 'CASH' && pendingPaymentMethod !== 'CREDIT' && pendingPayment > 0 && (!pendingCashAccountId || selectableCashAccounts.length === 0)) ||
                  ((pendingPaymentMethod === 'BANK_TRANSFER' || pendingPaymentMethod === 'QR') && pendingPayment > 0 && !pendingPaymentReference.trim())
                }
              >
                <FileText size={15} /> {isSubmittingDecision ? 'Procesando…' : 'Aceptar y registrar pago'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>Historial de proformas</h2>
            <p>Últimas cotizaciones realizadas</p>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Válida hasta</th>
                <th>Venta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {proformas.length === 0 ? (
                <tr>
                  <td colSpan={7}>Todavía no hay proformas registradas.</td>
                </tr>
              ) : (
                proformas.map((proforma) => (
                  <tr key={proforma.id}>
                    <td>{proforma.number}</td>
                    <td>{proforma.customer?.name ?? 'Consumidor final'}</td>
                    <td>{money.format(Number(proforma.total ?? 0))}</td>
                    <td>
                      <span className={`status ${proforma.status === 'REJECTED' || proforma.status === 'EXPIRED' ? 'warning' : 'success'}`}>
                        <i />{proforma.status === 'SENT' ? 'Enviada' : proforma.status === 'ACCEPTED' ? 'Aceptada' : proforma.status === 'EXPIRED' ? 'Vencida' : 'Rechazada'}
                      </span>
                    </td>
                    <td>{new Date(proforma.validUntil).toLocaleDateString('es-BO')}</td>
                    <td>{proforma.sales?.map((sale) => sale.number).join(', ') || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" className="outline-button" disabled={exportingPdf} onClick={() => void exportProforma(proforma, 'preview')}><Eye size={15} /> Ver</button>
                        <button type="button" className="outline-button" disabled={exportingPdf} onClick={() => void exportProforma(proforma, 'download')}><Download size={15} /> Descargar</button>
                        {canWrite && proforma.status === 'SENT' && (
                          <>
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => {
                                setPendingAcceptId(proforma.id)
                                setPendingPaymentMethod('CASH')
                                setPendingPaymentAmount(Number(proforma.total).toFixed(2))
                                setPendingPaymentReference('')
                                setPendingCashAccountId('')
                                setMessage('')
                              }}
                            >
                              Aceptar
                            </button>
                            <button type="button" className="outline-button" onClick={() => void handleProformaDecision(proforma.id, 'reject')}>Rechazar</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
