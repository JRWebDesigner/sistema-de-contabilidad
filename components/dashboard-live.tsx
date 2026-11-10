"use client";

import { useEffect, useState } from "react";
import {
  Boxes,
  Building2,
  CircleDollarSign,
  CreditCard,
  LogOut,
  Package,
  WalletCards,
} from "lucide-react";

type DashboardData = {
  visibility: { sales: boolean; inventory: boolean; finance: boolean };
  kpis: {
    sales: string;
    profit: string;
    receivables: string;
    inventory: string;
    salesChange: string;
    averageTicket: string;
    salesCount: number;
  };
  chart: { month: string; value: number }[];
  topProducts: { productId: string; name: string; sku: string; quantity: number; total: string }[];
  accounts: { name: string; type: string; balance: string }[];
  lowStock: {
    name: string;
    sku: string;
    category: string;
    stock: number;
    price: string;
  }[];
  movements: {
    type: string;
    product: string;
    sku: string;
    quantity: number;
    time: string;
  }[];
  reconciliation: {
    cash: { recorded: string; movements: string; difference: string; reconciled: boolean };
    receivables: { original: string; paid: string; balance: string; difference: string; reconciled: boolean };
    payables: { original: string; paid: string; balance: string; difference: string; reconciled: boolean };
    inventory: { valueAtCost: string; ledgerValue: string; difference: string; stockMismatches: number; reconciled: boolean };
  };
};

const money = (value: string) =>
  `Bs ${Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2 })}`;

