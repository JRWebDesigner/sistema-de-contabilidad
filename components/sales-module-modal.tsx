"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";
import { openPaymentReceiptPdf, type PaymentReceiptPdfData } from "./payment-receipt-pdf";
import { openSaleNotePdf, type SaleNotePdfData } from "./sales-note-pdf";

type Product = {
  id: string;
  type: "PRODUCT" | "SERVICE";
  serviceBillingPeriod: "ONE_TIME" | "MONTHLY" | "ANNUAL" | null;
  name: string;
  sku: string;
  price: string;
  currentStock: number;
  catalogPrice?: string;
  promotionDiscountPercent?: number;
  promotionName?: string | null;
};
type Customer = { id: string; name: string; document: string };
type CashAccount = {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "POS";
};
function isCashAccountList(value: unknown): value is CashAccount[] {
  return Array.isArray(value) && value.every((account) =>
    typeof account === "object" &&
    account !== null &&
    "id" in account &&
    typeof account.id === "string" &&
    "name" in account &&
    typeof account.name === "string" &&
    "type" in account &&
    (account.type === "CASH" || account.type === "BANK" || account.type === "POS"),
  );
}
type CartLine = Product & { quantity: number; discountPercent: number };
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "QR" | "CREDIT" | "OTHER";
type Sale = {
  id: string;
  number: string;
  status: "COMPLETED" | "CANCELLED";
  paymentMethod: PaymentMethod;
  paymentReference: string | null;
  requiresInvoice?: boolean;
  originalPrintedAt: string | null;
  discountTotal: string;
  total: string;
  createdAt: string;
  customer: { name: string; document: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    returnedQuantity: number;
    product: { name: string; sku: string; type: "PRODUCT" | "SERVICE" };
  }>;
};

const money = new Intl.NumberFormat("es-BO", {
  style: "currency",
  currency: "BOB",
  minimumFractionDigits: 2,
});
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const lineDiscount = (amount: number, discountPercent: number) => roundMoney(amount * discountPercent / 100);
const boliviaToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
  icon: typeof Banknote;
}[] = [
  { value: "CASH", label: "Efectivo", icon: Banknote },
  { value: "BANK_TRANSFER", label: "Banco", icon: Building2 },
  { value: "CARD", label: "Tarjeta", icon: CreditCard },
  { value: "OTHER", label: "Otro", icon: Wallet },
  { value: "QR", label: "QR", icon: QrCode },
  { value: "CREDIT", label: "Crédito", icon: Wallet },
];

const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  BANK_TRANSFER: "Banco",
  CARD: "Tarjeta",
  QR: "QR",
  OTHER: "Otro",
  CREDIT: "Crédito",
};

