import { useEffect, useMemo, useState } from "react";
import { PackageOpen, ShoppingCart, X } from "lucide-react";
import Card from "../components/Card";
import DataTable from "../components/DataTable";
import OperationalRow from "../components/OperationalRow";
import OrderDetailPanel from "../components/OrderDetailPanel";
import SeverityHighlight from "../components/SeverityHighlight";
import SmartEmptyState from "../components/SmartEmptyState";
import StatusBadge from "../components/StatusBadge";
import { formatDate } from "../utils/dateUtils";
import { formatNumber, humanizeColumn } from "../utils/formatters";
import { getOrderStatus } from "../utils/statusRules";
import { canPrepareSupplierOrderFromLine, isProcurementRequirement } from "../utils/procurement";

// Stati che richiedono un intervento del buyer: usati dal filtro "azioni
// richieste" quando si arriva qui dal KPI della dashboard.
const ACTION_STATUSES = ["OVERDUE", "CRITICAL", "TO_VERIFY"];

export default function OrdersView({ config, orders, materialLines = [], pendingDeliveryNotesCount = 0, focusOrderCode, presetFilter, onClearFilter, onUpdateOrder, onDeleteOrder, onNavigate, onPrepareSupplierOrder }) {
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Dopo un refresh dei dati (es. update dal pannello) l'ordine selezionato
  // va riagganciato alla riga aggiornata, altrimenti mostra i valori vecchi.
  useEffect(() => {
    if (!selectedOrder) return;
    const fresh = orders.find((order) => order.id === selectedOrder.id);
    if (fresh && fresh !== selectedOrder) setSelectedOrder(fresh);
    if (!fresh) setSelectedOrder(null);
  }, [orders, selectedOrder]);

  const allRows = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        status: getOrderStatus(order, config.alertRules)
      })),
    [orders, config.alertRules]
  );

  const rows = useMemo(
    () => (presetFilter === "actions" ? allRows.filter((row) => ACTION_STATUSES.includes(row.status)) : allRows),
    [allRows, presetFilter]
  );

  // Peso visivo immediato sullo stato generale, stesso principio degli
  // highlight di Altera: mostra solo le categorie non vuote.
  const severitySummary = useMemo(() => {
    const overdue = allRows.filter((row) => row.status === "OVERDUE").length;
    const critical = allRows.filter((row) => row.status === "CRITICAL").length;
    const toVerify = allRows.filter((row) => row.status === "TO_VERIFY").length;
    const onTrack = allRows.length - overdue - critical - toVerify;
    const items = [];
    if (overdue) items.push({ label: "In ritardo", value: overdue, severity: "critical" });
    if (critical) items.push({ label: "In scadenza", value: critical, severity: "warning" });
    if (toVerify) items.push({ label: "Da verificare", value: toVerify, severity: "warning" });
    if (allRows.length && onTrack > 0) items.push({ label: "Sotto controllo", value: onTrack, severity: "success" });
    return items;
  }, [allRows]);

  // Drill-down dalla dashboard/notifiche: apre direttamente l'ordine indicato.
  useEffect(() => {
    if (!focusOrderCode) return;
    const match = orders.find((order) => order.orderCode === focusOrderCode);
    if (match) setSelectedOrder(match);
  }, [focusOrderCode, orders]);

  const columns = config.tableColumns.orders.map((key) => ({
    key,
    label: humanizeColumn(key, config.terminology)
  }));

  const procurementNeeds = useMemo(
    () => materialLines
      .filter(isProcurementRequirement)
      .filter((line) => !line.orderId && !line.orderCode)
      .filter((line) => !/ricevut|arrivat|consegnat|complet|annullat/i.test(String(line.status || "")))
      .sort((a, b) => new Date(a.requiredDate || "9999-12-31") - new Date(b.requiredDate || "9999-12-31")),
    [materialLines]
  );

  function renderCell(row, key) {
    if (key === "status") return <StatusBadge status={row.status} />;
    if (key === "orderDate" || key === "dueDate") return formatDate(row[key]);
    if (key === "quantity") return formatNumber(row[key]);
    if (key === "daysRemaining") {
      return (
        <span className={row.daysRemaining < 0 ? "font-semibold" : ""} style={{ color: row.daysRemaining < 0 ? "var(--color-danger)" : "inherit" }}>
          {row.daysRemaining}
        </span>
      );
    }
    return row[key] || "-";
  }

  return (
    <div className="flex min-h-[calc(100vh-104px)] flex-col gap-4 xl:flex-row xl:gap-0">
      <main className="min-w-0 flex-1 xl:pr-4">
        {presetFilter === "actions" && (
          <div className="mb-3 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold"
              style={{
                borderColor: "color-mix(in srgb, var(--color-danger) 30%, white)",
                backgroundColor: "color-mix(in srgb, var(--color-danger) 8%, white)",
                color: "var(--color-danger)"
              }}
            >
              Filtro: azioni richieste ({rows.length})
              <button
                type="button"
                onClick={onClearFilter}
                aria-label="Rimuovi filtro"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full transition hover:bg-white/60"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        )}
        {!presetFilter && severitySummary.length > 0 && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {severitySummary.map((item) => (
              <SeverityHighlight key={item.label} label={item.label} value={item.value} severity={item.severity} />
            ))}
          </div>
        )}

        {rows.length ? (
          <Card title={`${config.terminology.ordersPlural} registrati (${rows.length})`}>
            <DataTable columns={columns} rows={rows} renderCell={renderCell} onRowClick={setSelectedOrder} />
          </Card>
        ) : (
          <OrdersEmptyState
            filtered={presetFilter === "actions"}
            onNavigate={onNavigate}
            hasProcurementNeeds={procurementNeeds.length > 0}
            pendingDeliveryNotesCount={pendingDeliveryNotesCount}
          />
        )}

        {!presetFilter && procurementNeeds.length > 0 && (
          <section className="mt-8 border-t pt-6" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Fabbisogni di acquisto</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Solo materiali e servizi esplicitamente definiti come acquisti, separati dai prodotti richiesti dal cliente.
                </p>
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--color-warning)" }}>{procurementNeeds.length} da gestire</span>
            </div>
            <div className="mt-4 border-y" style={{ borderColor: "var(--color-border)" }}>
              {procurementNeeds.slice(0, 12).map((line) => (
                <OperationalRow
                  key={line.id}
                  title={line.description || "Materiale da definire"}
                  subtitle={[line.projectCode, line.customerName, line.quantity ? `${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : null].filter(Boolean).join(" · ") || "Richiesta da completare"}
                  meta={formatDate(line.requiredDate) || "Senza scadenza"}
                  status={<StatusBadge status={line.needsReview ? "TO_VERIFY" : "Da ordinare"} />}
                  actions={onPrepareSupplierOrder && canPrepareSupplierOrderFromLine(line) ? [{
                    label: "Crea ordine fornitore",
                    icon: ShoppingCart,
                    onClick: () => onPrepareSupplierOrder({
                      kind: "material_line_selection",
                      materialLineIds: [line.id],
                      supplierId: line.supplierId || null,
                      supplierName: line.supplierName || null
                    })
                  }] : []}
                />
              ))}
            </div>
            {procurementNeeds.length > 12 && <p className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>Mostrati i primi 12 fabbisogni per urgenza.</p>}
          </section>
        )}
      </main>
      <OrderDetailPanel
        order={selectedOrder}
        status={selectedOrder ? getOrderStatus(selectedOrder, config.alertRules) : null}
        terminology={config.terminology}
        onClose={() => setSelectedOrder(null)}
        onUpdateOrder={onUpdateOrder}
        onDeleteOrder={onDeleteOrder}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function OrdersEmptyState({ filtered, onNavigate, hasProcurementNeeds, pendingDeliveryNotesCount }) {
  if (filtered) {
    return (
      <SmartEmptyState
        icon={PackageOpen}
        title="Nessun ordine richiede un'azione"
        description="Gli ordini aperti non presentano scadenze o verifiche urgenti."
      />
    );
  }

  const actions = [];
  if (onNavigate) {
    actions.push({ label: "Apri le azioni di oggi", onClick: () => onNavigate("dashboard") });
    if (pendingDeliveryNotesCount > 0) {
      actions.push({
        label: `Collega ${pendingDeliveryNotesCount} DDT in attesa in Ricevimenti`,
        onClick: () => onNavigate("receiving")
      });
    }
  }

  return (
    <SmartEmptyState
      icon={PackageOpen}
      title="Nessun ordine fornitore registrato"
      description={hasProcurementNeeds
        ? "Nessuna conferma fornitore ricevuta finora, ma ci sono fabbisogni di acquisto in attesa qui sotto."
        : "Gli ordini compariranno quando OrderWatch riconosce una conferma fornitore o quando il buyer prepara un ordine da un fabbisogno di acquisto approvato."}
      actions={actions}
    />
  );
}
