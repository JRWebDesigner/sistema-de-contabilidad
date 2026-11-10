"use client";

import { Fragment, FormEvent, useEffect, useState } from "react";
import { ArrowUpRight, CircleDollarSign } from "lucide-react";

import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";

type Payable = {
  id: string;
  number: string;
  status: string;
  originalAmount: string;
  paidAmount: string;
  balance: string;
  dueDate: string;
  supplier: { name: string; document: string };
  purchase: { number: string };
  payments: Array<{
    id: string;
    amount: string;
    reference: string | null;
    paymentMethod: string;
    createdAt: string;
    reversedAt: string | null;
    reversalReason: string | null;
    cashAccount: { name: string };
  }>;
};
type Account = { id: string; name: string; balance: string; custodianId: string | null };
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "BOB",
});

export default function PayablesModule() {
  const canWrite = usePermission("finance:write");
  const [payables, setPayables] = useState<Payable[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState({
    cashAccountId: "",
    paymentMethod: "CASH",
    amount: "",
  });
  const [message, setMessage] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [agingFilter, setAgingFilter] = useState("ALL");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  async function load() {
    try {
      const [payableResponse, accountResponse] = await Promise.all([
        fetch("/api/payables"),
        fetch("/api/cash"),
      ]);
      const payableData = await payableResponse.json().catch(() => null);
      const accountData = await accountResponse.json().catch(() => null);

      setPayables(payableResponse.ok && Array.isArray(payableData) ? payableData : []);
      const regularAccounts = accountResponse.ok && Array.isArray(accountData)
        ? accountData.filter((account: Account) => !account.custodianId)
        : [];
      setAccounts(regularAccounts);
      if (!payableResponse.ok || !accountResponse.ok) {
        setMessage(
          payableData?.error ?? accountData?.error ??
            "No se pudieron cargar las cuentas por pagar.",
        );
      }

      const availableAccounts = accountResponse.ok && Array.isArray(accountData)
        ? accountData.filter((account: Account) => !account.custodianId)
        : [];
    setForm((current) => ({
      ...current,
      cashAccountId: current.cashAccountId || availableAccounts[0]?.id || "",
    }));
    } catch {
      setPayables([]);
      setAccounts([]);
      setMessage("No se pudieron cargar las cuentas por pagar.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/payables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, payableId: selected }),
    });
    const data = await response.json();
    setMessage(response.ok ? `Pago ${data.reference} registrado.` : data.error);
    if (response.ok) {
      setSelected("");
      setForm((current) => ({ ...current, amount: "" }));
      setPaymentModalOpen(false);
      await load();
    }
  }
  async function reversePayment(paymentId: string) {
    const reason = window.prompt("Motivo para revertir este pago:");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setMessage("El motivo debe tener al menos 3 caracteres.");
      return;
    }
    if (!window.confirm("Se revertirá el pago y se actualizarán caja y contabilidad. ¿Continuar?")) return;
    const response = await fetch("/api/payables", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, reason }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Pago revertido y registrado en el historial." : (data.error ?? "No se pudo revertir el pago."));
    if (response.ok) await load();
  }
  const pending = payables
    .filter((item) => item.status !== "PAID" && item.status !== "CANCELLED")
    .reduce((sum, item) => sum + Number(item.balance), 0);
  const filteredPayables = payables.filter((item) => {
    if (agingFilter !== "ALL" && (item.status === "PAID" || item.status === "CANCELLED" || Number(item.balance) <= 0)) return false;
    const search = query.trim().toLocaleLowerCase();
    const matchesQuery = !search || [item.supplier.name, item.supplier.document, item.purchase.number, item.number]
      .some((value) => value.toLocaleLowerCase().includes(search));
    const matchesStatus = statusFilter === "ALL" || item.status === statusFilter;
    const due = new Date(item.dueDate);
    const dueDate = due.toISOString().slice(0, 10);
    const matchesDates = (!dueFrom || dueDate >= dueFrom) && (!dueTo || dueDate <= dueTo);
    const overdueDays = Math.max(0, Math.floor((Date.now() - new Date(`${dueDate}T00:00:00`).getTime()) / 86400000));
    const matchesAging = agingFilter === "ALL"
      || (agingFilter === "CURRENT" && overdueDays === 0)
      || (agingFilter === "1-30" && overdueDays >= 1 && overdueDays <= 30)
      || (agingFilter === "31-60" && overdueDays >= 31 && overdueDays <= 60)
      || (agingFilter === "61-90" && overdueDays >= 61 && overdueDays <= 90)
      || (agingFilter === "90+" && overdueDays > 90);
    return matchesQuery && matchesStatus && matchesDates && matchesAging;
  });
  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Finanzas · Bolivia</p>
          <h1>Cuentas por pagar</h1>
          <p className="muted">Obligaciones con proveedores en Bs.</p>
        </div>
        <div className="heading-actions"><span className="currency-note">Pendiente: {money.format(pending)}</span>{canWrite && <button className="primary-button" type="button" onClick={() => setPaymentModalOpen(true)}><CircleDollarSign size={15} /> Registrar pago</button>}</div>
      </div>
      {message && <p className="module-message">{message}</p>}
      {canWrite && <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} page="Finanzas · Bolivia" title="Registrar pago" description="Aplica un pago a una cuenta por pagar." className="finance-modal">
      <form className="product-form" onSubmit={submit}>
        <div className="product-form-grid">
          <label>
            Obligación
            <select
              required
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                const item = payables.find(
                  (row) => row.id === event.target.value,
                );
                setForm((current) => ({
                  ...current,
                  amount: item?.balance ?? "",
                }));
              }}
            >
              <option value="">Selecciona una obligación</option>
              {payables
                .filter((item) => item.status !== "PAID" && item.status !== "CANCELLED")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.supplier.name} · {money.format(Number(item.balance))}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Cuenta de pago
            <select
              required
              value={form.cashAccountId}
              onChange={(event) =>
                setForm({ ...form, cashAccountId: event.target.value })
              }
            >
              <option value="">Selecciona una cuenta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Medio de pago
            <select
              value={form.paymentMethod}
              onChange={(event) =>
                setForm({ ...form, paymentMethod: event.target.value })
              }
            >
              <option value="CASH">Efectivo</option>
              <option value="BANK_TRANSFER">Transferencia</option>
              <option value="CARD">Tarjeta</option>
              <option value="QR">QR</option>
            </select>
          </label>
          <label>
            Monto Bs
            <input
              required
              min="0.01"
              step="0.01"
              type="number"
              value={form.amount}
              onChange={(event) =>
                setForm({ ...form, amount: event.target.value })
              }
            />
          </label>
        </div>
        <button className="primary-button" type="submit">
          <CircleDollarSign size={15} /> Registrar pago
        </button>
      </form>
      </Modal>}
      <div className="module-toolbar">
        <input aria-label="Buscar cuentas por pagar" placeholder="Buscar proveedor, compra o documento..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ALL">Todos los estados</option><option value="PENDING">Pendiente</option><option value="PARTIAL">Parcial</option><option value="OVERDUE">Vencida</option><option value="PAID">Pagada</option><option value="CANCELLED">Cancelada</option>
        </select>
        <select aria-label="Filtrar antigüedad" value={agingFilter} onChange={(event) => setAgingFilter(event.target.value)}>
          <option value="ALL">Toda antigüedad</option><option value="CURRENT">Al día</option><option value="1-30">1–30 días</option><option value="31-60">31–60 días</option><option value="61-90">61–90 días</option><option value="90+">Más de 90 días</option>
        </select>
        <label>Vence desde<input type="date" value={dueFrom} onChange={(event) => setDueFrom(event.target.value)} /></label>
        <label>Vence hasta<input type="date" value={dueTo} onChange={(event) => setDueTo(event.target.value)} /></label>
      </div>
      <article className="panel module-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Compra</th>
                <th>Vencimiento</th>
                <th>Total</th>
                <th>Pagado</th>
                <th>Saldo</th>
                <th>Estado</th>
                <th>Abonos</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayables.length === 0 ? (
                <tr>
                  <td colSpan={8}>{payables.length ? "No hay resultados para los filtros seleccionados." : "No hay cuentas por pagar."}</td>
                </tr>
              ) : (
                filteredPayables.map((item) => (
                  <Fragment key={item.id}>
                  <tr key={item.id}>
                    <td>
                      <div className="product-cell">
                        <span className="product-thumb">
                          <ArrowUpRight size={16} />
                        </span>
                        <div>
                          <strong>{item.supplier.name}</strong>
                          <small>{item.supplier.document}</small>
                        </div>
                      </div>
                    </td>
                    <td>{item.purchase.number}</td>
                    <td>
                      {new Date(item.dueDate).toLocaleDateString("es-BO")}
                    </td>
                    <td>{money.format(Number(item.originalAmount))}</td>
                    <td>{money.format(Number(item.paidAmount))}</td>
                    <td>
                      <strong>{money.format(Number(item.balance))}</strong>
                    </td>
                    <td>
                      <span className={`status ${item.status === "PAID" ? "success" : item.status === "CANCELLED" ? "neutral" : item.status === "OVERDUE" ? "warning" : "success"}`}>
                        <i />
                        {item.status === "PARTIAL"
                          ? "Parcial"
                          : item.status === "PAID"
                            ? "Pagada"
                            : item.status === "OVERDUE"
                              ? "Vencida"
                              : item.status === "CANCELLED"
                                ? "Cancelada"
                                : "Pendiente"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="outline-button"
                        type="button"
                        onClick={() => setHistoryOpen(historyOpen === item.id ? null : item.id)}
                      >
                        {item.payments.length} abonos
                      </button>
                    </td>
                  </tr>
                  {historyOpen === item.id && (
                    <tr key={`${item.id}-payments`}>
                      <td colSpan={8}>
                        {item.payments.length === 0 ? "Esta cuenta no tiene abonos." : (
                          <div className="table-scroll">
                            <table>
                              <thead><tr><th>Fecha</th><th>Referencia</th><th>Cuenta</th><th>Medio</th><th>Importe</th><th>Estado / motivo</th><th>Acción</th></tr></thead>
                              <tbody>{item.payments.map((payment) => (
                                <tr key={payment.id}>
                                  <td>{new Date(payment.createdAt).toLocaleString("es-BO")}</td>
                                  <td>{payment.reference ?? "—"}</td>
                                  <td>{payment.cashAccount.name}</td>
                                  <td>{payment.paymentMethod}</td>
                                  <td>{money.format(Number(payment.amount))}</td>
                                  <td>{payment.reversedAt ? `Revertido ${new Date(payment.reversedAt).toLocaleString("es-BO")}: ${payment.reversalReason ?? ""}` : "Vigente"}</td>
                                  <td>{canWrite && !payment.reversedAt && <button className="outline-button" type="button" onClick={() => void reversePayment(payment.id)}>Revertir</button>}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
