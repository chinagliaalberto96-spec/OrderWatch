import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Send, X } from "lucide-react";
import Button from "./Button";

// Drawer preparazione/invio ordine verso fornitore (FASE 2/3) e sollecito (FASE 5).
// Riusa un solo pannello per l'intero ciclo: prepara -> modifica -> approva -> invia.
// Nessun invio parte senza conferma esplicita del buyer.
export default function SupplierOrderDrawer({ open, item, data = {}, adapter, onClose, onDone }) {
  const [dispatch, setDispatch] = useState(null);
  const [reminder, setReminder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [attachPdf, setAttachPdf] = useState(true);

  const mailboxes = useMemo(
    () => (data.mailboxes || []).filter((m) => m.connectionStatus === "connected" && m.hasPassword),
    [data.mailboxes]
  );
  const contacts = useMemo(
    () => (data.supplierContacts || []).filter((c) => c.email && dispatch && c.supplierId === dispatch.supplierId),
    [data.supplierContacts, dispatch]
  );

  const isReminder = item?.kind === "supplier_reminder";

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setMessage("");
    setConfirmSend(false);
    setDispatch(null);
    setReminder(null);

    (async () => {
      setBusy(true);
      try {
        if (isReminder) {
          const res = await adapter.supplierOrderAction({ action: "prepare_reminder", id: item.dispatchId || item.entityId });
          if (!cancelled) setReminder(res.reminder);
        } else if (item.kind === "supplier_order") {
          // Dispatch gia' esistente: caricalo tramite prepare idempotente sull'ordine
          const existing = (data.supplierDispatches || []).find((d) => d.id === (item.dispatchId || item.entityId));
          if (existing) setDispatch(existing);
        } else {
          // Una singola riga o la selezione aperta dalla home Oggi: prepara
          // una sola bozza mantenendo insieme tutti i materiali del fornitore.
          const materialLineIds = Array.isArray(item.materialLineIds) && item.materialLineIds.length
            ? item.materialLineIds
            : (item.lineItems || []).map((line) => line.entityId || line.id).filter(Boolean);
          const res = await adapter.supplierOrderAction({
            action: "prepare",
            materialLineIds: materialLineIds.length ? materialLineIds : [item.entityId]
          });
          if (!cancelled) setDispatch(res.dispatch);
        }
      } catch (error) {
        if (!cancelled) setMessage(`Errore: ${error.message}`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, item]);

  if (!open || !item) return null;

  async function run(action, successMessage, extra = {}) {
    setBusy(true);
    setMessage("");
    try {
      const res = await adapter.supplierOrderAction({ action, id: dispatch?.id || reminder?.id, ...extra });
      if (res.dispatch) setDispatch(res.dispatch);
      if (res.reminder) setReminder(res.reminder);
      setMessage(successMessage);
      onDone?.();
      return res;
    } catch (error) {
      setMessage(`Errore: ${error.message}`);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function patchField(field, value) {
    setDispatch((d) => (d ? { ...d, [field]: value } : d));
  }

  function patchLine(index, field, value) {
    setDispatch((d) => {
      if (!d) return d;
      const lines = [...(d.lines || [])];
      lines[index] = { ...lines[index], [field]: value };
      return { ...d, lines };
    });
  }

  const canSend = dispatch && dispatch.status === "approved" && /@/.test(dispatch.supplierEmail || "");
  const missingEmail = dispatch && !/@/.test(dispatch.supplierEmail || "");

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Chiudi" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-[520px] flex-col bg-white shadow-elevated" style={{ backgroundColor: "var(--color-card)" }}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: "var(--color-border)" }}>
          <div className="text-[15px] font-semibold">{isReminder ? "Sollecito fornitore" : "Ordine fornitore"}</div>
          <Button variant="ghost" className="h-8 w-8 px-0" onClick={onClose} aria-label="Chiudi"><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {busy && !dispatch && !reminder && <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>Preparazione in corso…</div>}

          {isReminder && reminder && (
            <div className="space-y-3 text-sm">
              <Row label="Fornitore" value={reminder.supplierName} />
              <Row label="Email" value={reminder.supplierEmail} />
              <Row label="Ordine" value={reminder.orderCode} />
              <Row label="Tentativo" value={`${reminder.attempt}`} />
              <Field label="Oggetto"><div className="rounded-md border px-3 py-2" style={{ borderColor: "var(--color-border)" }}>{reminder.subject}</div></Field>
              <Field label="Testo"><pre className="whitespace-pre-wrap rounded-md border p-3 text-[13px]" style={{ borderColor: "var(--color-border)" }}>{reminder.body}</pre></Field>
              <div className="rounded-md p-3 text-[13px]" style={{ backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>
                {reminder.status === "sent" ? "Sollecito inviato." : "Il sollecito parte solo dopo la tua conferma."}
              </div>
            </div>
          )}

          {!isReminder && dispatch && (
            <div className="space-y-4 text-sm">
              <StatusPill status={dispatch.status} />
              <Row label="Ordine" value={dispatch.orderCode} />
              <Row label="Fornitore" value={dispatch.supplierName || "—"} />

              <Field label="Email fornitore">
                <input className="w-full rounded-md border px-3 py-2" style={inputStyle} value={dispatch.supplierEmail || ""}
                  onChange={(e) => patchField("supplierEmail", e.target.value)} placeholder="ordini@fornitore.it"
                  disabled={dispatch.status !== "draft" && dispatch.status !== "approved" && dispatch.status !== "failed"} />
                {contacts.length > 0 && (
                  <select className="mt-2 w-full rounded-md border px-3 py-2" style={inputStyle}
                    onChange={(e) => e.target.value && patchField("supplierEmail", e.target.value)} defaultValue="">
                    <option value="">Scegli un contatto salvato…</option>
                    {contacts.map((c) => <option key={c.id} value={c.email}>{c.name || c.email}{c.isPrimary ? " (principale)" : ""}</option>)}
                  </select>
                )}
              </Field>

              <Field label="Mailbox mittente">
                <select className="w-full rounded-md border px-3 py-2" style={inputStyle}
                  value={dispatch.senderMailboxId || ""} onChange={(e) => patchField("senderMailboxId", e.target.value)}>
                  <option value="">Casella aziendale predefinita</option>
                  {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.mailboxName} ({m.emailAddress})</option>)}
                </select>
                {mailboxes.length === 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[12px]" style={{ color: "var(--color-danger)" }}>
                    <AlertTriangle className="h-3 w-3" /> Nessuna casella SMTP collegata: collegane una in Impostazioni.
                  </div>
                )}
              </Field>

              <Field label="Oggetto">
                <input className="w-full rounded-md border px-3 py-2" style={inputStyle} value={dispatch.subject || ""}
                  onChange={(e) => patchField("subject", e.target.value)} />
              </Field>

              <Field label={`Righe materiale (${dispatch.lines?.length || 0})`}>
                <div className="space-y-2">
                  {(dispatch.lines || []).map((line, i) => (
                    <div key={line.id || i} className="rounded-md border p-2" style={{ borderColor: line.incomplete ? "var(--color-warning)" : "var(--color-border)" }}>
                      <input className="w-full bg-transparent text-[13px] font-medium outline-none" value={line.description || ""}
                        onChange={(e) => patchLine(i, "description", e.target.value)} placeholder="Descrizione materiale" />
                      <div className="mt-1 flex gap-2">
                        <input className="w-24 rounded border px-2 py-1 text-[12px]" style={inputStyle} value={line.quantity || ""}
                          onChange={(e) => patchLine(i, "quantity", e.target.value)} placeholder="Quantita" />
                        <input className="w-20 rounded border px-2 py-1 text-[12px]" style={inputStyle} value={line.unit || ""}
                          onChange={(e) => patchLine(i, "unit", e.target.value)} placeholder="UM" />
                        {line.incomplete && <span className="self-center text-[11px] font-semibold" style={{ color: "var(--color-warning)" }}>dato incompleto</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Field>

              <Field label="Testo email">
                <textarea className="h-40 w-full rounded-md border p-3 text-[13px]" style={inputStyle} value={dispatch.body || ""}
                  onChange={(e) => patchField("body", e.target.value)} />
              </Field>

              {missingEmail && (
                <div className="rounded-md border p-3 text-[13px]" style={{ borderColor: "var(--color-warning)", color: "var(--color-warning)" }}>
                  Manca l'email del fornitore: inseriscila prima di inviare.
                </div>
              )}
            </div>
          )}

          {message && (
            <div className="mt-4 rounded-md px-3 py-2 text-[13px]" style={{ backgroundColor: "var(--color-muted)", color: message.startsWith("Errore") ? "var(--color-danger)" : "var(--color-text)" }}>{message}</div>
          )}
        </div>

        {/* Footer azioni */}
        <div className="shrink-0 border-t p-4" style={{ borderColor: "var(--color-border)" }}>
          {isReminder ? (
            <div className="flex gap-2">
              <Button className="h-10 flex-1 justify-center" disabled={busy || !reminder || reminder.status === "sent"}
                onClick={() => confirmSend ? run("send_reminder", "Sollecito inviato.").then(() => setConfirmSend(false)) : setConfirmSend(true)}>
                <Send className="h-4 w-4" />{confirmSend ? "Conferma invio sollecito" : "Invia sollecito"}
              </Button>
              {confirmSend && <Button variant="secondary" className="h-10" disabled={busy} onClick={() => setConfirmSend(false)}>Annulla</Button>}
            </div>
          ) : dispatch && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button variant="secondary" className="h-10 flex-1 justify-center" disabled={busy || !["draft", "approved", "failed"].includes(dispatch.status)}
                  onClick={() => run("update", "Bozza salvata.", {
                    supplierEmail: dispatch.supplierEmail, contactName: dispatch.contactName, senderMailboxId: dispatch.senderMailboxId,
                    subject: dispatch.subject, body: dispatch.body, lines: dispatch.lines
                  })}>
                  Salva bozza
                </Button>
                <Button className="h-10 flex-1 justify-center" disabled={busy || dispatch.status !== "draft" || !dispatch.lines?.length}
                  onClick={() => run("approve", "Ordine approvato.")}>
                  <Check className="h-4 w-4" />Approva
                </Button>
              </div>
              <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                <input type="checkbox" checked={attachPdf} onChange={(e) => setAttachPdf(e.target.checked)} disabled={busy || confirmSend} />
                Allega PDF ordine (generico — verra' sostituito col template aziendale)
              </label>
              <div className="flex gap-2">
                {!confirmSend ? (
                  <Button className="h-10 w-full justify-center" disabled={busy || !canSend}
                    onClick={() => setConfirmSend(true)} style={{ backgroundColor: canSend ? "var(--color-primary)" : undefined }}>
                    <Send className="h-4 w-4" />Invia ordine al fornitore
                  </Button>
                ) : (
                  <>
                    <Button className="h-10 flex-1 justify-center" disabled={busy}
                      onClick={() => run("send", "Ordine inviato.", { senderMailboxId: dispatch.senderMailboxId, attachPdf }).then(() => setConfirmSend(false))}
                      style={{ backgroundColor: "var(--color-danger)" }}>
                      Conferma invio a {dispatch.supplierEmail}
                    </Button>
                    <Button variant="secondary" className="h-10" disabled={busy} onClick={() => setConfirmSend(false)}>Annulla</Button>
                  </>
                )}
              </div>
              {dispatch.status === "waiting_confirmation" && (
                <div className="rounded-md p-2 text-center text-[12px]" style={{ backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>
                  Ordine inviato. In attesa di conferma dal fornitore.
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

const inputStyle = { borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" };

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}

function StatusPill({ status }) {
  const map = {
    draft: { label: "Bozza", color: "var(--color-text-muted)" },
    approved: { label: "Approvato", color: "var(--color-warning)" },
    sent: { label: "Inviato", color: "var(--color-primary)" },
    waiting_confirmation: { label: "In attesa conferma", color: "var(--color-primary)" },
    confirmed: { label: "Confermato", color: "var(--color-success)" },
    failed: { label: "Errore invio", color: "var(--color-danger)" },
    cancelled: { label: "Annullato", color: "var(--color-text-muted)" }
  };
  const s = map[status] || map.draft;
  return <span className="inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${s.color} 12%, white)`, color: s.color }}>{s.label}</span>;
}
