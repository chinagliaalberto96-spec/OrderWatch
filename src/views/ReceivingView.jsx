import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Copy, FileText, Link2, PackageCheck, RefreshCw, Send, Smartphone, Unlink, XCircle } from "lucide-react";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import { formatDate } from "../utils/dateUtils";

export default function ReceivingView({ adapter, readOnly = false, focusDeliveryNoteId = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [telegram, setTelegram] = useState({ connections: [], submissions: [], botUsername: null });
  const [pairing, setPairing] = useState(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const deliveryNoteRefs = useRef(new Map());

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [receivingData, telegramData] = await Promise.all([
        adapter.getReceivingData(),
        adapter.getTelegramConnections().catch(() => ({ connections: [], submissions: [], botUsername: null }))
      ]);
      setData(receivingData);
      setTelegram(telegramData);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [adapter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!focusDeliveryNoteId || !data?.deliveryNotes?.length) return undefined;
    const timeout = window.setTimeout(() => {
      deliveryNoteRefs.current.get(focusDeliveryNoteId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [data?.deliveryNotes, focusDeliveryNoteId]);

  const proposed = useMemo(
    () => (data?.allocations || []).filter((allocation) => allocation.status === "proposed"),
    [data?.allocations]
  );

  async function act(id, action) {
    if (readOnly || busyId) return;
    setBusyId(id);
    try {
      setData(await adapter.receivingAction({ id, action }));
      setError("");
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function telegramAction(action, id = null) {
    if (readOnly || telegramBusy) return;
    setTelegramBusy(true);
    try {
      const result = await adapter.telegramConnectionAction({ action, id });
      setTelegram(result);
      setPairing(result.pairing || null);
      setError("");
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setTelegramBusy(false);
    }
  }

  async function copyPairingCommand() {
    if (!pairing?.code) return;
    await navigator.clipboard.writeText(`/collega ${pairing.code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!data && refreshing) {
    return <p className="py-12 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>Caricamento ricevimenti...</p>;
  }

  return (
    <div className="mx-auto max-w-[1540px] space-y-4">
      {error && (
        <div role="alert" className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)", backgroundColor: "#FFF5F5" }}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Ricevimenti e DDT</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>Controlla consegne parziali, quantità residue e abbinamenti proposti.</p>
        </div>
        <button type="button" onClick={load} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--color-border)" }}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Aggiorna
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Righe aperte" value={data?.summary?.openLines || 0} icon={PackageCheck} />
        <Metric label="Consegne parziali" value={data?.summary?.partialLines || 0} icon={ClipboardCheck} />
        <Metric label="Righe complete" value={data?.summary?.completedLines || 0} icon={CheckCircle2} />
        <Metric label="Da confermare" value={data?.summary?.proposedMatches || 0} icon={AlertTriangle} accent />
        <Metric label="Sovraconsegne" value={data?.summary?.overReceivedLines || 0} icon={XCircle} danger />
      </div>

      <section className="rounded-lg border bg-white px-4 py-4 sm:px-5" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--color-primary-soft)", color: "var(--color-primary)" }}><Smartphone className="h-4 w-4" /></span>
            <div>
              <h3 className="text-sm font-semibold">Acquisizione DDT da Telegram</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5" style={{ color: "var(--color-text-muted)" }}>Fotografa un DDT dal telefono. OrderWatch estrae i dati e lo inserisce qui come pratica da verificare, senza aggiornare automaticamente le quantità.</p>
            </div>
          </div>
          {!readOnly && telegram.botUsername && (
            <button type="button" onClick={() => telegramAction("pair")} disabled={telegramBusy} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-primary)" }}>
              <Link2 className="h-4 w-4" /> {telegramBusy ? "Preparazione..." : "Collega Telegram"}
            </button>
          )}
        </div>

        {!telegram.botUsername && (
          <div className="mt-4 rounded-lg px-3 py-2.5 text-xs" style={{ backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>Il bot e pronto nel prodotto ma deve ancora ricevere il proprio account Telegram prima di poter essere collegato.</div>
        )}

        {pairing?.code && telegram.botUsername && (
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-center" style={{ borderColor: "var(--color-border)" }}>
            <div>
              <div className="text-xs font-semibold">Apri <a className="underline" href={`https://t.me/${String(telegram.botUsername).replace(/^@/, "")}`} target="_blank" rel="noreferrer">@{String(telegram.botUsername).replace(/^@/, "")}</a> e invia questo comando:</div>
              <code className="mt-2 block text-base font-semibold">/collega {pairing.code}</code>
              <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>Il codice scade tra 10 minuti e funziona una sola volta.</div>
            </div>
            <button type="button" onClick={copyPairingCommand} className="inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--color-border)" }}><Copy className="h-4 w-4" /> {copied ? "Copiato" : "Copia comando"}</button>
          </div>
        )}

        {(telegram.connections || []).length > 0 && (
          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>Telefoni collegati</div>
            <div className="space-y-1.5">
              {telegram.connections.map((connection) => (
                <div key={connection.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ backgroundColor: "var(--color-muted)" }}>
                  <div className="min-w-0 text-sm"><strong>{connection.display_name || connection.telegram_username || "Utente Telegram"}</strong><span className="ml-2 text-xs" style={{ color: "var(--color-text-muted)" }}>{connection.status === "active" ? "Attivo" : "Revocato"}</span></div>
                  {!readOnly && connection.status === "active" && <button type="button" onClick={() => telegramAction("revoke", connection.id)} disabled={telegramBusy} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--color-danger)" }}><Unlink className="h-3.5 w-3.5" /> Revoca</button>}
                </div>
              ))}
            </div>
          </div>
        )}

        {(telegram.submissions || []).length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
            <span className="inline-flex items-center gap-1.5 font-semibold"><Send className="h-3.5 w-3.5" /> Ultimi invii</span>
            {telegram.submissions.slice(0, 3).map((submission) => <span key={submission.id}>{submission.status === "needs_review" ? "Da verificare" : submission.status}</span>)}
          </div>
        )}
      </section>

      <Card title="DDT acquisiti">
        {!(data?.deliveryNotes || []).length && <EmptyState title="Nessun DDT acquisito" description="I DDT letti da email, importazione o Telegram compariranno qui." />}
        <div className="space-y-2">
          {(data?.deliveryNotes || []).map((note) => {
            const focused = focusDeliveryNoteId === note.id;
            return (
              <article
                key={note.id}
                ref={(node) => {
                  if (node) deliveryNoteRefs.current.set(note.id, node);
                  else deliveryNoteRefs.current.delete(note.id);
                }}
                className="rounded-lg border px-3 py-3 transition sm:px-4"
                style={{ borderColor: focused ? "var(--color-accent)" : "var(--color-border)", boxShadow: focused ? "0 0 0 2px var(--color-accent-soft)" : "none" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--color-primary-soft)", color: "var(--color-primary)" }}><FileText className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">DDT {note.ddtNumber || "senza numero"} · {note.supplierName || "Fornitore da verificare"}</div>
                      <div className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {[note.deliveryDate ? formatDate(note.deliveryDate) : null, note.orderCode ? `Ordine ${note.orderCode}` : "Ordine da collegare", `${note.lines?.length || 0} righe`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                  <Status status={note.needsReview ? "to_review" : note.status} />
                </div>
                {(note.lines || []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {note.lines.slice(0, 4).map((line) => (
                      <span key={line.id} className="max-w-full truncate rounded-md px-2 py-1 text-xs" style={{ backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>
                        {line.description || "Riga senza descrizione"} · {formatQuantity(line.deliveredQuantity)} {line.unitOfMeasure || ""}
                      </span>
                    ))}
                    {note.lines.length > 4 && <span className="px-2 py-1 text-xs" style={{ color: "var(--color-text-muted)" }}>+{note.lines.length - 4} righe</span>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </Card>

      <Card title="Abbinamenti da verificare">
        {!proposed.length && <EmptyState title="Nessun abbinamento in attesa" description="Le righe estratte dai DDT compariranno qui prima di aggiornare le quantità ricevute." />}
        <div className="space-y-3">
          {proposed.map((allocation) => (
            <article key={allocation.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">DDT {allocation.ddtNumber || "senza numero"} · {allocation.supplierName || "Fornitore da verificare"}</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {[allocation.deliveryDate ? formatDate(allocation.deliveryDate) : null, allocation.matchMethod, allocation.confidence !== null ? `confidenza ${Math.round(Number(allocation.confidence) * 100)}%` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: "var(--color-accent-soft)", color: "var(--color-danger)" }}>Da confermare</span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                <LineBox title="Riga DDT" description={allocation.deliveredDescription} code={allocation.ddtNumber} quantity={allocation.deliveredQuantity} unit={allocation.deliveredUnit} />
                <span className="hidden text-center text-lg lg:block" style={{ color: "var(--color-text-muted)" }}>→</span>
                <LineBox title={`Ordine ${allocation.orderCode || "da verificare"} · riga ${allocation.orderLineNumber || "-"}`} description={allocation.orderedDescription} quantity={allocation.orderedQuantity} unit={allocation.orderedUnit} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  Quantità proposta: <strong>{formatQuantity(allocation.allocatedQuantity)} {allocation.deliveredUnit || ""}</strong>
                </div>
                {!readOnly && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => act(allocation.id, "reject")} disabled={Boolean(busyId)} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--color-border)" }}>Rifiuta</button>
                    <button type="button" onClick={() => act(allocation.id, "confirm")} disabled={Boolean(busyId)} className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-primary)" }}>
                      {busyId === allocation.id ? "Salvataggio..." : "Conferma ricezione"}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </Card>

      <Card title="Stato righe ordine">
        {!(data?.orderLines || []).length && <EmptyState title="Nessuna riga ordine" description="Le righe numeriche degli ordini fornitori compariranno qui." />}
        <div className="overflow-x-auto">
          {(data?.orderLines || []).length > 0 && (
            <table className="min-w-full text-left text-sm">
              <thead style={{ color: "var(--color-text-muted)" }}>
                <tr className="border-b" style={{ borderColor: "var(--color-border)" }}>
                  {['Ordine', 'Articolo', 'Descrizione', 'Ordinato', 'Ricevuto', 'Residuo', 'Stato'].map((label) => <th key={label} scope="col" className="px-3 py-3 font-semibold">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(data?.orderLines || []).map((line) => (
                  <tr key={line.id} className="border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
                    <td className="px-3 py-3 font-semibold">{line.orderCode || "-"}</td>
                    <td className="px-3 py-3 font-mono text-xs">{line.internalItemCode || line.supplierItemCode || "-"}</td>
                    <td className="max-w-[340px] px-3 py-3">{line.description}</td>
                    <td className="px-3 py-3">{formatQuantity(line.orderedQuantity)} {line.unitOfMeasure}</td>
                    <td className="px-3 py-3">{formatQuantity(line.receivedQuantity)} {line.unitOfMeasure}</td>
                    <td className="px-3 py-3 font-semibold">{formatQuantity(line.remainingQuantity)} {line.unitOfMeasure}</td>
                    <td className="px-3 py-3"><Status status={line.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value, icon: Icon, accent = false, danger = false }) {
  const color = danger ? "var(--color-danger)" : accent ? "var(--color-accent)" : "var(--color-primary)";
  return (
    <section className="rounded-xl border bg-white p-4" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between"><span className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>{label}</span><Icon className="h-4 w-4" style={{ color }} /></div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </section>
  );
}

function LineBox({ title, description, code, quantity, unit }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: "var(--color-muted)" }}>
      <div className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>{title}</div>
      <div className="mt-1 font-semibold">{description || "Descrizione non disponibile"}</div>
      <div className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{[code, quantity !== null ? `${formatQuantity(quantity)} ${unit || ""}` : null].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

function Status({ status }) {
  const labels = { new: "Da collegare", to_review: "Da verificare", draft: "Bozza", ordered: "Ordinato", confirmed: "Confermato", partially_received: "Parziale", received: "Ricevuto", over_received: "Eccedenza", disputed: "Contestato", cancelled: "Annullato" };
  const warning = ["new", "to_review", "partially_received", "over_received", "disputed"].includes(status);
  return <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ backgroundColor: warning ? "var(--color-accent-soft)" : "var(--color-muted)", color: warning ? "var(--color-danger)" : "var(--color-text)" }}>{labels[status] || status}</span>;
}

function formatQuantity(value) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 }).format(Number(value || 0));
}