export default function DashboardLive({
  onNavigate,
  canCreateSale,
}: {
  onNavigate: (id: string) => void;
  canCreateSale: boolean;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar el dashboard.");
        return response.json();
      })
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error)
    return (
      <div className="dashboard-content">
        <p className="module-message">{error}</p>
      </div>
    );
  if (!data)
    return (
      <div className="dashboard-content">
        <p className="muted">Cargando indicadores reales...</p>
      </div>
    );

  const maxChart = Math.max(...data.chart.map((item) => item.value), 1);
  const totalCash = data.accounts.reduce(
    (sum, account) => sum + Number(account.balance),
    0,
  );

  return (
    <div className="dashboard-live">
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Resumen general · Bolivia</p>
          <h1>Dashboard</h1>
        </div>
        <div className="heading-actions">
          {canCreateSale && <button
            className="primary-button"
            onClick={() => onNavigate("ventas")}
          >
            Nueva venta
          </button>}
          <button
            className="outline-button"
            onClick={async () => {
              await fetch("/api/auth", { method: "DELETE" });
              window.location.href = "/login";
            }}
          >
            <LogOut size={15} /> Cerrar sesión
          </button>
        </div>
      </div>
      <section className="kpi-grid">
        {data.visibility.sales && <>
        <Kpi
          label="Ventas del mes"
          value={money(data.kpis.sales)}
          detail={data.kpis.salesChange}
          tone="green"
        />
        <Kpi
          label="Margen bruto estimado"
          value={money(data.kpis.profit)}
          detail="Antes de gastos e impuestos"
          tone="orange"
        />
        <Kpi
          label="Ticket promedio"
          value={money(data.kpis.averageTicket)}
          detail={`${data.kpis.salesCount} ventas este mes`}
          tone="purple"
        />
        </>}
        {data.visibility.finance && <>
        <Kpi
          label="Cuentas por cobrar"
          value={money(data.kpis.receivables)}
          detail="Pendiente"
          tone="purple"
        />
        </>}
        {data.visibility.inventory && <>
        <Kpi
          label="Valor inventario"
          value={money(data.kpis.inventory)}
          detail="A costo"
          tone="orange"
        />
        </>}
      </section>
      {data.visibility.finance && data.visibility.inventory && <section className="panel reconciliation-panel">
        <div className="panel-header">
          <div>
            <h2>Conciliación contable e inventario</h2>
            <p>Controles calculados contra los movimientos registrados.</p>
          </div>
        </div>
        <div className="reconciliation-grid">
          <ReconciliationItem
            label="Caja"
            detail={`Saldo ${money(data.reconciliation.cash.recorded)} · movimientos ${money(data.reconciliation.cash.movements)}`}
            difference={data.reconciliation.cash.difference}
            reconciled={data.reconciliation.cash.reconciled}
          />
          <ReconciliationItem
            label="Cuentas por cobrar"
            detail={`${money(data.reconciliation.receivables.original)} = ${money(data.reconciliation.receivables.paid)} pagado + ${money(data.reconciliation.receivables.balance)} saldo`}
            difference={data.reconciliation.receivables.difference}
            reconciled={data.reconciliation.receivables.reconciled}
          />
          <ReconciliationItem
            label="Cuentas por pagar"
            detail={`${money(data.reconciliation.payables.original)} = ${money(data.reconciliation.payables.paid)} pagado + ${money(data.reconciliation.payables.balance)} saldo`}
            difference={data.reconciliation.payables.difference}
            reconciled={data.reconciliation.payables.reconciled}
          />
          <ReconciliationItem
            label="Inventario valorizado"
            detail={`${data.reconciliation.inventory.stockMismatches} diferencias de stock · mayor ${money(data.reconciliation.inventory.ledgerValue)}`}
            difference={data.reconciliation.inventory.difference}
            reconciled={data.reconciliation.inventory.reconciled}
            valueLabel="Diferencia contable"
            statusLabel="Conciliado"
          />
        </div>
      </section>}
      {(data.visibility.sales || data.visibility.finance) && <section className="main-grid">
        {data.visibility.sales && <article className="panel sales-panel">
          <div className="panel-header">
            <div>
              <h2>Ventas del año</h2>
              <p>Totales mensuales desde PostgreSQL</p>
            </div>
          </div>
          <div className="chart-wrap">
            <div className="chart">
              <div className="grid-lines">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="bars">
                {data.chart.map((item) => (
                  <div className="bar-group" key={item.month}>
                    <div
                      className="bar-value"
                      style={{
                        height: `${Math.max((item.value / maxChart) * 100, 3)}%`,
                      }}
                    >
                      <b />
                    </div>
                    <span>{item.month}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </article>}
        {data.visibility.finance && <article className="panel summary-panel">
          <div className="panel-header">
            <div>
              <h2>Resumen de caja</h2>
              <p>Saldos actuales</p>
            </div>
          </div>
          <div className="cash-total">
            <span>Total en cuentas</span>
            <strong>{money(totalCash.toFixed(2))}</strong>
          </div>
          <div className="cash-list">
            {data.accounts.length === 0 ? (
              <p className="muted">No hay cuentas registradas.</p>
            ) : (
              data.accounts.map((account) => (
                <div key={account.name}>
                  <span className="cash-icon wallet">
                    <AccountIcon type={account.type} />
                  </span>
                  <label>
                    {account.name}
                    <b>{money(account.balance)}</b>
                  </label>
                </div>
              ))
            )}
          </div>
        </article>}
      </section>}
      {data.visibility.sales && <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>Productos más vendidos del mes</h2>
            <p>Ordenados por unidades vendidas; el total ya refleja descuentos.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Producto</th><th>Unidades</th><th>Venta neta</th></tr></thead>
            <tbody>
              {data.topProducts.length === 0 ? (
                <tr><td colSpan={3}>Todavía no hay ventas este mes.</td></tr>
              ) : data.topProducts.map((product) => (
                <tr key={product.productId}>
                  <td><div className="product-cell"><span className="product-thumb"><Package size={16} /></span><div><strong>{product.name}</strong><small>{product.sku}</small></div></div></td>
                  <td>{product.quantity}</td>
                  <td><strong>{money(product.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
      {data.visibility.inventory && <section className="lower-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Stock bajo</h2>
              <p>Productos que requieren reposición</p>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("inventario")}
            >
              Ver inventario
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Stock</th>
                  <th>Precio</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No hay productos bajo el mínimo.</td>
                  </tr>
                ) : (
                  data.lowStock.map((product) => (
                    <tr key={product.sku}>
                      <td>
                        <div className="product-cell">
                          <span className="product-thumb">
                            <Package size={16} />
                          </span>
                          <div>
                            <strong>{product.name}</strong>
                            <small>{product.sku}</small>
                          </div>
                        </div>
                      </td>
                      <td>{product.category}</td>
                      <td>
                        <strong className="stock-low">{product.stock}</strong>
                      </td>
                      <td>{money(product.price)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Movimientos recientes</h2>
              <p>Últimas entradas y salidas</p>
            </div>
          </div>
          <div className="activity-list">
            {data.movements.length === 0 ? (
              <p className="muted">No hay movimientos registrados.</p>
            ) : (
              data.movements.map((movement) => (
                <div
                  className="activity-item"
                  key={`${movement.sku}-${movement.time}`}
                >
                  <span                   className="activity-icon orange">
                    <Boxes size={15} />
                  </span>
                  <div>
                    <strong>{movement.product}</strong>
                    <p>
                      {movement.type} · {movement.sku}
                    </p>
                    <small>
                      {new Date(movement.time).toLocaleString("es-BO")}
                    </small>
                  </div>
                  <b>
                    {movement.quantity > 0 ? "+" : ""}
                    {movement.quantity}
                  </b>
                </div>
              ))
            )}
          </div>
        </article>
      </section>}
    </div>
    </div>
  );
}

function ReconciliationItem({ label, detail, difference, reconciled, valueLabel = "Diferencia", statusLabel = "Conciliado" }: { label: string; detail: string; difference: string; reconciled: boolean; valueLabel?: string; statusLabel?: string }) {
  return (
    <div className={`reconciliation-item ${reconciled ? "is-reconciled" : "is-unreconciled"}`}>
      <div className="reconciliation-item-heading">
        <strong>{label}</strong>
        <span>{reconciled ? statusLabel : "Revisar"}</span>
      </div>
      <p>{detail}</p>
      <small>{valueLabel}: <b>{money(difference)}</b></small>
    </div>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <article className="kpi-card">
      <div className={`kpi-icon ${tone}`}>
        <CircleDollarSign size={19} />
      </div>
      <div className="kpi-info">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}
function AccountIcon({ type }: { type: string }) {
  return type === "BANK" ? (
    <Building2 size={15} />
  ) : type === "POS" ? (
    <CreditCard size={15} />
  ) : (
    <WalletCards size={15} />
  );
}
