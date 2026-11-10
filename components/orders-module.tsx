"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileText, Plus, Printer, Search, Trash2 } from "lucide-react";

import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";
import { openCustomerOrderPdf, type CustomerOrderPdfData } from "./customer-order-note-pdf";

type Product = {
  id: string;
  name: string;
  sku: string;
  type: "PRODUCT" | "SERVICE";
  serviceBillingPeriod: "ONE_TIME" | "MONTHLY" | "ANNUAL" | null;
  price: string;
  currentStock: number;
  promotionDiscountPercent?: number;
  promotionName?: string | null;
};
type Customer = { id: string; name: string; document: string };
type CashAccount = { id: string; name: string; type: "CASH" | "BANK" | "POS" };
type OrderLine = Product & { quantity: number; discountPercent: number };
type Order = {
  id: string;
  number: string;
  status: "PENDING" | "DELIVERED" | "CANCELLED";
  createdAt: string;
  deliveredAt: string | null;
  receivedByName: string | null;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  total: string;
  customer: Customer;
  seller: { id: string; alias: string; name: string } | null;
  sales: Array<{ id: string; number: string }>;
  items: Array<{
    id: string;
    quantity: number;
    productType: "PRODUCT" | "SERVICE";
    serviceBillingPeriod: "ONE_TIME" | "MONTHLY" | "ANNUAL" | null;
    unitPrice: string;
    discountPercent: string;
    lineTotal: string;
    product: Pick<Product, "id" | "name" | "sku" | "type" | "serviceBillingPeriod">;
  }>;
};
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "QR" | "CREDIT" | "OTHER";

const money = new Intl.NumberFormat("es-BO", {
  style: "currency",
  currency: "BOB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("La respuesta del servidor no es válida.");
  }
}

function toPdfOrder(order: Order): CustomerOrderPdfData {
  return {
    number: order.number,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
    status: order.status,
    customer: order.customer,
    seller: order.seller,
    receivedByName: order.receivedByName,
    notes: order.notes,
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discountTotal),
    total: Number(order.total),
    items: order.items.map((item) => ({
      name: item.product.name,
      sku: item.product.sku,
      type: item.productType,
      serviceBillingPeriod: item.serviceBillingPeriod,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      discountPercent: Number(item.discountPercent),
      lineTotal: Number(item.lineTotal),
    })),
  };
}

