import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Clock3, Plus, ShoppingCart, X } from "lucide-react";
import Card from "../components/Card";
import DataTable from "../components/DataTable";
import SeverityHighlight from "../components/SeverityHighlight";
import SmartEmptyState from "../components/SmartEmptyState";
import StatusBadge from "../components/StatusBadge";
import Button from "../components/Button";
import { formatDate } from "../utils/dateUtils";
import { formatNumber } from "../utils/formatters";
import { splitProjectOperationalLines } from "../utils/procurement";

const PROJECT_STATUSES = ["Preventivo", "Aperto", "In produzione", "Concluso", "Annullato"];

function materialTokens(value) {
  return new Set(String(value || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2));
}

function materialSimilarity(left, right) {
  const a = materialTokens(left);
  const b = materialTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function procurementState(line, linkedOrders) {
  const status = String(line.status || "").toLowerCase();
  if (/ricevut|arrivat|consegnat|complet/.test(status) || Number(line.remainingQuantity) === 0 && Number(line.deliveredQuantity) > 0) {
    return { label: "Arrivato", tone: "success", Icon: CheckCircle2 };
  }
  const hasOrder = Boolean(line.orderId || line.orderCode || linkedOrders.some((order) =>
    order.orderCode === line.orderCode || materialSimilarity(order.material, line.description) >= 0.75
  ));
  if (hasOrder || /ordinat|confermat|attesa/.test(status)) {
    return { label: "Ordinato", tone: "accent", Icon: Clock3 };
  }
  return { label: "Da ordinare", tone: "warning", Icon: ShoppingCart };
}

function historicalSuppliers(line, allLines, projectCode) {
  const suppliers = allLines
    .filter((candidate) => candidate.projectCode !== projectCode && candidate.supplierName)
    .filter((candidate) => materialSimilarity(candidate.description, line.description) >= 0.62)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map((candidate) => candidate.supplierName);
  return [...new Set(suppliers)].slice(0, 3);
}

export default function ProjectsView({ config, projects, materialLines = [], orders = [], activities = [], focusProjectCode, onNavigate, onUpdateProject, onCreateProcurementRequirement }) {
  const [selected, setSelected] = useState(null);

  // Riaggancia il progetto selezionato dopo un refresh dati (es. dopo update).
  useEffect(() => {
    if (!selected) return;
    const fresh = projects.find((p) => p.id === selected.id);
    setSelected(fresh || null);
  }, [projects]);

  // Drill-down da una citazione (es. da Ordini/Fornitori): apre direttamente
  // il lavoro indicato, stesso pattern di focusOrderCode in OrdersView.
  useEffect(() => {
    if (!focusProjectCode) return;
    const match = projects.find((project) => project.projectCode === focusProjectCode);
    if (match) setSelected(match);
  }, [focusProjectCode, projects]);

  const projectRows = useMemo(() => projects.map((project) => {
    const linkedLines = materialLines.filter((line) => line.projectId === project.id || line.projectCode === project.projectCode);
    const { customerRequirements, procurementRequirements } = splitProjectOperationalLines(linkedLines);
    const linkedOrders = orders.filter((order) => order.projectCode === project.projectCode);
    const pendingLines = procurementRequirements.filter((line) => procurementState(line, linkedOrders).label !== "Arrivato");
    const criticalLines = pendingLines.filter((line) => {
      const due = line.requiredDate || line.dueDate;
      return line.needsReview || (due && due < new Date().toISOString().slice(0, 10));
    });
    return {
      ...project,
      customerRequirementCount: customerRequirements.length,
      procurementCount: procurementRequirements.length,
      pendingMaterialCount: pendingLines.length,
      linkedOrderCount: linkedOrders.length,
      operationalRisk: !customerRequirements.length ? "Dati mancanti" : criticalLines.length ? "A rischio" : pendingLines.length ? "Da seguire" : "Sotto controllo"
    };
  }), [projects, materialLines, orders]);

  const columns = [
    { key: "projectCode", label: config.terminology.projectSingular },
    { key: "customer", label: config.terminology.customer },
    { key: "status", label: "Stato" },
    { key: "customerRequirementCount", label: "Richieste cliente" },
    { key: "procurementCount", label: "Fabbisogni" },
    { key: "operationalRisk", label: "Situazione" },
    { key: "dueDate", label: config.terminology.dueDate }
  ];

  const riskSummary = useMemo(() => {
    const atRisk = projectRows.filter((row) => row.operationalRisk === "A rischio").length;
    const toFollow = projectRows.filter((row) => row.operationalRisk === "Da seguire").length;
    const underControl = projectRows.filter((row) => row.operationalRisk === "Sotto controllo").length;
    const items = [];
    if (atRisk) items.push({ label: "A rischio", value: atRisk, severity: "critical" });
    if (toFollow) items.push({ label: "Da seguire", value: toFollow, severity: "warning" });
    if (underControl) items.push({ label: "Sotto controllo", value: underControl, severity: "success" });
    return items;
  }, [projectRows]);

  return (
    <div className="flex min-h-[calc(100vh-104px)] flex-col gap-4 xl:flex-row xl:gap-0">
      <main className="min-w-0 flex-1 xl:pr-4">
        {riskSummary.length > 0 && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {riskSummary.map((item) => (
              <SeverityHighlight key={item.label} label={item.label} value={item.value} severity={item.severity} />
            ))}
          </div>
        )}
        {projectRows.length ? (
          <Card title={config.terminology.projectsPlural}>
            <DataTable
              columns={columns}
              rows={projectRows}
              onRowClick={setSelected}
              renderCell={(row, key) => {
                if (key === "status") return <StatusBadge status={row.status} />;
                if (key === "customerRequirementCount") return row.customerRequirementCount || "Nessun dato";
                if (key === "procurementCount") return row.procurementCount ? `${row.pendingMaterialCount}/${row.procurementCount} da completare` : "Nessuno definito";
                if (key === "operationalRisk") return <OperationalRiskBadge value={row.operationalRisk} />;
                if (key === "dueDate") return formatDate(row[key]);
                return row[key];
              }}
            />
          </Card>
        ) : (
          <SmartEmptyState
            icon={BarChart3}
            title={`Nessun ${config.terminology.projectSingular.toLowerCase()} registrato`}
            description="I lavori compariranno quando OrderWatch riconosce una richiesta cliente collegata a un progetto."
            actions={onNavigate ? [{ label: "Apri le azioni di oggi", onClick: () => onNavigate("dashboard") }] : []}
          />
        )}
      </main>
      <ProjectDetailPanel
        project={selected}
        terminology={config.terminology}
        materialLines={materialLines}
        orders={orders}
        activities={activities}
        onNavigate={onNavigate}
        onClose={() => setSelected(null)}
        onUpdateProject={onUpdateProject}
        onCreateProcurementRequirement={onCreateProcurementRequirement}
      />
    </div>
  );
}

