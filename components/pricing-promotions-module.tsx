"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Edit3, Plus, Search, Trash2 } from "lucide-react";

import Modal from "./ui/modal";
type Product = { id: string; name: string; sku: string };
type PriceList = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { customers: number };
  items: Array<{ product: Product; unitPrice: string }>;
};
type Promotion = {
  id: string;
  name: string;
  discountPercent: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  products: Array<{ product: Product }>;
};
type PriceItem = { productId: string; unitPrice: string };
type CatalogTab = "price-lists" | "promotions";

function toDateTimeInput(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function promotionState(promotion: Promotion, now: number) {
  if (!promotion.isActive) return "inactive";
  const start = new Date(promotion.startsAt).getTime();
  const end = new Date(promotion.endsAt).getTime();
  if (now < start) return "scheduled";
  if (now > end) return "expired";
  return "active";
}

export default function PricingPromotionsModule() {
  const [products, setProducts] = useState<Product[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [listName, setListName] = useState("");
  const [listDescription, setListDescription] = useState("");
  const [listItems, setListItems] = useState<PriceItem[]>([{ productId: "", unitPrice: "" }]);
  const [promotionName, setPromotionName] = useState("");
  const [promotionPercent, setPromotionPercent] = useState("");
  const [promotionProducts, setPromotionProducts] = useState<string[]>([]);
  const [promotionProductQuery, setPromotionProductQuery] = useState("");
  const [promotionStartsAt, setPromotionStartsAt] = useState("");
  const [promotionEndsAt, setPromotionEndsAt] = useState("");
  const [editingPriceListId, setEditingPriceListId] = useState("");
  const [editingPromotionId, setEditingPromotionId] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [catalogTab, setCatalogTab] = useState<CatalogTab>("price-lists");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [isPriceListModalOpen, setIsPriceListModalOpen] = useState(false);
  const [isPromotionModalOpen, setIsPromotionModalOpen] = useState(false);

  async function loadData(showLoading = true): Promise<boolean> {
    if (showLoading) setIsLoading(true);
    try {
      const [pricingResponse, productsResponse] = await Promise.all([
        fetch("/api/pricing"),
        fetch("/api/products"),
      ]);
      const [pricingData, productData] = await Promise.all([
        pricingResponse.json(),
        productsResponse.json(),
      ]);
      if (!pricingResponse.ok) throw new Error(pricingData.error ?? "No se pudieron cargar las listas y promociones.");
      if (!productsResponse.ok) throw new Error(productData.error ?? "No se pudieron cargar los productos.");
      if (!Array.isArray(pricingData.priceLists) || !Array.isArray(pricingData.promotions) || !Array.isArray(productData)) {
        throw new Error("La respuesta de precios y promociones no es válida.");
      }
      setPriceLists(pricingData.priceLists);
      setPromotions(pricingData.promotions);
      setProducts(productData);
      if (showLoading) setMessage("");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la configuración comercial.");
      setMessageKind("error");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function submit(kind: "price-list" | "promotion", body: object, id?: string) {
    if (isSaving) return false;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/pricing", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...body, ...(id ? { id } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar la configuración.");
      if (!await loadData(false)) return true;
      setMessage(kind === "price-list" ? "La lista de precios se guardó correctamente." : "La promoción se guardó correctamente.");
      setMessageKind("success");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la configuración.");
      setMessageKind("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function savePriceList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (new Set(listItems.map((item) => item.productId)).size !== listItems.length) {
      setMessage("Cada producto debe aparecer una sola vez en la lista.");
      setMessageKind("error");
      return;
    }
    const saved = await submit("price-list", {
      name: listName,
      description: listDescription || undefined,
      items: listItems.map((item) => ({ ...item, unitPrice: Number(item.unitPrice) })),
    }, editingPriceListId || undefined);
    if (saved) {
      resetPriceListForm();
      setIsPriceListModalOpen(false);
    }
  }

  async function savePromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (new Date(promotionStartsAt).getTime() >= new Date(promotionEndsAt).getTime()) {
      setMessage("La fecha de término debe ser posterior al inicio.");
      setMessageKind("error");
      return;
    }
    const saved = await submit("promotion", {
      name: promotionName,
      discountPercent: Number(promotionPercent),
      productIds: promotionProducts,
      startsAt: new Date(promotionStartsAt).toISOString(),
      endsAt: new Date(promotionEndsAt).toISOString(),
    }, editingPromotionId || undefined);
    if (saved) {
      resetPromotionForm();
      setIsPromotionModalOpen(false);
    }
  }

  function resetPriceListForm() {
    setEditingPriceListId("");
    setListName("");
    setListDescription("");
    setListItems([{ productId: "", unitPrice: "" }]);
  }

  function resetPromotionForm() {
    setEditingPromotionId("");
    setPromotionName("");
    setPromotionPercent("");
    setPromotionProducts([]);
    setPromotionProductQuery("");
    setPromotionStartsAt("");
    setPromotionEndsAt("");
  }

  async function changeStatus(kind: "price-list" | "promotion", id: string, isActive: boolean) {
    setMessage("");
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, isActive }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo actualizar el estado.");
      if (!await loadData(false)) return;
      setMessage(isActive ? "Configuración activada." : "Configuración desactivada.");
      setMessageKind("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el estado.");
      setMessageKind("error");
    }
  }

  function changeListItem(index: number, key: keyof PriceItem, value: string) {
    setListItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [key]: value } : item,
    ));
  }

  function editPriceList(list: PriceList) {
    setEditingPriceListId(list.id);
    setListName(list.name);
    setListDescription(list.description ?? "");
    setListItems(list.items.map((item) => ({ productId: item.product.id, unitPrice: item.unitPrice })));
    setMessage("");
    setIsPriceListModalOpen(true);
  }

  function editPromotion(promotion: Promotion) {
    setEditingPromotionId(promotion.id);
    setPromotionName(promotion.name);
    setPromotionPercent(promotion.discountPercent);
    setPromotionProducts(promotion.products.map((item) => item.product.id));
    setPromotionStartsAt(toDateTimeInput(promotion.startsAt));
    setPromotionEndsAt(toDateTimeInput(promotion.endsAt));
    setMessage("");
    setIsPromotionModalOpen(true);
  }

  const now = Date.now();
  const filteredPriceLists = useMemo(() => priceLists.filter((list) =>
    `${list.name} ${list.description ?? ""}`.toLocaleLowerCase("es-BO").includes(catalogQuery.trim().toLocaleLowerCase("es-BO")),
  ), [priceLists, catalogQuery]);
  const filteredPromotions = useMemo(() => promotions.filter((promotion) =>
    `${promotion.name} ${promotion.products.map((item) => item.product.name).join(" ")}`.toLocaleLowerCase("es-BO").includes(catalogQuery.trim().toLocaleLowerCase("es-BO")),
  ), [promotions, catalogQuery]);
  const visibleProducts = products.filter((product) =>
    `${product.name} ${product.sku}`.toLocaleLowerCase("es-BO").includes(promotionProductQuery.trim().toLocaleLowerCase("es-BO")),
  );

  return (
    <div className="dashboard-content">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Ventas · Configuración comercial</p>
          <h1>Precios y promociones</h1>
          <p className="muted">Gestiona precios por segmento y campañas con vigencia controlada.</p>
        </div>
        <div className="page-heading-actions">
          <button type="button" className="secondary-button" onClick={() => {
            resetPriceListForm();
            setMessage("");
            setIsPriceListModalOpen(true);
          }}>
            <Plus size={16} /> Nueva lista de precios
          </button>
          <button type="button" className="primary-button" onClick={() => {
            resetPromotionForm();
            setMessage("");
            setIsPromotionModalOpen(true);
          }}>
            <Plus size={16} /> Nueva promoción
          </button>
        </div>
      </header>

      {message && <p className={`module-message ${messageKind}`} role={messageKind === "error" ? "alert" : "status"}>{message}</p>}

      <section className="panel module-table">
        <div className="panel-header">
          <div><h2>Configuración comercial</h2><p>Administra segmentos de precios y campañas.</p></div>
        </div>
        <div className="module-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input aria-label="Buscar segmentos o promociones" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Buscar configuración" />
          </label>
          <div className="module-toolbar-actions" aria-label="Tipo de configuración">
            <button type="button" className={catalogTab === "price-lists" ? "primary-button" : "secondary-button"} aria-pressed={catalogTab === "price-lists"} onClick={() => setCatalogTab("price-lists")}>
              Listas de precios ({priceLists.length})
          </button>
            <button type="button" className={catalogTab === "promotions" ? "primary-button" : "secondary-button"} aria-pressed={catalogTab === "promotions"} onClick={() => setCatalogTab("promotions")}>
              Promociones ({promotions.length})
          </button>
        </div>
        </div>
        {isLoading ? <p className="module-message">Cargando configuración comercial…</p> : catalogTab === "price-lists" ? (
          filteredPriceLists.length === 0 ? <p className="module-message">{catalogQuery ? "No se encontraron listas de precios." : "Aún no hay listas de precios."}</p> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Lista de precios</th><th>Precios especiales</th><th>Clientes</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {filteredPriceLists.map((list) => (
                    <tr key={list.id}>
                      <td>{list.name}<small className="table-secondary-text">{list.description || "Sin descripción"}</small></td>
                      <td>{list.items.length} {list.items.length === 1 ? "producto" : "productos"}</td>
                      <td>{list._count.customers}</td>
                      <td><span className={`status ${list.isActive ? "success" : ""}`}>{list.isActive ? "Activa" : "Inactiva"}</span></td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="secondary-button" onClick={() => editPriceList(list)}><Edit3 size={14} /> Editar</button>
                          <button type="button" className="secondary-button" onClick={() => void changeStatus("price-list", list.id, !list.isActive)}>{list.isActive ? "Desactivar" : "Activar"}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredPromotions.length === 0 ? <p className="module-message">{catalogQuery ? "No se encontraron promociones." : "Aún no hay promociones."}</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Campaña</th><th>Descuento</th><th>Productos</th><th>Vigencia</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filteredPromotions.map((promotion) => {
                  const state = promotionState(promotion, now);
                  const statusLabel = { active: "Vigente", scheduled: "Programada", expired: "Vencida", inactive: "Inactiva" }[state];
                  return (
                    <tr key={promotion.id}>
                      <td>{promotion.name}</td>
                      <td>{Number(promotion.discountPercent)}%</td>
                      <td>{promotion.products.length ? promotion.products.map((item) => item.product.name).join(", ") : "Todo el catálogo"}</td>
                      <td>{formatDate(promotion.startsAt)}<small className="table-secondary-text">Hasta {formatDate(promotion.endsAt)}</small></td>
                      <td><span className={`status ${state === "active" ? "success" : state === "expired" ? "warning" : ""}`}>{statusLabel}</span></td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="secondary-button" onClick={() => editPromotion(promotion)}><Edit3 size={14} /> Editar</button>
                          <button type="button" className="secondary-button" onClick={() => void changeStatus("promotion", promotion.id, !promotion.isActive)}>{promotion.isActive ? "Desactivar" : "Activar"}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={isPriceListModalOpen}
        onClose={() => {
          setIsPriceListModalOpen(false);
          resetPriceListForm();
        }}
        page="Ventas"
        title={editingPriceListId ? "Editar lista de precios" : "Nueva lista de precios"}
        description="Define precios especiales para un segmento de clientes."
        className="product-modal"
      >
        <form className="product-form" onSubmit={savePriceList}>
          <div className="product-form-grid">
            <label>Nombre del segmento
              <input required maxLength={120} value={listName} onChange={(event) => setListName(event.target.value)} placeholder="Ej. Mayoristas" />
            </label>
            <label>Descripción
              <input maxLength={500} value={listDescription} onChange={(event) => setListDescription(event.target.value)} placeholder="Condiciones o público al que aplica" />
            </label>
          </div>
          <div className="pricing-subheading"><strong>Precios especiales</strong><span>{listItems.length} {listItems.length === 1 ? "producto" : "productos"}</span></div>
          <div className="pricing-item-editor">
            {listItems.map((item, index) => (
              <div className="pricing-item-row" key={`${editingPriceListId}-${index}`}>
                <label>Producto
                  <select required value={item.productId} onChange={(event) => changeListItem(index, "productId", event.target.value)}>
                    <option value="">Selecciona un producto</option>
                    {products.map((product) => <option key={product.id} value={product.id} disabled={listItems.some((other, otherIndex) => otherIndex !== index && other.productId === product.id)}>{product.sku} · {product.name}</option>)}
                  </select>
                </label>
                <label>Precio especial (Bs)
                  <input required type="number" min="0.01" step="0.01" value={item.unitPrice} onChange={(event) => changeListItem(index, "unitPrice", event.target.value)} placeholder="0,00" />
                </label>
                {listItems.length > 1 && <button className="secondary-button" type="button" aria-label="Quitar producto" onClick={() => setListItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
          <div className="pricing-form-actions">
            <button type="button" className="secondary-button" onClick={() => setListItems((current) => [...current, { productId: "", unitPrice: "" }])} disabled={listItems.length >= products.length}>
              <Plus size={15} /> Agregar producto
            </button>
            <button className="primary-button" type="submit" disabled={isSaving || isLoading || products.length === 0}>
              <Check size={15} /> {isSaving ? "Guardando…" : editingPriceListId ? "Guardar cambios" : "Crear lista"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={isPromotionModalOpen}
        onClose={() => {
          setIsPromotionModalOpen(false);
          resetPromotionForm();
        }}
        page="Ventas"
        title={editingPromotionId ? "Editar promoción" : "Nueva promoción"}
        description="Programa descuentos por producto o para todo el catálogo."
        className="product-modal"
      >
        <form className="product-form" onSubmit={savePromotion}>
          <div className="product-form-grid">
            <label>Nombre de campaña
              <input required maxLength={120} value={promotionName} onChange={(event) => setPromotionName(event.target.value)} placeholder="Ej. Semana de aniversario" />
            </label>
            <label>Descuento (%)
              <input required type="number" min="0.01" max="100" step="0.01" value={promotionPercent} onChange={(event) => setPromotionPercent(event.target.value)} placeholder="10" />
            </label>
            <label><span><CalendarDays size={13} /> Desde</span><input required type="datetime-local" value={promotionStartsAt} onChange={(event) => setPromotionStartsAt(event.target.value)} /></label>
            <label><span><CalendarDays size={13} /> Hasta</span><input required type="datetime-local" value={promotionEndsAt} onChange={(event) => setPromotionEndsAt(event.target.value)} /></label>
          </div>
          <div className="pricing-product-picker">
            <div className="pricing-picker-heading"><strong>Productos incluidos</strong><span>{promotionProducts.length ? `${promotionProducts.length} seleccionados` : "Todo el catálogo"}</span></div>
            <div className="search-box">
              <Search size={15} />
              <input aria-label="Buscar productos para la promoción" value={promotionProductQuery} onChange={(event) => setPromotionProductQuery(event.target.value)} placeholder="Buscar por nombre o SKU" />
            </div>
            <div className="pricing-product-options">
              {visibleProducts.length === 0 ? <p>No hay productos que coincidan con la búsqueda.</p> : visibleProducts.map((product) => (
                <label key={product.id}>
                  <input
                    type="checkbox"
                    checked={promotionProducts.includes(product.id)}
                    onChange={(event) => setPromotionProducts((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))}
                  />
                  <span><strong>{product.name}</strong><small>{product.sku}</small></span>
                </label>
              ))}
            </div>
            <small className="pricing-picker-hint">No selecciones productos para aplicar la campaña a todo el catálogo.</small>
          </div>
          <div className="pricing-form-actions">
            <button type="button" className="secondary-button" onClick={() => {
              setIsPromotionModalOpen(false);
              resetPromotionForm();
            }}>Cancelar</button>
            <button className="primary-button" type="submit" disabled={isSaving || isLoading || products.length === 0}>
              <Check size={15} /> {isSaving ? "Guardando…" : editingPromotionId ? "Guardar cambios" : "Crear promoción"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