export default function SalesModuleModal() {
  const canWrite = usePermission("sales:write");
  const canDiscount = usePermission("sales:discount");
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesQuery, setSalesQuery] = useState("");
  const [isLoadingSales, setIsLoadingSales] = useState(true);
  const [salesError, setSalesError] = useState("");
  const [cancellingSaleId, setCancellingSaleId] = useState("");
  const [printingSaleId, setPrintingSaleId] = useState("");
  const [returningSale, setReturningSale] = useState<Sale | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnError, setReturnError] = useState("");
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [saleDate, setSaleDate] = useState(boliviaToday);
  const [requiresInvoice, setRequiresInvoice] = useState(false);
  const [saleDescription, setSaleDescription] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function printSaleNote(sale: Sale) {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      setFeedback({ tone: "error", text: "El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes e inténtalo otra vez." });
      return;
    }

    setPrintingSaleId(sale.id);
    setFeedback(null);
    try {
      const response = await fetch("/api/sales/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId: sale.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo generar la nota de venta.");

      const note: SaleNotePdfData = {
        ...data,
        subtotal: Number(data.subtotal),
        discountTotal: Number(data.discountTotal),
        taxAmount: Number(data.taxAmount),
        total: Number(data.total),
        receivable: data.receivable ? {
          paidAmount: Number(data.receivable.paidAmount),
          balance: Number(data.receivable.balance),
        } : null,
        items: data.items.map((item: {
          name: string;
          sku: string;
          type: "PRODUCT" | "SERVICE";
          quantity: number;
          unitPrice: string;
          discountPercent: string;
          lineTotal: string;
        }) => ({
          ...item,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          lineTotal: Number(item.lineTotal),
        })),
      };

      if (data.copyType === "ORIGINAL") {
        setSales((current) => current.map((currentSale) =>
          currentSale.id === sale.id
            ? { ...currentSale, originalPrintedAt: new Date().toISOString() }
            : currentSale,
        ));
      }
      await openSaleNotePdf(note, previewWindow);
      setFeedback({
        tone: "success",
        text: `Nota de venta ${sale.number}: ${data.copyType === "ORIGINAL" ? "original" : "copia"} lista para imprimir.`,
      });
    } catch (error) {
      previewWindow.close();
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "No se pudo generar la nota de venta.",
      });
    } finally {
      setPrintingSaleId("");
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then((response) => response.json()),
      fetch("/api/customers").then((response) => response.json()),
      fetch("/api/sales/accounts").then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok || !isCashAccountList(data)) {
          const message = typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
            ? data.error
            : "No se pudieron cargar las cuentas de cobro.";
          throw new Error(message);
        }
        return data;
      }),
    ])
      .then(([productData, customerData, accountData]) => {
        const catalog = productData
          .filter((product: Product) => product.type === "PRODUCT" || product.serviceBillingPeriod === "ONE_TIME")
          .map((product: Product) => ({ ...product, catalogPrice: product.price }));
        setCatalogProducts(catalog);
        setProducts(catalog);
        setCustomers(customerData);
        setAccounts(accountData);
      })
      .catch((error) => {
        setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudieron cargar los datos de ventas." });
      })
      .finally(() => setIsLoadingData(false));
  }, []);

  useEffect(() => {
    if (!catalogProducts.length) return;
    const controller = new AbortController();
    const query = customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
    setPricingLoading(true);
    setPricingError("");
    fetch(`/api/sales/pricing${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error(data.error ?? "No se pudieron calcular los precios.");
        const prices = new Map<string, { price: string; promotionDiscountPercent: number; promotionName: string | null }>(
          data.map((item: { id: string; price: string; promotionDiscountPercent: number; promotionName: string | null }) =>
            [item.id, item],
          ),
        );
        const pricedProducts = catalogProducts.map((product) => {
          const effective = prices.get(product.id);
          return {
            ...product,
            price: effective?.price ?? product.catalogPrice ?? product.price,
            promotionDiscountPercent: effective?.promotionDiscountPercent ?? 0,
            promotionName: effective?.promotionName ?? null,
          };
        });
        setProducts(pricedProducts);
        setCart((current) => current.map((line) => {
          const latest = pricedProducts.find((product) => product.id === line.id);
          return latest ? { ...line, ...latest } : line;
        }));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "No se pudieron calcular los precios.";
        setPricingError(message);
        setFeedback({ tone: "error", text: message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false);
      });
    return () => controller.abort();
  }, [catalogProducts, customerId]);

  async function loadSales() {
    setIsLoadingSales(true);
    setSalesError("");
    try {
      const response = await fetch("/api/sales");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el historial de ventas.");
      setSales(data);
    } catch (error) {
      setSalesError(error instanceof Error ? error.message : "No se pudo cargar el historial de ventas.");
      setSales([]);
    } finally {
      setIsLoadingSales(false);
    }
  }

  async function cancelSale(sale: Sale) {
    const reason = window.prompt(`Motivo para anular la venta ${sale.number}:`)?.trim();
    if (!reason) return;
    if (!window.confirm(`¿Anular la venta ${sale.number}? Se registrará el reembolso y la devolución de inventario.`)) return;

    setCancellingSaleId(sale.id);
    try {
      const response = await fetch(`/api/sales?id=${encodeURIComponent(sale.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo anular la venta.");
      await loadSales();
      setFeedback({ tone: "success", text: `Venta ${sale.number} anulada.` });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo anular la venta." });
    } finally {
      setCancellingSaleId("");
    }
  }

  async function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!returningSale || isSubmittingReturn) return;
    setReturnError("");
    const items = returningSale.items
      .map((item) => ({ saleItemId: item.id, quantity: Number(returnQuantities[item.id] ?? 0) }))
      .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
    if (items.length === 0) {
      setFeedback({ tone: "error", text: "Indica la cantidad de al menos un producto que se devolverá." });
      return;
    }

    setIsSubmittingReturn(true);
    try {
      const response = await fetch("/api/sales/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId: returningSale.id, reason: returnReason.trim(), items }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo registrar la devolución.");

      await loadSales();
      setReturningSale(null);
      setReturnReason("");
      setReturnQuantities({});
      setFeedback({
        tone: "success",
        text: `Devolución ${data.number} registrada · ${money.format(Number(data.total))}.`,
      });
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : "No se pudo registrar la devolución.");
    } finally {
      setIsSubmittingReturn(false);
    }
  }

  useEffect(() => {
    void loadSales();
  }, []);

  const subtotal = useMemo(
    () => roundMoney(cart.reduce((sum, line) => sum + Number(line.price) * line.quantity, 0)),
    [cart],
  );
  const discountTotal = useMemo(
    () => roundMoney(cart.reduce((sum, line) =>
      sum + lineDiscount(Number(line.price) * line.quantity, Math.max(line.discountPercent, line.promotionDiscountPercent ?? 0)), 0)),
    [cart],
  );
  const total = Math.round((subtotal - discountTotal + Number.EPSILON) * 100) / 100;
  const enteredPaymentAmount = paymentAmount === "" ? total : Number(paymentAmount);
  const balanceDue = roundMoney(Math.max(0, total - enteredPaymentAmount));
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const paymentAccounts = useMemo(
    () => accounts.filter((account) => (
      paymentMethod === "BANK_TRANSFER"
        ? account.type === "BANK"
        : paymentMethod === "CARD"
          ? account.type === "POS"
          : true
    )),
    [accounts, paymentMethod],
  );

  useEffect(() => {
    if (paymentMethod === "CASH" || paymentMethod === "CREDIT") {
      setCashAccountId("");
      return;
    }

    if (!paymentAccounts.some((account) => account.id === cashAccountId)) {
      setCashAccountId(paymentAccounts[0]?.id ?? "");
    }
  }, [cashAccountId, paymentAccounts, paymentMethod]);

  const matchingProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    return products
      .filter((product) => product.type === "SERVICE" || product.currentStock > 0)
      .filter(
        (product) =>
          query.length === 0 ||
          product.name.toLowerCase().includes(query) ||
          product.sku.toLowerCase().includes(query),
      )
      .slice(0, 6);
  }, [products, productQuery]);

  const filteredSales = useMemo(() => {
    const query = salesQuery.trim().toLowerCase();
    if (!query) return sales;
    return sales.filter((sale) => [
      sale.number,
      sale.customer?.name ?? "Consumidor final",
      sale.customer?.document ?? "",
      paymentLabels[sale.paymentMethod],
      sale.paymentReference ?? "",
    ].some((value) => value.toLowerCase().includes(query)));
  }, [sales, salesQuery]);

  function addProduct(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.id === product.id);
      if (existing) {
        if (product.type === "PRODUCT" && existing.quantity >= product.currentStock) return current;
        return current.map((line) =>
          line.id === product.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [...current, { ...product, quantity: 1, discountPercent: 0 }];
    });
    setProductQuery("");
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((line) => {
          if (line.id !== productId) return line;
          const nextQuantity = line.type === "SERVICE"
            ? Math.max(line.quantity + delta, 0)
            : Math.min(Math.max(line.quantity + delta, 0), line.currentStock);
          return { ...line, quantity: nextQuantity };
        })
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((current) => current.filter((line) => line.id !== productId));
  }

  function changeDiscount(productId: string, value: number) {
    const discountPercent = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
    setCart((current) => current.map((line) =>
      line.id === productId ? { ...line, discountPercent } : line,
    ));
  }

  function resetForm() {
    setCart([]);
    setCustomerId("");
    setPaymentMethod("CASH");
    setPaymentReference("");
    setPaymentAmount("");
    setSaleDate(boliviaToday());
    setRequiresInvoice(false);
    setSaleDescription("");
    setCashAccountId("");
    setProductQuery("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cart.length === 0 || isSubmitting) return;
    if (pricingLoading || pricingError) {
      setFeedback({ tone: "error", text: pricingError || "Espera a que termine el cálculo de precios." });
      return;
    }
    setFeedback(null);
    setIsSubmitting(true);
    const shouldPrintPaymentReceipt = enteredPaymentAmount > 0 && enteredPaymentAmount < total;
    const receiptWindow = shouldPrintPaymentReceipt ? window.open("about:blank", "_blank") : null;
    let receiptWarning = "";
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId || undefined,
          cashAccountId:
            paymentMethod === "CASH" || paymentMethod === "CREDIT" ? undefined : cashAccountId || undefined,
          paymentMethod,
          paymentReference: paymentReference.trim() || undefined,
          paymentAmount: paymentAmount === "" ? total : Number(paymentAmount),
          saleDate,
          requiresInvoice,
          notes: saleDescription.trim() || undefined,
          items: cart.map((line) => ({
            productId: line.id,
            quantity: line.quantity,
            discountPercent: line.discountPercent,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        receiptWindow?.close();
        setFeedback({
          tone: "error",
          text: data.error ?? "No se pudo registrar la venta.",
        });
        return;
      }
      if (data.paymentId && shouldPrintPaymentReceipt) {
        if (!receiptWindow) {
          receiptWarning = " La ventana del comprobante fue bloqueada; podrás reimprimirlo desde el historial de cobros.";
        } else {
          try {
            const receiptResponse = await fetch("/api/receivables/receipt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentId: data.paymentId }),
            });
            if (!receiptResponse.ok) {
              const receiptError = await receiptResponse.json();
              throw new Error(receiptError.error ?? "No se pudo generar la nota de cobro.");
            }
            const receipt: PaymentReceiptPdfData = await receiptResponse.json();
            await openPaymentReceiptPdf(receipt, receiptWindow);
          } catch (error) {
            receiptWindow.close();
            receiptWarning = ` No se pudo abrir la nota de cobro: ${error instanceof Error ? error.message : "error desconocido"}.`;
          }
        }
      } else {
        receiptWindow?.close();
      }
      resetForm();
      setIsModalOpen(false);
      await loadSales();
      setFeedback({
        tone: "success",
        text: `Venta ${data.number} registrada · Abono ${money.format(Number(data.paidAmount))} · Saldo ${money.format(Number(data.balanceDue))}.${receiptWarning}`,
      });
    } catch {
      receiptWindow?.close();
      setFeedback({
        tone: "error",
        text: "No se pudo conectar con el servidor. Intenta nuevamente.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operaciones · Bolivia</p>
          <h1>Ventas</h1>
          <p className="muted">
            Registra ventas internas en bolivianos.
          </p>
        </div>
        {canWrite && <button className="primary-button" onClick={() => setIsModalOpen(true)}>
          <Plus size={17} /> Nueva venta
        </button>}
      </div>

      {feedback && (
        <div className={`inline-alert inline-alert-${feedback.tone}`}>
          <span>{feedback.text}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setFeedback(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <article className="panel module-table sales-history-panel">
        <div className="panel-header">
          <div>
            <h2>Historial de ventas</h2>
            <p>Consulta las operaciones registradas y sus cobros.</p>
          </div>
          <span className="currency-note">{sales.length} registros</span>
        </div>
        <div className="module-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input value={salesQuery} onChange={(event) => setSalesQuery(event.target.value)} placeholder="Buscar por número o cliente..." />
          </div>
          <button className="outline-button" type="button" onClick={() => void loadSales()} disabled={isLoadingSales}>
            {isLoadingSales ? <Loader2 size={15} className="spin" /> : "Actualizar"}
          </button>
        </div>
        <div className="table-scroll">
          {isLoadingSales ? (
            <p className="muted sales-table-message"><Loader2 size={16} className="spin" /> Cargando historial...</p>
          ) : salesError ? (
            <p className="module-message sales-table-message">{salesError}</p>
          ) : (
            <table>
              <thead><tr><th>Venta</th><th>Cliente</th><th>Fecha</th><th>Medio de pago</th><th>Comprobante</th><th>Factura</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filteredSales.length === 0 ? <tr><td colSpan={9}>No hay ventas que coincidan con la búsqueda.</td></tr> : filteredSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <strong>{sale.number}</strong>
                      {sale.originalPrintedAt && <small>Nota original emitida</small>}
                    </td>
                    <td><div className="product-cell"><span className="product-thumb"><ShoppingCart size={16} /></span><div><strong>{sale.customer?.name ?? "Consumidor final"}</strong><small>{sale.customer?.document ?? "Sin documento"}</small></div></div></td>
                    <td>{new Date(sale.createdAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>{paymentLabels[sale.paymentMethod]}</td>
                    <td>{sale.paymentReference || "-"}</td>
                    <td>{sale.requiresInvoice ? "Sí" : "No"}</td>
                    <td>
                      <strong>{money.format(Number(sale.total))}</strong>
                      {Number(sale.discountTotal) > 0 && <small>Desc. -{money.format(Number(sale.discountTotal))}</small>}
                    </td>
                    <td><span className={`status ${sale.status === "COMPLETED" ? "success" : "warning"}`}><i />{sale.status === "COMPLETED" ? "Completada" : "Cancelada"}</span></td>
                    <td>{sale.status === "COMPLETED" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="outline-button"
                          type="button"
                          disabled={printingSaleId === sale.id}
                          onClick={() => void printSaleNote(sale)}
                          title={sale.originalPrintedAt ? "Reimprimir nota como copia" : "Imprimir nota original"}
                        >
                          {printingSaleId === sale.id
                            ? <Loader2 size={14} className="spin" />
                            : <Printer size={14} />}
                          {sale.originalPrintedAt ? "Reimprimir copia" : "Imprimir original"}
                        </button>
                        {canWrite && sale.items.some((item) => item.product.type === "PRODUCT" && item.quantity > item.returnedQuantity) && (
                          <button
                            className="outline-button"
                            type="button"
                            onClick={() => {
                              setReturningSale(sale);
                              setReturnReason("");
                              setReturnError("");
                              setReturnQuantities(Object.fromEntries(sale.items.map((item) => [item.id, "0"])));
                            }}
                          >
                            Devolver
                          </button>
                        )}
                        {canWrite && <button className="outline-button" type="button" disabled={cancellingSaleId === sale.id} onClick={() => void cancelSale(sale)}>{cancellingSaleId === sale.id ? <Loader2 size={14} className="spin" /> : <X size={14} />} Anular</button>}
                      </div>
                    ) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        page="Operaciones · Bolivia"
        title="Nueva nota de venta"
        description="Completa la nota con el cliente, el detalle y las condiciones de pago."
        className="sale-modal"
      >
        {isLoadingData ? (
          <div className="sale-loading">
            <Loader2 size={20} className="spin" />
            <span>Cargando productos y clientes…</span>
          </div>
        ) : (
          <form className="sale-form" onSubmit={handleSubmit}>
            <div className="sale-note-sheet">
              <header className="sale-note-editor-header">
                <div className="sale-note-editor-brand">
                  <strong>Importlilimlab</strong>
                  <small>Venta de productos y servicios</small>
                </div>
                <div className="sale-note-editor-document">
                  <span>Documento comercial</span>
                  <strong>NOTA DE VENTA</strong>
                  <small>Borrador · Se asignará número al registrar</small>
                </div>
              </header>

              <section className="sale-section sale-note-customer">
                <h3 className="sale-section-title"><span>01</span> Datos de la venta</h3>
                <div className="sale-note-fields">
                  <label>
                    <span>Fecha de emisión <b>*</b></span>
                    <input
                      required
                      type="date"
                      value={saleDate}
                      onChange={(event) => setSaleDate(event.target.value)}
                    />
                  </label>
                  <label className="sale-note-customer-field">
                    <span>Señor(es) / Cliente</span>
                    <select
                      value={customerId}
                      onChange={(event) => setCustomerId(event.target.value)}
                    >
                      <option value="">Consumidor final</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name} — {customer.document}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sale-note-info-cell">
                    <span>Documento del cliente</span>
                    <strong>{customers.find((customer) => customer.id === customerId)?.document || "Consumidor final"}</strong>
                  </div>
                </div>
              </section>

            <section className="sale-section sale-note-detail">
              <h3 className="sale-section-title"><span>02</span> Detalle de productos y servicios</h3>
              <p className="sale-note-helper">Busca cada artículo o servicio y agrégalo a la nota.</p>
              <div className="product-picker">
                <Search size={16} className="product-picker-icon" />
                <input
                  type="text"
                  placeholder="Escribe el nombre o código del producto o servicio"
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                />
              </div>

              {productQuery.trim().length > 0 && (
                <div className="product-results">
                  {matchingProducts.length === 0 ? (
                    <p className="product-results-empty">
                      No hay productos disponibles que coincidan.
                    </p>
                  ) : (
                    matchingProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className="product-result-row"
                        onClick={() => addProduct(product)}
                      >
                        <div>
                          <strong>{product.name}</strong>
                          <small>{product.sku}</small>
                        </div>
                        <div className="product-result-meta">
                          <span>{money.format(Number(product.price))}</span>
                          {product.promotionName && (
                            <small>{product.promotionName} · -{product.promotionDiscountPercent}%</small>
                          )}
                          {product.type === "SERVICE" ? (
                            <span className="stock-pill">Servicio · pago único</span>
                          ) : (
                            <span className="stock-pill">Stock {product.currentStock}</span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="sale-note-table-wrap">
                <table className="sale-note-table">
                  <thead>
                    <tr>
                      <th>Producto / servicio</th>
                      <th>Cantidad</th>
                      <th>Precio unitario</th>
                      <th>Desc. %</th>
                      <th>Importe</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.length === 0 ? (
                      <tr><td className="sale-note-empty" colSpan={6}>El detalle está vacío. Agrega productos o servicios para continuar.</td></tr>
                    ) : cart.map((line) => {
                      const discountPercent = Math.max(line.discountPercent, line.promotionDiscountPercent ?? 0);
                      const lineTotal = Number(line.price) * line.quantity - lineDiscount(Number(line.price) * line.quantity, discountPercent);
                      return (
                        <tr key={line.id}>
                          <td className="sale-note-item">
                            <strong>{line.name}</strong>
                            <small>{line.type === "SERVICE" ? "Servicio · pago único" : "Producto"} · {line.sku}</small>
                            {line.promotionName && <small>{line.promotionName}</small>}
                          </td>
                          <td>
                            <div className="quantity-stepper">
                              <button type="button" aria-label={`Reducir cantidad de ${line.name}`} onClick={() => changeQuantity(line.id, -1)}>
                                <Minus size={13} />
                              </button>
                              <span>{line.quantity}</span>
                              <button
                                type="button"
                                aria-label={`Aumentar cantidad de ${line.name}`}
                                disabled={line.type === "PRODUCT" && line.quantity >= line.currentStock}
                                onClick={() => changeQuantity(line.id, 1)}
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                          </td>
                          <td className="sale-note-number">{money.format(Number(line.price))}</td>
                          <td className="sale-note-number">
                            {canDiscount ? (
                              <input
                                className="sale-note-discount"
                                aria-label={`Descuento de ${line.name} en porcentaje`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={line.discountPercent}
                                onChange={(event) => changeDiscount(line.id, Number(event.target.value))}
                              />
                            ) : `${discountPercent}%`}
                          </td>
                          <td className="sale-note-number"><strong>{money.format(lineTotal)}</strong></td>
                          <td>
                            <button type="button" className="row-menu" aria-label={`Quitar ${line.name}`} onClick={() => removeLine(line.id)}>
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="sale-note-item-count">{itemCount} {itemCount === 1 ? "unidad" : "unidades"} en esta nota</div>
            </section>

              <section className="sale-section sale-note-payment">
                <h3 className="sale-section-title"><span>03</span> Condiciones de pago</h3>
                <div className="sale-note-payment-method">
                  <span className="sale-note-field-label">Forma de pago</span>
                  <div className="payment-method-grid" role="radiogroup" aria-label="Forma de pago">
                    {PAYMENT_METHODS.filter(({ value }) => value !== "QR" && value !== "CREDIT").map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={paymentMethod === value}
                        className={`payment-method-option${paymentMethod === value ? " is-selected" : ""}`}
                        onClick={() => setPaymentMethod(value)}
                      >
                        <Icon size={18} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sale-form-grid">
                  {paymentMethod !== "CASH" && paymentMethod !== "CREDIT" && (
                    <label>
                      Cuenta donde se recibe el pago
                      <select
                        required={enteredPaymentAmount > 0}
                        value={cashAccountId}
                        onChange={(event) => setCashAccountId(event.target.value)}
                      >
                        <option value="">Selecciona una cuenta</option>
                        {paymentAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name} ({account.type})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {paymentMethod === "BANK_TRANSFER" && (
                    <label>
                      Número de comprobante
                      <input
                        required={enteredPaymentAmount > 0}
                        maxLength={100}
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        placeholder="Ej. 84739201"
                      />
                    </label>
                  )}
                  {paymentMethod === "OTHER" && (
                    <label>
                      Detalle del medio de pago (opcional)
                      <input
                        maxLength={100}
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        placeholder="Describe cómo se recibió"
                      />
                    </label>
                  )}
                  <label>
                    Abono recibido (Bs)
                    <input
                      type="number"
                      min="0"
                      max={total}
                      step="0.01"
                      value={paymentAmount}
                      placeholder={total.toFixed(2)}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                    />
                  </label>
                  <div className="sale-note-balance">
                    <span>Saldo pendiente</span>
                    <strong>{money.format(balanceDue)}</strong>
                  </div>
                </div>
                {paymentMethod === "CASH" && (
                  <p className="sale-note-payment-hint">
                    <Wallet size={15} /> El efectivo quedará bajo custodia de quien realiza la venta hasta registrar su depósito.
                  </p>
                )}
              </section>

              <section className="sale-section sale-note-observations">
                <h3 className="sale-section-title"><span>04</span> Observaciones y facturación</h3>
                <label>
                  <span>Concepto u observación <small>(opcional)</small></span>
                  <textarea
                    maxLength={500}
                    rows={3}
                    value={saleDescription}
                    onChange={(event) => setSaleDescription(event.target.value)}
                    placeholder="Escribe aquí información adicional sobre la venta o el servicio"
                  />
                </label>
                <label className="sale-invoice-checkbox">
                  <input
                    type="checkbox"
                    checked={requiresInvoice}
                    onChange={(event) => setRequiresInvoice(event.target.checked)}
                  />
                  <span>Se entregará factura</span>
                </label>
              </section>

            <footer className="order-summary sale-note-totals">
              <div className="order-summary-rows">
                <div>
                  <span>Subtotal</span>
                  <span>{money.format(subtotal)}</span>
                </div>
                {discountTotal > 0 && (
                  <div>
                    <span>Descuentos</span>
                    <span>-{money.format(discountTotal)}</span>
                  </div>
                )}
                <div className="order-summary-total">
                  <span>Total ({itemCount} {itemCount === 1 ? "ítem" : "ítems"})</span>
                  <span>{money.format(total)}</span>
                </div>
                {enteredPaymentAmount > 0 && (
                  <div>
                    <span>Abono</span>
                    <span>{money.format(enteredPaymentAmount)}</span>
                  </div>
                )}
                {balanceDue > 0 && (
                  <div className="sale-note-due-row">
                    <span>Saldo por cobrar</span>
                    <span>{money.format(balanceDue)}</span>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={cart.length === 0 || isSubmitting || pricingLoading || Boolean(pricingError) || enteredPaymentAmount < 0 || enteredPaymentAmount > total}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={15} className="spin" /> Registrando…
                    </>
                  ) : (
                    <>
                      <Receipt size={15} /> Registrar venta
                    </>
                  )}
                </button>
              </div>
            </footer>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={returningSale !== null}
        onClose={() => setReturningSale(null)}
        page="Devoluciones · Bolivia"
        title={`Devolución ${returningSale?.number ?? ""}`}
        description="Selecciona las cantidades que regresan al inventario."
        className="sale-modal"
      >
        {returningSale && (
          <form className="sale-form" onSubmit={submitReturn}>
            {returnError && <p className="module-message">{returnError}</p>}
            {returningSale.paymentMethod === "CREDIT" && (
              <p className="inline-alert inline-alert-error">
                El importe se descontará del saldo pendiente de la cuenta por cobrar. No se puede devolver más que ese saldo.
              </p>
            )}
            <section className="sale-section">
              {returningSale.items.map((item) => {
                const remaining = item.quantity - item.returnedQuantity;
                return (
                  <label key={item.id}>
                    {item.product.name} · {item.product.sku} (vendidos: {item.quantity}, devueltos: {item.returnedQuantity})
                    <input
                      type="number"
                      min="0"
                      max={remaining}
                      step="1"
                      value={returnQuantities[item.id] ?? "0"}
                      disabled={remaining <= 0}
                      onChange={(event) => setReturnQuantities((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))}
                    />
                  </label>
                );
              })}
              <label>
                Motivo de devolución
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                />
              </label>
            </section>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setReturningSale(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSubmittingReturn}>
                {isSubmittingReturn ? <Loader2 size={15} className="spin" /> : null}
                Registrar devolución
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}