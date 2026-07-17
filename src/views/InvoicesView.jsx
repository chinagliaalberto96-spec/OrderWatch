import Card from "../components/Card";
import DataTable from "../components/DataTable";
import StatusBadge from "../components/StatusBadge";
import { formatDate } from "../utils/dateUtils";
import { humanizeColumn } from "../utils/formatters";

// Tab dedicato alle fatture: prima vivevano nella coda "Oggi" come attivita'
// da fare, ma la gestione contabile/pagamenti non e' lo scope di OrderWatch.
// Qui restano semplicemente consultabili, con lo stato di collegamento a
// ordine/lavoro come unica informazione operativa.
export default function InvoicesView({ config, invoices }) {
  const rows = invoices || [];
  const totalAmount = rows.reduce((sum, invoice) => sum + (Number(invoice.totalAmount) || 0), 0);
  const unlinkedCount = rows.filter((invoice) => !invoice.orderCode && !invoice.projectCode).length;

  const columns = (config.tableColumns.invoices || []).map((key) => ({
    key,
    label: humanizeColumn(key, config.terminology)
  }));

  function renderCell(row, key) {
    if (key === "invoiceDate" || key === "dueDate") return formatDate(row[key]) || "-";
    if (key === "totalAmount") return formatCurrency(row.totalAmount, row.currency);
    if (key === "linked") {
      const reference = row.orderCode || row.projectCode;
      return reference ? reference : <span style={{ color: "var(--color-text-muted)" }}>Non collegata</span>;
    }
    if (key === "status") return <StatusBadge status={row.orderCode || row.projectCode ? "OK" : "TO_VERIFY"} />;
    return row[key] || "-";
  }

  return (
    <div className="mx-auto max-w-[1540px] space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric title="Fatture registrate" value={rows.length} />
        <Metric title="Importo totale" value={formatCurrency(totalAmount, rows[0]?.currency || "EUR")} />
        <Metric title="Non collegate a ordine/lavoro" value={unlinkedCount} />
      </div>

      <Card title="Fatture">
        <DataTable columns={columns} rows={rows} renderCell={renderCell} />
      </Card>
    </div>
  );
}

function Metric({ title, value }) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-soft" style={{ borderColor: "var(--color-border)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--color-text-muted)" }}>{title}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </section>
  );
}

function formatCurrency(value, currency = "EUR") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: currency || "EUR" }).format(numeric);
}
