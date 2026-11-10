"use client";

import { useEffect, useState } from "react";

import Modal from "./ui/modal";
import { openAccountStatementPdf } from "./account-statement-pdf";
import { saveArchivedReport, type ArchivedReportType } from "./report-archive-client";

type StatementEntry = {
  id: string;
  groupId: string;
  date: string;
  number: string;
  description: string;
  details?: string[];
  debit: number;
  credit: number;
  balance: number;
  outstandingBalance?: number;
  dueDate?: string;
};

type AccountStatement = {
  party: { name: string; document: string };
  openingBalance: number;
  closingBalance: number;
  entries: StatementEntry[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  partyType: "customer" | "supplier";
  partyId: string;
};

const money = (value: number) =>
  `Bs ${value.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function statementTotals(statement: AccountStatement) {
  const debit = statement.entries.reduce((total, entry) => total + Math.round(entry.debit * 100), 0) / 100;
  const credit = statement.entries.reduce((total, entry) => total + Math.round(entry.credit * 100), 0) / 100;
  return {
    debit,
    credit,
    balance: statement.closingBalance,
  };
}

function numberedEntries(entries: StatementEntry[]) {
  let previousGroupId: string | null = null;
  let rowNumber = 0;
  return entries.map((entry) => {
    const groupStart = entry.groupId !== previousGroupId;
    if (groupStart) rowNumber += 1;
    previousGroupId = entry.groupId;
    return { ...entry, rowNumber, groupStart };
  });
}

export default function AccountStatementModal({ open, onClose, partyType, partyId }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [statement, setStatement] = useState<AccountStatement | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !partyId) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setMessage("");
      try {
        const params = new URLSearchParams({ type: partyType, partyId, from, to });
        const response = await fetch(`/api/account-statements?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el estado de cuenta.");
        setStatement(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatement(null);
        setMessage(error instanceof Error ? error.message : "No se pudo cargar el estado de cuenta.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [open, partyType, partyId, from, to]);

  async function printStatement(mode: "basic" | "detailed" | "debts") {
    if (!statement) return;
    if (mode === "debts" && partyType !== "customer") {
      setMessage("El reporte de deudas está disponible solo para clientes.");
      return;
    }
    const printable = window.open("", "_blank", "width=1000,height=750");
    if (!printable) {
      setMessage("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e inténtalo otra vez.");
      return;
    }
    try {
      let debtBalance = 0;
      const reportEntries = mode === "debts"
        ? statement.entries
            .filter((entry) => entry.id.startsWith("sale-") && Number(entry.outstandingBalance) > 0)
            .map((entry) => {
              debtBalance = Math.round((debtBalance + Number(entry.outstandingBalance) + Number.EPSILON) * 100) / 100;
              return {
                ...entry,
                groupId: entry.id,
                description: `${entry.description}${entry.dueDate ? ` · Vence: ${new Date(entry.dueDate).toLocaleDateString("es-BO")}` : ""}`,
                debit: Number(entry.outstandingBalance),
                credit: 0,
                balance: debtBalance,
              };
            })
        : statement.entries;
      const numbered = numberedEntries(reportEntries);
      const title = mode === "detailed"
        ? "Estado de cuenta detallado"
        : mode === "debts"
          ? "Reporte de deudas"
          : "Estado de cuenta";
      const printableStatement = {
        title,
        partyName: statement.party.name,
        partyDocument: statement.party.document,
        from,
        to,
        openingBalance: mode === "debts" ? 0 : statement.openingBalance,
        closingBalance: mode === "debts"
          ? reportEntries.at(-1)?.balance ?? 0
          : statement.closingBalance,
        debitTotal: reportEntries.reduce((total, entry) => total + Math.round(entry.debit * 100), 0) / 100,
        creditTotal: reportEntries.reduce((total, entry) => total + Math.round(entry.credit * 100), 0) / 100,
        entries: numbered.map((entry) => ({
          rowNumber: entry.rowNumber,
          groupStart: entry.groupStart,
          number: entry.number,
          date: entry.date,
          description: entry.description,
          details: mode === "detailed" ? entry.details : undefined,
          debit: entry.debit,
          credit: entry.credit,
          balance: entry.balance,
        })),
      };
      const blob = await openAccountStatementPdf(printableStatement, printable);
      try {
        const type: ArchivedReportType = mode === "detailed"
          ? "CUSTOMER_STATEMENT_DETAILED"
          : mode === "debts"
            ? "CUSTOMER_DEBTS"
            : "CUSTOMER_STATEMENT_SUMMARY";
        await saveArchivedReport({
          blob,
          title: `${title} - ${statement.party.name}`,
          fileName: `${title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
          type: partyType === "customer" ? type : "FINANCE_REPORT",
          customerId: partyType === "customer" ? partyId : undefined,
          periodStart: from,
          periodEnd: to,
        });
        setMessage("PDF generado y guardado en el archivo de reportes.");
      } catch (error) {
        console.error("ERROR_ARCHIVING_ACCOUNT_STATEMENT", error);
        setMessage(error instanceof Error
          ? `El PDF se generó, pero no se pudo archivar: ${error.message}`
          : "El PDF se generó, pero no se pudo guardar en el archivo.");
      }
    } catch (error) {
      printable.close();
      setMessage(error instanceof Error ? error.message : "No se pudo generar el PDF del estado de cuenta.");
    }
  }

  const totals = statement ? statementTotals(statement) : { debit: 0, credit: 0, balance: 0 };
  const entries = statement ? numberedEntries(statement.entries) : [];

  return (
    <Modal open={open} onClose={onClose} page="Finanzas · Estados de cuenta" title="Estado de cuenta" description="Movimientos y saldo acumulado del tercero seleccionado." className="finance-modal">
      <div className="product-form">
        <div className="product-form-grid">
          <label>Desde<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        {message && <p className="module-message">{message}</p>}
        {loading ? <p>Cargando estado de cuenta...</p> : statement && <>
          <div className="module-stats">
            <div><span>{statement.party.name}</span><strong>{statement.party.document}</strong><small>Saldo inicial: {money(statement.openingBalance)}</small></div>
            <div><span>Saldo al cierre</span><strong>{money(statement.closingBalance)}</strong></div>
          </div>
          <div className="heading-actions">
            <button className="outline-button" type="button" onClick={() => printStatement("detailed")}>Imprimir a detalle PDF</button>
            <button className="outline-button" type="button" onClick={() => printStatement("basic")}>Imprimir PDF</button>
            <button className="outline-button" type="button" onClick={() => printStatement("debts")} disabled={partyType !== "customer"} title={partyType !== "customer" ? "Disponible solo para clientes" : undefined}>Reporte de deudas PDF</button>
          </div>
          <div className="table-scroll">
            <table className="account-statement-table">
              <thead><tr><th>NRO</th><th>DOCUMENTO</th><th>FECHA</th><th>CONCEPTO</th><th>DEUDA</th><th>HABER</th><th>SALDO</th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className={entry.groupStart ? "statement-group-start" : undefined}>
                    <td>{entry.groupStart ? entry.rowNumber : ""}</td>
                    <td>{entry.number}</td>
                    <td>{new Date(entry.date).toLocaleDateString("es-BO")}</td>
                    <td>{entry.description}</td>
                    <td>{money(entry.debit)}</td>
                    <td>{money(entry.credit)}</td>
                    <td><strong>{money(entry.balance)}</strong></td>
                  </tr>
                ))}
                {statement.entries.length === 0 && <tr><td colSpan={7}>No hay movimientos en este rango.</td></tr>}
                <tr className="table-total-row">
                  <td colSpan={4}><strong>Totales:</strong></td>
                  <td><strong>{money(totals.debit)}</strong></td>
                  <td><strong>{money(totals.credit)}</strong></td>
                  <td><strong>{money(totals.balance)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>}
      </div>
    </Modal>
  );
}
