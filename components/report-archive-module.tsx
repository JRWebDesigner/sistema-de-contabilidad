"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Archive, Download, FileText, Search, Upload } from "lucide-react";

import { usePermission } from "./permissions-context";

type ReportType =
  | "CUSTOMER_STATEMENT_DETAILED"
  | "CUSTOMER_STATEMENT_SUMMARY"
  | "CUSTOMER_DEBTS"
  | "SALES_REPORT"
  | "INVENTORY_REPORT"
  | "CONTACTS_REPORT"
  | "FINANCE_REPORT";

type Customer = { id: string; name: string; document: string };
type ArchivedReport = {
  id: string;
  title: string;
  type: ReportType;
  source: "GENERATED" | "IMPORTED";
  fileName: string;
  sizeBytes: number;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  customer: Customer | null;
  branch: { id: string; name: string } | null;
  createdBy: { name: string; alias: string } | null;
};
type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

const typeLabels: Record<ReportType, string> = {
  CUSTOMER_STATEMENT_DETAILED: "Estado de cuenta detallado",
  CUSTOMER_STATEMENT_SUMMARY: "Estado de cuenta sin detalle",
  CUSTOMER_DEBTS: "Reporte de deudas",
  SALES_REPORT: "Reporte de ventas",
  INVENTORY_REPORT: "Reporte de inventario",
  CONTACTS_REPORT: "Reporte de clientes y proveedores",
  FINANCE_REPORT: "Reporte financiero",
};

