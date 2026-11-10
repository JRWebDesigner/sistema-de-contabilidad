"use client";

import { FormEvent, useEffect, useState } from "react";
import { Building2, Plus, WalletCards } from "lucide-react";

import Modal from "./ui/modal";
import { usePermission } from "./permissions-context";
import { openTableReportPdf } from "./table-report-pdf";

type Account = {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "POS";
  balance: string;
  branchId: string | null;
  custodianId: string | null;
  custodian: { alias: string } | null;
  canDeposit: boolean;
};
type CashStatement = {
  account: { name: string; type: string };
  openingBalance: number;
  closingBalance: number;
  movements: Array<{
    id: string;
    type: "IN" | "OUT";
    amount: string;
    description: string;
    reference: string | null;
    createdAt: string;
    balance: number;
  }>;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "BOB",
});

export default function CashModule() {
  const canWrite = usePermission("finance:write");
  const canAdmin = usePermission("users:manage");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountForm, setAccountForm] = useState({
    name: "",
    type: "CASH",
    initialBalance: "0",
  });
  const [movementForm, setMovementForm] = useState({
    accountId: "",
    type: "IN",
    amount: "",
    description: "",
  });
  const [depositForm, setDepositForm] = useState({
    sourceAccountId: "",
    destinationAccountId: "",
    amount: "",
    externalReference: "",
  });
  const [message, setMessage] = useState("");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [branchAssignments, setBranchAssignments] = useState<Record<string, string>>({});
  const [statementAccountId, setStatementAccountId] = useState("");
  const [statementFrom, setStatementFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [statementTo, setStatementTo] = useState(new Date().toISOString().slice(0, 10));
  const [statement, setStatement] = useState<CashStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const custodyAccounts = accounts.filter((account) => account.custodianId);
  const personalCustodyAccounts = custodyAccounts.filter((account) => account.canDeposit);
  const bankAccounts = accounts.filter((account) => account.type === "BANK" && !account.custodianId);

  async function loadAccounts() {
    const response = await fetch("/api/cash");
    if (response.ok) {
      const data = await response.json();
      setAccounts(data);
      setMovementForm((current) => ({
        ...current,
        accountId: current.accountId || data.find((account: Account) => !account.custodianId)?.id || "",
      }));
    }
  }

  useEffect(() => {
    void loadAccounts();
    if (canAdmin) {
      void fetch("/api/branches").then(async (response) => {
        const data = await response.json();
        if (response.ok) setBranches(data.branches ?? []);
      });
    }
  }, []);

  useEffect(() => {
    if (!statementAccountId) return;
    let active = true;
    async function loadStatement() {
      setStatementLoading(true);
      setMessage("");
      try {
        const params = new URLSearchParams({
          statement: "true",
          accountId: statementAccountId,
          from: statementFrom,
          to: statementTo,
        });
        const response = await fetch(`/api/cash?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el estado de cuenta.");
        if (active) setStatement(data);
      } catch (error) {
        if (!active) return;
        setStatement(null);
        setMessage(error instanceof Error ? error.message : "No se pudo cargar el estado de cuenta.");
      } finally {
        if (active) setStatementLoading(false);
      }
    }
    void loadStatement();
    return () => { active = false; };
  }, [statementAccountId, statementFrom, statementTo]);

  async function assignAccount(accountId: string) {
    const branchId = branchAssignments[accountId];
    if (!branchId) return;
    const response = await fetch("/api/cash", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign-branch", accountId, branchId }),
    });
    const data = await response.json();
    setMessage(response.ok ? `Cuenta asignada a ${branches.find((branch) => branch.id === branchId)?.name ?? "la sucursal"}.` : data.error ?? "No se pudo asignar la cuenta.");
    if (response.ok) await loadAccounts();
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountForm),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? "Cuenta creada correctamente."
        : (data.error ?? "No se pudo crear la cuenta."),
    );
    if (response.ok) {
      setAccountForm({ name: "", type: "CASH", initialBalance: "0" });
      setAccountModalOpen(false);
      await loadAccounts();
    }
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(movementForm),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? "Movimiento financiero registrado."
        : (data.error ?? "No se pudo registrar el movimiento."),
    );
    if (response.ok) {
      setMovementForm((current) => ({
        ...current,
        amount: "",
        description: "",
      }));
      setMovementModalOpen(false);
      await loadAccounts();
    }
  }

  async function submitDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (depositSubmitting) return;
    setDepositSubmitting(true);
    try {
      const response = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...depositForm, action: "deposit" }),
      });
      const data = await response.json();
      setMessage(response.ok
        ? `Depósito ${data.reference} registrado correctamente.`
        : (data.error ?? "No se pudo registrar el depósito."));
      if (response.ok) {
        setDepositForm({
          sourceAccountId: "",
          destinationAccountId: "",
          amount: "",
          externalReference: "",
        });
        setDepositModalOpen(false);
        await loadAccounts();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo conectar para registrar el depósito.");
    } finally {
      setDepositSubmitting(false);
    }
  }

  async function removeAccount(id: string) {
    const confirmed = window.confirm("¿Deseas eliminar esta cuenta/banco?");
    if (!confirmed) return;
    const response = await fetch(`/api/cash?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? `Cuenta eliminada: ${data.name ?? "ok"}`
        : (data.error ?? "No se pudo eliminar la cuenta."),
    );
    if (response.ok) await loadAccounts();
  }

  const total = accounts.reduce(
    (sum, account) => sum + Number(account.balance),
    0,
  );

  function exportCashStatement() {
    if (!statement) return;
    const rows = [
      ["Fecha", "Referencia", "Descripción", "Ingreso (Bs)", "Egreso (Bs)", "Saldo (Bs)"],
      ...statement.movements.map((movement) => [
        new Date(movement.createdAt).toLocaleString("es-BO"),
        movement.reference ?? "",
        movement.description,
        movement.type === "IN" ? Number(movement.amount).toFixed(2) : "0.00",
        movement.type === "OUT" ? Number(movement.amount).toFixed(2) : "0.00",
        movement.balance.toFixed(2),
      ]),
    ];
    const content = `\uFEFF${rows.map((row) => row.map((value) => {
      const text = String(value).replace(/^[=+\-@\t\r]/, "'$&");
      return `"${text.replace(/"/g, '""')}"`;
    }).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `estado-de-caja-${statementAccountId}-${statementFrom}-${statementTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function printCashStatement() {
    if (!statement) return;
    const printable = window.open("", "_blank", "width=1000,height=750");
    if (!printable) {
      setMessage("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e inténtalo otra vez.");
      return;
    }
    try {
      await openTableReportPdf({
        title: `Estado de caja · ${statement.account.name}`,
        subtitle: `${statementFrom} a ${statementTo} · Saldo inicial: ${money.format(statement.openingBalance)} · Saldo final: ${money.format(statement.closingBalance)}`,
        headers: ["Fecha", "Referencia", "Descripción", "Ingreso (Bs)", "Egreso (Bs)", "Saldo (Bs)"],
        rows: statement.movements.map((movement) => [
          new Date(movement.createdAt).toLocaleString("es-BO"),
          movement.reference ?? "",
          movement.description,
          movement.type === "IN" ? money.format(Number(movement.amount)) : "—",
          movement.type === "OUT" ? money.format(Number(movement.amount)) : "—",
          money.format(movement.balance),
        ]),
      }, printable);
    } catch (error) {
      printable.close();
      setMessage(error instanceof Error ? error.message : "No se pudo generar el PDF del estado de caja.");
    }
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Finanzas · Bolivia</p>
          <h1>Caja y bancos</h1>
          <p className="muted">
            Saldos y movimientos financieros expresados en Bs.
          </p>
        </div>
        <div className="heading-actions">
          <span className="currency-note">Saldo total: {money.format(total)}</span>
          {canWrite && <button className="primary-button" type="button" onClick={() => setAccountModalOpen(true)}><Plus size={15} /> Nueva cuenta</button>}
          {canWrite && <button className="outline-button" type="button" onClick={() => setMovementModalOpen(true)}><WalletCards size={15} /> Movimiento</button>}
          {canWrite && personalCustodyAccounts.length > 0 && <button
            className="outline-button"
            type="button"
            disabled={!bankAccounts.length}
            title={!bankAccounts.length ? "Crea o activa una cuenta bancaria antes de registrar un depósito." : undefined}
            onClick={() => {
              setDepositForm((current) => ({
                ...current,
                sourceAccountId: personalCustodyAccounts[0]?.id ?? "",
                destinationAccountId: bankAccounts[0]?.id ?? "",
              }));
              setDepositModalOpen(true);
            }}
          >
            <Building2 size={15} /> Registrar depósito
          </button>}
        </div>
      </div>
      {message && <p className="module-message">{message}</p>}
      <div className="module-stats">
        {accounts.map((account) => (
          <div key={account.id}>
            <span>{account.name}</span>
            <strong>{money.format(Number(account.balance))}</strong>
            <small>
              {account.custodian
                ? `En custodia de ${account.custodian.alias}`
                : account.type === "CASH"
                ? "Efectivo"
                : account.type === "BANK"
                  ? "Banco"
                  : "POS"}
            </small>
            {canAdmin && !account.branchId && branches.length > 0 && <>
              <select
                aria-label={`Sucursal para ${account.name}`}
                value={branchAssignments[account.id] ?? ""}
                onChange={(event) => setBranchAssignments({ ...branchAssignments, [account.id]: event.target.value })}
              >
                <option value="">Asignar sucursal...</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
              <button className="outline-button" disabled={!branchAssignments[account.id]} onClick={() => void assignAccount(account.id)}>
                Asignar cuenta
              </button>
            </>}
            {canAdmin && !account.custodianId && <button
              className="outline-button"
              style={{ marginTop: 8 }}
              onClick={() => void removeAccount(account.id)}
            >
              Eliminar
            </button>}
          </div>
        ))}
      </div>
      {canWrite && <Modal open={accountModalOpen} onClose={() => setAccountModalOpen(false)} page="Finanzas · Bolivia" title="Nueva cuenta" description="Crea una caja, cuenta bancaria o cuenta POS." className="finance-modal">
        <form className="product-form" onSubmit={submitAccount}>
          <h2>Nueva cuenta</h2>
          <div className="product-form-grid">
            <label>
              Nombre
              <input
                required
                value={accountForm.name}
                onChange={(event) =>
                  setAccountForm({ ...accountForm, name: event.target.value })
                }
                placeholder="Ej. Banco BNB"
              />
            </label>
            <label>
              Tipo
              <select
                value={accountForm.type}
                onChange={(event) =>
                  setAccountForm({ ...accountForm, type: event.target.value })
                }
              >
                <option value="CASH">Caja</option>
                <option value="BANK">Banco</option>
                <option value="POS">POS</option>
              </select>
            </label>
            <label>
              Saldo inicial Bs
              <input
                min="0"
                step="0.01"
                type="number"
                value={accountForm.initialBalance}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    initialBalance: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <button className="primary-button" type="submit">
            <Plus size={15} /> Crear cuenta
          </button>
        </form>
      </Modal>}
      {canWrite && <Modal open={movementModalOpen} onClose={() => setMovementModalOpen(false)} page="Finanzas · Bolivia" title="Registrar movimiento" description="Registra un ingreso o egreso en una cuenta." className="finance-modal">
        <form className="product-form" onSubmit={submitMovement}>
          <h2>Registrar movimiento</h2>
          <div className="product-form-grid">
            <label>
              Cuenta
              <select
                required
                value={movementForm.accountId}
                onChange={(event) =>
                  setMovementForm({
                    ...movementForm,
                    accountId: event.target.value,
                  })
                }
              >
                <option value="">Selecciona una cuenta</option>
                {accounts.filter((account) => !account.custodianId).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo
              <select
                value={movementForm.type}
                onChange={(event) =>
                  setMovementForm({ ...movementForm, type: event.target.value })
                }
              >
                <option value="IN">Ingreso</option>
                <option value="OUT">Egreso</option>
              </select>
            </label>
            <label>
              Monto Bs
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                value={movementForm.amount}
                onChange={(event) =>
                  setMovementForm({
                    ...movementForm,
                    amount: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Descripción
              <input
                required
                value={movementForm.description}
                onChange={(event) =>
                  setMovementForm({
                    ...movementForm,
                    description: event.target.value,
                  })
                }
                placeholder="Ej. pago de servicio"
              />
            </label>
          </div>
          <button className="primary-button" type="submit">
            <WalletCards size={15} /> Guardar movimiento
          </button>
        </form>
      </Modal>}
      {canWrite && <Modal open={depositModalOpen} onClose={() => setDepositModalOpen(false)} page="Finanzas · Bolivia" title="Registrar depósito" description="Transfiere el efectivo bajo tu custodia a una cuenta bancaria." className="finance-modal">
        <form className="product-form" onSubmit={submitDeposit}>
          <div className="product-form-grid">
            <label>
              Efectivo en custodia
              <select
                required
                value={depositForm.sourceAccountId}
                onChange={(event) => setDepositForm({ ...depositForm, sourceAccountId: event.target.value })}
              >
                <option value="">Selecciona tu caja</option>
                {personalCustodyAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name} · Bs {Number(account.balance).toFixed(2)}</option>
                ))}
              </select>
            </label>
            <label>
              Cuenta bancaria de destino
              <select
                required
                value={depositForm.destinationAccountId}
                onChange={(event) => setDepositForm({ ...depositForm, destinationAccountId: event.target.value })}
              >
                <option value="">Selecciona el banco</option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
            <label>
              Monto depositado (Bs)
              <input
                required
                type="number"
                min="0.01"
                max={Number(accounts.find((account) => account.id === depositForm.sourceAccountId)?.balance ?? 0)}
                step="0.01"
                value={depositForm.amount}
                onChange={(event) => setDepositForm({ ...depositForm, amount: event.target.value })}
              />
            </label>
            <label>
              Referencia del depósito (opcional)
              <input
                maxLength={100}
                value={depositForm.externalReference}
                onChange={(event) => setDepositForm({ ...depositForm, externalReference: event.target.value })}
                placeholder="Ej. número de operación bancaria"
              />
            </label>
          </div>
          <button className="primary-button" type="submit" disabled={depositSubmitting || !bankAccounts.length}>
            <Building2 size={15} /> Confirmar depósito
          </button>
        </form>
      </Modal>}
      <article className="panel module-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Tipo</th>
                <th>Saldo Bs</th>
                <th>Estado</th>
                <th>Estado de cuenta</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <div className="product-cell">
                      <span className="product-thumb">
                        <Building2 size={16} />
                      </span>
                      <strong>{account.name}</strong>
                    </div>
                  </td>
                  <td>
                    {account.type === "CASH"
                      ? "Caja"
                      : account.type === "BANK"
                        ? "Banco"
                        : "POS"}
                  </td>
                  <td>
                    <strong>{money.format(Number(account.balance))}</strong>
                  </td>
                  <td>
                    <span className="status success">
                      <i />
                      Activa
                    </span>
                  </td>
                  <td><button className="outline-button" type="button" onClick={() => {
                    setStatement(null);
                    setStatementAccountId(account.id);
                  }}>Ver movimientos</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
      <Modal
        open={Boolean(statementAccountId)}
        onClose={() => {
          setStatementAccountId("");
          setStatement(null);
        }}
        page="Finanzas · Estados de cuenta"
        title={statement?.account.name ?? "Estado de cuenta"}
        description="Movimientos de caja o banco con saldo acumulado por fecha."
        className="finance-modal"
      >
        <div className="product-form">
          <div className="product-form-grid">
            <label>Desde<input type="date" value={statementFrom} max={statementTo} onChange={(event) => setStatementFrom(event.target.value)} /></label>
            <label>Hasta<input type="date" value={statementTo} min={statementFrom} onChange={(event) => setStatementTo(event.target.value)} /></label>
          </div>
          {statementLoading ? <p>Cargando estado de cuenta...</p> : statement && <>
            <div className="module-stats">
              <div><span>Saldo inicial</span><strong>{money.format(statement.openingBalance)}</strong></div>
              <div><span>Saldo al cierre</span><strong>{money.format(statement.closingBalance)}</strong></div>
            </div>
            <div className="heading-actions">
              <button className="outline-button" type="button" onClick={exportCashStatement}>Exportar CSV</button>
              <button className="outline-button" type="button" onClick={printCashStatement}>Imprimir / PDF</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Fecha</th><th>Referencia</th><th>Descripción</th><th>Ingreso</th><th>Egreso</th><th>Saldo corrido</th></tr></thead>
                <tbody>{statement.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{new Date(movement.createdAt).toLocaleString("es-BO")}</td>
                    <td>{movement.reference ?? "—"}</td>
                    <td>{movement.description}</td>
                    <td>{movement.type === "IN" ? money.format(Number(movement.amount)) : "—"}</td>
                    <td>{movement.type === "OUT" ? money.format(Number(movement.amount)) : "—"}</td>
                    <td><strong>{money.format(movement.balance)}</strong></td>
                  </tr>
                ))}{statement.movements.length === 0 && <tr><td colSpan={6}>No hay movimientos en este rango.</td></tr>}</tbody>
              </table>
            </div>
          </>}
        </div>
      </Modal>
    </div>
  );
}