export default function OrdersModule() {
  const canWrite = usePermission("sales:write");
  const canDiscount = usePermission("sales:discount");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<OrderLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [receivedByName, setReceivedByName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [requiresInvoice, setRequiresInvoice] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const filteredProducts = useMemo(() => {
    const normalized = productQuery.trim().toLocaleLowerCase();
    return products.filter((product) =>
      !normalized ||
      product.name.toLocaleLowerCase().includes(normalized) ||
      product.sku.toLocaleLowerCase().includes(normalized),
    );
  }, [products, productQuery]);
  const subtotal = roundMoney(cart.reduce((sum, line) => sum + Number(line.price) * line.quantity, 0));
  const discountTotal = roundMoney(cart.reduce((sum, line) =>
    sum + roundMoney(Number(line.price) * line.quantity * Math.max(line.discountPercent, line.promotionDiscountPercent ?? 0) / 100), 0));
  const total = roundMoney(subtotal - discountTotal);
  const allowedAccounts = useMemo(() => {
    if (paymentMethod === "BANK_TRANSFER" || paymentMethod === "QR") {
      return accounts.filter((account) => account.type === "BANK");
    }
    if (paymentMethod === "CARD") return accounts.filter((account) => account.type === "POS");
    if (paymentMethod === "OTHER") return accounts;
    return [];
  }, [accounts, paymentMethod]);
  const visibleOrders = orders.filter((order) => {
    const matchesQuery = !query.trim() ||
      order.number.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
      order.customer.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
      order.customer.document.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (statusFilter === "ALL" || order.status === statusFilter);
  });

  async function loadOrders() {
    const response = await fetch("/api/orders");
    const data = await readJson(response);
    if (!response.ok || !Array.isArray(data)) {
      throw new Error(data.error ?? "No se pudieron cargar los pedidos.");
    }
    setOrders(data);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/products").then(readJson),
      fetch("/api/customers").then(readJson),
      canWrite ? fetch("/api/sales/accounts").then(readJson) : Promise.resolve([]),
      fetch("/api/orders").then(readJson),
    ]).then(([productData, customerData, accountData, orderData]) => {
      if (!active) return;
      if (!Array.isArray(productData) || !Array.isArray(customerData) || !Array.isArray(accountData) || !Array.isArray(orderData)) {
        throw new Error("No se pudieron cargar los datos de pedidos.");
      }
      setProducts(productData.filter((product: Product) =>
        product.type === "PRODUCT" || product.serviceBillingPeriod !== null,
      ));
      setCustomers(customerData);
      setAccounts(accountData);
      setOrders(orderData);
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "No se pudieron cargar los pedidos.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canWrite]);

  useEffect(() => {
    if (!selectedOrder) return;
    setPaymentAmount(selectedOrder.total);
    setReceivedByName("");
    setPaymentReference("");
    setRequiresInvoice(false);
    setPaymentMethod("CASH");
  }, [selectedOrder]);

  useEffect(() => {
    if (paymentMethod === "CASH" || paymentMethod === "CREDIT") {
      setCashAccountId("");
      return;
    }
    setCashAccountId((current) =>
      allowedAccounts.some((account) => account.id === current)
        ? current
        : allowedAccounts[0]?.id ?? "",
    );
  }, [allowedAccounts, paymentMethod]);

  useEffect(() => {
    const controller = new AbortController();
    const search = customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
    fetch(`/api/sales/pricing${search}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok || !Array.isArray(data)) throw new Error(data.error ?? "No se pudieron actualizar los precios.");
        const prices = new Map<string, { price: string; promotionDiscountPercent: number; promotionName: string | null }>(
          data.map((item: { id: string; price: string; promotionDiscountPercent: number; promotionName: string | null }) => [item.id, item]),
        );
        setProducts((current) => current.map((product) => {
          const currentPrice = prices.get(product.id);
          return currentPrice
            ? { ...product, price: currentPrice.price, promotionDiscountPercent: currentPrice.promotionDiscountPercent, promotionName: currentPrice.promotionName }
            : product;
        }));
        setCart((current) => current.map((line) => {
          const currentPrice = prices.get(line.id);
          return currentPrice
            ? { ...line, price: currentPrice.price, promotionDiscountPercent: currentPrice.promotionDiscountPercent, promotionName: currentPrice.promotionName }
            : line;
        }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "No se pudieron actualizar los precios.");
      });
    return () => controller.abort();
  }, [customerId]);

  function addLine() {
    if (!selectedProduct || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) {
      setMessage("Selecciona un producto o servicio y una cantidad válida.");
      return;
    }
    if (cart.some((line) => line.id === selectedProduct.id)) {
      setMessage("Este producto o servicio ya está en el pedido.");
      return;
    }
    setCart((current) => [...current, {
      ...selectedProduct,
      quantity: Number(quantity),
      discountPercent: 0,
    }]);
    setSelectedProductId("");
    setProductQuery("");
    setQuantity("1");
    setMessage("");
  }

  function removeLine(productId: string) {
    setCart((current) => current.filter((line) => line.id !== productId));
  }

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart.length) {
      setMessage("Agrega al menos un producto o servicio al pedido.");
      return;
    }
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      setMessage("Permite las ventanas emergentes para generar la nota de pedido.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    let order: Order;
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          orderDate,
          notes,
          items: cart.map((line) => ({
            productId: line.id,
            quantity: line.quantity,
            discountPercent: Math.max(line.discountPercent, line.promotionDiscountPercent ?? 0),
          })),
        }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error ?? "No se pudo registrar el pedido.");
      order = data as Order;
    } catch (error) {
      previewWindow.close();
      setMessage(error instanceof Error ? error.message : "No se pudo registrar el pedido.");
      setSubmitting(false);
      return;
    }

    setIsFormOpen(false);
    setCart([]);
    setCustomerId("");
    setNotes("");
    setOrderDate(today());
    setMessage(`Pedido ${order.number} registrado. Imprime la nota y obtén las firmas.`);
    try {
      await openCustomerOrderPdf(toPdfOrder(order), previewWindow);
    } catch (error) {
      previewWindow.close();
      setMessage(`El pedido ${order.number} se registró, pero no se pudo generar su nota. Puedes volver a imprimirla desde la lista.`);
      console.error("ERROR_RENDERING_CUSTOMER_ORDER_NOTE", error);
    }
    try {
      await loadOrders();
    } catch (error) {
      setMessage(error instanceof Error
        ? `El pedido ${order.number} se registró; no se pudo actualizar la lista: ${error.message}`
        : "El pedido se registró, pero no se pudo actualizar la lista.");
    }
    setSubmitting(false);
  }

  async function printOrder(order: Order) {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      setMessage("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e inténtalo otra vez.");
      return;
    }
    try {
      await openCustomerOrderPdf(toPdfOrder(order), previewWindow);
    } catch (error) {
      previewWindow.close();
      setMessage(error instanceof Error ? error.message : "No se pudo generar la nota de pedido.");
    }
  }

  async function processOrder(action: "deliver" | "cancel", order: Order) {
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "cancel"
          ? { action, orderId: order.id }
          : {
              action,
              orderId: order.id,
              receivedByName,
              paymentMethod,
              paymentAmount: paymentMethod === "CREDIT" ? 0 : Number(paymentAmount),
              cashAccountId: cashAccountId || undefined,
              paymentReference: paymentReference.trim() || undefined,
              requiresInvoice,
            }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error ?? "No se pudo actualizar el pedido.");
      setSelectedOrder(null);
      await loadOrders();
      setMessage(action === "deliver"
        ? `Pedido ${order.number} entregado y convertido en venta.`
        : `Pedido ${order.number} cancelado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operaciones · Pedidos</p>
          <h1>Pedidos</h1>
          <p className="muted">Registra pedidos de clientes, imprime la nota para firmas y confirma la venta al entregar.</p>
        </div>
        {canWrite && (
          <button className="primary-button" type="button" onClick={() => {
            setMessage("");
            setCart([]);
            setCustomerId("");
            setOrderDate(today());
            setNotes("");
            setProductQuery("");
            setSelectedProductId("");
            setQuantity("1");
            setIsFormOpen(true);
          }}>
            <Plus size={16} /> Nuevo pedido
          </button>
        )}
      </div>

      {message && !isFormOpen && <div className="notice" role="status">{message}</div>}

      <section className="panel">
        <div className="module-toolbar">
          <label>
            Buscar pedido
            <div className="search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Número o cliente" />
            </div>
          </label>
          <label>
            Estado
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">Todos</option>
              <option value="PENDING">Pendientes</option>
              <option value="DELIVERED">Entregados</option>
              <option value="CANCELLED">Cancelados</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Detalle</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Venta(s)</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}>Cargando pedidos...</td></tr>
              ) : visibleOrders.length === 0 ? (
                <tr><td colSpan={8}>No hay pedidos para mostrar.</td></tr>
              ) : visibleOrders.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.number}</strong></td>
                  <td>{new Date(order.createdAt).toLocaleDateString("es-BO")}</td>
                  <td>{order.customer.name}</td>
                  <td>{order.items.map((item) => `${item.product.name} × ${item.quantity}`).join(", ")}</td>
                  <td>{money.format(Number(order.total))}</td>
                  <td>
                    <span className={`status ${order.status === "PENDING" ? "warning" : order.status === "DELIVERED" ? "success" : "neutral"}`}>
                      <i />{order.status === "PENDING" ? "Pendiente" : order.status === "DELIVERED" ? "Entregado" : "Cancelado"}
                    </span>
                  </td>
                  <td>{order.sales.map((sale) => sale.number).join(", ") || "—"}</td>
                  <td>
                    <div className="row-actions">
                      <button className="outline-button" type="button" onClick={() => void printOrder(order)} title="Imprimir nota de pedido">
                        <Printer size={14} /> Nota
                      </button>
                      {canWrite && order.status === "PENDING" && (
                        <>
                          <button className="primary-button" type="button" onClick={() => setSelectedOrder(order)}>Confirmar entrega</button>
                          <button className="row-menu" type="button" aria-label={`Cancelar pedido ${order.number}`} onClick={() => {
                            if (window.confirm(`¿Cancelar el pedido ${order.number}?`)) void processOrder("cancel", order);
                          }}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canWrite && (
        <Modal
          open={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          page="Operaciones · Pedidos"
          title="Nuevo pedido"
          description="El pedido queda pendiente; el stock y la venta se registran al confirmar su entrega."
          className="sale-modal"
        >
          <form className="sale-form" onSubmit={handleCreateOrder}>
            <div className="sale-note-sheet">
              <header className="sale-note-editor-header">
                <div className="sale-note-editor-brand">
                  <strong>Businessman <span>S.R.L.</span></strong>
                  <small>Pedido de productos y servicios</small>
                </div>
                <div className="sale-note-editor-document">
                  <span>Documento comercial</span>
                  <strong>NOTA DE PEDIDO</strong>
                  <small>Borrador · Se asignará número al registrar</small>
                </div>
              </header>
              {message && <p className="module-message" role="alert">{message}</p>}

              <section className="sale-section">
                <h3 className="sale-section-title"><span>01</span> Datos del pedido</h3>
                <div className="sale-note-fields">
                  <label>
                    <span>Cliente <b>*</b></span>
                    <select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                      <option value="">Selecciona un cliente</option>
                      {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.document}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Fecha del pedido <b>*</b></span>
                    <input required type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} />
                  </label>
                  <div className="sale-note-info-cell">
                    <span>Estado inicial</span>
                    <strong>Pendiente de entrega</strong>
                  </div>
                </div>
              </section>

              <section className="sale-section">
                <h3 className="sale-section-title"><span>02</span> Detalle del pedido</h3>
                <div className="sale-note-fields order-note-item-entry">
                  <label>
                    <span>Buscar producto o servicio</span>
                    <input type="search" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Nombre o código" />
                  </label>
                  <label>
                    <span>Producto o servicio</span>
                    <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
                      <option value="">Selecciona un producto o servicio</option>
                      {filteredProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} · {product.name} · {money.format(Number(product.price))}
                          {product.type === "SERVICE"
                            ? ` · Servicio${product.serviceBillingPeriod === "MONTHLY" ? " mensual" : product.serviceBillingPeriod === "ANNUAL" ? " anual" : ""}`
                            : ` · stock ${product.currentStock}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Cantidad</span>
                    <input min="1" step="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                  </label>
                  <button className="outline-button" type="button" onClick={addLine}><Plus size={15} /> Agregar al pedido</button>
                </div>

                <div className="sale-note-table-wrap">
                  <table className="sale-note-table">
                    <thead>
                      <tr><th>Producto / servicio</th><th>Cantidad</th><th>Precio unitario</th><th>Desc. %</th><th>Importe</th><th /></tr>
                    </thead>
                    <tbody>
                      {cart.length === 0 ? (
                        <tr><td className="sale-note-empty" colSpan={6}>Agrega productos o servicios para completar el pedido.</td></tr>
                      ) : cart.map((line) => {
                        const discount = Math.max(line.discountPercent, line.promotionDiscountPercent ?? 0);
                        return (
                          <tr key={line.id}>
                            <td className="sale-note-item">
                              <strong>{line.name}</strong>
                              <small>{line.sku}{line.type === "SERVICE" ? ` · ${line.serviceBillingPeriod === "MONTHLY" ? "Servicio mensual" : line.serviceBillingPeriod === "ANNUAL" ? "Servicio anual" : "Servicio único"}` : ` · Stock ${line.currentStock}`}</small>
                            </td>
                            <td>{line.quantity}</td>
                            <td className="sale-note-number">{money.format(Number(line.price))}</td>
                            <td>{canDiscount ? (
                              <input className="sale-note-discount" aria-label={`Descuento de ${line.name}`} type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={(event) => setCart((current) => current.map((item) => item.id === line.id ? { ...item, discountPercent: Number(event.target.value) } : item))} />
                            ) : `${discount}%`}</td>
                            <td className="sale-note-number">{money.format(roundMoney(Number(line.price) * line.quantity * (1 - discount / 100)))}</td>
                            <td><button className="row-menu" type="button" aria-label={`Quitar ${line.name}`} onClick={() => removeLine(line.id)}><Trash2 size={14} /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="sale-note-item-count">{cart.length} {cart.length === 1 ? "ítem" : "ítems"} en el pedido</p>
              </section>

              <section className="sale-section sale-note-observations">
                <h3 className="sale-section-title"><span>03</span> Observaciones</h3>
                <label>
                  <span>Instrucciones o información adicional</span>
                  <textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional" />
                </label>
              </section>

              <footer className="sale-note-totals">
                <div className="sale-note-total-lines">
                  <div><span>Subtotal</span><strong>{money.format(subtotal)}</strong></div>
                  {discountTotal > 0 && <div><span>Descuento</span><strong>-{money.format(discountTotal)}</strong></div>}
                  <div className="sale-note-total-due"><span>Total del pedido</span><strong>{money.format(total)}</strong></div>
                </div>
                <div className="modal-actions">
                  <button className="outline-button" type="button" onClick={() => setIsFormOpen(false)}>Cancelar</button>
                  <button className="primary-button" type="submit" disabled={submitting || cart.length === 0 || !customerId}>
                    <FileText size={15} /> {submitting ? "Registrando…" : "Registrar e imprimir nota"}
                  </button>
                </div>
              </footer>
            </div>
          </form>
        </Modal>
      )}

      <Modal open={Boolean(selectedOrder)} onClose={() => setSelectedOrder(null)} page="Operaciones · Entrega" title="Confirmar entrega y venta" description="Al confirmar se registran la venta, el stock, el cobro y la cuenta por cobrar que corresponda." className="proforma-modal">
        {selectedOrder && (
          <div className="product-form">
            <div className="module-stats">
              <div><span>Pedido</span><strong>{selectedOrder.number}</strong></div>
              <div><span>Cliente</span><strong>{selectedOrder.customer.name}</strong></div>
              <div><span>Total</span><strong>{money.format(Number(selectedOrder.total))}</strong></div>
            </div>
            <div className="product-form-grid">
              <label>
                Recibido por
                <input required maxLength={120} value={receivedByName} onChange={(event) => setReceivedByName(event.target.value)} placeholder="Nombre de quien recibe" />
              </label>
              <label>
                Forma de pago
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                  <option value="CASH">Efectivo</option>
                  <option value="BANK_TRANSFER">Transferencia bancaria</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="QR">QR</option>
                  <option value="OTHER">Otro</option>
                  <option value="CREDIT">Crédito</option>
                </select>
              </label>
              {paymentMethod !== "CREDIT" && (
                <label>
                  Pago recibido (Bs)
                  <input min="0" max={selectedOrder.total} step="0.01" type="number" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                </label>
              )}
              {paymentMethod !== "CASH" && paymentMethod !== "CREDIT" && (
                <label>
                  Cuenta
                  <select required={Number(paymentAmount) > 0} value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
                    <option value="">Selecciona cuenta</option>
                    {allowedAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
              )}
              {(paymentMethod === "BANK_TRANSFER" || paymentMethod === "QR") && Number(paymentAmount) > 0 && (
                <label>
                  Referencia de pago
                  <input required maxLength={100} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
                </label>
              )}
            </div>
            {paymentMethod === "CASH" && <p className="muted">El efectivo quedará registrado bajo custodia del vendedor. Un saldo pendiente se registrará en Cuentas por cobrar.</p>}
            {paymentMethod === "CREDIT" && <p className="muted">El total quedará pendiente de cobro, sujeto al límite de crédito del cliente.</p>}
            {paymentMethod !== "CREDIT" && Number(paymentAmount) < Number(selectedOrder.total) && (
              <p className="muted">Saldo por cobrar: {money.format(Math.max(0, Number(selectedOrder.total) - Number(paymentAmount)))}</p>
            )}
            <label className="checkbox-row">
              <input type="checkbox" checked={requiresInvoice} onChange={(event) => setRequiresInvoice(event.target.checked)} />
              Emitir factura
            </label>
            <div className="panel-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button className="outline-button" type="button" onClick={() => setSelectedOrder(null)}>Cancelar</button>
              <button className="primary-button" type="button" disabled={submitting || !receivedByName.trim() || (paymentMethod !== "CREDIT" && Number(paymentAmount) > 0 && !cashAccountId && paymentMethod !== "CASH") || (paymentMethod === "BANK_TRANSFER" && Number(paymentAmount) > 0 && !paymentReference.trim()) || (paymentMethod === "QR" && Number(paymentAmount) > 0 && !paymentReference.trim())} onClick={() => void processOrder("deliver", selectedOrder)}>
                {submitting ? "Procesando..." : "Confirmar entrega"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
