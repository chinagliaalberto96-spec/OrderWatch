import { AlertTriangle, CheckCircle2, ExternalLink, FileText, HelpCircle, Mail, Send } from "lucide-react";
import { formatDate } from "../utils/dateUtils";

const STATUS_META = {
  certain: {
    label: "Dato certo",
    description: "La conclusione è supportata da una fonte strutturata e coerente.",
    color: "var(--color-success)",
    icon: CheckCircle2
  },
  probable: {
    label: "Dato probabile",
    description: "La fonte è presente, ma il riconoscimento non è completamente certo.",
    color: "var(--color-accent)",
    icon: HelpCircle
  },
  uncertain: {
    label: "Dato incerto",
    description: "La fonte è parziale o il riconoscimento ha affidabilità limitata.",
    color: "var(--color-warning)",
    icon: AlertTriangle
  },
  needs_review: {
    label: "Da verificare",
    description: "OrderWatch ha trovato una fonte, ma serve una conferma umana.",
    color: "var(--color-warning)",
    icon: AlertTriangle
  },
  unavailable: {
    label: "Fonte non disponibile",
    description: "Questa conclusione non dispone ancora di una prova consultabile.",
    color: "var(--color-text-muted)",
    icon: HelpCircle
  }
};

function assertionStatus(item, evidence) {
  if (!evidence.length) return "unavailable";
  if (item?.status === "needs_review" || evidence.some((entry) => entry.confidenceStatus === "needs_review")) {
    return "needs_review";
  }
  const confidence = Number(item?.confidence);
  if (Number.isFinite(confidence)) {
    if (confidence >= 0.9) return "certain";
    if (confidence >= 0.75) return "probable";
    return "uncertain";
  }
  if (evidence.every((entry) => entry.confidenceStatus === "certain")) return "certain";
  if (evidence.some((entry) => entry.confidenceStatus === "probable" || entry.confidenceStatus === "certain")) return "probable";
  return "uncertain";
}

function observedSummary(values = {}) {
  return [
    values.description,
    values.item_code || values.itemCode ? `Cod. ${values.item_code || values.itemCode}` : null,
    values.quantity ? `${values.quantity}${values.unit ? ` ${values.unit}` : ""}` : null,
    values.due_date || values.required_date || values.dueDate || values.requiredDate
      ? `Data ${formatDate(values.due_date || values.required_date || values.dueDate || values.requiredDate)}`
      : null,
    values.status
  ].filter(Boolean);
}