const dateFormat = new Intl.DateTimeFormat("es-BO", { dateStyle: "short", timeZone: "America/La_Paz" });
const dateValue = (value: string | null) => value ? dateFormat.format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`)) : "—";
const formatSize = (size: number) => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const isCustomerStatement = (type: ReportType) =>
  type === "CUSTOMER_STATEMENT_DETAILED" || type === "CUSTOMER_STATEMENT_SUMMARY" || type === "CUSTOMER_DEBTS";

async function responseJson(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "No se pudo completar la operación.");
  return result;
}

export default function ReportArchiveModule() {
  const canImport = usePermission("finance:write");
  const canSeeSales = usePermission("sales:read");
  const canSeeFinance = usePermission("finance:read");
  const canSeeInventory = usePermission("inventory:read");
  const canSeeCustomers = usePermission("contacts:read");
  const availableTypes = useMemo(() => [
    ...(canSeeFinance ? [
      "CUSTOMER_STATEMENT_DETAILED",
      "CUSTOMER_STATEMENT_SUMMARY",
      "CUSTOMER_DEBTS",
      "FINANCE_REPORT",
    ] as ReportType[] : []),
    ...(canSeeSales ? ["SALES_REPORT" as ReportType] : []),
    ...(canSeeInventory ? ["INVENTORY_REPORT" as ReportType] : []),
    ...(canSeeCustomers ? ["CONTACTS_REPORT" as ReportType] : []),
  ], [canSeeFinance, canSeeSales, canSeeInventory, canSeeCustomers]);

  const [reports, setReports] = useState<ArchivedReport[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [showImportForm, setShowImportForm] = useState(false);
  const [importType, setImportType] = useState<ReportType>("CUSTOMER_STATEMENT_DETAILED");
  const [importTitle, setImportTitle] = useState(typeLabels.CUSTOMER_STATEMENT_DETAILED);
  const [importCustomerId, setImportCustomerId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (query.trim()) params.set("q", query.trim());
    if (customerFilter) params.set("customerId", customerFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);
    fetch(`/api/report-archive?${params}`)
      .then(responseJson)
      .then((result) => {
        if (!active) return;
        setReports(result.data);
        setPagination(result.pagination);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "No se pudo cargar el archivo de reportes.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [page, query, customerFilter, typeFilter, filterFrom, filterTo, refresh]);

  useEffect(() => {
    if (!canSeeCustomers) return;
    let active = true;
    fetch("/api/customers")
      .then(responseJson)
      .then((result) => {
        if (active && Array.isArray(result)) setCustomers(result);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "No se pudo cargar la lista de clientes.");
      });
    return () => { active = false; };
  }, [canSeeCustomers]);

  function resetImportForm() {
    setShowImportForm(false);
    setImportTitle(typeLabels[importType]);
    setImportCustomerId("");
    setPeriodStart("");
    setPeriodEnd("");
    setSelectedFile(null);
    setFileInputKey((key) => key + 1);
  }

  async function importReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setMessage("Selecciona el archivo PDF que deseas archivar.");
      return;
    }
    if (Boolean(periodStart) !== Boolean(periodEnd)) {
      setMessage("Completa ambas fechas del período o déjalas vacías.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.set("file", selectedFile);
      formData.set("title", importTitle.trim());
      formData.set("type", importType);
      formData.set("source", "IMPORTED");
      if (importCustomerId) formData.set("customerId", importCustomerId);
      if (periodStart) formData.set("periodStart", periodStart);
      if (periodEnd) formData.set("periodEnd", periodEnd);
      await responseJson(await fetch("/api/report-archive", { method: "POST", body: formData }));
      setPage(1);
      setRefresh((value) => value + 1);
      setMessage("El documento quedó guardado en el archivo.");
      resetImportForm();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo importar el documento.");
    } finally {
      setSubmitting(false);
    }
  }

  const customerRequired = isCustomerStatement(importType);

  return (
    <div className="dashboard-content report-archive-module">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Análisis · Documentos</p>
          <h1>Archivo de reportes</h1>
          <p className="muted">Consulta PDFs históricos e informes generados, asociados a su período y cliente.</p>
        </div>
        {canImport && (
          <button className="primary-button" type="button" onClick={() => {
            setMessage("");
            setImportTitle((value) => value || typeLabels[importType]);
            setShowImportForm((value) => !value);
          }}>
            <Upload size={16} /> Importar PDF histórico
          </button>
        )}
      </div>

      {message && <div className="notice" role="status">{message}</div>}

      {canImport && showImportForm && (
        <section className="panel report-archive-upload">
          <form onSubmit={(event) => void importReport(event)}>
            <header className="report-archive-upload-heading">
              <span className="report-archive-upload-icon"><Archive size={20} /></span>
              <div>
                <h2>Importar reporte histórico</h2>
                <p>Completa los datos para poder encontrar este documento más adelante.</p>
              </div>
            </header>

            <section className="report-archive-form-section">
              <div className="report-archive-section-heading">
                <span>1</span>
                <div>
                  <h3>Información del documento</h3>
                  <p>Indica qué tipo de reporte estás archivando y cómo quieres identificarlo.</p>
                </div>
              </div>
              <div className="product-form-grid">
                <label>
                  <span>Tipo de documento <b>*</b></span>
                  <select required value={importType} onChange={(event) => {
                    const nextType = event.target.value as ReportType;
                    setImportType(nextType);
                    setImportTitle(typeLabels[nextType]);
                  }}>
                    {availableTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Nombre o título <b>*</b></span>
                  <input required maxLength={180} value={importTitle} onChange={(event) => setImportTitle(event.target.value)} placeholder="Ej.: Estado de cuenta 2024" />
                  <small>Este nombre aparecerá en el archivo de reportes.</small>
                </label>
                {canSeeCustomers && (
                  <label>
                    <span>Cliente{customerRequired ? <> <b>*</b></> : " (opcional)"}</span>
                    <select required={customerRequired} value={importCustomerId} onChange={(event) => setImportCustomerId(event.target.value)}>
                      <option value="">Sin cliente asociado</option>
                      {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.document}</option>)}
                    </select>
                    <small>{customerRequired ? "Necesario para los estados de cuenta y reportes de deudas." : "Vincúlalo a un cliente si corresponde."}</small>
                  </label>
                )}
              </div>
            </section>

            <section className="report-archive-form-section">
              <div className="report-archive-section-heading">
                <span>2</span>
                <div>
                  <h3>Período del reporte</h3>
                  <p>Opcional. Si lo completas, indica ambas fechas.</p>
                </div>
              </div>
              <div className="product-form-grid report-archive-period-fields">
                <label>
                  <span>Desde</span>
                  <input type="date" value={periodStart} max={periodEnd || undefined} onChange={(event) => setPeriodStart(event.target.value)} />
                </label>
                <label>
                  <span>Hasta</span>
                  <input type="date" value={periodEnd} min={periodStart || undefined} onChange={(event) => setPeriodEnd(event.target.value)} />
                </label>
              </div>
            </section>

            <section className="report-archive-form-section">
              <div className="report-archive-section-heading">
                <span>3</span>
                <div>
                  <h3>Archivo PDF</h3>
                  <p>Selecciona el documento que deseas guardar. Tamaño máximo: 15 MB.</p>
                </div>
              </div>
              <label className="report-archive-file-field">
                <span>Seleccionar PDF <b>*</b></span>
                <input className="report-archive-file-input" key={fileInputKey} required accept="application/pdf,.pdf" type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
                <small>{selectedFile ? `Archivo seleccionado: ${selectedFile.name} · ${formatSize(selectedFile.size)}` : "Formatos aceptados: PDF"}</small>
              </label>
            </section>

            <footer className="report-archive-upload-actions">
              <button className="outline-button" type="button" onClick={resetImportForm} disabled={submitting}>Cancelar</button>
              <button className="primary-button" type="submit" disabled={submitting}>
                <Upload size={15} /> {submitting ? "Guardando..." : "Guardar documento"}
              </button>
            </footer>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="module-toolbar report-archive-filters">
          <label>
            Buscar documento
            <div className="search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Nombre del reporte o archivo" />
            </div>
          </label>
          <label>
            Tipo
            <select value={typeFilter} onChange={(event) => { setPage(1); setTypeFilter(event.target.value); }}>
              <option value="">Todos los tipos</option>
              {availableTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
            </select>
          </label>
          {canSeeCustomers && (
            <label>
              Cliente
              <select value={customerFilter} onChange={(event) => { setPage(1); setCustomerFilter(event.target.value); }}>
                <option value="">Todos los clientes</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
            </label>
          )}
          <label>
            Período desde
            <input type="date" value={filterFrom} max={filterTo || undefined} onChange={(event) => { setPage(1); setFilterFrom(event.target.value); }} />
          </label>
          <label>
            Período hasta
            <input type="date" value={filterTo} min={filterFrom || undefined} onChange={(event) => { setPage(1); setFilterTo(event.target.value); }} />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Período</th>
                <th>Origen</th>
                <th>Sucursal</th>
                <th>Guardado</th>
                <th>Tamaño</th>
                <th>Archivo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}>Cargando documentos...</td></tr>
              ) : reports.length === 0 ? (
                <tr><td colSpan={8}>No hay documentos para mostrar.</td></tr>
              ) : reports.map((report) => (
                <tr key={report.id}>
                  <td><strong>{report.title}</strong><small>{typeLabels[report.type]}</small></td>
                  <td>{report.customer ? `${report.customer.name} · ${report.customer.document}` : "—"}</td>
                  <td>{report.periodStart ? `${dateValue(report.periodStart)} al ${dateValue(report.periodEnd)}` : "—"}</td>
                  <td>{report.source === "IMPORTED" ? "Histórico importado" : "Generado por el sistema"}</td>
                  <td>{report.branch?.name ?? "Todas"}</td>
                  <td>{dateFormat.format(new Date(report.createdAt))}{report.createdBy ? ` · ${report.createdBy.alias}` : ""}</td>
                  <td>{formatSize(report.sizeBytes)}</td>
                  <td>
                    <div className="row-actions">
                      <a className="outline-button" href={`/api/report-archive/${report.id}`} target="_blank" rel="noreferrer">
                        <FileText size={14} /> Ver PDF
                      </a>
                      <a className="row-menu" href={`/api/report-archive/${report.id}?download=1`} aria-label={`Descargar ${report.title}`}>
                        <Download size={15} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="module-toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <span className="muted">Documentos: {pagination.total}</span>
          <div className="row-actions">
            <button className="outline-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Anterior</button>
            <span className="muted">Página {pagination.totalPages ? page : 0} de {pagination.totalPages}</span>
            <button className="outline-button" type="button" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
          </div>
        </div>
      </section>
    </div>
  );
}
