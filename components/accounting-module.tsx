"use client";

import { useEffect, useState } from "react";
import { BookOpen, Download, FileText, LockKeyhole, LockKeyholeOpen, RefreshCw } from "lucide-react";

import { usePermission } from "./permissions-context";
import { openTableReportPdf } from "./table-report-pdf";

type ReportType = "income-statement" | "balance-sheet" | "trial-balance" | "cash-flow" | "journal";
type Period = { id: string; code: string; startDate: string; endDate: string; status: "OPEN" | "CLOSED"; closedAt: string | null; closeNote: string | null };
type ReportData = Record<string, any>;

const reportOptions: { value: ReportType; label: string }[] = [
  { value: "income-statement", label: "Estado de resultados" },
  { value: "balance-sheet", label: "Balance general" },
  { value: "trial-balance", label: "Balance de comprobación" },
  { value: "cash-flow", label: "Flujo de efectivo" },
  { value: "journal", label: "Libro diario y mayor" },
];

const money = (value: number | string | null | undefined) =>
  `Bs ${Number(value ?? 0).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountingModule() {
  const canManagePeriods = usePermission("users:manage");
  const [reportType, setReportType] = useState<ReportType>("income-statement");
  const [year, setYear] = useState(new Date().getFullYear());
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<ReportData | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyPeriod, setBusyPeriod] = useState("");

  async function loadPeriods() {
    const response = await fetch(`/api/accounting?resource=periods&year=${year}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "No se pudieron cargar los períodos.");
    setPeriods(result);
  }

  async function loadReport() {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ resource: reportType, year: String(year) });
      if (["income-statement", "cash-flow", "journal"].includes(reportType)) params.set("from", from);
      params.set("to", to);
      const [reportResponse, periodResponse] = await Promise.all([
        fetch(`/api/accounting?${params}`),
        fetch(`/api/accounting?resource=periods&year=${year}`),
      ]);
      const [report, periodResult] = await Promise.all([reportResponse.json(), periodResponse.json()]);
      if (periodResponse.ok) setPeriods(periodResult);
      const firstPeriodDate = Array.isArray(periodResult) && periodResult[0]
        ? new Date(periodResult[0].startDate).toISOString().slice(0, 10)
        : null;
      if (firstPeriodDate && ["income-statement", "cash-flow", "journal"].includes(reportType) && from < firstPeriodDate) {
        setData(null);
        setFrom(firstPeriodDate);
        return;
      }
      if (!reportResponse.ok) throw new Error(report.error ?? "No se pudo cargar el informe.");
      if (!periodResponse.ok) throw new Error(periodResult.error ?? "No se pudieron cargar los períodos.");
      setData(report);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la información contable.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, [reportType, year, from, to]);

  async function updatePeriod(period: Period) {
    const action = period.status === "OPEN" ? "close" : "reopen";
    const response = action === "reopen"
      ? window.prompt(`Motivo para reabrir ${period.code}:`)
      : window.prompt(`Nota de cierre para ${period.code} (opcional):`);
    if (response === null) return;
    const reason = response.trim();
    if (action === "reopen" && !reason) return;
    setBusyPeriod(period.id);
    setMessage("");
    try {
      const response = await fetch("/api/accounting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, periodId: period.id, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo actualizar el período.");
      await loadPeriods();
      setMessage(action === "close" ? `Período ${period.code} cerrado.` : `Período ${period.code} reabierto.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el período.");
    } finally {
      setBusyPeriod("");
    }
  }

  async function exportAccountingReport(format: "csv" | "pdf") {
    if (!data) return;
    if (reportType === "income-statement") {
      await exportIncomeStatement(format);
      return;
    }

    const rows: string[][] = [[reportOptions.find((option) => option.value === reportType)?.label ?? reportType, `${from} a ${to}`]];
    const addSection = (title: string, value: unknown) => {
      if (!Array.isArray(value) || value.length === 0) return;
      const records: Array<Record<string, string>> = value.map((item) => item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).map(([key, cell]) => [key, cell == null ? "" : typeof cell === "object" ? JSON.stringify(cell) : String(cell)]))
        : { Valor: String(item ?? "") });
      const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
      rows.push([title], columns, ...records.map((record) => columns.map((column) => record[column] ?? "")));
    };

    if (Array.isArray(data)) {
      addSection(reportType, data);
    } else {
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) addSection(key, value);
        else if (value !== null && typeof value === "object") addSection(key, [value]);
        else rows.push([key, String(value ?? "")]);
      }
    }

    if (format === "csv") {
      const content = `\uFEFF${rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(";")).join("\r\n")}`;
      const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `informe-contable-${reportType}-${from}-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const title = reportOptions.find((option) => option.value === reportType)?.label ?? reportType;
    const printable = window.open("", "_blank", "width=1000,height=750");
    if (!printable) {
      setMessage("El navegador bloqueó la ventana del PDF. Permite ventanas emergentes e inténtalo otra vez.");
      return;
    }
    try {
      await openTableReportPdf({
        title,
        subtitle: `Período: ${from} a ${to} · Bs`,
        rows,
      }, printable);
    } catch (error) {
      printable.close();
      setMessage(error instanceof Error ? error.message : "No se pudo generar el PDF contable.");
    }
  }

  async function exportIncomeStatement(format: "csv" | "pdf") {
    if (!data || reportType !== "income-statement") return
    const rows: Array<[string, string]> = [
      ["Estado de resultados", `${from} a ${to}`],
      ["Ventas contabilizadas (netas de descuentos)", money(data.salesRevenue)],
      ["Devoluciones de ventas", money(data.salesReturns)],
      ["Ingresos netos por ventas", money(data.netSales)],
      ["Costo de ventas", money(data.costOfSales)],
      ["Utilidad bruta", money(data.grossProfit)],
      ["Margen bruto", `${data.grossMarginPercent}%`],
      ["Gastos operativos y ajustes", money(data.operatingExpenses)],
      ["Resultado operativo", money(data.operatingIncome)],
      ["Otros ingresos", money(data.otherIncome)],
      ["Resultado neto del período", money(data.netIncome)],
      ["Margen neto", `${data.netMarginPercent}%`],
      ["Ingresos contabilizados por cuenta", ""],
      ...(data.income ?? []).map((item: ReportData) => [`${item.code} · ${item.name}`, money(item.balance)] as [string, string]),
      ["Gastos y devoluciones contabilizados por cuenta", ""],
      ...(data.expenses ?? []).map((item: ReportData) => [`${item.code} · ${item.name}`, money(item.balance)] as [string, string]),
    ]

    if (format === "csv") {
      const content = `\uFEFF${rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(";")).join("\r\n")}`
      const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }))
      const link = document.createElement("a")
      link.href = url
      link.download = `estado-de-resultados-${from}-${to}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      return
    }

    const printable = window.open("", "_blank", "width=900,height=700")
    if (!printable) {
      setMessage("El navegador bloqueó la ventana del PDF. Permite ventanas emergentes e inténtalo otra vez.")
      return
    }
    const printableRows = rows.slice(1);
    const sectionRows = [11, 12 + (data.income?.length ?? 0)];
    const totalLabels = new Set(["Utilidad bruta", "Resultado operativo", "Resultado neto del período"]);
    const totalRows = printableRows.flatMap(([label], index) => totalLabels.has(label) ? [index] : []);
    try {
      await openTableReportPdf({
        title: "Estado de resultados",
        subtitle: `Período: ${from} a ${to} · Bs · Sin IVA`,
        headers: ["Concepto", "Monto"],
        rows: printableRows,
        sectionRows,
        totalRows,
        note: "Calculado desde los asientos contabilizados. La confiabilidad del resultado depende del registro completo de gastos.",
      }, printable);
    } catch (error) {
      printable.close();
      setMessage(error instanceof Error ? error.message : "No se pudo generar el PDF del estado de resultados.");
    }
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Finanzas · Libro mayor</p>
          <h1>Contabilidad</h1>
          <p className="muted">Informes generados desde asientos contabilizados.</p>
        </div>
        <button className="outline-button" type="button" onClick={() => void loadReport()} disabled={loading}>
          <RefreshCw size={15} /> Actualizar
        </button>
        {data && <>
          <button className="outline-button" type="button" onClick={() => exportAccountingReport("csv")}><Download size={15} /> CSV</button>
          <button className="outline-button" type="button" onClick={() => exportAccountingReport("pdf")}><FileText size={15} /> PDF</button>
        </>}
      </div>

      <section className="panel" style={{ marginBottom: "1rem", padding: "1rem" }}>
        <div className="module-toolbar" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ minWidth: 230 }}>
            Informe
            <select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)} style={{ display: "block", width: "100%", marginTop: 6 }}>
              {reportOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Año
            <input type="number" min="2000" max="2200" value={year} onChange={(event) => {
              const nextYear = Number(event.target.value);
              setYear(nextYear);
              setFrom(`${nextYear}-01-01`);
              setTo(`${nextYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`);
            }} />
          </label>
          {reportType !== "balance-sheet" && <label>
            Desde
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>}
          <label>
            Hasta
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
      </section>

      {message && <p className="module-message">{message}</p>}
      <article className="panel module-table">
        {loading ? <p className="muted" style={{ padding: "1rem" }}>Cargando informe...</p> : data && <ReportView type={reportType} data={data} />}
      </article>

      <section className="panel module-table" style={{ marginTop: "1rem" }}>
        <div className="panel-header">
          <div>
            <h2>Períodos contables</h2>
            <p>Los asientos nuevos quedan bloqueados al cerrar un período.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Período</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Nota</th>{canManagePeriods && <th>Acción</th>}</tr></thead>
            <tbody>
              {periods.map((period) => <tr key={period.id}>
                <td><strong>{period.code}</strong></td>
                <td>{new Date(period.startDate).toLocaleDateString("es-BO", { timeZone: "UTC" })}</td>
                <td>{new Date(period.endDate).toLocaleDateString("es-BO", { timeZone: "UTC" })}</td>
                <td><span className={`status ${period.status === "OPEN" ? "success" : "warning"}`}><i />{period.status === "OPEN" ? "Abierto" : "Cerrado"}</span></td>
                <td>{period.closeNote ?? "-"}</td>
                {canManagePeriods && <td><button className="outline-button" type="button" disabled={busyPeriod === period.id} onClick={() => void updatePeriod(period)}>
                  {period.status === "OPEN" ? <><LockKeyhole size={14} /> Cerrar</> : <><LockKeyholeOpen size={14} /> Reabrir</>}
                </button></td>}
              </tr>)}
              {periods.length === 0 && <tr><td colSpan={canManagePeriods ? 6 : 5}>No hay períodos para este año.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportView({ type, data }: { type: ReportType; data: ReportData }) {
  if (type === "income-statement") return <>
    <FinancialTable title="Ingresos contabilizados" items={data.income} />
    <FinancialTable title="Gastos y devoluciones contabilizados" items={data.expenses} />
    <div style={{ padding: "1rem" }}>
      <h2>Estado de resultados del período</h2>
      <p className="muted">Calculado desde los asientos contabilizados. Los descuentos ya están reflejados en el importe de ventas y no se restan por segunda vez.</p>
    </div>
    <SummaryLine label="Ventas contabilizadas (netas de descuentos)" value={data.salesRevenue} />
    <SummaryLine label="Devoluciones de ventas" value={data.salesReturns} />
    <SummaryLine label="Ingresos netos por ventas" value={data.netSales} strong />
    <SummaryLine label="Costo de ventas" value={data.costOfSales} />
    <SummaryLine label="Utilidad bruta" value={data.grossProfit} strong detail={`Margen bruto: ${data.grossMarginPercent}%`} />
    <SummaryLine label="Gastos operativos y ajustes" value={data.operatingExpenses} />
    <SummaryLine label="Resultado operativo" value={data.operatingIncome} strong />
    <SummaryLine label="Otros ingresos" value={data.otherIncome} />
    <SummaryLine label="Resultado neto del período" value={data.netIncome} strong detail={`Margen neto: ${data.netMarginPercent}%`} />
    <p className="muted" style={{ padding: "0 1rem 1rem" }}>La ganancia será confiable si todos los gastos del período están registrados; este informe no prorratea gastos pendientes ni incluye IVA.</p>
  </>;

  if (type === "balance-sheet") return <>
    <FinancialTable title="Activos" items={data.assets} />
    <FinancialTable title="Pasivos" items={data.liabilities} />
    <FinancialTable title="Patrimonio" items={data.equity} />
    <SummaryLine label="Resultados acumulados" value={data.retainedEarnings} />
    <SummaryLine label="Total activos" value={data.assetTotal} strong />
    <SummaryLine label="Pasivos + patrimonio" value={Number(data.liabilityTotal) + Number(data.equityTotal)} strong />
    <SummaryLine label="Diferencia" value={data.difference} />
  </>;

  if (type === "trial-balance") return <>
    <FinancialTable title="Balance de comprobación" items={data.data} showDebitCredit />
    <SummaryLine label="Total débitos" value={data.debitTotal} strong />
    <SummaryLine label="Total créditos" value={data.creditTotal} strong />
  </>;

  if (type === "cash-flow") return <>
    <SummaryLine label="Entradas de efectivo" value={data.inflows} />
    <SummaryLine label="Salidas de efectivo" value={data.outflows} />
    <SummaryLine label="Flujo neto" value={data.netCashFlow} strong />
    <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Asiento</th><th>Descripción</th><th>Entrada</th><th>Salida</th></tr></thead><tbody>
      {data.entries?.map((item: any, index: number) => <tr key={`${item.number}-${index}`}><td>{new Date(item.date).toLocaleDateString("es-BO", { timeZone: "UTC" })}</td><td>{item.number}</td><td>{item.description}</td><td>{money(item.inflow)}</td><td>{money(item.outflow)}</td></tr>)}
      {!data.entries?.length && <tr><td colSpan={5}>No hay movimientos en este rango.</td></tr>}
    </tbody></table></div>
  </>;

  return <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Asiento</th><th>Descripción</th><th>Cuenta</th><th>Detalle</th><th>Débito</th><th>Crédito</th></tr></thead><tbody>
    {Array.isArray(data) && data.map((line: any, index: number) => <tr key={`${line.number}-${index}`}><td>{new Date(line.date).toLocaleDateString("es-BO", { timeZone: "UTC" })}</td><td>{line.number}</td><td>{line.description}</td><td>{line.accountCode} · {line.accountName}</td><td>{line.lineDescription ?? "-"}</td><td>{money(line.debit)}</td><td>{money(line.credit)}</td></tr>)}
    {(!Array.isArray(data) || !data.length) && <tr><td colSpan={7}>No hay asientos en este rango.</td></tr>}
  </tbody></table></div>;
}

function FinancialTable({ title, items, showDebitCredit = false }: { title: string; items?: ReportData[]; showDebitCredit?: boolean }) {
  return <div className="table-scroll">
    <h2 style={{ padding: "1rem 1rem 0" }}>{title}</h2>
    <table><thead><tr><th>Cuenta</th><th>Nombre</th>{showDebitCredit && <><th>Débito</th><th>Crédito</th></>}<th>Saldo</th></tr></thead><tbody>
      {items?.map((item) => <tr key={item.code}><td>{item.code}</td><td>{item.name}</td>{showDebitCredit && <><td>{money(item.debit)}</td><td>{money(item.credit)}</td></>}<td>{money(item.balance)}</td></tr>)}
      {!items?.length && <tr><td colSpan={showDebitCredit ? 5 : 3}>Sin movimientos.</td></tr>}
    </tbody></table>
  </div>;
}

function SummaryLine({ label, value, strong = false, detail }: { label: string; value: number; strong?: boolean; detail?: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: ".65rem 1rem", borderTop: "1px solid var(--border, #ebe8e5)", fontWeight: strong ? 700 : 500 }}>
    <span>{label}{detail && <small className="muted" style={{ display: "block", fontWeight: 400 }}>{detail}</small>}</span><span>{money(value)}</span>
  </div>;
}