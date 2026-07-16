import { useEffect, useMemo, useState } from "react";
import Button from "./Button";
import { formatDate } from "../utils/dateUtils";

const STATUS_LABELS = {
  draft: "Bozza",
  submitted: "Inviato",
  approved: "Approvato",
  rejected: "Rifiutato",
  cancelled: "Annullato"
};

const EMPTY_FORM = {
  salNumber: "",
  title: "",
  periodStart: "",
  periodEnd: "",
  progressPercentage: "",
  amount: "",
  currency: "EUR",
  externalReference: ""
};

function normalizeReport(row) {
  return {
    id: row.id,
    projectId: row.projectId || row.project_id,
    salNumber: row.salNumber || row.sal_number,
    title: row.title,
    periodStart: row.periodStart || row.period_start,
    periodEnd: row.periodEnd || row.period_end,
    progressPercentage: row.progressPercentage ?? row.progress_percentage,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    rejectionReason: row.rejectionReason || row.rejection_reason,
    externalReference: row.externalReference || row.external_reference
  };
}

function normalizeBilling(row) {
  return {
    id: row.id,
    projectId: row.projectId || row.project_id,
    progressReportId: row.progressReportId || row.progress_report_id,
    amount: row.amount,
    currency: row.currency,
    targetDate: row.targetDate || row.target_date,
    status: row.status,
    issuedAt: row.issuedAt || row.issued_at,
    invoiceReference: row.invoiceReference || row.invoice_reference
  };
}

function formForReport(report) {
  if (!report) return { ...EMPTY_FORM };
  return {
    id: report.id,
    salNumber: report.salNumber || "",
    title: report.title || "",
    periodStart: report.periodStart || "",
    periodEnd: report.periodEnd || "",
    progressPercentage: report.progressPercentage ?? "",
    amount: report.amount ?? "",
    currency: report.currency || "EUR",
    externalReference: report.externalReference || ""
  };
}

