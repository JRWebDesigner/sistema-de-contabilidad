'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'

type AuditEntry = {
  id: string
  userName: string
  userEmail: string | null
  action: string
  moduleName: string
  entity: string
  entityId: string | null
  details: string
  createdAt: string
}

export default function AuditModule() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/audit')
      if (!response.ok) throw new Error('No autorizado')
      const data = await response.json()
      setEntries(Array.isArray(data) ? data : [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Seguridad</p>
          <h1>Auditoría</h1>
          <p className="muted">Historial de acciones del equipo, cambios, accesos y movimientos críticos.</p>
        </div>
      </div>

      <article className="panel module-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Módulo</th>
                <th>Entidad</th>
                <th>Detalle</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="database-loading">Cargando auditoría...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6}>No hay registros de auditoría todavía.</td></tr>
              ) : entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <div className="product-cell">
                      <span className="product-thumb"><ShieldCheck size={16} /></span>
                      <div>
                        <strong>{entry.userName}</strong>
                        <small>{entry.userEmail ?? 'Sistema'}</small>
                      </div>
                    </div>
                  </td>
                  <td><span className="status success"><i />{entry.action}</span></td>
                  <td>{entry.moduleName}</td>
                  <td>{entry.entity}{entry.entityId ? ` #${entry.entityId}` : ''}</td>
                  <td>{entry.details}</td>
                  <td>{new Date(entry.createdAt).toLocaleString('es-BO')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  )
}
