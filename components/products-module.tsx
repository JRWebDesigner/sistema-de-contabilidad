"use client";

import { FormEvent, useEffect, useState } from "react";
import { BriefcaseBusiness, Check, Package, Plus, Search } from "lucide-react";

import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";

type Product = {
  id: string;
  type: "PRODUCT" | "SERVICE";
  serviceBillingPeriod: "ONE_TIME" | "MONTHLY" | "ANNUAL" | null;
  sku: string;
  name: string;
  unit: string;
  imageUrl: string | null;
  cost: string;
  price: string;
  currentStock: number;
  minimumStock: number;
  category: { id: string; name: string };
};

type Category = { id: string; name: string };

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "BOB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function ProductsModule() {
  const canWrite = usePermission("inventory:write");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [query, setQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [form, setForm] = useState({
    type: "PRODUCT" as Product["type"],
    serviceBillingPeriod: "ONE_TIME" as NonNullable<Product["serviceBillingPeriod"]>,
    sku: "",
    name: "",
    categoryId: "",
    unit: "UNIDAD",
    image: null as File | null,
    cost: "",
    price: "",
    currentStock: "0",
    minimumStock: "0",
  });

  async function loadProducts(search = query) {
    setIsLoading(true);
    const response = await fetch(
      `/api/products?q=${encodeURIComponent(search)}`,
    );
    const data = await response.json();
    setProducts(response.ok ? data : []);
    setIsLoading(false);
  }

  async function loadCategories() {
    const response = await fetch("/api/categories");
    if (response.ok) setCategories(await response.json());
  }

  useEffect(() => {
    void loadProducts("");
    void loadCategories();
    void fetch("/api/auth").then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        setIsAdmin(data.user?.role === "ADMIN");
      }
    });
  }, []);

  async function handleCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: categoryName }),
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "No se pudo guardar la categoría.");
      return;
    }

    setCategoryName("");
    setCategories((current) =>
      [...current, data].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    );
    setForm((current) => ({ ...current, categoryId: data.id }));
    setMessage("Categoría guardada en PostgreSQL.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const savedType = form.type;
    const wasEditing = Boolean(editingProductId);

    const payload = new FormData();
    payload.append("type", form.type);
    payload.append("serviceBillingPeriod", form.type === "SERVICE" ? form.serviceBillingPeriod : "");
    payload.append("sku", form.sku);
    payload.append("name", form.name);
    payload.append("categoryId", form.categoryId);
    payload.append("unit", form.unit);
    payload.append("cost", form.type === "SERVICE" ? "0" : form.cost);
    payload.append("price", form.price);
    payload.append("currentStock", form.type === "SERVICE" ? "0" : form.currentStock);
    payload.append("minimumStock", form.type === "SERVICE" ? "0" : form.minimumStock);
    if (form.image) payload.append("image", form.image);

    const response = await fetch(
      editingProductId
        ? `/api/products?id=${encodeURIComponent(editingProductId)}`
        : "/api/products",
      {
        method: editingProductId ? "PATCH" : "POST",
        body: payload,
      },
    );
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "No se pudo guardar el producto.");
      return;
    }

    setForm({
      type: "PRODUCT",
      serviceBillingPeriod: "ONE_TIME",
      sku: "",
      name: "",
      categoryId: "",
      unit: "UNIDAD",
      image: null,
      cost: "",
      price: "",
      currentStock: "0",
      minimumStock: "0",
    });
    setEditingProductId(null);
    setIsFormOpen(false);
    setMessage(
      wasEditing
        ? `${savedType === "SERVICE" ? "Servicio" : "Producto"} actualizado correctamente.`
        : `${savedType === "SERVICE" ? "Servicio" : "Producto"} guardado correctamente.`,
    );
    await loadProducts();
  }

  function handleNewProduct() {
    setEditingProductId(null);
    setForm({
      type: "PRODUCT",
      serviceBillingPeriod: "ONE_TIME",
      sku: "",
      name: "",
      categoryId: "",
      unit: "UNIDAD",
      image: null,
      cost: "",
      price: "",
      currentStock: "0",
      minimumStock: "0",
    });
    setIsFormOpen(true);
  }

  function handleEditProduct(product: Product) {
    setEditingProductId(product.id);
    setForm({
      type: product.type,
      serviceBillingPeriod: product.serviceBillingPeriod ?? "ONE_TIME",
      sku: product.sku,
      name: product.name,
      categoryId: product.category.id,
      unit: product.unit,
      image: null,
      cost: product.cost,
      price: product.price,
      currentStock: String(product.currentStock),
      minimumStock: String(product.minimumStock),
    });
    setIsFormOpen(true);
  }

  async function handleDeleteProduct(id: string) {
    const confirmed = window.confirm("¿Deseas eliminar este producto?");
    if (!confirmed) return;

    const response = await fetch(`/api/products?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? `Producto eliminado: ${data.name ?? "ok"}`
        : (data.error ?? "No se pudo eliminar el producto."),
    );
    if (response.ok) await loadProducts();
  }

  async function handleDeleteCategory(id: string) {
    const confirmed = window.confirm("¿Deseas eliminar esta categoría?");
    if (!confirmed) return;

    const response = await fetch(
      `/api/categories?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    const data = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? `Categoría eliminada: ${data.name ?? "ok"}`
        : (data.error ?? "No se pudo eliminar la categoría."),
    );
    if (response.ok) {
      setCategories((current) =>
        current.filter((category) => category.id !== id),
      );
      setForm((current) => ({
        ...current,
        categoryId: current.categoryId === id ? "" : current.categoryId,
      }));
      await loadProducts();
    }
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Productos y servicios</h1>
          <p className="muted">
            Productos con inventario y servicios de pago único o recurrente.
          </p>
        </div>
        {canWrite && <button className="primary-button" onClick={handleNewProduct}>
          <Plus size={17} /> Nuevo producto o servicio
        </button>}
      </div>
      {message && <p className="module-message">{message}</p>}
      <Modal
        open={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingProductId(null);
        }}
        page="Catálogo"
        title={editingProductId ? "Editar registro" : "Nuevo producto o servicio"}
        description="Completa los datos paso a paso. Te mostraremos solo los campos que corresponden."
        className="product-modal product-editor-modal"
      >
        <form className="product-form product-editor-form" onSubmit={handleSubmit}>
          <div className="product-editor-sheet">
            <section className="product-editor-section">
              <h3 className="product-editor-section-title"><span>1</span> ¿Qué vas a registrar?</h3>
              <p className="product-editor-help">Elige una opción. Así sabremos si debemos controlar existencias o cobrar por períodos.</p>
              <div className="product-kind-options">
                <button
                  type="button"
                  className={`product-kind-option${form.type === "PRODUCT" ? " is-selected" : ""}`}
                  aria-pressed={form.type === "PRODUCT"}
                  disabled={Boolean(editingProductId)}
                  onClick={() => setForm({
                    ...form,
                    type: "PRODUCT",
                    unit: "UNIDAD",
                    currentStock: "0",
                    minimumStock: "0",
                  })}
                >
                  <span className="product-kind-icon"><Package size={20} /></span>
                  <span className="product-kind-copy">
                    <strong>Producto físico</strong>
                    <small>Se guarda, vende y descuenta del inventario.</small>
                  </span>
                  {form.type === "PRODUCT" && <Check size={17} className="product-kind-check" />}
                </button>
                <button
                  type="button"
                  className={`product-kind-option${form.type === "SERVICE" ? " is-selected" : ""}`}
                  aria-pressed={form.type === "SERVICE"}
                  disabled={Boolean(editingProductId)}
                  onClick={() => setForm({
                    ...form,
                    type: "SERVICE",
                    unit: "SERVICIO",
                    cost: "0",
                    currentStock: "0",
                    minimumStock: "0",
                  })}
                >
                  <span className="product-kind-icon"><BriefcaseBusiness size={20} /></span>
                  <span className="product-kind-copy">
                    <strong>Servicio</strong>
                    <small>No tiene stock. Puede cobrarse una vez, al mes o al año.</small>
                  </span>
                  {form.type === "SERVICE" && <Check size={17} className="product-kind-check" />}
                </button>
              </div>
              {editingProductId && <p className="product-editor-help">El tipo de un registro no se puede cambiar después de crearlo.</p>}
            </section>

            <section className="product-editor-section">
              <h3 className="product-editor-section-title"><span>2</span> Información para identificarlo</h3>
              <p className="product-editor-help">Usa un nombre claro y un código que ayude a encontrarlo rápidamente.</p>
              <div className="product-editor-grid">
                <label>
                  <span>Nombre {form.type === "SERVICE" ? "del servicio" : "del producto"} <b>*</b></span>
                  <input
                    autoFocus
                    required
                    maxLength={180}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder={form.type === "SERVICE" ? "Ej. Mantenimiento mensual" : "Ej. Teclado inalámbrico"}
                  />
                </label>
                <label>
                  <span>Código interno (SKU) <b>*</b></span>
                  <input
                    required
                    maxLength={50}
                    value={form.sku}
                    onChange={(event) => setForm({ ...form, sku: event.target.value })}
                    placeholder="Ej. SER-001 o PROD-001"
                  />
                  <small>Puede ser el código que ya utiliza tu empresa.</small>
                </label>
                <label>
                  <span>Categoría <b>*</b></span>
                  <select
                    required
                    value={form.categoryId}
                    onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                  >
                    <option value="">Selecciona una categoría</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                  {categories.length === 0 && <small>Primero crea una categoría en la sección Categorías.</small>}
                </label>
                {form.type === "PRODUCT" && (
                  <label>
                    <span>¿Cómo se cuenta? <b>*</b></span>
                    <select
                      required
                      value={form.unit}
                      onChange={(event) => setForm({ ...form, unit: event.target.value })}
                    >
                      <option value="UNIDAD">Unidad</option>
                      <option value="PIEZA">Pieza</option>
                      <option value="CAJA">Caja</option>
                      <option value="PAQUETE">Paquete</option>
                      <option value="DOCENA">Docena</option>
                      <option value="KILOGRAMO">Kilogramo</option>
                      <option value="GRAMO">Gramo</option>
                      <option value="LITRO">Litro</option>
                      <option value="MILILITRO">Mililitro</option>
                    </select>
                    <small>Por ejemplo: unidades, cajas o kilogramos.</small>
                  </label>
                )}
              </div>
            </section>

            {form.type === "SERVICE" ? (
              <section className="product-editor-section">
                <h3 className="product-editor-section-title"><span>3</span> ¿Cuándo se cobra?</h3>
                <p className="product-editor-help">El precio indicado será el importe que se cobrará según la frecuencia elegida.</p>
                <div className="product-editor-grid product-service-grid">
                  <label>
                    <span>Frecuencia de cobro <b>*</b></span>
                    <select
                      required
                      value={form.serviceBillingPeriod}
                      onChange={(event) => setForm({
                        ...form,
                        serviceBillingPeriod: event.target.value as NonNullable<Product["serviceBillingPeriod"]>,
                      })}
                    >
                      <option value="ONE_TIME">Una sola vez</option>
                      <option value="MONTHLY">Cada mes</option>
                      <option value="ANNUAL">Cada año</option>
                    </select>
                  </label>
                  <label>
                    <span>{form.serviceBillingPeriod === "ONE_TIME" ? "Precio del servicio" : `Precio ${form.serviceBillingPeriod === "MONTHLY" ? "mensual" : "anual"}`} (Bs) <b>*</b></span>
                    <input
                      required
                      min="0.01"
                      step="0.01"
                      type="number"
                      value={form.price}
                      onChange={(event) => setForm({ ...form, price: event.target.value })}
                      placeholder="0.00"
                    />
                  </label>
                </div>
                <div className="product-editor-notice">
                  <BriefcaseBusiness size={17} />
                  <p><strong>Este servicio no controla stock.</strong> {form.serviceBillingPeriod === "ONE_TIME" ? "Se cobrará una sola vez cuando se contrate." : `Se generará un cobro ${form.serviceBillingPeriod === "MONTHLY" ? "cada mes" : "cada año"} mientras el servicio esté activo.`}</p>
                </div>
              </section>
            ) : (
              <>
                <section className="product-editor-section">
                  <h3 className="product-editor-section-title"><span>3</span> Precio y costo</h3>
                  <p className="product-editor-help">El precio es lo que pagará el cliente. El costo sirve para calcular la ganancia.</p>
                  <div className="product-editor-grid">
                    <label>
                      <span>Precio de venta (Bs) <b>*</b></span>
                      <input
                        required
                        min="0.01"
                        step="0.01"
                        type="number"
                        value={form.price}
                        onChange={(event) => setForm({ ...form, price: event.target.value })}
                        placeholder="0.00"
                      />
                    </label>
                    <label>
                      <span>Costo de compra (Bs) <b>*</b></span>
                      <input
                        required
                        min="0"
                        step="0.01"
                        type="number"
                        value={form.cost}
                        onChange={(event) => setForm({ ...form, cost: event.target.value })}
                        placeholder="0.00"
                      />
                      <small>Lo que pagó la empresa por adquirir este producto.</small>
                    </label>
                  </div>
                </section>

                <section className="product-editor-section">
                  <h3 className="product-editor-section-title"><span>4</span> Existencias iniciales</h3>
                  <p className="product-editor-help">Indica cuántas unidades tienes ahora. El sistema las descontará cuando vendas.</p>
                  <div className="product-editor-grid">
                    <label>
                      <span>¿Cuántas unidades tienes? <b>*</b></span>
                      <input
                        required
                        min="0"
                        step="1"
                        type="number"
                        value={form.currentStock}
                        onChange={(event) => setForm({ ...form, currentStock: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Avisarme cuando queden pocas</span>
                      <input
                        min="0"
                        step="1"
                        type="number"
                        value={form.minimumStock}
                        onChange={(event) => setForm({ ...form, minimumStock: event.target.value })}
                      />
                      <small>Recibirás una alerta cuando el stock llegue a esta cantidad.</small>
                    </label>
                    <label className="product-editor-image">
                      <span>Foto del producto <small>(opcional)</small></span>
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        type="file"
                        onChange={(event) => setForm({ ...form, image: event.target.files?.[0] ?? null })}
                      />
                      <small>Imagen JPG, PNG o WebP; máximo 5 MB.</small>
                    </label>
                  </div>
                </section>
              </>
            )}

            {message && <p className="module-message" role="alert">{message}</p>}
            <footer className="product-editor-footer">
              <p><b>*</b> Campos obligatorios</p>
              <button className="primary-button" type="submit" disabled={!categories.length}>
                <Check size={16} /> Guardar {form.type === "SERVICE" ? "servicio" : "producto"}
              </button>
            </footer>
          </div>
        </form>
      </Modal>
      {canWrite && <form className="panel category-form" onSubmit={handleCategorySubmit}>
        <label>
          Nueva categoría
          <input
            required
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            placeholder="Ej. Tecnología"
          />
        </label>
        <button className="outline-button" type="submit">
          Crear categoría
        </button>
      </form>}
      {categories.length > 0 && (
        <div className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>{category.name}</td>
                    <td>
                      <button
                        className="outline-button"
                        onClick={() => void handleDeleteCategory(category.id)}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <article className="panel module-table">
        <div className="module-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void loadProducts(event.target.value);
              }}
              placeholder="Buscar productos..."
            />
          </div>
          <span className="currency-note">Moneda: Bs</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Producto o servicio</th>
                <th>Categoría</th>
                <th>Unidad</th>
                <th>Tipo / stock</th>
                <th>Costo</th>
                <th>Precio</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8}>Cargando productos...</td>
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
                            <Package size={16} />
                          )}
                        </span>
                        <div>
                          <strong>{product.name}</strong>
                          <small>{product.sku}</small>
                        </div>
                      </div>
                    </td>
                    <td>{product.category.name}</td>
                    <td>{product.unit}</td>
                    <td>
                      {product.type === "SERVICE"
                        ? product.serviceBillingPeriod === "MONTHLY"
                          ? "Servicio · mensual"
                          : product.serviceBillingPeriod === "ANNUAL"
                            ? "Servicio · anual"
                            : "Servicio · pago único"
                        : `${product.currentStock} unid.`}
                    </td>
                    <td>{product.type === "SERVICE" ? "—" : `Bs ${money.format(Number(product.cost))}`}</td>
                    <td>
                      <strong>Bs {money.format(Number(product.price))}</strong>
                    </td>
                    <td>
                      <span
                        className={`status ${product.type === "SERVICE" || product.currentStock > product.minimumStock ? "success" : "warning"}`}
                      >
                        <i />
                        {product.type === "SERVICE"
                          ? "Sin inventario"
                          : product.currentStock <= product.minimumStock
                            ? "Bajo stock"
                            : "Disponible"}
                      </span>
                    </td>
                    <td>
                      {isAdmin && (
                        <button
                          className="outline-button"
                          onClick={() => handleEditProduct(product)}
                        >
                          Editar
                        </button>
                      )}
                      <button
                        className="outline-button"
                        onClick={() => void handleDeleteProduct(product.id)}
                      >
                        Eliminar
                      </button>
                    </td>
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
//17:45 = 21%
//17:48 = 32%
//17:54 = 40%
//18:03 = 53%
//18:21 = 76%