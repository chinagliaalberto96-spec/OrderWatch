import { useMemo, useState } from "react";
import { Check, Link2, Mail, Merge, Plus, Save, Search, Trash2, X } from "lucide-react";

const TYPE_LABELS = { supplier: "Fornitore", customer: "Cliente", both: "Cliente e fornitore", unknown: "Da definire" };

function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    supplier: "bg-blue-50 text-blue-700",
    customer: "bg-emerald-50 text-emerald-700",
    both: "bg-violet-50 text-violet-700",
    pending: "bg-amber-50 text-amber-700"
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.neutral}`}>{children}</span>;
}

function ActionButton({ children, variant = "primary", ...props }) {
  const style = variant === "primary"
    ? "bg-[color:var(--color-primary)] text-white hover:opacity-90"
    : variant === "danger"
      ? "border border-red-200 bg-white text-red-700 hover:bg-red-50"
      : "border border-[color:var(--color-border)] bg-white text-[color:var(--color-text)] hover:bg-slate-50";
  return <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${style}`} {...props}>{children}</button>;
}

export default function ContactsView({ data, onContactAction, readOnly = false }) {
  const contacts = data.contacts || [];
  const emails = data.contactEmails || [];
  const aliases = data.contactAliases || [];
  const candidates = data.contactCandidates || [];
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [newMode, setNewMode] = useState(false);
  const [form, setForm] = useState({ legalName: "", type: "supplier", email: "", vatNumber: "", domain: "", notes: "" });
  const [newEmail, setNewEmail] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [candidateRoles, setCandidateRoles] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const activeContacts = useMemo(() => contacts.filter((item) => item.status === "active"), [contacts]);
  const officialEmails = useMemo(
    () => emails.filter((item) => item.verified && item.matchEnabled),
    [emails]
  );
  const candidateGroups = useMemo(() => {
    const groups = new Map();
    for (const candidate of candidates) {
      const contactId = candidate.matchedContactId || candidate.sourceContactId || null;
      const key = contactId || String(candidate.proposedEmail || candidate.proposedName || candidate.id).toLowerCase();
      const current = groups.get(key) || {
        key,
        contactId,
        candidates: [],
        names: new Set(),
        emails: new Set(),
        roles: new Set()
      };
      current.candidates.push(candidate);
      if (candidate.proposedName) current.names.add(candidate.proposedName);
      if (candidate.proposedEmail) current.emails.add(candidate.proposedEmail);
      if (candidate.proposedType) current.roles.add(candidate.proposedType);
      groups.set(key, current);
    }
    return [...groups.values()].map((group) => {
      const contact = activeContacts.find((item) => item.id === group.contactId);
      const roles = [...group.roles];
      return {
        ...group,
        contact,
        name: contact?.legalName || [...group.names][0] || "Contatto da verificare",
        email: [...group.emails][0] || "Nessuna email rilevata",
        roles,
        conflicting: roles.length > 1,
        defaultRole: roles.length === 1 ? roles[0] : "unknown"
      };
    });
  }, [activeContacts, candidates]);
  const filtered = useMemo(() => activeContacts.filter((item) => {
    if (typeFilter !== "all" && item.type !== typeFilter && item.type !== "both") return false;
    const haystack = [item.legalName, item.vatNumber, item.domain, ...officialEmails.filter((e) => e.contactId === item.id).map((e) => e.email)].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [activeContacts, officialEmails, query, typeFilter]);
  const selected = activeContacts.find((item) => item.id === selectedId) || null;
  const selectedEmails = officialEmails.filter((item) => item.contactId === selected?.id);
  const selectedAliases = aliases.filter((item) => item.contactId === selected?.id);

  function selectContact(contact) {
    setSelectedId(contact.id);
    setNewMode(false);
    setForm({
      legalName: contact.legalName || "",
      type: contact.type || "unknown",
      email: "",
      vatNumber: contact.vatNumber || "",
      domain: contact.domain || "",
      notes: contact.notes || ""
    });
    setMessage("");
  }

  async function run(payload, success) {
    setBusy(true);
    setMessage("");
    try {
      await onContactAction(payload);
      setMessage(success);
    } catch (error) {
      setMessage(error.message || "Operazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  async function saveContact() {
    if (newMode) {
      await run({ action: "create", ...form }, "Contatto creato e verificato.");
      setNewMode(false);
      setForm({ legalName: "", type: "supplier", email: "", vatNumber: "", domain: "", notes: "" });
    } else if (selected) {
      await run({ action: "update", id: selected.id, ...form }, "Dati aggiornati.");
    }
  }

  return (
    <div className="space-y-5">
      {candidateGroups.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-amber-950">Ruoli aziendali da confermare</h2>
              <p className="mt-1 text-sm text-amber-800">Ogni azienda compare una sola volta. Dopo la conferma, le nuove email manterranno sempre il ruolo scelto.</p>
            </div>
            <Pill tone="pending">{candidateGroups.length} {candidateGroups.length === 1 ? "azienda" : "aziende"} in attesa</Pill>
          </div>
          <div className="space-y-2">
            {candidateGroups.map((group) => {
              const selectedRole = candidateRoles[group.key] || group.defaultRole;
              return (
                <div key={group.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white p-3">
                  <div className="min-w-[220px] flex-1">
                    <div className="font-semibold text-slate-900">{group.name}</div>
                    <div className="mt-0.5 text-sm text-slate-600">{group.email}</div>
                    {group.conflicting ? (
                      <div className="mt-1 text-xs font-semibold text-amber-700">
                        Documenti discordanti: {group.roles.map((role) => TYPE_LABELS[role]).join(" e ")}. Scegli il ruolo corretto una sola volta.
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">Ruolo suggerito: {TYPE_LABELS[group.roles[0]] || "Da definire"}</div>
                    )}
                  </div>
                  <label className="text-xs font-semibold text-slate-600">
                    Ruolo definitivo
                    <select
                      value={selectedRole}
                      onChange={(event) => setCandidateRoles((current) => ({ ...current, [group.key]: event.target.value }))}
                      className="mt-1 block min-w-[190px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                    >
                      <option value="unknown">Scegli il ruolo</option>
                      <option value="supplier">Fornitore</option>
                      <option value="customer">Cliente</option>
                      <option value="both">Cliente e fornitore</option>
                    </select>
                  </label>
                  <ActionButton
                    disabled={busy || readOnly || selectedRole === "unknown" || !group.contactId}
                    onClick={() => run({ action: "confirm_contact_role", contactId: group.contactId, confirmedType: selectedRole }, "Ruolo confermato: le prossime email useranno questa scelta.")}
                  >
                    <Check className="h-4 w-4" /> Conferma ruolo
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    disabled={busy || readOnly || !group.contactId}
                    onClick={() => run({ action: "reject_contact_group", contactId: group.contactId }, "Azienda rimossa dalle segnalazioni.")}
                  >
                    <X className="h-4 w-4" /> Non è un contatto operativo
                  </ActionButton>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--color-border)] p-4">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nome, email o P. IVA" className="w-full rounded-lg border border-[color:var(--color-border)] py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400" />
            </div>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-lg border border-[color:var(--color-border)] bg-white px-3 py-2 text-sm">
              <option value="all">Tutti</option><option value="supplier">Fornitori</option><option value="customer">Clienti</option><option value="unknown">Da definire</option>
            </select>
            <ActionButton disabled={readOnly} onClick={() => { setNewMode(true); setSelectedId(null); setForm({ legalName: "", type: "supplier", email: "", vatNumber: "", domain: "", notes: "" }); }}><Plus className="h-4 w-4" /> Nuovo</ActionButton>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Ragione sociale</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Email associate</th><th className="px-4 py-3">Stato</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((contact) => {
                  const contactEmails = officialEmails.filter((item) => item.contactId === contact.id);
                  return <tr key={contact.id} className={`hover:bg-slate-50 ${selectedId === contact.id ? "bg-slate-50" : ""}`}>
                    <td className="px-4 py-3 font-semibold text-slate-900"><button type="button" onClick={() => selectContact(contact)} className="text-left hover:underline">{contact.legalName}</button></td>
                    <td className="px-4 py-3"><Pill tone={contact.type}>{TYPE_LABELS[contact.type]}</Pill></td>
                    <td className="px-4 py-3 text-slate-600">{contactEmails[0]?.email || "—"}{contactEmails.length > 1 ? ` +${contactEmails.length - 1}` : ""}</td>
                    <td className="px-4 py-3"><Pill tone={contact.verificationStatus === "pending" ? "pending" : "neutral"}>{contact.verificationStatus === "verified" ? "Verificato" : "Da verificare"}</Pill></td>
                  </tr>;
                })}
              </tbody>
            </table>
            {!filtered.length && <div className="p-8 text-center text-sm text-slate-500">Nessun contatto trovato.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-[color:var(--color-border)] bg-white p-5">
          {!selected && !newMode ? <div className="flex min-h-[280px] items-center justify-center text-center text-sm text-slate-500">Seleziona un contatto per vedere e modificare i dettagli.</div> : (
            <div className="space-y-4">
              <div><h2 className="text-lg font-semibold text-slate-900">{newMode ? "Nuovo contatto" : selected.legalName}</h2><p className="mt-1 text-sm text-slate-500">Le email verificate vengono usate per il riconoscimento automatico.</p></div>
              <label className="block text-sm font-medium text-slate-700">Ragione sociale<input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-700">Tipo<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"><option value="supplier">Fornitore</option><option value="customer">Cliente</option><option value="both">Entrambi</option><option value="unknown">Da definire</option></select></label>
                <label className="block text-sm font-medium text-slate-700">Partita IVA<input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
              </div>
              <label className="block text-sm font-medium text-slate-700">Dominio<input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="azienda.it" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
              {newMode && <label className="block text-sm font-medium text-slate-700">Prima email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>}
              <label className="block text-sm font-medium text-slate-700">Note<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
              <ActionButton disabled={busy || readOnly || !form.legalName.trim()} onClick={saveContact}><Save className="h-4 w-4" /> Salva</ActionButton>

              {!newMode && selected && <>
                <div className="border-t border-slate-100 pt-4"><div className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><Mail className="h-4 w-4" /> Email</div>{selectedEmails.map((item) => <div key={item.id} className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{item.email}</span>{item.verified && <Check className="h-4 w-4 text-emerald-600" />}<button disabled={busy || readOnly} onClick={() => run({ action: "delete_email", id: item.id }, "Email rimossa.")}><Trash2 className="h-4 w-4 text-slate-400" /></button></div>)}<div className="flex gap-2"><input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Aggiungi email" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><ActionButton variant="secondary" disabled={busy || readOnly || !newEmail} onClick={async () => { await run({ action: "add_email", contactId: selected.id, email: newEmail }, "Email verificata e aggiunta."); setNewEmail(""); }}><Plus className="h-4 w-4" /></ActionButton></div></div>
                <div className="border-t border-slate-100 pt-4"><div className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><Link2 className="h-4 w-4" /> Nomi alternativi</div><div className="mb-2 flex flex-wrap gap-2">{selectedAliases.map((item) => <span key={item.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{item.alias}</span>)}</div><div className="flex gap-2"><input value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder="Es. VIBUR S.R.L." className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><ActionButton variant="secondary" disabled={busy || readOnly || !newAlias} onClick={async () => { await run({ action: "add_alias", contactId: selected.id, alias: newAlias }, "Nome alternativo aggiunto."); setNewAlias(""); }}><Plus className="h-4 w-4" /></ActionButton></div></div>
                <div className="border-t border-slate-100 pt-4"><div className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><Merge className="h-4 w-4" /> Unisci duplicato</div><div className="flex gap-2"><select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Scegli il contatto corretto</option>{activeContacts.filter((item) => item.id !== selected.id).map((item) => <option key={item.id} value={item.id}>{item.legalName}</option>)}</select><ActionButton variant="secondary" disabled={busy || readOnly || !mergeTarget} onClick={() => window.confirm("Unire questo contatto nel contatto selezionato? L'operazione sposterà email e storico.") && run({ action: "merge", sourceContactId: selected.id, targetContactId: mergeTarget }, "Contatti uniti.")}>Unisci</ActionButton></div></div>
              </>}
              {message && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
