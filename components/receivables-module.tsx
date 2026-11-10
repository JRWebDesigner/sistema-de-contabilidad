"use client";

import { Fragment, FormEvent, useEffect, useState } from "react";
import { CircleDollarSign, Printer } from "lucide-react";

import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";
import { openPaymentReceiptPdf, type PaymentReceiptPdfData } from "./payment-receipt-pdf";
import AccountStatementModal from "./account-statement-modal";

type Receivable = {
  id: string;
  number: string;
  status: string;
  originalAmount: string;
  paidAmount: string;
  balance: string;
  dueDate: string;
  customer: { id: string; name: string; document: string };
  sale: { number: string; createdAt: string; paymentMethod: string };
  payments: Array<{
    id: string;
    amount: string;
    reference: string | null;
    externalReference: string | null;
    description: string | null;
    paymentMethod: string;
    createdAt: string;
    reversedAt: string | null;
    reversalReason: string | null;
    cashAccount: { name: string };
  }>;
};
type Account = { id: string; name: string; balance: string; type: "CASH" | "BANK" | "POS"; custodianId: string | null };
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";
const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  BANK_TRANSFER: "Banco",
  CARD: "Tarjeta",
  OTHER: "Otro",
};
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "BOB",
});

export default function ReceivablesModule() {
  const canWrite = usePermission("finance:write");
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState({
    cashAccountId: "",
    paymentMethod: "CASH",
    amount: "",
    description: "",
    externalReference: "",
  });
  const [message, setMessage] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [customerIdFilter, setCustomerIdFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statementCustomerId, setStatementCustomerId] = useState("");

  async function load() {
    const [receivableResponse, accountResponse] = await Promise.all([
      fetch("/api/receivables"),
      fetch("/api/cash"),
    ]);
    setReceivables(await receivableResponse.json());
    const accountData = await accountResponse.json();
    const availableAccounts = accountData.filter((account: Account) => !account.custodianId);
    setAccounts(availableAccounts);
    setForm((current) => ({
      ...current,
      cashAccountId: current.cashAccountId || availableAccounts[0]?.id || "",
    }));
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const previewWindow = window.open("about:blank", "_blank");
    try {
      const response = await fetch("/api/receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          cashAccountId: form.paymentMethod === "CASH" ? undefined : form.cashAccountId || undefined,
          description: form.description.trim() || undefined,
          externalReference: form.externalReference.trim() || undefined,
          receivableId: selected,
        }),
      });
      const data = await response.json();
      setMessage(
        response.ok
        ? `Cobro ${data.reference} registrado. Saldo pendiente: ${money.format(Number(data.balance))}.`
          : (data.error ?? "No se pudo registrar el pago."),
      );
      if (response.ok) {
        setSelected("");
        setForm((current) => ({ ...current, amount: "", description: "", externalReference: "" }));
        setPaymentModalOpen(false);
        try {
          await load();
        } catch (error) {
          setMessage(error instanceof Error
            ? `Cobro registrado, pero no se pudo actualizar la lista: ${error.message}`
            : "Cobro registrado, pero no se pudo actualizar la lista.");
        }
        if (previewWindow && data.paymentId) {
          try {
            await printPaymentNote(data.paymentId, previewWindow);
          } catch (error) {
            previewWindow.close();
            setMessage(error instanceof Error ? `Cobro registrado, pero no se pudo generar su nota: ${error.message}` : "Cobro registrado, pero no se pudo generar su nota.");
          }
        } else {
          previewWindow?.close();
          setMessage("Cobro registrado. Permite ventanas emergentes y pulsa Imprimir PDF en el historial del cobro.");
        }
      } else {
        previewWindow?.close();
      }
    } catch (error) {
      previewWindow?.close();
      setMessage(error instanceof Error ? error.message : "No se pudo registrar el cobro.");
    }
  }

  async function printPaymentNote(paymentId: string, previewWindow = window.open("about:blank", "_blank")) {
    if (!previewWindow) throw new Error("El navegador bloqueó la ventana de impresión.");
    const response = await fetch("/api/receivables/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudo generar la nota de cobro.");
    await openPaymentReceiptPdf(data as PaymentReceiptPdfData, previewWindow);
  }

  async function reversePayment(paymentId: string) {
    const reason = window.prompt("Motivo para revertir este cobro:");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setMessage("El motivo debe tener al menos 3 caracteres.");
      return;
    }
    if (!window.confirm("Se revertirá el cobro y se actualizarán caja y contabilidad. ¿Continuar?")) return;
    const response = await fetch("/api/receivables", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, reason }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Cobro revertido y registrado en el historial." : (data.error ?? "No se pudo revertir el cobro."));
    if (response.ok) await load();
  }

  const pending = receivables
    .filter((item) => item.status !== "PAID" && item.status !== "CANCELLED")
    .reduce((sum, item) => sum + Number(item.balance), 0);
  const selectedReceivable = receivables.find((item) => item.id === selected);
  const enteredAmount = Number(form.amount || 0);
  const remainingBalance = selectedReceivable
    ? Math.max(Number(selectedReceivable.balance) - enteredAmount, 0)
    : 0;
  const customers = Array.from(
    new Map(receivables.map((item) => [item.customer.id, item.customer])).values(),
  ).sort((left, right) => left.name.localeCompare(right.name, "es"));
  const paymentAccounts = accounts.filter((account) => (
    form.paymentMethod === "BANK_TRANSFER"
      ? account.type === "BANK"
      : form.paymentMethod === "CARD"
        ? account.type === "POS"
        : form.paymentMethod === "OTHER"
          ? true
          : false
  ));
  const filteredReceivables = receivables.filter((item) => {
    const search = query.trim().toLocaleLowerCase();
    const matchesQuery = !search || [item.customer.name, item.customer.document, item.sale.number, item.number]
      .some((value) => value.toLocaleLowerCase().includes(search));
    const saleDate = new Date(item.sale.createdAt).toISOString().slice(0, 10);
    const matchesDates = (!dateFrom || saleDate >= dateFrom) && (!dateTo || saleDate <= dateTo);
    const matchesCustomer = !customerIdFilter || item.customer.id === customerIdFilter;
    return matchesQuery && matchesDates && matchesCustomer;
  });

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Finanzas · Bolivia</p>
          <h1>Cuentas por cobrar</h1>
          <p className="muted">
            Saldos pendientes en Bs y cobros aplicados a Caja/Bancos.
          </p>
        </div>
        <div className="heading-actions"><span className="currency-note">Pendiente: {money.format(pending)}</span></div>
      </div>
      {message && <p className="module-message">{message}</p>}
      {canWrite && <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} page="Finanzas · Cobros" title="Registrar cobro" description="Aplica un pago y actualiza el saldo del cliente." className="finance-modal receivable-payment-modal">
      <form className="receivable-payment-form" onSubmit={handleSubmit}>
        <section className="receivable-payment-section">
          <div className="receivable-section-heading">
            <span className="receivable-step">1</span>
            <div>
              <h3>Cuenta por cobrar</h3>
              <p>Elige la deuda a la que se aplicará este cobro.</p>
            </div>
          </div>
          <label>
            Factura y cliente
            <select
              required
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                const item = receivables.find((row) => row.id === event.target.value);
                setForm((current) => ({
                  ...current,
                  amount: item?.balance ?? "",
                  description: "",
                  externalReference: "",
                }));
              }}
            >
              <option value="">Selecciona una cuenta</option>
              {receivables
                .filter((item) => item.status !== "PAID" && item.status !== "CANCELLED")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sale.number} · {item.customer.name} · saldo {money.format(Number(item.balance))}
                  </option>
                ))}
            </select>
          </label>
        </section>
        <section className="receivable-payment-section">
          <div className="receivable-section-heading">
            <span className="receivable-step">2</span>
            <div>
              <h3>Forma de pago e importe</h3>
              <p>Elige si abona una parte o el total de la deuda.</p>
            </div>
          </div>
          <div className="receivable-payment-grid">
          {form.paymentMethod === "CASH" && (
            <p className="muted">El efectivo quedará bajo custodia de quien registra este cobro, hasta que deposite el dinero.</p>
          )}
          <label>
            Medio de pago
            <select
              value={form.paymentMethod}
              onChange={(event) => {
                const paymentMethod = event.target.value as PaymentMethod;
                const nextAccount = paymentMethod === "BANK_TRANSFER"
                  ? accounts.find((account) => account.type === "BANK")
                  : paymentMethod === "CARD"
                    ? accounts.find((account) => account.type === "POS")
                    : paymentMethod === "OTHER"
                      ? accounts[0]
                      : undefined;
                setForm((current) => ({ ...current, paymentMethod, cashAccountId: nextAccount?.id ?? "" }));
              }}
            >
              <option value="CASH">Efectivo</option>
              <option value="BANK_TRANSFER">Banco / transferencia</option>
              <option value="CARD">Tarjeta</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>
          {form.paymentMethod !== "CASH" && (
            <label>
              Cuenta que recibe
              <select required value={form.cashAccountId} onChange={(event) => setForm({ ...form, cashAccountId: event.target.value })}>
                <option value="">Selecciona una cuenta</option>
                {paymentAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · saldo {money.format(Number(account.balance))}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Importe recibido (Bs)
            <input
              required
              min="0.01"
              step="0.01"
              max={selectedReceivable?.balance}
              type="number"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
          </label>
          <label className="sale-invoice-checkbox receivable-payment-concept">
            <input
              type="checkbox"
              checked={!!selectedReceivable && enteredAmount === Number(selectedReceivable.balance)}
              onChange={(event) => setForm((current) => ({
                ...current,
                amount: event.target.checked ? selectedReceivable?.balance ?? "" : "",
              }))}
            />
            Pagar el saldo total ({money.format(Number(selectedReceivable?.balance ?? 0))})
          </label>
          <label>
            {form.paymentMethod === "BANK_TRANSFER" ? "Numero de comprobante" : "Referencia del pago (opcional)"}
            <input
              required={form.paymentMethod === "BANK_TRANSFER"}
              maxLength={100}
              value={form.externalReference}
              onChange={(event) => setForm({ ...form, externalReference: event.target.value })}
              placeholder="Ej. 12345600"
            />
          </label>
          <label className="receivable-payment-concept">
            Descripción o concepto (opcional)
            <textarea
              maxLength={500}
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Información adicional sobre este cobro"
            />
          </label>
          </div>
        </section>
        <div className="receivable-payment-summary">
          <div>
            <span>Cliente</span>
            <strong>{selectedReceivable?.customer.name ?? "Pendiente"}</strong>
          </div>
          <div>
            <span>Saldo antes del cobro</span>
            <strong>{money.format(Number(selectedReceivable?.balance ?? 0))}</strong>
          </div>
          <div className="receivable-summary-total">
            <span>Saldo después del cobro</span>
            <strong>{money.format(remainingBalance)}</strong>
          </div>
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={() => setPaymentModalOpen(false)}>Cancelar</button>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !selectedReceivable ||
              enteredAmount <= 0 ||
              enteredAmount > Number(selectedReceivable?.balance ?? 0) ||
              (form.paymentMethod !== "CASH" && (!form.cashAccountId || paymentAccounts.length === 0)) ||
              (form.paymentMethod === "BANK_TRANSFER" && !form.externalReference.trim())
            }
          >
            <CircleDollarSign size={15} /> Confirmar cobro
          </button>
        </div>
      </form>
      </Modal>}
      <div className="module-toolbar">
        <label>
          Fecha desde
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          Fecha hasta
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          Buscar
          <input aria-label="Buscar cuentas por cobrar" placeholder="Factura, documento o cliente..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Cliente
          <select aria-label="Seleccionar cliente" value={customerIdFilter} onChange={(event) => setCustomerIdFilter(event.target.value)}>
            <option value="">Todos los clientes</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name} · {customer.document}</option>
            ))}
          </select>
        </label>
      </div>
      <article className="panel module-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Nro. factura</th>
                <th>Documento</th>
                <th>Crédito</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Deuda (Bs)</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredReceivables.length === 0 ? (
                <tr>
                  <td colSpan={8}>{receivables.length ? "No hay resultados para los filtros seleccionados." : "No hay cuentas por cobrar."}</td>
                </tr>
              ) : (
                filteredReceivables.map((item, index) => (
                  <Fragment key={item.id}>
                  <tr className={Number(item.balance) > 0 ? "receivable-debt-row" : ""}>
                    <td>{index + 1}</td>
                    <td>{item.sale.number}</td>
                    <td>{item.customer.document || "—"}</td>
                    <td>Sí</td>
                    <td>{new Date(item.sale.createdAt).toLocaleDateString("es-BO")}</td>
                    <td>{item.customer.name}</td>
                    <td>
                      <strong>{money.format(Number(item.balance))}</strong>
                    </td>
                    <td>
                      <div className="heading-actions">
                        <button
                          className="outline-button"
                          type="button"
                          disabled={!canWrite || item.status === "PAID" || item.status === "CANCELLED"}
                          onClick={() => {
                            setSelected(item.id);
                            setForm((current) => ({
                              ...current,
                              amount: item.balance,
                              paymentMethod: "CASH",
                              cashAccountId: "",
                              description: "",
                              externalReference: "",
                            }));
                            setPaymentModalOpen(true);
                          }}
                        >
                          <CircleDollarSign size={14} /> Registrar pago
                        </button>
                        <button
                          className="outline-button"
                          type="button"
                          onClick={() => setStatementCustomerId(item.customer.id)}
                        >
                          <Printer size={14} /> Estado de cuenta
                        </button>
                        <button
                          className="outline-button"
                          type="button"
                          onClick={() => setHistoryOpen(historyOpen === item.id ? null : item.id)}
                        >
                          {item.payments.length} abonos
                        </button>
                      </div>
                    </td>
                  </tr>
                  {historyOpen === item.id && (
                    <tr key={`${item.id}-payments`}>
                      <td colSpan={8}>
                        {item.payments.length === 0 ? "Esta cuenta no tiene abonos." : (
                          <div className="table-scroll">
                            <table>
                              <thead><tr><th>Fecha</th><th>Comprobante</th><th>Concepto</th><th>Cuenta</th><th>Medio</th><th>Importe</th><th>Estado / motivo</th><th>Acción</th></tr></thead>
                              <tbody>{item.payments.map((payment) => (
                                <tr key={payment.id}>
                                  <td>{new Date(payment.createdAt).toLocaleString("es-BO")}</td>
                                  <td>{payment.reference ?? "—"}</td>
                                  <td>{payment.description || payment.externalReference || "S/D"}</td>
                                  <td>{payment.cashAccount.name}</td>
                                  <td>{paymentMethodLabels[payment.paymentMethod as PaymentMethod] ?? payment.paymentMethod}</td>
                                  <td>{money.format(Number(payment.amount))}</td>
                                  <td>{payment.reversedAt ? `Revertido ${new Date(payment.reversedAt).toLocaleString("es-BO")}: ${payment.reversalReason ?? ""}` : "Vigente"}</td>
                                  <td>
                                    <div className="heading-actions">
                                      <button className="outline-button" type="button" onClick={() => void printPaymentNote(payment.id).catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo imprimir la nota de cobro."))}>
                                        <Printer size={14} /> Imprimir PDF
                                      </button>
                                      {canWrite && !payment.reversedAt && <button className="outline-button" type="button" onClick={() => void reversePayment(payment.id)}>Revertir</button>}
                                    </div>
                                  </td>
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
      <AccountStatementModal
        open={!!statementCustomerId}
        onClose={() => setStatementCustomerId("")}
        partyType="customer"
        partyId={statementCustomerId}
      />
    </div>
  );
}
