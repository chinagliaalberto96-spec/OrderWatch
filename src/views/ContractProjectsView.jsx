import { useEffect, useMemo, useState } from "react";
import { Archive, Plus, X } from "lucide-react";
import Button from "../components/Button";
import Card from "../components/Card";
import ContractSalSection from "../components/ContractSalSection";
import DataTable from "../components/DataTable";
import { formatDate } from "../utils/dateUtils";

const STATUS_OPTIONS = [
  { value: "draft", label: "Bozza" },
  { value: "active", label: "Attiva" },
  { value: "suspended", label: "Sospesa" },
  { value: "completed", label: "Completata" }
];

const STATUS_TONES = {
  draft: "text-muted",
  active: "success",
  suspended: "warning",
  completed: "accent"
};

const EMPTY_DRAFT = {
  projectCode: "",
  name: "",
  description: "",
  customerContactId: "",
  responsibleAppUserId: "",
  startDate: "",
  expectedEndDate: "",
  contractStatus: "draft"
};

function ContractStatus({ value }) {
  const option = STATUS_OPTIONS.find((item) => item.value === value);
  const color = STATUS_TONES[value] || "text-muted";
  return (
    <span
      className="inline-flex min-w-24 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-${color}) 13%, white)`,
        color: `var(--color-${color})`
      }}
    >
      {option?.label || value || "-"}
    </span>
  );
}

function projectDraft(project, membershipsById) {
  const responsible = membershipsById.get(project.responsibleMembershipId);
  return {
    id: project.id,
    projectCode: project.projectCode || "",
    name: project.name || "",
    description: project.description || "",
    customerContactId: project.customerContactId || "",
    responsibleAppUserId: responsible?.appUserId || "",
    startDate: project.startDate || "",
    expectedEndDate: project.expectedEndDate || "",
    contractStatus: project.contractStatus || "draft"
  };
}

