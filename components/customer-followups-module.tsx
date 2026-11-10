"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, RotateCcw, Search } from "lucide-react";

import { usePermission } from "./permissions-context";

type Customer = { id: string; name: string; document: string; isActive: boolean };
type FollowUp = {
  id: string;
  note: string;
  dueAt: string;
  status: "OPEN" | "COMPLETED";
  completedAt?: string | null;
  customer: { id: string; name: string; document: string };
};
type FollowUpView = "OPEN" | "COMPLETED";

function localDateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatFollowUpDate(value: string) {
  return new Intl.DateTimeFormat("es-BO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function CustomerFollowUpsModule() {
  const canWrite = usePermission("contacts:write");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingId, setIsUpdatingId] = useState("");
  const [view, setView] = useState<FollowUpView>("OPEN");
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState(Date.now());

  async function loadData(showLoading = true): Promise<boolean> {
    if (showLoading) setIsLoading(true);
    try {
      const [customersResponse, followUpsResponse] = await Promise.all([
        fetch("/api/customers"),
        fetch("/api/customers/follow-ups"),
      ]);
      const [customerData, followUpData] = await Promise.all([
        customersResponse.json(),
        followUpsResponse.json(),
      ]);
      if (!customersResponse.ok) throw new Error(customerData.error ?? "No se pudieron cargar los clientes.");
      if (!followUpsResponse.ok) throw new Error(followUpData.error ?? "No se pudieron cargar los seguimientos.");
      if (!Array.isArray(customerData) || !Array.isArray(followUpData)) throw new Error("La respuesta de seguimiento comercial no es válida.");
      setCustomers(customerData.filter((customer: Customer) => customer.isActive));
      setFollowUps(followUpData);
      if (showLoading) setMessage("");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los seguimientos.");
      setMessageKind("error");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const now = clock;
  const openFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.status === "OPEN"),
    [followUps],
  );
  const completedFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.status === "COMPLETED"),
    [followUps],
  );
  const overdueCount = openFollowUps.filter((followUp) => new Date(followUp.dueAt).getTime() < now).length;
  const todayCount = openFollowUps.filter((followUp) => {
    const due = new Date(followUp.dueAt);
    const today = new Date();
    return due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth() && due.getDate() === today.getDate();
  }).length;
  const currentItems = (view === "OPEN" ? openFollowUps : completedFollowUps).filter((followUp) => {
    const searchText = `${followUp.customer.name} ${followUp.customer.document} ${followUp.note}`.toLocaleLowerCase("es-BO");
    return searchText.includes(query.trim().toLocaleLowerCase("es-BO"));
  });

  async function createFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/customers/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, note, dueAt: new Date(dueAt).toISOString() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar el seguimiento.");
      setCustomerId("");
      setNote("");
      setDueAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
      setView("OPEN");
      setQuery("");
      if (!await loadData(false)) return;
      setMessage("Seguimiento programado. Ya aparece en la lista de pendientes.");
      setMessageKind("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el seguimiento.");
      setMessageKind("error");
    } finally {
      setIsSaving(false);
    }
  }

  async function changeStatus(followUp: FollowUp) {
    if (isUpdatingId) return;
    setIsUpdatingId(followUp.id);
    setMessage("");
    try {
      const response = await fetch("/api/customers/follow-ups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: followUp.id, status: followUp.status === "OPEN" ? "COMPLETED" : "OPEN" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo actualizar el seguimiento.");
      if (!await loadData(false)) return;
      setMessage(followUp.status === "OPEN" ? "Seguimiento marcado como completado." : "Seguimiento reabierto.");
      setMessageKind("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el seguimiento.");
      setMessageKind("error");
    } finally {
      setIsUpdatingId("");
    }
  }

  return (
    <div className="dashboard-content">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Clientes · CRM</p>
          <h1>Seguimiento comercial</h1>
          <p className="muted">Organiza los próximos contactos y mantén cada oportunidad en movimiento.</p>
        </div>
      </header>

      {message && <p className={`module-message ${messageKind}`} role={messageKind === "error" ? "alert" : "status"}>{message}</p>}

      <section className="module-stats" aria-label="Resumen de seguimientos">
        <div><span>Pendientes</span><strong>{openFollowUps.length}</strong></div>
        <div><span>Vencidos</span><strong>{overdueCount}</strong></div>
        <div><span>Programados para hoy</span><strong>{todayCount}</strong></div>
        <div><span>Completados</span><strong>{completedFollowUps.length}</strong></div>
      </section>

      {canWrite ? (
        <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Programar contacto</h2>
            <p>Define el cliente, la fecha y el siguiente paso.</p>
          </div>
        </div>
        {customers.length === 0 ? (
          <p className="module-message">No hay clientes activos disponibles para programar un seguimiento.</p>
        ) : (
          <form className="sale-form sale-form-grid" onSubmit={createFollowUp}>
            <label>
              Cliente
              <select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="">Selecciona un cliente</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.document}</option>)}
              </select>
            </label>
            <label>
              Fecha y hora
              <input required type="datetime-local" min={localDateTimeValue(new Date())} value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <label className="sale-form-wide">
              Actividad / próximo paso
              <textarea required maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ej. Llamar para revisar la propuesta y resolver dudas." />
              <small>{note.length}/500 · Sé específico para facilitar el seguimiento.</small>
            </label>
            <button type="submit" className="primary-button" disabled={isSaving || isLoading}>
              {isSaving ? "Guardando…" : "Programar seguimiento"}
            </button>
          </form>
        )}
        </section>
      ) : null}

      <section className="panel module-table">
          <div className="panel-header">
            <div>
            <h2>Actividad comercial</h2>
            <p>Consulta lo pendiente y recupera seguimientos ya atendidos.</p>
            </div>
          </div>
          <div className="module-toolbar">
            <label className="search-box">
            <Search size={16} />
            <input aria-label="Buscar seguimientos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente o actividad" />
            </label>
            <div className="module-toolbar-actions" aria-label="Filtrar por estado">
            <button type="button" className={view === "OPEN" ? "primary-button" : "secondary-button"} aria-pressed={view === "OPEN"} onClick={() => setView("OPEN")}>
              Pendientes ({openFollowUps.length})
            </button>
            <button type="button" className={view === "COMPLETED" ? "primary-button" : "secondary-button"} aria-pressed={view === "COMPLETED"} onClick={() => setView("COMPLETED")}>
              Completados ({completedFollowUps.length})
            </button>
            </div>
          </div>

          {isLoading ? (
            <p className="module-message" aria-live="polite">Cargando actividad comercial…</p>
          ) : currentItems.length === 0 ? (
            <p className="module-message">{query ? "No se encontraron seguimientos. Prueba con otra búsqueda." : view === "OPEN" ? "No hay seguimientos pendientes." : "Aún no hay actividades completadas."}</p>
          ) : (
            <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Fecha</th><th>Cliente</th><th>Actividad / próximo paso</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr>
              </thead>
              <tbody>
                {currentItems.map((followUp) => {
                  const overdue = followUp.status === "OPEN" && new Date(followUp.dueAt).getTime() < now;
                  return (
                    <tr key={followUp.id}>
                      <td>{formatFollowUpDate(followUp.dueAt)}</td>
                      <td>{followUp.customer.name}<small className="table-secondary-text">{followUp.customer.document}</small></td>
                      <td>{followUp.note}</td>
                      <td><span className={`status ${overdue ? "warning" : followUp.status === "COMPLETED" ? "success" : ""}`}>{overdue ? "Vencido" : followUp.status === "COMPLETED" ? "Completado" : "Programado"}</span></td>
                      {canWrite && <td>
                        <button type="button" className="secondary-button" onClick={() => void changeStatus(followUp)} disabled={isUpdatingId === followUp.id}>
                          {followUp.status === "OPEN" ? <><Check size={15} /> {isUpdatingId === followUp.id ? "Guardando…" : "Completar"}</> : <><RotateCcw size={15} /> Reabrir</>}
                        </button>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          {followUps.length >= 200 && <p className="muted">Mostrando los últimos 200 seguimientos.</p>}
      </section>
    </div>
  );
}