export default function ContractSalSection({
  project,
  initialReports = [],
  initialBillingItems = [],
  focusBillingItemId,
  readOnly,
  adapter,
  onChanged
}) {
  const [reports, setReports] = useState(() => initialReports.map(normalizeReport));
  const [billingItems, setBillingItems] = useState(() => initialBillingItems.map(normalizeBilling));
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [state, setState] = useState({ busy: false, error: "", message: "" });

  useEffect(() => {
    setReports(initialReports.map(normalizeReport));
    setBillingItems(initialBillingItems.map(normalizeBilling));
  }, [project.id, initialReports, initialBillingItems]);

  useEffect(() => {
    let active = true;
    adapter.getContractProgressReports(project.id)
      .then((result) => {
        if (!active) return;
        setReports((result.progressReports || []).map(normalizeReport));
        setBillingItems((result.billingItems || []).map(normalizeBilling));
      })
      .catch((error) => {
        if (active) setState((current) => ({ ...current, error: error.message }));
      });
    return () => { active = false; };
  }, [adapter, project.id]);

  useEffect(() => {
    if (!focusBillingItemId) return;
    const billing = billingItems.find((item) => item.id === focusBillingItemId);
    if (billing) setSelectedId(billing.progressReportId);
  }, [focusBillingItemId, billingItems]);

  const selected = reports.find((report) => report.id === selectedId) || null;
  const selectedBilling = useMemo(
    () => billingItems.find((item) => item.progressReportId === selectedId && item.status !== "cancelled") || null,
    [billingItems, selectedId]
  );

  async function reload(message) {
    const result = await adapter.getContractProgressReports(project.id);
    setReports((result.progressReports || []).map(normalizeReport));
    setBillingItems((result.billingItems || []).map(normalizeBilling));
    await onChanged?.();
    setState({ busy: false, error: "", message });
  }

  async function run(operation, message) {
    setState({ busy: true, error: "", message: "" });
    try {
      await operation();
      setEditing(false);
      await reload(message);
    } catch (error) {
      setState({ busy: false, error: error.message, message: "" });
    }
  }

  function beginCreate() {
    setSelectedId(null);
    setForm({ ...EMPTY_FORM });
    setEditing(true);
    setState({ busy: false, error: "", message: "" });
  }

  function beginEdit() {
    setForm(formForReport(selected));
    setEditing(true);
    setState({ busy: false, error: "", message: "" });
  }

  function save() {
    return run(async () => {
      const result = await adapter.saveContractProgressReport({ ...form, projectId: project.id });
      setSelectedId(result.progressReport?.id || result.id || form.id || null);
    }, "SAL salvato.");
  }

  function transition(action, fields = {}) {
    return run(
      () => adapter.transitionContractProgressReport(selected.id, action, fields),
      action === "submit" ? "SAL inviato." : action === "approve" ? "SAL approvato e voce da fatturare creata." : "SAL rifiutato."
    );
  }

  function reject() {
    const rejectionReason = window.prompt("Motivo del rifiuto:");
    if (!rejectionReason?.trim()) return;
    transition("reject", { rejectionReason });
  }

  function issue() {
    const invoiceReference = window.prompt("Numero o riferimento della fattura emessa:");
    if (!invoiceReference?.trim()) return;
    run(() => adapter.issueContractBillingItem(selectedBilling.id, invoiceReference), "Fattura registrata come emessa.");
  }

  const inputClass = "mt-1 w-full rounded-md border px-2.5 py-2 text-sm outline-none";
  const inputStyle = { borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" };
  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <section className="border-t pt-5" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Stati avanzamento lavori</h3>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>SAL e fatturazione attiva della commessa.</p>
        </div>
        {!readOnly && !project.archivedAt && <Button variant="secondary" onClick={beginCreate}>Nuovo SAL</Button>}
      </div>

      <div className="mt-3 space-y-2">
        {reports.map((report) => {
          const billing = billingItems.find((item) => item.progressReportId === report.id && item.status !== "cancelled");
          return (
            <button
              key={report.id}
              type="button"
              onClick={() => { setSelectedId(report.id); setEditing(false); setState({ busy: false, error: "", message: "" }); }}
              className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-[color:var(--color-muted)]"
              style={{ borderColor: selectedId === report.id ? "var(--color-primary)" : "var(--color-border)" }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{report.salNumber} · {report.title}</span>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{STATUS_LABELS[report.status] || report.status}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold">{Number(report.amount).toLocaleString("it-IT", { minimumFractionDigits: 2 })} {report.currency}</span>
                {billing && <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{billing.status === "issued" ? "Fattura emessa" : "Da fatturare"}</span>}
              </span>
            </button>
          );
        })}
        {!reports.length && <p className="rounded-md bg-[color:var(--color-muted)] px-3 py-3 text-sm">Nessun SAL registrato.</p>}
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Numero SAL *"><input className={inputClass} style={inputStyle} value={form.salNumber} onChange={(event) => updateField("salNumber", event.target.value)} /></Field>
            <Field label="Riferimento esterno"><input className={inputClass} style={inputStyle} value={form.externalReference} onChange={(event) => updateField("externalReference", event.target.value)} /></Field>
          </div>
          <Field label="Titolo *"><input className={inputClass} style={inputStyle} value={form.title} onChange={(event) => updateField("title", event.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inizio periodo"><input type="date" className={inputClass} style={inputStyle} value={form.periodStart} onChange={(event) => updateField("periodStart", event.target.value)} /></Field>
            <Field label="Fine periodo"><input type="date" className={inputClass} style={inputStyle} value={form.periodEnd} onChange={(event) => updateField("periodEnd", event.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Avanzamento %"><input type="number" min="0" max="100" step="0.01" className={inputClass} style={inputStyle} value={form.progressPercentage} onChange={(event) => updateField("progressPercentage", event.target.value)} /></Field>
            <Field label="Importo *"><input type="number" min="0" step="0.01" className={inputClass} style={inputStyle} value={form.amount} onChange={(event) => updateField("amount", event.target.value)} /></Field>
            <Field label="Valuta"><input className={inputClass} style={inputStyle} maxLength={3} value={form.currency} onChange={(event) => updateField("currency", event.target.value.toUpperCase())} /></Field>
          </div>
          <div className="flex gap-2"><Button onClick={save} disabled={state.busy}>Salva SAL</Button><Button variant="secondary" onClick={() => setEditing(false)} disabled={state.busy}>Annulla</Button></div>
        </div>
      )}

      {selected && !editing && (
        <div className="mt-4 space-y-3 rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="font-semibold">{selected.salNumber} · {selected.title}</div><div className="text-xs" style={{ color: "var(--color-text-muted)" }}>{formatDate(selected.periodStart)} – {formatDate(selected.periodEnd)}</div></div>
            <span className="rounded-full bg-[color:var(--color-muted)] px-2 py-1 text-xs font-semibold">{STATUS_LABELS[selected.status] || selected.status}</span>
          </div>
          {selected.rejectionReason && <p className="text-[color:var(--color-danger)]">Motivo: {selected.rejectionReason}</p>}
          {selectedBilling && <BillingStatus item={selectedBilling} />}
          {!readOnly && !project.archivedAt && (
            <div className="flex flex-wrap gap-2">
              {["draft", "rejected"].includes(selected.status) && <Button variant="secondary" onClick={beginEdit}>Modifica</Button>}
              {["draft", "rejected"].includes(selected.status) && <Button onClick={() => transition("submit")} disabled={state.busy}>Invia</Button>}
              {selected.status === "submitted" && <Button onClick={() => transition("approve")} disabled={state.busy}>Approva</Button>}
              {selected.status === "submitted" && <Button variant="secondary" onClick={reject} disabled={state.busy}>Rifiuta</Button>}
              {selectedBilling?.status === "to_issue" && <Button onClick={issue} disabled={state.busy}>Registra fattura emessa</Button>}
            </div>
          )}
        </div>
      )}

      {state.error && <p className="mt-3 text-sm text-[color:var(--color-danger)]">{state.error}</p>}
      {state.message && <p className="mt-3 text-sm text-[color:var(--color-success)]">{state.message}</p>}
    </section>
  );
}

function BillingStatus({ item }) {
  return (
    <div className="rounded-md bg-[color:var(--color-muted)] px-3 py-2">
      <div className="font-semibold">{item.status === "issued" ? "Fattura emessa" : "Voce da fatturare"}</div>
      <div className="text-xs">{Number(item.amount).toLocaleString("it-IT", { minimumFractionDigits: 2 })} {item.currency}{item.invoiceReference ? ` · ${item.invoiceReference}` : ""}</div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="text-xs font-semibold">{label}</span>{children}</label>;
}
