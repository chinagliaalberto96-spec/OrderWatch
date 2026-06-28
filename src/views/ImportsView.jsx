import Card from "../components/Card";
import DataTable from "../components/DataTable";
import { formatDate } from "../utils/dateUtils";
import { humanizeColumn } from "../utils/formatters";

const statusTones = {
  Done: "success",
  Error: "danger",
  Processing: "warning",
  "Processing ": "warning",
  Skipped: "muted"
};

function ImportBadge({ value, type = "status" }) {
  const normalized = typeof value === "string" ? value.trim() : value;
  const tone = type === "classification" ? "primary" : statusTones[value] || statusTones[normalized] || "muted";

  if (!normalized) return "-";

  return (
    <span
      className="inline-flex min-w-24 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-${tone}) 13%, white)`,
        color: `var(--color-${tone})`
      }}
    >
      {normalized}
    </span>
  );
}

export default function ImportsView({ config, processedEmails }) {
  const rows = [...(processedEmails || [])].sort((a, b) => {
    const aDate = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bDate = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bDate - aDate;
  });

  const columns = (config.tableColumns.processedEmails || []).map((key) => ({
    key,
    label: humanizeColumn(key, config.terminology)
  }));

  function renderCell(row, key) {
    if (key === "receivedAt") return formatDate(row.receivedAt);
    if (key === "classification") return <ImportBadge value={row.classification || row.finalClassification || row.preClassification} type="classification" />;
    if (key === "status") return <ImportBadge value={row.status} />;
    if (key === "errorDetail") {
      return row.errorDetail ? (
        <span className="line-clamp-2 text-[color:var(--color-danger)]">{row.errorDetail}</span>
      ) : (
        "-"
      );
    }
    return row[key] || "-";
  }

  const processingCount = rows.filter((row) => row.status?.trim() === "Processing").length;
  const errorCount = rows.filter((row) => row.status === "Error").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card title="Email processate">
          <div className="text-3xl font-semibold">{rows.filter((row) => row.status === "Done").length}</div>
          <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Concluse senza errori
          </div>
        </Card>
        <Card title="In lavorazione">
          <div className="text-3xl font-semibold" style={{ color: processingCount ? "var(--color-warning)" : "inherit" }}>
            {processingCount}
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Da controllare se restano ferme
          </div>
        </Card>
        <Card title="Errori importazione">
          <div className="text-3xl font-semibold" style={{ color: errorCount ? "var(--color-danger)" : "inherit" }}>
            {errorCount}
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Flussi fermati correttamente
          </div>
        </Card>
      </div>
      <Card title={config.terminology.importsPlural}>
        <DataTable columns={columns} rows={rows} renderCell={renderCell} />
      </Card>
    </div>
  );
}
