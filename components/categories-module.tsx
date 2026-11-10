"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";

import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";

type Category = {
  id: string;
  name: string;
  createdAt: string;
  _count?: { products: number };
};

export default function CategoriesModule() {
  const canWrite = usePermission("inventory:write");
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadCategories() {
    setIsLoading(true);
    const response = await fetch("/api/categories");
    const data = await response.json().catch(() => []);
    setCategories(response.ok ? data : []);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadCategories();
    void fetch("/api/auth").then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        setIsAdmin(data.user?.role === "ADMIN");
      }
    });
  }, []);

  function openCreate() {
    setEditingId(null);
    setName("");
    setMessage("");
    setIsFormOpen(true);
  }

  function openEdit(category: Category) {
    setEditingId(category.id);
    setName(category.name);
    setMessage("");
    setIsFormOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch(
      editingId
        ? `/api/categories?id=${encodeURIComponent(editingId)}`
        : "/api/categories",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error ?? "No se pudo guardar la categoría.");
      return;
    }
    setIsFormOpen(false);
    setEditingId(null);
    setName("");
    setMessage(
      editingId
        ? "Categoría actualizada correctamente."
        : "Categoría creada correctamente.",
    );
    await loadCategories();
  }

  async function handleDelete(category: Category) {
    if (!window.confirm(`¿Deseas eliminar la categoría "${category.name}"?`))
      return;
    const response = await fetch(
      `/api/categories?id=${encodeURIComponent(category.id)}`,
      { method: "DELETE" },
    );
    const data = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? "Categoría eliminada correctamente."
        : (data.error ?? "No se pudo eliminar la categoría."),
    );
    if (response.ok) await loadCategories();
  }

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Categorías</h1>
          <p className="muted">Organiza los productos de tu catálogo.</p>
        </div>
        {canWrite && <button className="primary-button" onClick={openCreate}>
          <Plus size={17} /> Nueva categoría
        </button>}
      </div>
      {message && <p className="module-message">{message}</p>}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        page="Catálogo"
        title={editingId ? "Editar categoría" : "Nueva categoría"}
        description="Usa un nombre claro para encontrar tus productos fácilmente."
      >
        <form className="product-form" onSubmit={handleSubmit}>
          <label>
            Nombre de la categoría
            <input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej. Tecnología"
            />
          </label>
          <button className="primary-button" type="submit">
            {editingId ? "Guardar cambios" : "Crear categoría"}
          </button>
          {message && <p className="module-message">{message}</p>}
        </form>
      </Modal>
      <article className="panel module-table">
        <div className="module-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar categorías..."
            />
          </div>
          <span className="currency-note">{categories.length} categorías</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Productos</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4}>Cargando categorías...</td>
                </tr>
              ) : filteredCategories.length === 0 ? (
                <tr>
                  <td colSpan={4}>No hay categorías que mostrar.</td>
                </tr>
              ) : (
                filteredCategories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <div className="product-cell">
                        <span className="product-thumb">
                          <Tags size={16} />
                        </span>
                        <strong>{category.name}</strong>
                      </div>
                    </td>
                    <td>{category._count?.products ?? 0}</td>
                    <td>
                      <span className="status success">
                        <i />
                        Activa
                      </span>
                    </td>
                    <td>
                      {isAdmin && (
                        <>
                          <button
                            className="outline-button"
                            onClick={() => openEdit(category)}
                          >
                            <Pencil size={14} /> Editar
                          </button>
                          <button
                            className="outline-button"
                            onClick={() => void handleDelete(category)}
                          >
                            <Trash2 size={14} /> Eliminar
                          </button>
                        </>
                      )}
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