export default function ContractProjectsView({
  projects,
  contacts,
  appUsers,
  progressReports = [],
  billingItems = [],
  operationalActions = [],
  focusProjectCode,
  focusBillingItemId,
  readOnly,
  onSave,
  adapter,
  onRefresh
}) {
  const [showArchived, setShowArchived] = useState(false);
  const contractProjects = useMemo(
    () => (projects || []).filter(
      (project) => project.contractWatchEnabled && (showArchived || !project.archivedAt)
    ),
    [projects, showArchived]
  );
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [state, setState] = useState({ busy: false, message: "", error: "" });

  const selected = contractProjects.find((project) => project.id === selectedId) || null;
  const selectedReports = useMemo(
    () => progressReports.filter((report) => report.projectId === selectedId),
    [progressReports, selectedId]
  );
  const selectedBillingItems = useMemo(
    () => billingItems.filter((item) => item.projectId === selectedId),
    [billingItems, selectedId]
  );

  const membershipsById = useMemo(() => {
    const map = new Map();
    for (const user of appUsers || []) {
      if (user.membershipId) map.set(user.membershipId, { appUserId: user.id, fullName: user.fullName });
    }
    return map;
  }, [appUsers]);

  const customerOptions = (contacts || []).filter(
    (contact) => contact.status === "active" && ["customer", "both"].includes(contact.type)
  );
  const userOptions = (appUsers || []).filter((user) => user.active);

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  useEffect(() => {
    if (!focusProjectCode) return;
    const focused = contractProjects.find((project) => project.projectCode === focusProjectCode);
    if (focused) setSelectedId(focused.id);
  }, [focusProjectCode, contractProjects]);

  function beginCreate() {
    setSelectedId(null);
    setDraft({ ...EMPTY_DRAFT });
    setCreating(true);
    setEditing(true);
    setState({ busy: false, message: "", error: "" });
  }

  function beginEdit() {
    if (!selected) return;
    setDraft(projectDraft(selected, membershipsById));
    setCreating(false);
    setEditing(true);
    setState({ busy: false, message: "", error: "" });
  }

  function closePanel() {
    setSelectedId(null);
    setCreating(false);
    setEditing(false);
    setState({ busy: false, message: "", error: "" });
  }

  async function save() {
    setState({ busy: true, message: "", error: "" });
    try {
      const saved = await onSave(draft);
      setSelectedId(saved.id);
      setCreating(false);
      setEditing(false);
      setState({ busy: false, message: "Commessa salvata.", error: "" });
    } catch (error) {
      setState({ busy: false, message: "", error: error.message });
    }
  }

  async function setArchived(archived) {
    if (!selected) return;
    const verb = archived ? "Archiviare" : "Ripristinare";
    if (!window.confirm(`${verb} la commessa ${selected.projectCode}?`)) return;
    setState({ busy: true, message: "", error: "" });
    try {
      await onSave({ id: selected.id, archived });
      setEditing(false);
      if (archived && !showArchived) setSelectedId(null);
      setState({ busy: false, message: archived ? "Commessa archiviata." : "Commessa ripristinata.", error: "" });
    } catch (error) {
      setState({ busy: false, message: "", error: error.message });
    }
  }

  const rows = contractProjects.map((project) => ({
    ...project,
    displayName: project.name || project.projectCode,
    displayCustomer: project.customer || "-",
    displayOwner: project.owner || "-",
    contractSummary: (() => {
      const openActions = operationalActions.filter((action) => action.projectId === project.id && action.status === "open").length;
      const openBilling = billingItems.filter((item) => item.projectId === project.id && item.status === "to_issue");
      const currencies = new Set(openBilling.map((item) => item.currency));
      const total = openBilling.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (!openActions && !openBilling.length) return "-";
      const amount = currencies.size === 1
        ? `${total.toLocaleString("it-IT", { minimumFractionDigits: 2 })} ${openBilling[0].currency}`
        : openBilling.length ? `${openBilling.length} importi` : null;
      return [`${openActions} az.`, amount].filter(Boolean).join(" · ");
    })()
  }));

  const columns = [
    { key: "projectCode", label: "Codice" },
    { key: "displayName", label: "Commessa" },
    { key: "displayCustomer", label: "Cliente" },
    { key: "displayOwner", label: "Responsabile" },
    { key: "contractStatus", label: "Stato" },
    { key: "expectedEndDate", label: "Fine prevista" },
    { key: "contractSummary", label: "Da fare" }
  ];

  return (
    <div className="flex min-h-[calc(100vh-104px)] gap-0">
      <main className="min-w-0 flex-1 pr-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Commesse</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Fondazione ContractWatch: anagrafica e responsabilità della commessa.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              Mostra archiviate
            </label>
            {!readOnly && <Button onClick={beginCreate}><Plus className="h-4 w-4" />Nuova commessa</Button>}
          </div>
        </div>
        <Card>
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(project) => {
              setSelectedId(project.id);
              setCreating(false);
              setEditing(false);
              setState({ busy: false, message: "", error: "" });
            }}
            renderCell={(row, key) => {
              if (key === "contractStatus") return <ContractStatus value={row.contractStatus} />;
              if (key === "expectedEndDate") return formatDate(row.expectedEndDate);
              return row[key] || "-";
            }}
          />
        </Card>
      </main>

      {(selected || creating) && (
        <aside className="w-[420px] shrink-0 border-l bg-white" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex h-14 items-center justify-between border-b px-4" style={{ borderColor: "var(--color-border)" }}>
            <div>
              <div className="text-sm font-semibold">{creating ? "Nuova commessa" : selected.projectCode}</div>
              <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>ContractWatch</div>
            </div>
            <Button variant="ghost" className="h-8 w-8 px-0" onClick={closePanel} aria-label="Chiudi dettaglio">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-5 overflow-y-auto p-4" style={{ maxHeight: "calc(100vh - 124px)" }}>
            {editing ? (
              <ProjectForm draft={draft} setDraft={setDraft} customers={customerOptions} users={userOptions} />
            ) : (
              <ProjectDetails project={selected} />
            )}

            {!editing && selected && adapter && (
              <ContractSalSection
                project={selected}
                initialReports={selectedReports}
                initialBillingItems={selectedBillingItems}
                focusBillingItemId={focusProjectCode === selected.projectCode ? focusBillingItemId : undefined}
                readOnly={readOnly}
                adapter={adapter}
                onChanged={onRefresh}
              />
            )}

            {state.error && <Feedback tone="danger">{state.error}</Feedback>}
            {state.message && <Feedback>{state.message}</Feedback>}

            {editing ? (
              <div className="flex gap-2">
                <Button className="flex-1" onClick={save} disabled={state.busy}>Salva</Button>
                <Button variant="secondary" onClick={creating ? closePanel : () => setEditing(false)} disabled={state.busy}>Annulla</Button>
              </div>
            ) : !readOnly ? (
              <div className="space-y-2">
                <Button variant="secondary" className="w-full" onClick={beginEdit}>Modifica commessa</Button>
                <Button
                  variant="ghost"
                  className={`w-full ${selected.archivedAt ? "" : "text-[color:var(--color-danger)]"}`}
                  onClick={() => setArchived(!selected.archivedAt)}
                  disabled={state.busy}
                >
                  <Archive className="h-4 w-4" />{selected.archivedAt ? "Ripristina" : "Archivia"}
                </Button>
              </div>
            ) : null}
          </div>
        </aside>
      )}
    </div>
  );
}

