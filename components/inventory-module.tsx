"use client";

import { FormEvent, useEffect, useState } from "react";
import { Boxes, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";

type Product = {
  id: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  currentStock: number;
  minimumStock: number;
  category: { name: string };
};
type ReturnSaleItem = {
  productId: string;
  quantity: number;
  returnedQuantity: number;
  unitPrice: string;
  product: { id: string; name: string; sku: string };
};
type ReturnSale = {
  id: string;
  number: string;
  createdAt: string;
  paymentMethod: string;
  taxRate: string;
  total: string;
  customer: { name: string; document: string } | null;
  receivable: { balance: string } | null;
  items: ReturnSaleItem[];
};
type CashAccount = {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "POS";
  balance: string;
};
type InventoryHistoryItem = {
  id: string;
  type: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "RETURN_IN" | "RETURN_OUT" | "TRANSFER_IN" | "TRANSFER_OUT";
  quantity: number;
  notes: string | null;
  reference: string | null;
  createdAt: string;
  product: { name: string; sku: string };
  sale: { number: string } | null;
  transfer: { number: string; fromBranch: { name: string } | null; toBranch: { name: string } } | null;
};
type TransferProduct = {
  id: string;
  name: string;
  sku: string;
  stocks: Array<{ branchId: string | null; quantity: number }>;
};

const money = new Intl.NumberFormat("es-BO", {
  style: "currency",
  currency: "BOB",
  minimumFractionDigits: 2,
});

export default function InventoryModule() {
  const canWrite = usePermission("inventory:write");
  const [products, setProducts] = useState<Product[]>([]);
  const [returnSales, setReturnSales] = useState<ReturnSale[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [history, setHistory] = useState<InventoryHistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    productId: "",
    type: "ADJUSTMENT_IN",
    quantity: "1",
    notes: "",
    saleId: "",
    cashAccountId: "",
  });
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingReturns, setIsLoadingReturns] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [transferData, setTransferData] = useState<{
    canManage: boolean;
    branches: Array<{ id: string; name: string; code: string }>;
    products: TransferProduct[];
  } | null>(null);
  const [transferForm, setTransferForm] = useState({ productId: "", fromBranchId: "unassigned", toBranchId: "", quantity: "1" });
  const [transferMessage, setTransferMessage] = useState("");

  async function loadInventory(search = query) {
    setIsLoading(true);
    const response = await fetch(
      `/api/inventory?q=${encodeURIComponent(search)}`,
    );
    const data = await response.json();
    setProducts(response.ok ? data : []);
    setIsLoading(false);
  }

  async function loadReturnSales() {
    setIsLoadingReturns(true);
    const response = await fetch("/api/inventory?resource=returns");
    const data = await response.json();
    setReturnSales(response.ok ? data : []);
    setIsLoadingReturns(false);
  }

  async function loadCashAccounts() {
    const response = await fetch("/api/inventory?resource=return-accounts");
    const data = await response.json();
    setCashAccounts(response.ok ? data : []);
  }

  async function loadHistory() {
    setIsLoadingHistory(true);
    const response = await fetch("/api/inventory?resource=history");
    const data = await response.json();
    setHistory(response.ok ? data : []);
    setIsLoadingHistory(false);
  }

  useEffect(() => {
    void loadInventory("");
    void loadReturnSales();
    void loadCashAccounts();
    void loadHistory();
    if (canWrite) {
      void fetch("/api/branches/transfers").then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudo cargar la información de sucursales.");
        setTransferData(data);
      }).catch((error: unknown) => {
        setTransferMessage(error instanceof Error ? error.message : "No se pudo cargar la información de sucursales.");
      });
    }
  }, []);

  const transferProduct = transferData?.products.find((product) => product.id === transferForm.productId);
  const sourceStock = transferProduct?.stocks.find((stock) =>
    stock.branchId === (transferForm.fromBranchId === "unassigned" ? null : transferForm.fromBranchId),
  )?.quantity ?? 0;

  async function handleTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferMessage("");
    const response = await fetch("/api/branches/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...transferForm,
        fromBranchId: transferForm.fromBranchId === "unassigned" ? null : transferForm.fromBranchId,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setTransferMessage(data.error ?? "No se pudo completar la transferencia.");
      return;
    }
    setTransferMessage(`Transferencia ${data.number} registrada correctamente.`);
    await Promise.all([loadInventory(), loadHistory()]);
    const refreshed = await fetch("/api/branches/transfers");
    const refreshedData = await refreshed.json();
    if (refreshed.ok) setTransferData(refreshedData);
  }

  const selectedReturnSale = returnSales.find((sale) => sale.id === form.saleId);
  const selectedReturnItem = selectedReturnSale?.items.find(
    (item) => item.productId === form.productId,
  );
  const returnableQuantity = selectedReturnItem
    ? selectedReturnItem.quantity - selectedReturnItem.returnedQuantity
    : 0;
  const returnableProducts = Array.from(
    new Map(
      returnSales
        .flatMap((sale) => sale.items)
        .filter((item) => item.quantity > item.returnedQuantity)
        .map((item) => [item.productId, item.product]),
    ).values(),
  );
  const salesForSelectedProduct = returnSales.filter((sale) =>
    sale.items.some(
      (item) =>
        item.productId === form.productId &&
        item.quantity > item.returnedQuantity,
    ),
  );
  const refundAmount = selectedReturnItem
    ? Number(selectedReturnItem.unitPrice) * Number(form.quantity || 0)
    : 0;
  const cashRefundRequired = selectedReturnSale?.paymentMethod === "CREDIT"
    && refundAmount > Number(selectedReturnSale.receivable?.balance ?? 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "No se pudo registrar el movimiento.");
      return;
    }

    setForm((current) => ({
      ...current,
      productId: "",
      type: "ADJUSTMENT_IN",
      saleId: "",
      cashAccountId: "",
      quantity: "1",
      notes: "",
    }));
    setMessage("Movimiento de inventario registrado.");
    if (form.type === "RETURN_IN") setIsReturnModalOpen(false);
    if (form.type === "ADJUSTMENT_IN" || form.type === "ADJUSTMENT_OUT") {
      setIsAdjustmentModalOpen(false);
    }
    await loadInventory();
    await loadHistory();
    if (form.type === "RETURN_IN") await loadReturnSales();
  }

  function closeReturnModal() {
    setIsReturnModalOpen(false);
    setForm((current) => ({ ...current, type: "ADJUSTMENT_IN", productId: "", saleId: "", cashAccountId: "" }));
  }

  function closeAdjustmentModal() {
    setIsAdjustmentModalOpen(false);
    setForm((current) => ({
      ...current,
      type: "ADJUSTMENT_IN",
      productId: "",
      quantity: "1",
      notes: "",
      cashAccountId: "",
    }));
  }

  async function handleDeleteInventory(id: string) {
    const confirmed = window.confirm(
      "¿Deseas eliminar este producto del inventario?",
    );
    if (!confirmed) return;
    const response = await fetch(`/api/products?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? `Producto eliminado del inventario: ${data.name ?? "ok"}`
        : (data.error ?? "No se pudo eliminar el producto."),
    );
    if (response.ok) await loadInventory();
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operaciones · Bolivia</p>
          <h1>Inventario</h1>
          <p className="muted">
            Existencias y movimientos auditables por producto.
          </p>
        </div>
        <div className="heading-actions">
          {canWrite && <button
            className="primary-button"
            type="button"
            onClick={() => {
              setForm((current) => ({
                ...current,
                type: "ADJUSTMENT_IN",
                productId: "",
                quantity: "1",
                notes: "",
                cashAccountId: "",
              }));
              setIsAdjustmentModalOpen(true);
            }}
          >
            <SlidersHorizontal size={15} /> Registrar ajuste
          </button>}
          {canWrite && <button
            className="outline-button"
            type="button"
            onClick={() => {
              setForm((current) => ({
                ...current,
                type: "RETURN_IN",
                productId: "",
                saleId: "",
                quantity: "1",
                notes: "",
                cashAccountId: "",
              }));
              setIsReturnModalOpen(true);
            }}
          >
            <RotateCcw size={15} /> Nueva devolución
          </button>}
          <span className="currency-note">Costos: Bs</span>
        </div>
      </div>
      {message && <p className="module-message">{message}</p>}
      <p className="inventory-actions-hint">
        Registra entradas, salidas y devoluciones desde acciones independientes para mantener cada movimiento bien documentado.
      </p>
      {transferData?.canManage && <section className="inventory-transfer-panel">
        <div className="inventory-transfer-heading">
          <div><strong>Asignar o transferir existencias</strong><small>El stock histórico queda en “Sin sucursal” hasta que lo asignes explícitamente.</small></div>
        </div>
        <form className="inventory-transfer-form" onSubmit={handleTransfer}>
          <label>Producto
            <select required value={transferForm.productId} onChange={(event) => setTransferForm({ ...transferForm, productId: event.target.value })}>
              <option value="">Selecciona un producto</option>
              {transferData.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
            </select>
          </label>
          <label>Origen
            <select value={transferForm.fromBranchId} onChange={(event) => setTransferForm({ ...transferForm, fromBranchId: event.target.value })}>
              <option value="unassigned">Sin sucursal ({transferProduct?.stocks.find((stock) => stock.branchId === null)?.quantity ?? 0})</option>
              {transferData.branches.map((branch) => <option key={branch.id} value={branch.id} disabled={branch.id === transferForm.toBranchId}>
                {branch.name} ({transferProduct?.stocks.find((stock) => stock.branchId === branch.id)?.quantity ?? 0})
              </option>)}
            </select>
          </label>
          <label>Destino
            <select required value={transferForm.toBranchId} onChange={(event) => setTransferForm({ ...transferForm, toBranchId: event.target.value })}>
              <option value="">Selecciona sucursal</option>
              {transferData.branches.map((branch) => <option key={branch.id} value={branch.id} disabled={branch.id === transferForm.fromBranchId}>
                {branch.name}
              </option>)}
            </select>
          </label>
          <label>Cantidad (disponible: {sourceStock})
            <input type="number" required min="1" max={sourceStock || undefined} value={transferForm.quantity} onChange={(event) => setTransferForm({ ...transferForm, quantity: event.target.value })} />
          </label>
          <button className="primary-button" type="submit" disabled={!transferForm.productId || !transferForm.toBranchId || sourceStock < 1}>Registrar transferencia</button>
        </form>
        {transferMessage && <p className="module-message" role="status">{transferMessage}</p>}
      </section>}
      <Modal
        open={isAdjustmentModalOpen}
        onClose={closeAdjustmentModal}
        page="Inventario · Ajustes"
        title="Registrar ajuste"
        description="Corrige existencias por conteo físico, merma u otra incidencia."
        className="inventory-adjustment-modal"
      >
        <form className="inventory-adjustment-form" onSubmit={handleSubmit}>
          <div className="adjustment-type-switch" role="radiogroup" aria-label="Tipo de ajuste">
            <button
              type="button"
              role="radio"
              aria-checked={form.type === "ADJUSTMENT_IN"}
              className={form.type === "ADJUSTMENT_IN" ? "is-selected" : ""}
              onClick={() => setForm({ ...form, type: "ADJUSTMENT_IN" })}
            >
              Entrada por ajuste
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.type === "ADJUSTMENT_OUT"}
              className={form.type === "ADJUSTMENT_OUT" ? "is-selected" : ""}
              onClick={() => setForm({ ...form, type: "ADJUSTMENT_OUT" })}
            >
              Salida por ajuste
            </button>
          </div>
          <label>
            Producto
            <select
              required
              value={form.productId}
              onChange={(event) => setForm({ ...form, productId: event.target.value })}
            >
              <option value="">Selecciona un producto</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · stock actual {product.currentStock}
                </option>
              ))}
            </select>
          </label>
          <div className="adjustment-fields">
            <label>
              Cantidad
              <input
                required
                min="1"
                type="number"
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              />
            </label>
            <label>
              Motivo / nota
              <input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Ej. conteo físico"
              />
            </label>
          </div>
          <div className="modal-actions">
            <button className="outline-button" type="button" onClick={closeAdjustmentModal}>
              Cancelar
            </button>
            <button className="primary-button" type="submit">
              <SlidersHorizontal size={15} /> Confirmar ajuste
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={isReturnModalOpen}
        onClose={closeReturnModal}
        page="Inventario · Devoluciones"
        title="Registrar devolución"
        description="Relaciona el producto con su venta para actualizar stock y caja."
        className="inventory-return-modal"
      >
        <form className="inventory-return-form" onSubmit={handleSubmit}>
          <div className="return-step-grid">
            <label>
              Producto devuelto
              <select
                required
                value={form.productId}
                onChange={(event) =>
                  setForm({ ...form, productId: event.target.value, saleId: "" })
                }
              >
                <option value="">Selecciona un producto</option>
                {returnableProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {product.sku}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Venta de origen
              <select
                required
                value={form.saleId}
                onChange={(event) =>
                  setForm({ ...form, saleId: event.target.value })
                }
              >
                <option value="">
                  {isLoadingReturns ? "Cargando ventas..." : "Selecciona una venta"}
                </option>
                {salesForSelectedProduct.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {sale.number} · {sale.customer?.name ?? "Consumidor final"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Cuenta para devolver el dinero
            <select
              required={selectedReturnSale?.paymentMethod !== "CREDIT" || cashRefundRequired}
              value={form.cashAccountId}
              onChange={(event) =>
                setForm({ ...form, cashAccountId: event.target.value })
              }
            >
              <option value="">
                {selectedReturnSale?.paymentMethod === "CREDIT"
                  ? "No aplica: se ajustará la cuenta por cobrar"
                  : "Selecciona la cuenta de salida"}
              </option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · saldo {money.format(Number(account.balance))}
                </option>
              ))}
            </select>
            <small className="field-hint">
              {selectedReturnSale?.paymentMethod === "CREDIT"
                ? cashRefundRequired
                  ? "La devolución supera la deuda pendiente. Selecciona la cuenta para reembolsar el excedente."
                  : "La devolución reducirá la deuda pendiente del cliente."
                : "El importe se registrará como salida en la cuenta seleccionada."}
            </small>
          </label>
          <div className="return-summary">
            <div>
              <span>Venta seleccionada</span>
              <strong>{selectedReturnSale?.number ?? "Pendiente"}</strong>
            </div>
            <div>
              <span>Máximo retornable</span>
              <strong>{selectedReturnItem ? `${returnableQuantity} unid.` : "-"}</strong>
            </div>
            <div className="return-summary-total">
              <span>Importe a devolver</span>
              <strong>{money.format(refundAmount)}</strong>
            </div>
          </div>
          <div className="return-step-grid">
            <label>
              Cantidad
              <input
                required
                min="1"
                max={returnableQuantity || undefined}
                type="number"
                value={form.quantity}
                onChange={(event) =>
                  setForm({ ...form, quantity: event.target.value })
                }
              />
            </label>
            <label>
              Motivo / nota
              <input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Ej. producto defectuoso"
              />
            </label>
          </div>
          <div className="modal-actions">
            <button
              className="outline-button"
              type="button"
              onClick={closeReturnModal}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={
                !selectedReturnItem ||
                !form.saleId ||
                returnableQuantity < 1 ||
                ((selectedReturnSale?.paymentMethod !== "CREDIT" || cashRefundRequired) &&
                  !form.cashAccountId)
              }
            >
              <RotateCcw size={15} /> Confirmar devolución
            </button>
          </div>
        </form>
      </Modal>
      <article className="panel module-table">
        <div className="module-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void loadInventory(event.target.value);
              }}
              placeholder="Buscar inventario..."
            />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Stock actual</th>
                <th>Stock mínimo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5}>Cargando inventario...</td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <div className="product-cell">
                        <span className="product-thumb">
                          {product.imageUrl ? (
                            <img src={product.imageUrl} alt="" />
                          ) : (
                            <Boxes size={16} />
                          )}
                        </span>
                        <div>
                          <strong>{product.name}</strong>
                          <small>{product.sku}</small>
                        </div>
                      </div>
                    </td>
                    <td>{product.category.name}</td>
                    <td>
                      <strong
                        className={
                          product.currentStock <= product.minimumStock
                            ? "stock-low"
                            : ""
                        }
                      >
                        {product.currentStock} unid.
                      </strong>
                    </td>
                    <td>{product.minimumStock} unid.</td>
                    <td>
                      <span
                        className={`status ${product.currentStock <= product.minimumStock ? "warning" : "success"}`}
                      >
                        <i />
                        {product.currentStock <= product.minimumStock
                          ? "Bajo stock"
                          : "Disponible"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
      <article className="panel module-table inventory-history-panel">
        <div className="module-toolbar inventory-history-heading">
          <div>
            <strong>Historial de devoluciones y ajustes</strong>
            <small>Consulta el motivo y el detalle de cada movimiento registrado.</small>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Motivo / detalle</th>
                <th>Referencia</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingHistory ? (
                <tr>
                  <td colSpan={6}>Cargando historial...</td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={6}>Todavía no hay devoluciones ni ajustes registrados.</td>
                </tr>
              ) : (
                history.map((movement) => (
                  <tr key={movement.id}>
                    <td>{new Date(movement.createdAt).toLocaleString("es-BO")}</td>
                    <td>
                      <span className={`history-type ${movement.type.startsWith("RETURN") ? "return" : "adjustment"}`}>
                        {movement.type === "RETURN_IN" ? "Devolución" : movement.type === "RETURN_OUT" ? "Salida por devolución" : movement.type === "ADJUSTMENT_IN" ? "Ajuste de entrada" : movement.type === "ADJUSTMENT_OUT" ? "Ajuste de salida" : movement.type === "TRANSFER_IN" ? "Transferencia de entrada" : "Transferencia de salida"}
                      </span>
                    </td>
                    <td>
                      <strong>{movement.product.name}</strong>
                      <small>{movement.product.sku}</small>
                    </td>
                    <td className={movement.quantity > 0 ? "history-in" : "history-out"}>
                      {movement.quantity > 0 ? "+" : ""}{movement.quantity} unid.
                    </td>
                    <td>
                      <span>{movement.notes || "Sin motivo registrado"}</span>
                      {movement.sale && <small>Venta de origen: {movement.sale.number}</small>}
                      {movement.transfer && <small>{movement.transfer.number}: {movement.transfer.fromBranch?.name ?? "Sin sucursal"} → {movement.transfer.toBranch.name}</small>}
                    </td>
                    <td>{movement.reference || "-"}</td>
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
