import { useEffect } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, FileText, SearchCheck, ShoppingCart } from "lucide-react";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import OperationalRow from "../components/OperationalRow";
import StatusBadge from "../components/StatusBadge";
import { formatDate } from "../utils/dateUtils";

export default function QuotesView({ data, onNavigate, focusQuoteId, onConvertQuote, onVerifyQuote }) {
  const navigate = onNavigate || (() => {});
  const representedEmails = new Set((data.quotes || []).map((quote) => quote.sourceEmailId).filter(Boolean));

  const storedQuotes = (data.quotes || []).map((quote) => {
    const matchedLines = (data.materialLines || []).filter((line) => line.sourceEmailId && line.sourceEmailId === quote.sourceEmailId);
    const customerQuote = /customer/.test(quote.quoteType || "");
    return {
      id: `quote-${quote.id}`,
      entityId: quote.id,
      quoteId: quote.id,
      source: customerQuote ? "Cliente" : "Fornitore",
      title: quote.supplierName || quote.customerName || "Contatto da verificare",
      description: matchedLines.length
        ? matchedLines.slice(0, 2).map((line) => line.description).filter(Boolean).join(" · ")
        : quote.notes || quote.quoteCode || "Preventivo ricevuto",
      projectCode: quote.projectCode,
      dueDate: quote.validUntil || quote.quoteDate,
      status: quote.status,
      needsReview: quote.needsReview,
      materialLineIds: matchedLines.map((line) => line.id),
      amount: quote.totalAmount,
      currency: quote.currency
    };
  });

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
    .filter((document) => /preventivo/i.test(document.type || "") && !representedEmails.has(document.sourceEmailId))
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
    .filter((line) => (line.sourceType === "quote" || /preventivo/i.test(line.status || "")) && !representedEmails.has(line.sourceEmailId))
    .map((line) => ({
      id: `line-${line.id}`,
      entityId: line.id,
      source: line.supplierName ? "Fornitore" : "Cliente",
      title: line.supplierName || line.customerName || "Contatto da verificare",
      description: line.description,
      projectCode: line.projectCode,
      linkedOrder: line.orderCode,
      dueDate: line.dueDate || line.requiredDate,
      status: line.status,
      quantity: line.quantity,
      needsReview: line.needsReview,
      materialLineIds: [line.id]
    }));

  const rows = [...storedQuotes, ...quoteLines, ...quoteProjects, ...quoteDocuments].sort((a, b) => {
    const aDate = new Date(a.receivedAt || a.dueDate || 0).getTime();
    const bDate = new Date(b.receivedAt || b.dueDate || 0).getTime();
    return bDate - aDate;
  });

  const customerQuotes = rows.filter((row) => row.source === "Cliente").length;
  const supplierQuotes = rows.filter((row) => row.source === "Fornitore").length;

  useEffect(() => {
    if (!focusQuoteId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`operational-quote-${focusQuoteId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusQuoteId, rows.length]);

  function openRow(row) {
    if (row.projectCode) navigate("projects", { projectCode: row.projectCode });
    else if (row.linkedOrder) navigate("orders", { orderCode: row.linkedOrder });
    else navigate("imports");
  }

  function actionsFor(row) {
    const canConvert = row.source === "Fornitore" && row.materialLineIds?.length && row.status !== "converted" && onConvertQuote;
    const missingConversionData = row.source === "Fornitore" && !row.materialLineIds?.length && row.status !== "converted" && onConvertQuote;
    return [
      canConvert && {
        label: "Converti in ordine",
        icon: ShoppingCart,
        onClick: () => onConvertQuote({
          kind: "quote_conversion",
          quoteId: row.quoteId || null,
          materialLineIds: row.materialLineIds,
          supplierName: row.title
        })
      },
      missingConversionData && {
        label: "Materiali da completare",
        icon: ShoppingCart,
        disabled: true
      },
      row.quoteId && row.needsReview && onVerifyQuote && {
        label: "Segna verificato",
        icon: CheckCircle2,
        onClick: () => onVerifyQuote({ kind: "quote", entityId: row.quoteId })
      },
      {
        label: "Apri dettaglio",
        icon: ExternalLink,
        onClick: () => openRow(row)
      }
    ];
  }

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

        <div className="border-y" style={{ borderColor: "var(--color-border)" }}>
          {rows.map((row) => (
            <OperationalRow
              key={row.id}
              rowId={row.quoteId ? `operational-quote-${row.quoteId}` : undefined}
              leading={<span
                className="flex h-10 w-10 items-center justify-center rounded-md"
                style={{
                  backgroundColor: row.source === "Cliente" ? "var(--color-primary-soft)" : "var(--color-accent-soft)",
                  color: row.source === "Cliente" ? "var(--color-primary)" : "var(--color-danger)"
                }}
              >
                {row.source === "Cliente" ? <SearchCheck className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </span>}
              title={row.title}
              subtitle={[row.description, row.projectCode || row.linkedOrder].filter(Boolean).join(" · ")}
              meta={[
                row.amount ? new Intl.NumberFormat("it-IT", { style: "currency", currency: row.currency || "EUR" }).format(row.amount) : row.quantity,
                row.dueDate ? formatDate(row.dueDate) : null
              ].filter(Boolean).join(" · ") || "Da completare"}
              status={<StatusBadge status={row.status || row.source} />}
              actions={actionsFor(row)}
              onOpen={() => openRow(row)}
              highlighted={Boolean(focusQuoteId && row.quoteId === focusQuoteId)}
            />
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
