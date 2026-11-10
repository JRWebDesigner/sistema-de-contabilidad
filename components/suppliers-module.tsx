'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, Truck } from 'lucide-react'

import Modal from './ui/modal'
import AccountStatementModal from './account-statement-modal'
import { usePermission } from './permissions-context'

type Supplier = {
  id: string
  document: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  contactName: string | null
  contactPhone: string | null
  city: string | null
  paymentTerms: string | null
  estimatedDeliveryDays: number | null
  observations: string | null
}

type SupplierForm = {
  document: string
  name: string
  email: string
  phone: string
  address: string
  contactName: string
  contactPhone: string
  city: string
  paymentTerms: string
  estimatedDeliveryDays: string
  observations: string
}

const emptyForm: SupplierForm = {
  document: '',
  name: '',
  email: '',
  phone: '',
  address: '',
  contactName: '',
  contactPhone: '',
  city: '',
  paymentTerms: '',
  estimatedDeliveryDays: '',
  observations: '',
}

export default function SuppliersModule() {
  const canWrite = usePermission('contacts:write')
  const canAdmin = usePermission('users:manage')
  const canReadFinance = usePermission('finance:read')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SupplierForm>(emptyForm)
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null)
  async function load() { const response = await fetch('/api/suppliers'); if (response.ok) setSuppliers(await response.json()) }
  useEffect(() => { void load() }, [])
  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id)
    setForm({
      document: supplier.document,
      name: supplier.name,
      email: supplier.email ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address ?? '',
      contactName: supplier.contactName ?? '',
      contactPhone: supplier.contactPhone ?? '',
      city: supplier.city ?? '',
      paymentTerms: supplier.paymentTerms ?? '',
      estimatedDeliveryDays: supplier.estimatedDeliveryDays?.toString() ?? '',
      observations: supplier.observations ?? '',
    })
    setOpen(true)
    setMessage('')
  }
  function startCreate() { setEditingId(null); setForm({ ...emptyForm }); setOpen(true); setMessage('') }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch(editingId ? `/api/suppliers?id=${encodeURIComponent(editingId)}` : '/api/suppliers', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        estimatedDeliveryDays: form.estimatedDeliveryDays === '' ? null : Number(form.estimatedDeliveryDays),
      }),
    })
    const data = await response.json()
    setMessage(response.ok ? (editingId ? 'Proveedor actualizado.' : 'Proveedor guardado.') : data.error)
    if (response.ok) { setForm({ ...emptyForm }); setEditingId(null); setOpen(false); await load() }
  }
  async function remove(id: string) {
    const confirmed = window.confirm('¿Deseas eliminar este proveedor?')
    if (!confirmed) return
    const response = await fetch(`/api/suppliers?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    setMessage(response.ok ? `Proveedor eliminado: ${data.name ?? 'ok'}` : data.error ?? 'No se pudo eliminar el proveedor.')
    if (response.ok) await load()
  }
  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div><p className="eyebrow">Contactos · Bolivia</p><h1>Proveedores</h1><p className="muted">Directorio de proveedores identificados por NIT.</p></div>
        {canWrite && <button className="primary-button" onClick={startCreate}><Plus size={17} /> Nuevo proveedor</button>}
      </div>
      {message && <p className="module-message">{message}</p>}
      <Modal open={open} onClose={() => { setOpen(false); setEditingId(null) }} page="Contactos · Bolivia" title={editingId ? 'Editar proveedor' : 'Nuevo proveedor'} description="Registra los datos de contacto y las condiciones habituales de suministro." className="supplier-modal">
        <form className="product-form" onSubmit={submit}>
          <div className="product-form-grid">
            <label>NIT<input required value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} /></label>
            <label>Razón social<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Correo<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Teléfono<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
            <label>Dirección<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
            <label>Ciudad<input maxLength={100} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
            <label>Persona de contacto<input maxLength={180} value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label>
            <label>Celular / WhatsApp de contacto<input maxLength={30} value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} /></label>
            <label>Condiciones de pago habituales<input maxLength={250} value={form.paymentTerms} onChange={(event) => setForm({ ...form, paymentTerms: event.target.value })} placeholder="Ej. 30 días, transferencia" /></label>
            <label>Plazo estimado de entrega (días)<input type="number" min="0" max="3650" step="1" value={form.estimatedDeliveryDays} onChange={(event) => setForm({ ...form, estimatedDeliveryDays: event.target.value })} /></label>
            <label className="supplier-observations">Observaciones<textarea maxLength={500} value={form.observations} onChange={(event) => setForm({ ...form, observations: event.target.value })} /></label>
          </div>
          <button className="primary-button" type="submit">{editingId ? 'Guardar cambios' : 'Guardar proveedor'}</button>
        </form>
      </Modal>
      <article className="panel module-table">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Proveedor</th><th>NIT</th><th>Contacto</th><th>Correo</th><th>Teléfono</th><th>Ciudad</th><th>Pago / entrega</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>{suppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td>
                  <div className="product-cell">
                    <span className="product-thumb"><Truck size={16} /></span>
                    <div className="supplier-name-cell">
                      <strong>{supplier.name}</strong>
                      {supplier.observations && <small className="table-secondary-text">{supplier.observations}</small>}
                    </div>
                  </div>
                </td>
                <td>{supplier.document}</td>
                <td>{supplier.contactName || '—'}{supplier.contactPhone && <small className="table-secondary-text">{supplier.contactPhone}</small>}</td>
                <td>{supplier.email || 'Sin correo'}</td>
                <td>{supplier.phone || 'Sin teléfono'}</td>
                <td>{supplier.city || '—'}</td>
                <td>{supplier.paymentTerms || '—'}{supplier.estimatedDeliveryDays !== null && <small className="table-secondary-text">{supplier.estimatedDeliveryDays} días de entrega</small>}</td>
                <td><span className="status success"><i />Activo</span></td>
                <td>
                  {canWrite && <button className="outline-button" onClick={() => startEdit(supplier)}><Pencil size={14} /> Editar</button>}
                  {canReadFinance && <button className="outline-button" onClick={() => setStatementSupplier(supplier)}>Estado de cuenta</button>}
                  {canAdmin && <button className="outline-button" onClick={() => void remove(supplier.id)}><Trash2 size={14} /> Desactivar</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </article>
      {canReadFinance && statementSupplier && (
        <AccountStatementModal
          open={statementSupplier !== null}
          onClose={() => setStatementSupplier(null)}
          partyType="supplier"
          partyId={statementSupplier.id}
        />
      )}
    </div>
  )
}
