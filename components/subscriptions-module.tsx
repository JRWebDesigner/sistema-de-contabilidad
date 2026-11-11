"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Loader2, Plus, Printer, Receipt, RefreshCw, X } from "lucide-react";

import { usePermission } from "./permissions-context";
import { openOperationNotePdf, type OperationNotePdfData } from "./operation-note-pdf";
import Modal from "./ui/modal";

type Customer = { id: string; name: string; document: string };
type CashAccount = { id: string; name: string; type: "CASH" | "BANK" | "POS" };
type Service = {
  id: string;
  name: string;
  sku: string;
  price: string;
  type: "SERVICE";
  serviceBillingPeriod: "MONTHLY" | "ANNUAL";
};
type Subscription = {
  id: string;
  number: string;
  status: "ACTIVE" | "CANCELLED";
  billingPeriod: "MONTHLY" | "ANNUAL";
  unitPrice: string;
  startDate: string;
  nextBillingDate: string;
  customer: Customer;
  serviceProduct: { id: string; name: string; sku: string };
  branch: { id: string; name: string };
  invoices: Array<{
    number: string;
    total: string;
    receivable: { number: string; balance: string; dueDate: string; status: string } | null;
  }>;
};

const money = new Intl.NumberFormat("es-BO", {
  style: "currency",
  currency: "BOB",
  minimumFractionDigits: 2,
});
const date = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium" });
const periodLabel = (period: Subscription["billingPeriod"]) =>
  period === "MONTHLY" ? "Mensual" : "Anual";

async function readList<T>(response: Response, label: string): Promise<T[]> {
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : label;
    throw new Error(message);
  }
  if (!Array.isArray(data)) throw new Error(label);
  return data as T[];
}