function OperationalRiskBadge({ value }) {
  const tone = value === "A rischio" ? "danger" : value === "Da seguire" ? "warning" : value === "Sotto controllo" ? "success" : "muted";
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        color: `var(--color-${tone === "muted" ? "text-muted" : tone})`,
        backgroundColor: tone === "muted" ? "var(--color-muted)" : `color-mix(in srgb, var(--color-${tone}) 11%, white)`
      }}
    >
      {value}
    </span>
  );
}

function ProjectDetailPanel({ project, terminology, materialLines, orders, activities, onNavigate, onClose, onUpdateProject, onCreateProcurementRequirement }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [procurementDraft, setProcurementDraft] = useState(null);

  useEffect(() => {
    setEditing(false);
    setProcurementDraft(null);
    setMessage("");
  }, [project?.id]);

  const linkedLines = useMemo(
    () => (project ? materialLines.filter((line) => line.projectCode === project.projectCode) : []),
    [materialLines, project]
  );
  const { customerRequirements, procurementRequirements } = useMemo(
    () => splitProjectOperationalLines(linkedLines),
    [linkedLines]
  );
  const linkedOrders = useMemo(
    () => (project ? orders.filter((order) => order.projectCode === project.projectCode) : []),
    [orders, project]
  );
  const recentActivities = useMemo(
    () =>
      (project ? activities.filter((activity) => activity.projectCode === project.projectCode) : [])
        .slice(0, 6),
    [activities, project]
  );

  if (!project) return null;

  const inputClass = "mt-1 w-full rounded-md border px-2 py-1.5 text-sm outline-none";
  const inputStyle = { borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" };

  function startEditing() {
    setDraft({
      status: PROJECT_STATUSES.includes(project.status) ? project.status : "Aperto",
      owner: project.owner || "",
      dueDate: project.dueDate || "",
      customer: project.customer || "",
      notes: project.notes || ""
    });
    setEditing(true);
    setMessage("");
  }

  async function save() {
    if (!onUpdateProject) return;
    setBusy(true);
    setMessage("");
    try {
      await onUpdateProject(project.id, draft);
      setEditing(false);
      setMessage("Lavoro aggiornato.");
    } catch (error) {
      setMessage(`Errore: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function startProcurementDraft(source) {
    setProcurementDraft({
      sourceProjectRequirementId: source.id,
      sourceDescription: source.description || "Richiesta cliente",
      description: "",
      quantity: "",
      unit: "",
      requiredDate: source.requiredDate || project.dueDate || ""
    });
    setMessage("");
  }

  async function saveProcurementDraft() {
    if (!onCreateProcurementRequirement || !procurementDraft) return;
    setBusy(true);
    setMessage("");
    try {
      await onCreateProcurementRequirement({
        action: "create",
        ...procurementDraft,
        approve: true
      });
      setProcurementDraft(null);
      setMessage("Fabbisogno di acquisto creato e approvato.");
    } catch (error) {
      setMessage(`Errore: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="w-full shrink-0 border-t bg-white xl:w-96 xl:border-l xl:border-t-0" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}>
      <div className="flex h-14 items-center justify-between border-b px-4" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <div className="text-sm font-semibold">{project.projectCode}</div>
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Dettaglio {terminology.projectSingular.toLowerCase()}
          </div>
        </div>
        <Button variant="ghost" className="h-8 w-8 px-0" onClick={onClose} aria-label="Chiudi dettaglio">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-5 overflow-y-auto p-4 xl:max-h-[calc(100vh-124px)]">
        <StatusBadge status={project.status} />

        {!editing && (
          <dl className="space-y-3 text-sm">
            <Row label={terminology.customer} value={project.customer} />
            <Row label={terminology.owner} value={project.owner} />
            <Row label={terminology.dueDate} value={formatDate(project.dueDate)} />
            <Row label="Ordini collegati" value={linkedOrders.length || "Nessuno"} />
            <Row label="Richieste cliente" value={customerRequirements.length || "Nessun dato"} />
            <Row label="Fabbisogni di acquisto" value={procurementRequirements.length || "Nessuno definito"} />
          </dl>
        )}

        {editing && (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="font-semibold">Stato</span>
              <select className={inputClass} style={inputStyle} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="font-semibold">{terminology.customer}</span>
              <input className={inputClass} style={inputStyle} value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">{terminology.owner}</span>
              <input className={inputClass} style={inputStyle} value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">{terminology.dueDate}</span>
              <input type="date" className={inputClass} style={inputStyle} value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">Note</span>
              <textarea className={`${inputClass} h-20`} style={inputStyle} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            <div className="flex gap-2">
              <Button className="h-9 flex-1" onClick={save} disabled={busy}>Salva modifiche</Button>
              <Button variant="secondary" className="h-9" onClick={() => setEditing(false)} disabled={busy}>Annulla</Button>
            </div>
          </div>
        )}

        {project.notes && !editing && (
          <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
            {project.notes}
          </div>
        )}

        {onUpdateProject && !editing && (
          <Button variant="secondary" className="h-9 w-full justify-center" onClick={startEditing}>
            Modifica lavoro
          </Button>
        )}

        {message && (
          <div className="rounded-md px-3 py-2 text-[13px]" style={{ backgroundColor: "var(--color-muted)", color: message.startsWith("Errore") ? "var(--color-danger)" : "var(--color-text)" }}>
            {message}
          </div>
        )}

        <Section title={`Richieste cliente (${customerRequirements.length})`}>
          {customerRequirements.length ? (
            <div className="space-y-2">
              {customerRequirements.map((line) => (
                  <div key={line.id} className="rounded-md border p-3 text-[13px]" style={{ borderColor: "var(--color-border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{line.description || "Prodotto da definire"}</div>
                        <div className="mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                          {[formatNumber(line.quantity), line.unit, formatDate(line.requiredDate)].filter(Boolean).join(" · ") || "Dettagli non indicati"}
                        </div>
                      </div>
                      <StatusBadge status={line.needsReview ? "TO_VERIFY" : "Richiesto"} />
                    </div>
                    {onCreateProcurementRequirement && (
                      <button type="button" onClick={() => startProcurementDraft(line)} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--color-primary)" }}>
                        <Plus className="h-3.5 w-3.5" /> Definisci un materiale da acquistare
                      </button>
                    )}
                  </div>
              ))}
            </div>
          ) : (
            <EmptyHint text="Nessuna richiesta cliente strutturata per questo lavoro." />
          )}
        </Section>

        {procurementDraft && (
          <Section title="Nuovo fabbisogno di acquisto">
            <div className="space-y-3 rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
              <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                Richiesta cliente: <span className="font-medium" style={{ color: "var(--color-text)" }}>{procurementDraft.sourceDescription}</span>
              </div>
              <label className="block">
                <span className="font-semibold">Materiale o servizio da acquistare</span>
                <input className={inputClass} style={inputStyle} value={procurementDraft.description} onChange={(e) => setProcurementDraft({ ...procurementDraft, description: e.target.value })} placeholder="Es. Carta patinata 300 g" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="font-semibold">Quantità</span>
                  <input type="number" min="0" step="any" className={inputClass} style={inputStyle} value={procurementDraft.quantity} onChange={(e) => setProcurementDraft({ ...procurementDraft, quantity: e.target.value })} />
                </label>
                <label className="block">
                  <span className="font-semibold">Unità</span>
                  <input className={inputClass} style={inputStyle} value={procurementDraft.unit} onChange={(e) => setProcurementDraft({ ...procurementDraft, unit: e.target.value })} placeholder="RISME" />
                </label>
              </div>
              <label className="block">
                <span className="font-semibold">Data necessaria</span>
                <input type="date" className={inputClass} style={inputStyle} value={procurementDraft.requiredDate} onChange={(e) => setProcurementDraft({ ...procurementDraft, requiredDate: e.target.value })} />
              </label>
              <div className="flex gap-2">
                <Button className="h-9 flex-1" onClick={saveProcurementDraft} disabled={busy}>Crea fabbisogno</Button>
                <Button variant="secondary" className="h-9" onClick={() => setProcurementDraft(null)} disabled={busy}>Annulla</Button>
              </div>
            </div>
          </Section>
        )}

        <Section title={`Fabbisogni di acquisto (${procurementRequirements.length})`}>
          {procurementRequirements.length ? (
            <div className="space-y-2">
              {procurementRequirements.map((line) => {
                const state = procurementState(line, linkedOrders);
                const previousSuppliers = historicalSuppliers(line, materialLines, project.projectCode);
                return (
                  <div key={line.id} className="rounded-md border p-3 text-[13px]" style={{ borderColor: "var(--color-border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{line.description || "Materiale da definire"}</div>
                        <div className="mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                          {[formatNumber(line.quantity), line.unit, line.orderCode ? `Ordine ${line.orderCode}` : null].filter(Boolean).join(" · ") || "Quantità non indicata"}
                        </div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold" style={{ color: `var(--color-${state.tone})`, backgroundColor: `color-mix(in srgb, var(--color-${state.tone}) 10%, white)` }}>
                        <state.Icon className="h-3 w-3" /> {state.label}
                      </span>
                    </div>
                    {line.supplierName && (
                      <div className="mt-2 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                        Fornitore: {onNavigate ? (
                          <Citation onClick={() => onNavigate("suppliers", { supplierName: line.supplierName })}>{line.supplierName}</Citation>
                        ) : (
                          <span className="font-medium" style={{ color: "var(--color-text)" }}>{line.supplierName}</span>
                        )}
                      </div>
                    )}
                    {!line.supplierName && previousSuppliers.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                        Acquisti simili:
                        {onNavigate
                          ? previousSuppliers.map((name) => <Citation key={name} onClick={() => onNavigate("suppliers", { supplierName: name })}>{name}</Citation>)
                          : <span className="font-medium" style={{ color: "var(--color-text)" }}>{previousSuppliers.join(", ")}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : <EmptyHint text="Nessun fabbisogno di acquisto definito: le richieste cliente non vengono trasformate automaticamente." />}
        </Section>

        <Section title={`${terminology.ordersPlural} collegati (${linkedOrders.length})`}>
          {linkedOrders.length ? (
            <div className="space-y-2">
              {linkedOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-[13px]" style={{ borderColor: "var(--color-border)" }}>
                  <div className="min-w-0 truncate">
                    {onNavigate ? (
                      <Citation onClick={() => onNavigate("orders", { orderCode: order.orderCode })}>{order.orderCode}</Citation>
                    ) : (
                      <span className="font-medium">{order.orderCode}</span>
                    )} — {order.supplierName || "fornitore"}
                  </div>
                  <StatusBadge status={order.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyHint text="Nessun ordine materiali collegato." />
          )}
        </Section>

        <Section title="Attivita' recenti">
          {recentActivities.length ? (
            <div className="space-y-2">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="text-[13px]">
                  <div className="font-medium">{activity.title}</div>
                  <div style={{ color: "var(--color-text-muted)" }}>{activity.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyHint text="Nessuna attivita' registrata." />
          )}
        </Section>
      </div>
    </aside>
  );
}

function Row({ label, value }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt style={{ color: "var(--color-text-muted)" }}>{label}</dt>
      <dd className="font-medium">{value || "-"}</dd>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-2 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
      <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>{title}</div>
      {children}
    </div>
  );
}

function EmptyHint({ text }) {
  return <div className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>{text}</div>;
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
