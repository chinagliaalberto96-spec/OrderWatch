import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, PackageCheck, RefreshCw, XCircle } from "lucide-react";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import { formatDate } from "../utils/dateUtils";

export default function ReceivingView({ adapter, readOnly = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await adapter.getReceivingData());
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
  const labels = { draft: "Bozza", ordered: "Ordinato", confirmed: "Confermato", partially_received: "Parziale", received: "Ricevuto", over_received: "Eccedenza", disputed: "Contestato", cancelled: "Annullato" };
  const warning = ["partially_received", "over_received", "disputed"].includes(status);
  return <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ backgroundColor: warning ? "var(--color-accent-soft)" : "var(--color-muted)", color: warning ? "var(--color-danger)" : "var(--color-text)" }}>{labels[status] || status}</span>;
}

function formatQuantity(value) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 }).format(Number(value || 0));
}
