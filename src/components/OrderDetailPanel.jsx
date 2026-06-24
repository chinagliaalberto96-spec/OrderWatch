import { X } from "lucide-react";
import { formatDate } from "../utils/dateUtils";
import { formatNumber, formatPercent } from "../utils/formatters";
import StatusBadge from "./StatusBadge";
import Button from "./Button";

export default function OrderDetailPanel({ order, status, terminology, onClose }) {
  if (!order) return null;

  const rows = [
    ["ID ordine", order.orderCode],
    [terminology.supplierSingular, order.supplierName],
    [terminology.projectSingular, order.projectCode],
    [terminology.material, order.material],
    ["Quantita", formatNumber(order.quantity)],
    ["Data ordine", formatDate(order.orderDate)],
    [terminology.dueDate, formatDate(order.dueDate)],
    ["Data richiesta", formatDate(order.requiredDate)],
    // Numero ordine assegnato dal fornitore (es. 13974707 Fedrigoni, 399863 Sunclear),
    // utile per riscontro rapido durante un sollecito telefonico o via email.
    ...(order.supplierOrderRef ? [["Rif. fornitore", order.supplierOrderRef]] : []),
    ["Risposta fornitore", order.supplierResponse || "-"],
    ["Solleciti", order.reminderCount],
    ["AI confidence", formatPercent(order.aiConfidence)]
  ];

  return (
    <aside className="w-96 shrink-0 border-l bg-white" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}>
      <div className="flex h-14 items-center justify-between border-b px-4" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <div className="text-sm font-semibold">{order.orderCode}</div>
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Dettaglio {terminology.orderSingular.toLowerCase()}
          </div>
        </div>
        <Button variant="ghost" className="h-8 w-8 px-0" onClick={onClose} aria-label="Chiudi dettaglio">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-5 p-4">
        <StatusBadge status={status} />
        <dl className="space-y-3">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[140px_1fr] gap-3 text-sm">
              <dt style={{ color: "var(--color-text-muted)" }}>{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {order.notes && (
          <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
            {order.notes}
          </div>
        )}
      </div>
    </aside>
  );
}