function deduplicateEvidence(rows) {
  const unique = new Map();
  for (const row of rows) {
    const key = [row.sourceEmailId || "-", row.sourceDocumentId || "-", row.sourceLineNumber ?? "-"].join(":");
    const existing = unique.get(key);
    if (!existing || new Date(row.observedAt || 0) > new Date(existing.observedAt || 0)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => new Date(b.observedAt || 0) - new Date(a.observedAt || 0));
}

function legacyEvidence({ email, lines, documents, revisions }) {
  if (!email) return [];
  const observed = revisions?.[0]?.newValues || lines?.[0] || {};
  const document = documents?.[0];
  return [{
    id: `legacy-${email.id}`,
    sourceEmailId: email.id,
    sourceDocumentId: document?.id || null,
    kind: document ? "document" : "email",
    emailSubject: email.subject,
    emailFrom: email.from,
    emailDirection: email.direction,
    emailDate: email.receivedAt,
    classificationOrigin: email.classificationOrigin || email.classification,
    classificationType: email.classificationType || email.classification,
    documentName: document?.name,
    documentType: document?.type,
    observedValues: observed,
    confidence: Number(email.confidence),
    confidenceStatus: email.needsReview ? "needs_review" : Number(email.confidence) >= 0.9 ? "certain" : "probable",
    observedAt: email.receivedAt
  }];
}

function needsOutboundCoverage(item) {
  const text = [item?.title, item?.detail, item?.actionLabel].filter(Boolean).join(" ");
  return /sollecit|inviat|conferma.*fornitor|risposta.*fornitor/i.test(text);
}

export default function OperationalEvidence({
  item,
  evidence = [],
  fallbackEmail,
  fallbackLines = [],
  fallbackDocuments = [],
  fallbackRevisions = [],
  dataCoverage = [],
  onOpenSource
}) {
  const normalizedEvidence = deduplicateEvidence(
    evidence.length ? evidence : legacyEvidence({
      email: fallbackEmail,
      lines: fallbackLines,
      documents: fallbackDocuments,
      revisions: fallbackRevisions
    })
  );
  const status = assertionStatus(item, normalizedEvidence);
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const outboundCoverage = dataCoverage.find((source) => source.sourceKey === "outbound_email");
  const showOutboundLimit = needsOutboundCoverage(item) && outboundCoverage?.status !== "available";

  return (
    <section className="overflow-hidden rounded-md border" style={{ borderColor: "var(--color-border)" }}>
      <div className="border-b px-3 py-2.5" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>Perché OrderWatch lo segnala</div>
            <div className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: meta.color }}>
              <StatusIcon className="h-3.5 w-3.5" />
              {meta.label}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{meta.description}</p>
          </div>
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold" style={{ borderColor: meta.color, color: meta.color }}>
            {normalizedEvidence.length} {normalizedEvidence.length === 1 ? "fonte" : "fonti"}
          </span>
        </div>
      </div>

      {showOutboundLimit && (
        <div className="border-b px-3 py-2.5 text-[12px] leading-relaxed" style={{ borderColor: "var(--color-border)", backgroundColor: "color-mix(in srgb, var(--color-warning) 8%, white)" }}>
          <span className="font-semibold">Limite dei dati: </span>
          {outboundCoverage?.limitation || "Le email inviate non sono completamente disponibili: questa conclusione non può essere verificata in modo definitivo."}
        </div>
      )}

      {normalizedEvidence.length ? (
        <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          {normalizedEvidence.map((source) => {
            const isOther = String(source.classificationOrigin || source.classificationType || "").toUpperCase() === "OTHER";
            const SourceIcon = source.kind === "document" ? FileText : source.emailDirection === "outbound" ? Send : Mail;
            const details = observedSummary(source.observedValues);
            const sourceConfidence = Number(source.confidence);

            return (
              <article key={source.id} className="px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 rounded-md p-1.5" style={{ backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>
                    <SourceIcon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold">
                          {source.documentName || source.emailSubject || "Fonte senza titolo"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                          {!isOther && source.emailFrom && <span>Da: {source.emailFrom}</span>}
                          {source.observedAt && <span>{formatDate(source.observedAt)}</span>}
                          {source.emailDirection && <span>{source.emailDirection === "outbound" ? "Uscita" : "Entrata"}</span>}
                          {source.documentType && <span>{source.documentType}</span>}
                          {source.sourceLineNumber !== null && source.sourceLineNumber !== undefined && <span>Riga {source.sourceLineNumber}</span>}
                        </div>
                      </div>
                      {Number.isFinite(sourceConfidence) && (
                        <span className="shrink-0 text-[10.5px] font-semibold" style={{ color: sourceConfidence < 0.85 ? "var(--color-warning)" : "var(--color-success)" }}>
                          {Math.round(sourceConfidence * 100)}%
                        </span>
                      )}
                    </div>

                    {details.length > 0 && !isOther && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {details.slice(0, 5).map((detail, index) => (
                          <span key={`${source.id}-detail-${index}`} className="rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                            {detail}
                          </span>
                        ))}
                      </div>
                    )}
                    {isOther && <p className="mt-1 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>Contenuto non esposto: email classificata come non operativa.</p>}

                    {source.sourceEmailId && (
                      <button
                        type="button"
                        onClick={() => onOpenSource?.(source)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
                        style={{ color: "var(--color-accent)" }}
                      >
                        Apri fonte <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="px-3 py-3 text-[12px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
          Nessuna email o documento consultabile dimostra ancora questa conclusione. L'elemento resta visibile, ma non va trattato come certo.
        </div>
      )}
    </section>
  );
}
