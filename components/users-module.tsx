'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Building2, Plus, UserRound } from 'lucide-react'
import Modal from './ui/modal'

type Branch = { id: string; name: string; code: string }
type User = {
  id: string
  name: string
  alias: string
  email: string
  role: string
  branchId: string | null
  branch?: { name: string; code: string } | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrador',
  SALES: 'Ventas',
  INVENTORY: 'Inventario',
  ACCOUNTING: 'Contabilidad',
  VIEWER: 'Solo lectura',
}

export default function UsersModule() {
  const [users, setUsers] = useState<User[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false)
  const [isSubmittingUser, setIsSubmittingUser] = useState(false)
  const [isSubmittingBranch, setIsSubmittingBranch] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ name: '', alias: '', email: '', password: '', role: 'VIEWER', branchId: '' })
  const [branchForm, setBranchForm] = useState({ name: '', code: '', address: '', phone: '' })

  async function load() {
    const [response, branchResponse] = await Promise.all([fetch('/api/users'), fetch('/api/branches')])
    if (response.ok) setUsers(await response.json())
    else setMessage('No tienes permisos para administrar usuarios.')
    if (branchResponse.ok) {
      const data = await branchResponse.json()
      setBranches(data.branches ?? [])
    }
  }

  useEffect(() => { void load() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmittingUser(true)
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error ?? 'No se pudo crear el usuario.')
        return
      }
      setMessage('Usuario creado correctamente.')
      setForm({ name: '', alias: '', email: '', password: '', role: 'VIEWER', branchId: '' })
      setIsUserModalOpen(false)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo conectar con el servidor.')
    } finally {
      setIsSubmittingUser(false)
    }
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmittingBranch(true)
    try {
      const response = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...branchForm }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error ?? 'No se pudo crear la sucursal.')
        return
      }
      setMessage(`Sucursal ${data.name} creada. Ya puedes asignar usuarios y registrar sus existencias.`)
      setBranchForm({ name: '', code: '', address: '', phone: '' })
      setIsBranchModalOpen(false)
      window.dispatchEvent(new Event('superlab-branches-changed'))
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo conectar con el servidor.')
    } finally {
      setIsSubmittingBranch(false)
    }
  }

  async function assignBranch(user: User, branchId: string) {
    const response = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, branchId: branchId || null }),
    })
    const data = await response.json()
    setMessage(response.ok
      ? user.role === 'ADMIN' ? 'Sucursal predeterminada del administrador actualizada.' : 'Sucursal del usuario actualizada.'
      : data.error)
    if (response.ok) {
      window.dispatchEvent(new Event('superlab-branches-changed'))
      await load()
    }
  }

  async function toggle(user: User) {
    const response = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
    })
    const data = await response.json()
    setMessage(response.ok ? 'Estado actualizado.' : data.error)
    if (response.ok) await load()
  }

  return <div className="dashboard-content">
    <div className="page-heading">
      <div>
        <p className="eyebrow">Administración</p>
        <h1>Usuarios y sucursales</h1>
        <p className="muted">Asigna sucursales operativas y define la sucursal predeterminada de cada administrador.</p>
      </div>
      <button className="primary-button" type="button" onClick={() => { setMessage(''); setIsUserModalOpen(true) }}>
        <Plus size={17} /> Nuevo usuario
      </button>
    </div>
    {message && !isUserModalOpen && !isBranchModalOpen && <p className="module-message">{message}</p>}

    <section className="panel users-branches-panel">
      <div className="panel-header">
        <div>
          <h2>Sucursales</h2>
          <p>Administra las ubicaciones de la empresa y asigna usuarios a cada una.</p>
        </div>
        <button className="outline-button" type="button" onClick={() => { setMessage(''); setIsBranchModalOpen(true) }}>
          <Building2 size={16} /> Nueva sucursal
        </button>
      </div>
      <p className="users-branch-hint">Una sucursal nueva empieza sin existencias. El inventario actual se conserva como “Sin sucursal” hasta transferirlo.</p>
      {branches.length > 0 ? (
        <div className="users-branch-list">
          {branches.map((branch) => (
            <div className="users-branch-card" key={branch.id}>
              <span className="users-branch-icon"><Building2 size={17} /></span>
              <span><strong>{branch.name}</strong><small>Código: {branch.code}</small></span>
            </div>
          ))}
        </div>
      ) : <p className="muted">Todavía no hay sucursales registradas.</p>}
    </section>

    <Modal
      open={isBranchModalOpen}
      onClose={() => setIsBranchModalOpen(false)}
      page="Administración · Sucursales"
      title="Crear sucursal"
      description="Registra una ubicación de la empresa. Luego podrás asignarle usuarios y existencias."
      className="users-management-modal"
    >
      <form className="users-management-form" onSubmit={createBranch}>
        {message && <p className="module-message" role="alert">{message}</p>}
        <section className="users-form-section">
          <h3>Datos de la sucursal</h3>
          <p>El nombre y el código ayudan a identificar esta ubicación en las operaciones.</p>
          <div className="users-form-grid">
            <label>
              <span>Nombre de la sucursal <b>*</b></span>
              <input required minLength={2} maxLength={120} value={branchForm.name} onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })} placeholder="Ej. Sucursal Central" />
            </label>
            <label>
              <span>Código corto <b>*</b></span>
              <input required minLength={2} maxLength={20} pattern="[A-Za-z0-9_-]+" value={branchForm.code} onChange={(event) => setBranchForm({ ...branchForm, code: event.target.value.toUpperCase() })} placeholder="Ej. CENTRAL" />
              <small>Solo letras, números, guion y guion bajo.</small>
            </label>
            <label>
              <span>Dirección <small>(opcional)</small></span>
              <input maxLength={240} value={branchForm.address} onChange={(event) => setBranchForm({ ...branchForm, address: event.target.value })} placeholder="Calle, número, ciudad" />
            </label>
            <label>
              <span>Teléfono <small>(opcional)</small></span>
              <input maxLength={40} type="tel" value={branchForm.phone} onChange={(event) => setBranchForm({ ...branchForm, phone: event.target.value })} placeholder="Número de contacto" />
            </label>
          </div>
        </section>
        <div className="users-form-actions">
          <button className="outline-button" type="button" onClick={() => setIsBranchModalOpen(false)}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={isSubmittingBranch}>
            <Plus size={15} /> {isSubmittingBranch ? 'Creando sucursal…' : 'Crear sucursal'}
          </button>
        </div>
      </form>
    </Modal>

    <Modal
      open={isUserModalOpen}
      onClose={() => setIsUserModalOpen(false)}
      page="Administración · Usuarios y roles"
      title="Crear usuario"
      description="Crea el acceso, define el rol y asígnalo a una sucursal."
      className="users-management-modal"
    >
      <form className="users-management-form" onSubmit={submit}>
        {message && <p className="module-message" role="alert">{message}</p>}
        <section className="users-form-section">
          <h3>Información de la cuenta</h3>
          <p>Estos datos identifican al usuario y le permiten ingresar al sistema.</p>
          <div className="users-form-grid">
            <label>
              <span>Nombre completo <b>*</b></span>
              <input required maxLength={120} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre y apellido" />
            </label>
            <label>
              <span>Alias para ingresar <b>*</b></span>
              <input required minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]+" autoComplete="username" value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="Ej. fernando" />
              <small>Sin espacios; puedes usar punto, guion o guion bajo.</small>
            </label>
            <label>
              <span>Correo electrónico <b>*</b></span>
              <input required type="email" maxLength={160} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="nombre@empresa.com" />
            </label>
            <label>
              <span>Contraseña temporal <b>*</b></span>
              <input required minLength={8} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 8 caracteres" />
              <small>Compártela de forma segura con el usuario.</small>
            </label>
          </div>
        </section>
        <section className="users-form-section">
          <h3>Permisos y sucursal</h3>
          <p>El rol determina qué secciones puede usar. La sucursal limita sus operaciones a esa ubicación.</p>
          <div className="users-form-grid">
            <label>
              <span>Rol del usuario <b>*</b></span>
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <small>{form.role === 'ADMIN' ? 'El administrador tiene acceso a todo el sistema.' : form.role === 'VIEWER' ? 'Puede consultar información, pero no realizar cambios.' : `El usuario tendrá permisos del área de ${roleLabels[form.role]?.toLocaleLowerCase() ?? 'su rol'}.`}</small>
            </label>
            <label>
              <span>{form.role === 'ADMIN' ? 'Sucursal predeterminada' : 'Sucursal asignada'}{form.role !== 'ADMIN' && <b> *</b>}</span>
              <select required={form.role !== 'ADMIN'} value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>
                <option value="">{form.role === 'ADMIN' ? 'Todas las sucursales (global)' : 'Selecciona una sucursal'}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
              </select>
              {branches.length === 0 && form.role !== 'ADMIN' && <small>Primero crea una sucursal para poder asignar este usuario.</small>}
            </label>
          </div>
        </section>
        <div className="users-form-actions">
          <button className="outline-button" type="button" onClick={() => setIsUserModalOpen(false)}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={isSubmittingUser || (form.role !== 'ADMIN' && branches.length === 0)}>
            <Plus size={15} /> {isSubmittingUser ? 'Creando usuario…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>

    <article className="panel module-table">
      <div className="table-scroll">
        <table>
          <thead><tr><th>Usuario</th><th>Alias</th><th>Correo</th><th>Rol</th><th>Sucursal</th><th>Se unió</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {users.map((user) => <tr key={user.id}>
              <td><div className="product-cell"><span className="product-thumb"><UserRound size={16} /></span><strong>{user.name}</strong></div></td>
              <td>{user.alias}</td>
              <td>{user.email}</td>
              <td>{roleLabels[user.role] ?? user.role}</td>
              <td><select aria-label={`${user.role === 'ADMIN' ? 'Sucursal predeterminada' : 'Sucursal'} de ${user.name}`} value={user.branchId ?? ''} onChange={(event) => void assignBranch(user, event.target.value)}><option value="">{user.role === 'ADMIN' ? 'Global' : 'Sin asignar'}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></td>
              <td>{new Date(user.createdAt).toLocaleString('es-BO')}</td>
              <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('es-BO') : 'Nunca'}</td>
              <td><span className={`status ${user.isActive ? 'success' : 'warning'}`}><i />{user.isActive ? 'Activo' : 'Inactivo'}</span></td>
              <td><button className="outline-button" type="button" onClick={() => void toggle(user)}>{user.isActive ? 'Desactivar' : 'Activar'}</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </article>
  </div>
}
