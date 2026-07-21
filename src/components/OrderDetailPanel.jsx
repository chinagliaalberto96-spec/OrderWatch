import { useEffect, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { formatDate } from "../utils/dateUtils";
import { formatNumber, formatPercent } from "../utils/formatters";
import StatusBadge from "./StatusBadge";
import Button from "./Button";

// Stati impostabili manualmente dal buyer (devono rispettare il CHECK del DB).
const BUYER_STATUSES = ["In attesa", "Confermato", "Ricevuto", "Annullato"];

export default function OrderDetailPanel({ order, status, terminology, onClose, onUpdateOrder, onDeleteOrder, onNavigate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    // Cambiando ordine si esce da modifica/conferma eliminazione.
    setEditing(false);
    setConfirmDelete(false);
    setMessage("");
    setDraft({});
  }, [order?.id]);

  if (!order) return null;

  const canAct = typeof onUpdateOrder === "function";
  // Eliminabile se chiuso/scaduto oppure se non e' mai stato verificato
  // (bozza incompleta, spesso aperta per errore dalla pipeline email):
  // stessa regola dell'API (che resta l'unica autorita' — qui serve solo a
  // non mostrare un tasto inutile).
  const deletable =
    typeof onDeleteOrder === "function" &&
    (status === "CLOSED" || status === "OVERDUE" || order.status === "Scaduto" || order.needsReview);

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
    ["Solleciti", order.reminderCount ?? "-"],
    ["AI confidence", formatPercent(order.aiConfidence)]
  ].map(([label, value]) => [label, value === null || value === undefined || value === "" ? "-" : value]);

  async function runAction(action, successMessage) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(successMessage);
    } catch (error) {
      setMessage(`Errore: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    setDraft({
      material: order.material || "",
      quantity: order.quantity || "",
      dueDate: order.dueDate || "",
      requiredDate: order.requiredDate || ""
    });
    setEditing(true);
    setMessage("");
  }

  async function saveEdits() {
    await runAction(async () => {
      await onUpdateOrder(order.id, {
        material: draft.material,
        quantity: draft.quantity,
        dueDate: draft.dueDate || null,
        requiredDate: draft.requiredDate || null,
        needsReview: false
      });
      setEditing(false);
    }, "Ordine aggiornato.");
  }

  const inputClass = "mt-1 w-full rounded-md border px-2 py-1.5 text-sm outline-none";
  const inputStyle = { borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" };

  return (
    <aside className="w-full shrink-0 border-t bg-white xl:w-96 xl:border-l xl:border-t-0" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}>
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
      <div className="space-y-5 overflow-y-auto p-4 xl:max-h-[calc(100vh-124px)]">
        <StatusBadge status={status} />

        {!editing && (
          <dl className="space-y-3">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[140px_1fr] gap-3 text-sm">
                <dt style={{ color: "var(--color-text-muted)" }}>{label}</dt>
                <dd className="font-medium">
                  {label === terminology.supplierSingular && value !== "-" && onNavigate ? (
                    <Citation onClick={() => onNavigate("suppliers", { supplierName: value })}>{value}</Citation>
                  ) : label === terminology.projectSingular && value !== "-" && onNavigate ? (
                    <Citation onClick={() => onNavigate("projects", { projectCode: value })}>{value}</Citation>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {editing && (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="font-semibold">{terminology.material}</span>
              <input className={inputClass} style={inputStyle} value={draft.material} onChange={(e) => setDraft({ ...draft, material: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">Quantita</span>
              <input className={inputClass} style={inputStyle} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">{terminology.dueDate}</span>
              <input type="date" className={inputClass} style={inputStyle} value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">Data richiesta</span>
              <input type="date" className={inputClass} style={inputStyle} value={draft.requiredDate} onChange={(e) => setDraft({ ...draft, requiredDate: e.target.value })} />
            </label>
            <div className="flex gap-2">
              <Button className="h-9 flex-1" onClick={saveEdits} disabled={busy}>
                Salva modifiche
              </Button>
              <Button variant="secondary" className="h-9" onClick={() => setEditing(false)} disabled={busy}>
                Annulla
              </Button>
            </div>
          </div>
        )}

        {order.notes && !editing && (
          <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
            {order.notes}
          </div>
        )}

        {canAct && !editing && (
          <div className="space-y-2 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
            <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
              Azioni buyer
            </div>

            {order.needsReview && (
              <Button
                className="h-9 w-full justify-center"
                disabled={busy}
                onClick={() => runAction(() => onUpdateOrder(order.id, { needsReview: false }), "Ordine segnato come verificato.")}
              >
                <Check className="h-4 w-4" />
                Segna come verificato
              </Button>
            )}

            <Button variant="secondary" className="h-9 w-full justify-center" disabled={busy} onClick={startEditing}>
              <Pencil className="h-4 w-4" />
              Modifica dati ordine
            </Button>

            <label className="block text-sm">
              <span className="font-semibold">Cambia stato</span>
              <select
                className={inputClass}
                style={inputStyle}
                value={BUYER_STATUSES.includes(order.status) ? order.status : ""}
                disabled={busy}
                onChange={(e) => {
                  if (!e.target.value) return;
                  // Un cambio stato manuale del buyer vale anche come verifica:
                  // altrimenti needsReview resta true e il badge continua a
                  // mostrare "Da verificare" anche se lo stato e' stato salvato,
                  // dando l'impressione (falsa) che la modifica non sia stata
                  // registrata.
                  runAction(
                    () => onUpdateOrder(order.id, { status: e.target.value, needsReview: false }),
                    `Stato aggiornato: ${e.target.value}.`
                  );
                }}
              >
                <option value="">Seleziona stato...</option>
                {BUYER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            {deletable && !confirmDelete && (
              <Button
                variant="secondary"
                className="h-9 w-full justify-center"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
                style={{ color: "var(--color-danger)" }}
              >
                <Trash2 className="h-4 w-4" />
                Elimina ordine
              </Button>
            )}

            {deletable && confirmDelete && (
              <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-danger)", backgroundColor: "color-mix(in srgb, var(--color-danger) 6%, white)" }}>
                <div className="font-semibold" style={{ color: "var(--color-danger)" }}>
                  Eliminare definitivamente l'ordine {order.orderCode}?
                </div>
                <div className="mt-1 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                  I documenti collegati restano in archivio. L'operazione non e' reversibile.
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="h-9 flex-1 justify-center"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await onDeleteOrder(order.id);
                        onClose?.();
                      }, "Ordine eliminato.")
                    }
                    style={{ backgroundColor: "var(--color-danger)" }}
                  >
                    Elimina definitivamente
                  </Button>
                  <Button variant="secondary" className="h-9" disabled={busy} onClick={() => setConfirmDelete(false)}>
                    Annulla
                  </Button>
                </div>
              </div>
            )}

            {message && (
              <div className="rounded-md px-3 py-2 text-[13px]" style={{ backgroundColor: "var(--color-muted)", color: message.startsWith("Errore") ? "var(--color-danger)" : "var(--color-text)" }}>
                {message}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// Stesso stile dei chip citazione di AlteraView: porta dritti al dato
// collegato invece di lasciarlo come testo statico.
function Citation({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{ borderColor: "var(--color-border)" }}
    >
      {children}
    </button>
  );
}
