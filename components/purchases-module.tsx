"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  ClipboardList,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  QrCode,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";

type Supplier = {
  id: string;
  name: string;
  document: string;
  paymentTerms: string | null;
  estimatedDeliveryDays: number | null;
};
type Product = {
  id: string;
  name: string;
  sku: string;
  price: string;
  currentStock: number;
};
type CashAccount = {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "POS";
  balance: string;
  custodianId?: string | null;
};
type PurchaseLine = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitCost: number;
};
type PurchaseRecord = {
  id: string;
  number: string;
  status: "RECEIVED" | "CANCELLED";
  paymentMethod: PaymentMethod;
  subtotal: string;
  taxAmount: string;
  total: string;
  createdAt: string;
  supplier: { name: string; document: string };
  items: Array<{
    id: string;
    quantity: number;
    unitCost: string;
    lineTotal: string;
    product: { name: string; sku: string };
  }>;
};
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "QR" | "CREDIT";

const money = new Intl.NumberFormat("es-BO", {
  style: "currency",
  currency: "BOB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
  icon: typeof Banknote;
}[] = [
  { value: "CASH", label: "Efectivo", icon: Banknote },
  { value: "BANK_TRANSFER", label: "Transferencia", icon: Building2 },
  { value: "CARD", label: "Tarjeta", icon: CreditCard },
  { value: "QR", label: "QR", icon: QrCode },
  { value: "CREDIT", label: "Crédito", icon: Wallet },
];

const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  BANK_TRANSFER: "Transferencia",
  CARD: "Tarjeta",
  QR: "QR",
  CREDIT: "Crédito",
};