function ProjectForm({ draft, setDraft, customers, users }) {
  const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none";
  const inputStyle = { borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" };
  const field = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Codice commessa *"><input className={inputClass} style={inputStyle} value={draft.projectCode} onChange={(e) => field("projectCode", e.target.value)} /></Field>
        <Field label="Stato"><select className={inputClass} style={inputStyle} value={draft.contractStatus} onChange={(e) => field("contractStatus", e.target.value)}>{STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></Field>
      </div>
      <Field label="Nome *"><input className={inputClass} style={inputStyle} value={draft.name} onChange={(e) => field("name", e.target.value)} /></Field>
      <Field label="Cliente"><select className={inputClass} style={inputStyle} value={draft.customerContactId} onChange={(e) => field("customerContactId", e.target.value)}><option value="">Nessun cliente</option>{customers.map((contact) => <option key={contact.id} value={contact.id}>{contact.legalName}</option>)}</select></Field>
      <Field label="Responsabile"><select className={inputClass} style={inputStyle} value={draft.responsibleAppUserId} onChange={(e) => field("responsibleAppUserId", e.target.value)}><option value="">Nessun responsabile</option>{users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data inizio"><input type="date" className={inputClass} style={inputStyle} value={draft.startDate} onChange={(e) => field("startDate", e.target.value)} /></Field>
        <Field label="Fine prevista"><input type="date" className={inputClass} style={inputStyle} value={draft.expectedEndDate} onChange={(e) => field("expectedEndDate", e.target.value)} /></Field>
      </div>
      <Field label="Descrizione"><textarea className={`${inputClass} h-28 resize-none`} style={inputStyle} value={draft.description} onChange={(e) => field("description", e.target.value)} /></Field>
    </div>
  );
}

function ProjectDetails({ project }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <ContractStatus value={project.contractStatus} />
        {project.archivedAt && <span className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Archiviata</span>}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{project.name || project.projectCode}</h2>
        {project.description && <p className="mt-2 whitespace-pre-line" style={{ color: "var(--color-text-muted)" }}>{project.description}</p>}
      </div>
      <dl className="space-y-3">
        <Detail label="Cliente" value={project.customer} />
        <Detail label="Responsabile" value={project.owner} />
        <Detail label="Data inizio" value={formatDate(project.startDate)} />
        <Detail label="Fine prevista" value={formatDate(project.expectedEndDate)} />
      </dl>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="font-semibold">{label}</span>{children}</label>;
}

function Detail({ label, value }) {
  return <div className="grid grid-cols-[130px_1fr] gap-3"><dt style={{ color: "var(--color-text-muted)" }}>{label}</dt><dd className="font-medium">{value || "-"}</dd></div>;
}

function Feedback({ tone, children }) {
  return <div className="rounded-md px-3 py-2 text-[13px]" style={{ backgroundColor: "var(--color-muted)", color: tone === "danger" ? "var(--color-danger)" : "var(--color-text)" }}>{children}</div>;
}
