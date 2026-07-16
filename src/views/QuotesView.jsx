import { ArrowRight, FileText, SearchCheck } from "lucide-react";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import { formatDate } from "../utils/dateUtils";

export default function QuotesView({ data, onNavigate }) {
  const navigate = onNavigate || (() => {});
  const quoteProjects = (data.projects || [])
    .filter((project) => /preventivo/i.test(project.status || ""))
    .map((project) => ({
      id: `project-${project.id}`,
      source: "Cliente",
      title: project.customer || "Cliente da verificare",
      description: project.notes || "Richiesta di preventivo cliente",
      projectCode: project.projectCode,
      dueDate: project.dueDate,
      status: project.status
    }));

  const quoteDocuments = (data.documents || [])
    .filter((document) => /preventivo/i.test(document.type || ""))
    .map((document) => ({
      id: `document-${document.id}`,
      source: "Fornitore",
      title: document.supplierName || "Fornitore da verificare",
      description: document.name || "Preventivo fornitore",
      linkedOrder: document.linkedOrder,
      receivedAt: document.receivedAt,
      confidence: document.confidence
    }));

  const quoteLines = (data.materialLines || [])
    .filter((line) => line.sourceType === "quote" || /preventivo/i.test(line.status || ""))
    .map((line) => ({
      id: `line-${line.id}`,
      source: line.supplierName ? "Fornitore" : "Cliente",
      title: line.supplierName || line.customerName || "Contatto da verificare",
      description: line.description,
      projectCode: line.projectCode,
      linkedOrder: line.orderCode,
      dueDate: line.dueDate || line.requiredDate,
      status: line.status,
      quantity: line.quantity
    }));

  const rows = [...quoteLines, ...quoteProjects, ...quoteDocuments].sort((a, b) => {
    const aDate = new Date(a.receivedAt || a.dueDate || 0).getTime();
    const bDate = new Date(b.receivedAt || b.dueDate || 0).getTime();
    return bDate - aDate;
  });

  const customerQuotes = rows.filter((row) => row.source === "Cliente").length;
  const supplierQuotes = rows.filter((row) => row.source === "Fornitore").length;

  return (
    <div className="mx-auto max-w-[1540px] space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric title="Quotazioni aperte" value={rows.length} />
        <Metric title="Richieste cliente" value={customerQuotes} />
        <Metric title="Preventivi fornitore" value={supplierQuotes} />
      </div>

      <Card
        title="Quotazioni"
        action={
          <button
            type="button"
            onClick={() => navigate("imports")}
            className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline"
            style={{ color: "var(--color-accent)" }}
          >
            Verifica importazioni
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        }
      >
        {!rows.length && <EmptyState title="Nessuna quotazione aperta" description="Le richieste di preventivo e i preventivi fornitore compariranno qui." />}

        <div className="space-y-3">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                if (row.projectCode) navigate("projects", { projectCode: row.projectCode });
                else if (row.linkedOrder) navigate("orders", { orderCode: row.linkedOrder });
                else navigate("imports");
              }}
              className="grid w-full grid-cols-[44px_1fr_auto] items-center gap-3 rounded-md border px-3 py-3 text-left transition hover:bg-[color:var(--color-muted)]"
              style={{ borderColor: "var(--color-border)" }}
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-md"
                style={{
                  backgroundColor: row.source === "Cliente" ? "var(--color-primary-soft)" : "var(--color-accent-soft)",
                  color: row.source === "Cliente" ? "var(--color-primary)" : "var(--color-danger)"
                }}
              >
                {row.source === "Cliente" ? <SearchCheck className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{row.title}</span>
                <span className="mt-1 block truncate text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {row.description}
                </span>
                <span className="mt-1 block text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {[row.projectCode || row.linkedOrder, row.quantity, row.dueDate ? formatDate(row.dueDate) : null].filter(Boolean).join(" · ") || "Da completare"}
                </span>
              </span>
              <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ backgroundColor: "var(--color-muted)" }}>
                {row.source}
              </span>
            </button>
          ))}
        </div>
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