export default function SubscriptionsModule() {
  const canWrite = usePermission("sales:write");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [serviceProductId, setServiceProductId] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  });
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK_TRANSFER" | "CARD" | "OTHER">("CASH");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [cashAccountId, setCashAccountId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");
  const [requiresInvoice, setRequiresInvoice] = useState(false);
  const initializedInitialPayment = useRef(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  async function printServiceNote(serviceId: string, previewWindow = window.open("about:blank", "_blank")) {
    if (!previewWindow) throw new Error("El navegador bloqueó la ventana de impresión.");
    const response = await fetch("/api/subscriptions/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudo generar la constancia de servicio.");
    await openOperationNotePdf(data as OperationNotePdfData, previewWindow);
  }

  const load = useCallback(async () => {
    const [subscriptionResponse, customerResponse, serviceResponse, accountResponse] = await Promise.all([
      fetch("/api/subscriptions"),
      fetch("/api/customers"),
      fetch("/api/products?type=SERVICE"),
      fetch("/api/sales/accounts"),
    ]);
    const [subscriptionData, customerData, serviceData, accountData] = await Promise.all([
      readList<Subscription>(subscriptionResponse, "No se pudieron cargar los servicios contratados."),
      readList<Customer>(customerResponse, "No se pudieron cargar los clientes."),
      readList<Service>(serviceResponse, "No se pudieron cargar los servicios."),
      readList<CashAccount>(accountResponse, "No se pudieron cargar las cuentas de pago."),
    ]);
    setSubscriptions(subscriptionData);
    setCustomers(customerData);
    setAccounts(accountData);
    const recurringServices = serviceData.filter(
      (service) => service.serviceBillingPeriod === "MONTHLY" || service.serviceBillingPeriod === "ANNUAL",
    );
    setServices(recurringServices);
    setServiceProductId((current) => current || recurringServices[0]?.id || "");
    setCustomerId((current) => current || customerData[0]?.id || "");
    setCashAccountId((current) => current || accountData[0]?.id || "");
    if (!initializedInitialPayment.current && recurringServices[0]) {
      setPaymentAmount(recurringServices[0].price);
      initializedInitialPayment.current = true;
    }
  }, []);

  useEffect(() => {
    load()
      .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron cargar los datos."))
      .finally(() => setIsLoading(false));
  }, [load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setMessage("");
    setIsSubmitting(true);
    const previewWindow = window.open("about:blank", "_blank");
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          serviceProductId,
          startDate,
          paymentMethod,
          cashAccountId: paymentMethod === "CASH" ? undefined : cashAccountId || undefined,
          paymentReference: paymentReference || undefined,
          paymentAmount: Number(paymentAmount),
          notes: notes || undefined,
          requiresInvoice,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo iniciar el servicio.");
      setIsCreateModalOpen(false);
      let refreshError = "";
      try {
        await load();
      } catch (error) {
        refreshError = error instanceof Error ? ` No se pudo actualizar la lista: ${error.message}` : " No se pudo actualizar la lista.";
      }
      if (previewWindow) {
        try {
          await printServiceNote(data.id, previewWindow);
        } catch (error) {
          previewWindow.close();
          setMessage(error instanceof Error
            ? `Servicio ${data.number} iniciado, pero no se pudo generar la constancia: ${error.message}${refreshError}`
            : `Servicio ${data.number} iniciado, pero no se pudo generar la constancia.${refreshError}`);
          return;
        }
      }
      setMessage(
        `Servicio ${data.number} iniciado. Se registró la venta ${data.invoiceNumber} y su cuenta por cobrar.${refreshError}`,
      );
      setMessage(
        `Servicio ${data.number} iniciado. Venta ${data.invoiceNumber}; pago inicial ${money.format(data.paymentAmount)}; saldo ${money.format(data.balanceDue)}.${refreshError}`,
      );
      if (!previewWindow) {
        setMessage(`Servicio ${data.number} iniciado, pero el navegador bloqueó el PDF. Usa "Imprimir constancia" en el historial.${refreshError}`);
      }
    } catch (error) {
      previewWindow?.close();
      setMessage(error instanceof Error ? error.message : "No se pudo conectar con el servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelSubscription(subscription: Subscription) {
    if (!window.confirm(`¿Detener el servicio ${subscription.number}? No se emitirán nuevos períodos.`)) return;
    setPendingId(subscription.id);
    setMessage("");
    try {
      const response = await fetch("/api/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: subscription.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo detener el servicio.");
      await load();
      setMessage(`Servicio ${data.number} detenido. Las cuentas por cobrar existentes se mantienen.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo conectar con el servidor.");
    } finally {
      setPendingId("");
    }
  }

  const selectedService = services.find((service) => service.id === serviceProductId);
  const paymentAccounts = accounts.filter((account) => (
    paymentMethod === "BANK_TRANSFER"
      ? account.type === "BANK"
      : paymentMethod === "CARD"
        ? account.type === "POS"
        : paymentMethod === "OTHER"
          ? true
          : false
  ));
  const servicePrice = Number(selectedService?.price ?? 0);
  const enteredPayment = Number(paymentAmount);
  const initialBalance = Math.max(servicePrice - (Number.isFinite(enteredPayment) ? enteredPayment : 0), 0);

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Servicios recurrentes</p>
          <h1>Servicios</h1>
          <p className="muted">
            Cada período registra una venta a crédito y una cuenta por cobrar para el cliente.
          </p>
        </div>
        <div className="page-heading-actions">
          <span className="currency-note"><CalendarClock size={15} /> Cobro mensual o anual</span>
          {canWrite && (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setMessage("");
                setIsCreateModalOpen(true);
              }}
            >
              <Plus size={16} /> Nuevo servicio
            </button>
          )}
        </div>
      </div>

      {message && !isCreateModalOpen && <p className="module-message" role="status">{message}</p>}

      <Modal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        page="Servicios · Importlilimlab"
        title="Nuevo servicio"
        description="Completa la constancia con el cliente, el servicio contratado y las condiciones del pago inicial."
        className="sale-modal"
      >
        {isLoading ? (
          <div className="sale-loading">
            <Loader2 size={20} className="spin" />
            <span>Cargando servicios, clientes y cuentas…</span>
          </div>
        ) : (
          <form className="sale-form" onSubmit={handleSubmit}>
            <div className="sale-note-sheet">
              <header className="sale-note-editor-header">
                <div className="sale-note-editor-brand">
                  <strong>Importlilimlab</strong>
                  <small>Contratación de servicios</small>
                </div>
                <div className="sale-note-editor-document">
                  <span>Documento comercial</span>
                  <strong>NOTA DE SERVICIO</strong>
                  <small>Borrador · Se asignará número al registrar</small>
                </div>
              </header>

              <section className="sale-section">
                <h3 className="sale-section-title"><span>01</span> Cliente y servicio contratado</h3>
                <div className="sale-note-fields">
                  <label>
                    <span>Cliente <b>*</b></span>
                    <select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                      <option value="">Selecciona un cliente</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.name} · {customer.document}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Servicio recurrente <b>*</b></span>
                    <select
                      required
                      value={serviceProductId}
                      onChange={(event) => {
                        const selectedId = event.target.value;
                        setServiceProductId(selectedId);
                        setPaymentAmount(services.find((service) => service.id === selectedId)?.price ?? "0");
                      }}
                    >
                      <option value="">Selecciona un servicio</option>
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.sku} · {service.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sale-note-info-cell">
                    <span>Frecuencia y precio por período</span>
                    <strong>
                      {selectedService
                        ? `${periodLabel(selectedService.serviceBillingPeriod)} · ${money.format(Number(selectedService.price))}`
                        : "Selecciona un servicio"}
                    </strong>
                  </div>
                  <label>
                    <span>Fecha de inicio <b>*</b></span>
                    <input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                  </label>
                </div>
                {!services.length && (
                  <p className="sale-note-helper">Primero registra un servicio mensual o anual en Productos y servicios.</p>
                )}
              </section>

              <section className="sale-section">
                <h3 className="sale-section-title"><span>02</span> Pago inicial</h3>
                <div className="sale-note-fields">
                  <label>
                    <span>Forma de pago <b>*</b></span>
                    <select
                      value={paymentMethod}
                      onChange={(event) => {
                        const nextMethod = event.target.value as typeof paymentMethod;
                        setPaymentMethod(nextMethod);
                        if (nextMethod !== "CASH") {
                          const account = accounts.find((item) => (
                            nextMethod === "BANK_TRANSFER"
                              ? item.type === "BANK"
                              : nextMethod === "CARD"
                                ? item.type === "POS"
                                : true
                          ));
                          setCashAccountId(account?.id ?? "");
                        }
                      }}
                    >
                      <option value="CASH">Efectivo</option>
                      <option value="BANK_TRANSFER">Banco / transferencia</option>
                      <option value="CARD">Tarjeta</option>
                      <option value="OTHER">Otro</option>
                    </select>
                  </label>
                  <label>
                    <span>Pago inicial (Bs) <b>*</b></span>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      max={selectedService?.price}
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                    />
                  </label>
                  <div className="sale-note-balance">
                    <span>Saldo pendiente del primer período</span>
                    <strong>{money.format(initialBalance)}</strong>
                  </div>
                  {paymentMethod !== "CASH" && Number(paymentAmount) > 0 && (
                    <label>
                      <span>Cuenta de pago <b>*</b></span>
                      <select required value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
                        <option value="">Selecciona una cuenta</option>
                        {paymentAccounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {paymentMethod === "BANK_TRANSFER" && Number(paymentAmount) > 0 && (
                    <label>
                      <span>Número de comprobante <b>*</b></span>
                      <input
                        required
                        maxLength={100}
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                      />
                    </label>
                  )}
                </div>
                {paymentMethod !== "CASH" && Number(paymentAmount) > 0 && paymentAccounts.length === 0 && (
                  <p className="module-message" role="alert">No hay una cuenta disponible para esa forma de pago.</p>
                )}
              </section>

              <section className="sale-section sale-note-observations">
                <h3 className="sale-section-title"><span>03</span> Observaciones y facturación</h3>
                <label>
                  <span>Observación / concepto</span>
                  <textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
                <label className="sale-invoice-checkbox">
                  <input
                    type="checkbox"
                    checked={requiresInvoice}
                    onChange={(event) => setRequiresInvoice(event.target.checked)}
                  />
                  Se entregará factura
                </label>
              </section>

              {message && <p className="module-message" role="alert">{message}</p>}

              <footer className="sale-note-totals">
                <div className="modal-actions">
                  <button type="button" className="outline-button" onClick={() => setIsCreateModalOpen(false)}>
                    Cancelar
                  </button>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      isSubmitting ||
                      !customers.length ||
                      !services.length ||
                      !startDate ||
                      (paymentMethod !== "CASH" && Number(paymentAmount) > 0 && (!cashAccountId || paymentAccounts.length === 0)) ||
                      (paymentMethod === "BANK_TRANSFER" && Number(paymentAmount) > 0 && !paymentReference.trim())
                    }
                  >
                    {isSubmitting ? <Loader2 size={15} className="spin" /> : <Receipt size={15} />}
                    {isSubmitting ? "Registrando…" : "Registrar servicio"}
                  </button>
                </div>
              </footer>
            </div>
          </form>
        )}
      </Modal>

      <article className="panel module-table">
        <div className="panel-header">
          <div>
            <h2>Servicios contratados</h2>
            <p>Los servicios se procesan automáticamente mientras la aplicación está activa.</p>
          </div>
          <button className="outline-button" type="button" onClick={() => void load()} disabled={isLoading}>
            {isLoading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            Actualizar
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Cliente</th>
                <th>Servicio</th>
                <th>Período</th>
                <th>Importe</th>
                <th>Próximo cobro</th>
                <th>Último saldo</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9}>Cargando servicios contratados...</td></tr>
              ) : subscriptions.length === 0 ? (
                <tr><td colSpan={9}>Todavía no hay servicios contratados.</td></tr>
              ) : subscriptions.map((subscription) => {
                const latestReceivable = subscription.invoices[0]?.receivable;
                return (
                  <tr key={subscription.id}>
                    <td><strong>{subscription.number}</strong><small>{subscription.branch.name}</small></td>
                    <td>{subscription.customer.name}<small>{subscription.customer.document}</small></td>
                    <td>{subscription.serviceProduct.name}<small>{subscription.serviceProduct.sku}</small></td>
                    <td>{periodLabel(subscription.billingPeriod)}</td>
                    <td>{money.format(Number(subscription.unitPrice))}</td>
                    <td>{subscription.status === "ACTIVE" ? date.format(new Date(subscription.nextBillingDate)) : "—"}</td>
                    <td>
                      {latestReceivable
                        ? <>{money.format(Number(latestReceivable.balance))}<small>Vence {date.format(new Date(latestReceivable.dueDate))}</small></>
                        : "—"}
                    </td>
                    <td>
                      <span className={`status ${subscription.status === "ACTIVE" ? "success" : "warning"}`}>
                        <i />{subscription.status === "ACTIVE" ? "Activo" : "Detenido"}
                      </span>
                    </td>
                    <td>
                      <div className="heading-actions">
                        <button className="outline-button" type="button" onClick={() => void printServiceNote(subscription.id).catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo imprimir la constancia."))}>
                          <Printer size={14} /> Imprimir constancia
                        </button>
                        {canWrite && subscription.status === "ACTIVE" && (
                          <button
                            className="outline-button"
                            type="button"
                            disabled={pendingId === subscription.id}
                            onClick={() => void cancelSubscription(subscription)}
                          >
                            {pendingId === subscription.id ? <Loader2 size={14} className="spin" /> : <X size={14} />}
                            Detener servicio
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