export default function PurchasesModule() {
  const canWrite = usePermission("finance:write");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [cancellingPurchaseId, setCancellingPurchaseId] = useState("");

  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [cashAccountId, setCashAccountId] = useState("");

  const [productQuery, setProductQuery] = useState("");
  const [stagedProduct, setStagedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function loadPurchaseHistory() {
    setIsLoadingHistory(true);
    try {
      const response = await fetch("/api/purchases");
      const data = await response.json().catch(() => []);
      setPurchases(response.ok && Array.isArray(data) ? data : []);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function cancelPurchase(purchase: PurchaseRecord) {
    const reason = window.prompt(`Motivo para anular la compra ${purchase.number}:`)?.trim();
    if (!reason) return;
    if (!window.confirm(`¿Anular la compra ${purchase.number}? Se revertirá el inventario y el pago asociado.`)) return;

    setCancellingPurchaseId(purchase.id);
    try {
      const response = await fetch(`/api/purchases?id=${encodeURIComponent(purchase.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo anular la compra.");
      await loadPurchaseHistory();
      setFeedback({ tone: "success", text: `Compra ${purchase.number} anulada.` });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo anular la compra." });
    } finally {
      setCancellingPurchaseId("");
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/suppliers").then((response) => response.json()),
      fetch("/api/products?type=PRODUCT").then((response) => response.json()),
      fetch("/api/cash").then((response) => response.json()),
    ])
      .then(([supplierData, productData, accountData]) => {
        setSuppliers(supplierData);
        setProducts(productData);
        const regularAccounts = accountData.filter((account: CashAccount) => !account.custodianId);
        setAccounts(regularAccounts);
        if (regularAccounts[0]) setCashAccountId(regularAccounts[0].id);
      })
      .finally(() => setIsLoadingData(false));
    void loadPurchaseHistory();
  }, []);

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    [lines],
  );
  const total = subtotal;
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);

  const matchingProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    if (query.length === 0) return [];
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(query) ||
          product.sku.toLowerCase().includes(query),
      )
      .slice(0, 6);
  }, [products, productQuery]);

  function stageProduct(product: Product) {
    setStagedProduct(product);
    setProductQuery("");
    setQuantity("1");
    setUnitCost("");
    setFeedback(null);
  }

  function cancelStaged() {
    setStagedProduct(null);
    setQuantity("1");
    setUnitCost("");
  }

  function confirmLine() {
    if (!stagedProduct) return;
    const qty = Number(quantity);
    const cost = Number(unitCost);

    if (!Number.isFinite(qty) || qty < 1) {
      setFeedback({ tone: "error", text: "Ingresa una cantidad válida." });
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setFeedback({ tone: "error", text: "Ingresa un costo unitario válido." });
      return;
    }

    setLines((current) => {
      const existing = current.find((line) => line.id === stagedProduct.id);
      if (existing) {
        return current.map((line) =>
          line.id === stagedProduct.id
            ? { ...line, quantity: line.quantity + qty, unitCost: cost }
            : line,
        );
      }
      return [
        ...current,
        {
          id: stagedProduct.id,
          name: stagedProduct.name,
          sku: stagedProduct.sku,
          quantity: qty,
          unitCost: cost,
        },
      ];
    });

    setFeedback(null);
    cancelStaged();
  }

  function changeQuantity(lineId: string, delta: number) {
    setLines((current) =>
      current
        .map((line) =>
          line.id === lineId
            ? { ...line, quantity: Math.max(line.quantity + delta, 0) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(lineId: string) {
    setLines((current) => current.filter((line) => line.id !== lineId));
  }

  function resetForm() {
    setLines([]);
    setSupplierId("");
    setPaymentMethod("CASH");
    cancelStaged();
    setProductQuery("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lines.length === 0 || !supplierId || isSubmitting) return;
    setFeedback(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          paymentMethod,
          cashAccountId:
            paymentMethod === "CREDIT" ? undefined : cashAccountId || undefined,
          items: lines.map((line) => ({
            productId: line.id,
            quantity: line.quantity,
            unitCost: line.unitCost,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback({
          tone: "error",
          text: data.error ?? "No se pudo registrar la compra.",
        });
        return;
      }
      resetForm();
      setIsFormOpen(false);
      await loadPurchaseHistory();
      setFeedback({
        tone: "success",
        text: `Compra ${data.number ?? ""} guardada · Total ${money.format(total)}`,
      });
    } catch {
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
          <p className="eyebrow">Compras · Bolivia</p>
          <h1>Registrar compra</h1>
          <p className="muted">
            Entradas de inventario y pagos a proveedores en Bs.
          </p>
        </div>
        <div className="heading-actions"><span className="currency-note">Moneda: Bs</span>{canWrite && <button className="primary-button" type="button" onClick={() => setIsFormOpen(true)}><Plus size={17} /> Nueva compra</button>}</div>
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

      <Modal open={isFormOpen} onClose={() => setIsFormOpen(false)} page="Compras · Bolivia" title="Nueva compra" description="Selecciona el proveedor, productos y medio de pago." className="purchase-modal">
      {isLoadingData ? (
        <div className="sale-loading">
          <Loader2 size={20} className="spin" />
          <span>Cargando proveedores y productos…</span>
        </div>
      ) : (
        <form className="sale-form" onSubmit={handleSubmit}>
          <section className="sale-section">
            <h3 className="sale-section-title">Proveedor y pago</h3>
            <div className="sale-form-grid">
              <label>
                Proveedor
                <select
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                  required
                >
                  <option value="">Selecciona un proveedor</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name} — {supplier.document}
                    </option>
                  ))}
                </select>
              </label>
              {selectedSupplier && (selectedSupplier.paymentTerms || selectedSupplier.estimatedDeliveryDays !== null) && (
                <p className="supplier-purchase-reference">
                  Referencia habitual:
                  {selectedSupplier.paymentTerms && <> {selectedSupplier.paymentTerms}</>}
                  {selectedSupplier.estimatedDeliveryDays !== null && <> · Entrega estimada: {selectedSupplier.estimatedDeliveryDays} días</>}
                </p>
              )}

              {paymentMethod !== "CREDIT" && (
                <label>
                  Cuenta de pago
                  <select
                    value={cashAccountId}
                    onChange={(event) => setCashAccountId(event.target.value)}
                  >
                    <option value="">Selecciona una cuenta</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.type})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div
              className="payment-method-grid"
              role="radiogroup"
              aria-label="Medio de pago"
            >
              {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={paymentMethod === value}
                  className={`payment-method-option${
                    paymentMethod === value ? " is-selected" : ""
                  }`}
                  onClick={() => setPaymentMethod(value)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="sale-section">
            <h3 className="sale-section-title">Productos</h3>

            {!stagedProduct ? (
              <>
                <div className="product-picker">
                  <Search size={16} className="product-picker-icon" />
                  <input
                    type="text"
                    placeholder="Busca por nombre o SKU"
                    value={productQuery}
                    onChange={(event) => setProductQuery(event.target.value)}
                  />
                </div>
                {productQuery.trim().length > 0 && (
                  <div className="product-results">
                    {matchingProducts.length === 0 ? (
                      <p className="product-results-empty">
                        No hay productos que coincidan.
                      </p>
                    ) : (
                      matchingProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="product-result-row"
                          onClick={() => stageProduct(product)}
                        >
                          <div>
                            <strong>{product.name}</strong>
                            <small>{product.sku}</small>
                          </div>
                          <span className="stock-pill">
                            stock {product.currentStock}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="staged-product">
                <div className="staged-product-header">
                  <div>
                    <strong>{stagedProduct.name}</strong>
                    <small>{stagedProduct.sku}</small>
                  </div>
                  <button
                    type="button"
                    className="row-menu"
                    aria-label="Cancelar selección"
                    onClick={cancelStaged}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="staged-product-fields">
                  <label>
                    Cantidad
                    <input
                      min="1"
                      type="number"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </label>
                  <label>
                    Costo unitario Bs
                    <input
                      min="0"
                      step="0.01"
                      type="number"
                      value={unitCost}
                      onChange={(event) => setUnitCost(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={confirmLine}
                  >
                    <Plus size={15} /> Agregar línea
                  </button>
                </div>
              </div>
            )}

            <div className="cart-list">
              {lines.length === 0 ? (
                <p className="cart-empty">
                  Aún no agregaste productos. Búscalos arriba para
                  comenzar.
                </p>
              ) : (
                lines.map((line) => (
                  <div className="cart-line" key={line.id}>
                    <div className="cart-line-info">
                      <span className="product-thumb">
                        <ClipboardList size={16} />
                      </span>
                      <div>
                        <strong>{line.name}</strong>
                        <small>
                          {line.sku} · {money.format(line.unitCost)} c/u
                        </small>
                      </div>
                    </div>
                    <div className="cart-line-controls">
                      <div className="quantity-stepper">
                        <button
                          type="button"
                          aria-label="Reducir cantidad"
                          onClick={() => changeQuantity(line.id, -1)}
                        >
                          <Minus size={13} />
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          type="button"
                          aria-label="Aumentar cantidad"
                          onClick={() => changeQuantity(line.id, 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <span className="cart-line-total">
                        {money.format(line.quantity * line.unitCost)}
                      </span>
                      <button
                        type="button"
                        className="row-menu"
                        aria-label="Eliminar línea"
                        onClick={() => removeLine(line.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <footer className="order-summary">
            <div className="order-summary-rows">
              <div>
                <span>Subtotal</span>
                <span>{money.format(subtotal)}</span>
              </div>
              <div className="order-summary-total">
                <span>
                  Total ({itemCount} {itemCount === 1 ? "ítem" : "ítems"})
                </span>
                <span>{money.format(total)}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={lines.length === 0 || !supplierId || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={15} className="spin" /> Guardando…
                  </>
                ) : (
                  "Guardar compra"
                )}
              </button>
            </div>
          </footer>
        </form>
      )}
      </Modal>
      <article className="panel module-table purchase-history">
        <div className="panel-header">
          <div>
            <h2>Historial de compras</h2>
            <p>Compras recibidas y registradas recientemente.</p>
          </div>
          <span className="currency-note">{purchases.length} registros</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Artículos</th>
                <th>Medio de pago</th>
                <th>Subtotal</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingHistory ? (
                <tr><td colSpan={10}>Cargando historial de compras...</td></tr>
              ) : purchases.length === 0 ? (
                <tr><td colSpan={10}>Todavía no hay compras registradas.</td></tr>
              ) : (
                purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td><strong>{purchase.number}</strong></td>
                    <td>{new Date(purchase.createdAt).toLocaleDateString("es-BO")}</td>
                    <td><div className="product-cell"><div><strong>{purchase.supplier.name}</strong><small>{purchase.supplier.document}</small></div></div></td>
                    <td><span title={purchase.items.map((item) => `${item.product.name} x${item.quantity}`).join(", ")}>{purchase.items.reduce((sum, item) => sum + item.quantity, 0)} unid.</span></td>
                    <td>{paymentLabels[purchase.paymentMethod]}</td>
                    <td>{money.format(Number(purchase.subtotal))}</td>
                    <td><strong>{money.format(Number(purchase.total))}</strong></td>
                    <td><span className={`status ${purchase.status === "CANCELLED" ? "warning" : "success"}`}><i />{purchase.status === "CANCELLED" ? "Cancelada" : "Recibida"}</span></td>
                    <td>{canWrite && purchase.status === "RECEIVED" ? <button className="outline-button" type="button" disabled={cancellingPurchaseId === purchase.id} onClick={() => void cancelPurchase(purchase)}>{cancellingPurchaseId === purchase.id ? <Loader2 size={14} className="spin" /> : <X size={14} />} Anular</button> : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}