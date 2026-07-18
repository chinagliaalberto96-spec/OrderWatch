import { useMemo, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Building2, CalendarClock, CheckCircle2, ChevronDown, Clock3, Eye, EyeOff, Inbox, Lightbulb, Mail, Send, Users, X } from "lucide-react";
import { daysFromToday, formatDate } from "../utils/dateUtils";
import { getOrderStatus } from "../utils/statusRules";
import { getWorkflowMode, getWorkflowPolicy } from "../config/workflowModes";
import { groupOperationalItemsByCounterparty } from "../utils/operationalGrouping";
import OperationalRow from "../components/OperationalRow";

// Home "Oggi": la coda operativa E' la pagina. Il buyer deve capire in 10
// secondi cosa fare adesso. Niente KPI/grafici come protagonisti: solo una
// lista prioritizzata e azionabile di cose da controllare, collegare, sollecitare.

const SNOOZE_KEY = "orderwatch-snoozed-queue-items";

const KIND_LABEL = {
  material_line: "Riga materiale",
  supplier_material_group: "Ordine fornitore",
  quote: "Preventivo",
  delivery_note: "DDT",
  invoice: "Fattura",
  processed_email: "Email",
  buyer_action: "Azione",
  operational_action: "ContractWatch",
  supplier_order: "Ordine fornitore",
  supplier_reminder: "Sollecito"
};

const PRIORITY_GROUPS = [
  { key: "urgent", label: "Urgente — da fare adesso", tone: "danger" },
  { key: "high", label: "Importante", tone: "warning" },
  { key: "medium", label: "Questa settimana / da tenere d'occhio", tone: "accent" }
];

function toneColor(tone) {
  return {
    danger: "var(--color-danger)",
    warning: "var(--color-warning)",
    accent: "var(--color-accent)",
    muted: "var(--color-text-muted)"
  }[tone] || "var(--color-text-muted)";
}

function priorityTone(priority) {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  if (priority === "medium") return "accent";
  return "muted";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadSnoozed() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SNOOZE_KEY) || "{}");
    const today = todayKey();
    // Tieni solo gli snooze di oggi: domani la coda ricompare pulita.
    return Object.fromEntries(Object.entries(raw).filter(([, day]) => day === today));
  } catch {
    return {};
  }
}

function viewForItem(item) {
  if (item.kind === "operational_action") return "contract_watch";
  if (item.kind === "supplier_material_group") return item.orderCode ? "orders" : "suppliers";
  if (item.kind === "quote") return "quotes";
  if ((item.kind === "invoice" || item.kind === "delivery_note") && item.sourceEmailId) return "imports";
  if (item.kind === "invoice" || item.kind === "delivery_note") return "documents";
  if (item.kind === "processed_email") return "imports";
  if (item.kind === "material_line" && !item.orderCode) {
    if (item.supplierId || item.supplierName) return "suppliers";
    if (item.sourceEmailId) return "imports";
    return "quotes";
  }
  return "orders";
}

function contextForItem(item) {
  if (item.kind === "operational_action") {
    return { projectCode: item.projectCode, billingItemId: item.sourceEntityId };
  }
  if (item.kind === "quote") return { quoteId: item.entityId };
  if (item.kind === "material_line" && !item.orderCode && (item.supplierId || item.supplierName)) {
    return {
      supplierId: item.supplierId || null,
      supplierName: item.supplierName || null,
      supplierTab: "materials",
      materialLineIds: [item.entityId].filter(Boolean)
    };
  }
  if (item.sourceEmailId && ["material_line", "delivery_note", "invoice"].includes(item.kind)) {
    return { emailId: item.sourceEmailId };
  }
  if (item.kind === "supplier_material_group" && !item.orderCode) {
    const lines = item.lineItems || [];
    return {
      supplierId: item.supplierId || lines.find((line) => line.supplierId)?.supplierId || null,
      supplierName: item.supplierName || null,
      supplierTab: "materials",
      materialLineIds: lines.map((line) => line.entityId).filter(Boolean)
    };
  }
  if (item.orderCode) return { orderCode: item.orderCode };
  if (item.projectCode) return { projectCode: item.projectCode };
  return {};
}

export default function DashboardView({
  config,
  data,
  onNavigate,
  onVerifyOperationalItem,
  onLinkOperationalItem,
  onPrepareCustomerConfirmation,
  onUpdateCustomerConfirmation,
  onSendCustomerConfirmation,
  onPrepareSupplierOrder
}) {
  const navigate = onNavigate || (() => {});
  const [snoozed, setSnoozed] = useState(loadSnoozed);
  const [filter, setFilter] = useState("all"); // all | urgent | week | review
  const [selectedItem, setSelectedItem] = useState(null);
  const [actionState, setActionState] = useState({ loading: false, error: null, done: false });
  const [linkDraft, setLinkDraft] = useState({ projectCode: "", orderCode: "" });
  const [confirmationDraft, setConfirmationDraft] = useState(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const rawQueue = data.operationalQueue || [];
  const traceabilityMode = (data.settings || []).find((setting) => setting.settingKey === "workflow.traceability_mode")?.value || "required_link";
  const workflowMode = getWorkflowMode(traceabilityMode);
  const workflowPolicy = getWorkflowPolicy(traceabilityMode);
  const essentialMode = workflowPolicy.exceptionsOnly;
  const assistedMode = workflowPolicy.suggestsLinks;
  const suggestions = data.operationalSuggestions || [];

  // Fallback: se il backend non ha ancora prodotto la coda (deploy vecchio),
  // ricostruisci gli item essenziali dagli ordini che richiedono attenzione,
  // cosi' la home non e' mai vuota quando invece c'e' lavoro da fare.
  const queue = useMemo(() => {
    if (rawQueue.length) return rawQueue;
    const orders = (data.orders || [])
      .map((order) => ({ ...order, computedStatus: getOrderStatus(order, config.alertRules) }))
      .filter((order) => ["OVERDUE", "CRITICAL", "TO_VERIFY"].includes(order.computedStatus));
    return orders.map((order) => ({
      id: `order-${order.id}`,
      kind: "material_line",
      priority: order.computedStatus === "OVERDUE" ? "urgent" : order.computedStatus === "CRITICAL" ? "high" : "high",
      status: order.needsReview ? "needs_review" : "open",
      title: order.material || `Ordine ${order.orderCode}`,
      subtitle: [order.supplierName, order.orderCode].filter(Boolean).join(" · "),
      detail: order.needsReview ? "Richiede verifica del buyer." : "Ordine da controllare.",
      actionLabel: order.needsReview ? "Verifica ordine" : "Apri ordine",
      orderCode: order.orderCode,
      supplierName: order.supplierName,
      dueDate: order.dueDate
    }));
  }, [rawQueue, data.orders, config.alertRules]);

  // Mostra solo le priorità operative "di oggi" (urgent/high/medium). Gli
  // eventuali item low = programmati tra oltre 7 giorni non appartengono alla
  // home "Oggi"; restano raggiungibili dalle viste Ordini/Quotazioni. Cosi'
  // il conteggio in header combacia sempre con ciò che è mostrato.
  const RENDERED_PRIORITIES = new Set(["urgent", "high", "medium"]);
  const visibleQueue = useMemo(
    () => queue.filter((item) => !snoozed[item.id] && RENDERED_PRIORITIES.has(item.priority)),
    [queue, snoozed]
  );

  const hiddenQueue = useMemo(
    () => queue.filter((item) => snoozed[item.id] && RENDERED_PRIORITIES.has(item.priority)),
    [queue, snoozed]
  );

  const counts = useMemo(() => {
    const urgent = visibleQueue.filter((i) => i.priority === "urgent" || i.status === "due_soon").length;
    const week = visibleQueue.filter((i) => i.status === "this_week" || i.priority === "medium").length;
    const review = visibleQueue.filter((i) => i.status === "needs_review" || i.status === "needs_link").length;
    return { total: visibleQueue.length, urgent, week, review };
  }, [visibleQueue]);

  const filteredQueue = useMemo(() => {
    if (filter === "hidden") return hiddenQueue;
    if (filter === "urgent") return visibleQueue.filter((i) => i.priority === "urgent" || i.status === "due_soon");
    if (filter === "week") return visibleQueue.filter((i) => i.status === "this_week" || i.priority === "medium");
    if (filter === "review") return visibleQueue.filter((i) => i.status === "needs_review" || i.status === "needs_link");
    return visibleQueue;
  }, [visibleQueue, hiddenQueue, filter]);

  const counterpartyGroups = useMemo(
    () => groupOperationalItemsByCounterparty(filteredQueue),
    [filteredQueue]
  );

  const allCounterpartyGroups = useMemo(
    () => groupOperationalItemsByCounterparty(visibleQueue),
    [visibleQueue]
  );

  const grouped = useMemo(() => {
    const groups = { urgent: [], high: [], medium: [], low: [] };
    for (const group of counterpartyGroups) {
      (groups[group.priority] || groups.low).push(group);
    }
    return groups;
  }, [counterpartyGroups]);

  const processedEmails = [...(data.processedEmails || [])].sort((a, b) => {
    const av = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bv = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bv - av;
  });

  const selectedLineItems = selectedItem?.lineItems || [];
  const selectedEntityIds = new Set([
    selectedItem?.entityId,
    ...selectedLineItems.map((line) => line.entityId)
  ].filter(Boolean));
  const selectedSourceEmailId = selectedItem?.sourceEmailId ||
    selectedLineItems.find((line) => line.sourceEmailId)?.sourceEmailId ||
    (selectedItem?.kind === "processed_email" ? selectedItem.entityId : null);
  const selectedSourceEmail = selectedSourceEmailId
    ? (data.processedEmails || []).find((email) => email.id === selectedSourceEmailId) || null
    : null;
  const selectedEvidenceLines = selectedSourceEmailId
    ? (data.materialLines || []).filter((line) => line.sourceEmailId === selectedSourceEmailId)
    : [];
  const selectedSourceDocuments = selectedSourceEmailId
    ? (data.documents || []).filter((document) => document.sourceEmailId === selectedSourceEmailId)
    : [];
  const selectedEvidenceRevisions = (data.materialLineRevisions || [])
    .filter((revision) => selectedEntityIds.has(revision.materialLineId));

  const upcomingArrivals = (essentialMode ? (data.materialLines || []).map((line) => ({
    ...line,
    material: line.description,
    dueDate: line.dueDate || line.requiredDate,
    daysRemaining: daysFromToday(line.dueDate || line.requiredDate)
  })) : (data.orders || []))
    .map((order) => ({ ...order, days: order.daysRemaining ?? daysFromToday(order.dueDate), computedStatus: getOrderStatus(order, config.alertRules) }))
    .filter((order) => order.days !== null && order.days >= 0 && order.days <= 7 && order.computedStatus !== "CLOSED")
    .sort((a, b) => (a.days ?? 99) - (b.days ?? 99));

  function snooze(item) {
    const next = { ...snoozed, [item.id]: todayKey() };
    setSnoozed(next);
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    if (selectedItem?.id === item.id) setSelectedItem(null);
  }

  function restore(item) {
    const next = { ...snoozed };
    delete next[item.id];
    setSnoozed(next);
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    if (selectedItem?.id === item.id) setSelectedItem(null);
    if (filter === "hidden" && hiddenQueue.length <= 1) setFilter("all");
  }

  function openItem(item) {
    // Gli ordini/solleciti fornitore aprono il drawer dedicato, non il pannello inline.
    if ((item.kind === "supplier_order" || item.kind === "supplier_reminder") && onPrepareSupplierOrder) {
      onPrepareSupplierOrder(item);
      return;
    }
    setSelectedItem(item);
    setLinkDraft({ projectCode: item.projectCode || "", orderCode: item.orderCode || "" });
    setConfirmationDraft(item.confirmation ? { ...item.confirmation } : null);
    setActionState({ loading: false, error: null, done: false });
  }

  async function verifyItem(item) {
    if (!onVerifyOperationalItem) return;
    setActionState({ loading: true, error: null, done: false });
    try {
      await onVerifyOperationalItem(item);
      setActionState({ loading: false, error: null, done: true });
      setSelectedItem(null);
    } catch (error) {
      setActionState({ loading: false, error: error.message, done: false });
    }
  }

  async function linkItem(item) {
    if (!onLinkOperationalItem) return;
    if (!linkDraft.projectCode && !linkDraft.orderCode) {
      setActionState({ loading: false, error: "Seleziona almeno un lavoro o un ordine da collegare.", done: false });
      return;
    }
    setActionState({ loading: true, error: null, done: false });
    try {
      await onLinkOperationalItem(item, linkDraft);
      setActionState({ loading: false, error: null, done: true });
      setSelectedItem(null);
    } catch (error) {
      setActionState({ loading: false, error: error.message, done: false });
    }
  }

  async function prepareConfirmation(item) {
    if (!onPrepareCustomerConfirmation) return;
    setActionState({ loading: true, error: null, done: false });
    try {
      const confirmation = await onPrepareCustomerConfirmation(item);
      setConfirmationDraft({ ...confirmation });
      setSelectedItem((current) => ({ ...current, confirmation }));
      setActionState({ loading: false, error: null, done: true });
    } catch (error) {
      setActionState({ loading: false, error: error.message, done: false });
    }
  }

  async function saveConfirmation() {
    if (!onUpdateCustomerConfirmation || !confirmationDraft) return;
    setActionState({ loading: true, error: null, done: false });
    try {
      const confirmation = await onUpdateCustomerConfirmation(confirmationDraft);
      setConfirmationDraft({ ...confirmation });
      setSelectedItem((current) => ({ ...current, confirmation }));
      setActionState({ loading: false, error: null, done: true });
    } catch (error) {
      setActionState({ loading: false, error: error.message, done: false });
    }
  }

  async function sendConfirmation(senderMailboxId) {
    if (!onSendCustomerConfirmation || !confirmationDraft) return;
    setActionState({ loading: true, error: null, done: false });
    try {
      const saved = await onUpdateCustomerConfirmation(confirmationDraft);
      const confirmation = await onSendCustomerConfirmation({ id: saved.id, senderMailboxId });
      setConfirmationDraft({ ...confirmation });
      setSelectedItem(null);
      setActionState({ loading: false, error: null, done: true });
    } catch (error) {
      setActionState({ loading: false, error: error.message, done: false });
    }
  }

  function openFullView(item) {
    navigate(viewForItem(item), contextForItem(item));
  }

  const dateLabel = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="mx-auto max-w-[1180px] space-y-5">
      {/* Intestazione operativa + chip filtro (i vecchi KPI, ora azionabili) */}
      <section className="rounded-lg border bg-white px-5 py-4 shadow-soft" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[19px] font-semibold" style={{ color: "var(--color-text)" }}>
              {filter === "hidden"
                ? `${hiddenQueue.length} ${hiddenQueue.length === 1 ? "attività nascosta" : "attività nascoste"} fino a domani`
                : counts.total
                ? `${allCounterpartyGroups.length} ${allCounterpartyGroups.length === 1 ? "controparte" : "controparti"} · ${counts.total} attività da controllare oggi`
                : "Tutto sotto controllo"}
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {filter === "hidden" ? (
                <span>Queste attività non sono eliminate. Puoi ripristinarle ora; altrimenti ricompariranno automaticamente domani.</span>
              ) : (
                <>
                  <span className="capitalize">{dateLabel}</span>
                  <span> · Vista {workflowMode.label}: {essentialMode ? "solo eccezioni reali" : assistedMode ? "suggerimenti separati" : "collegamenti inclusi"}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterChip label="Tutte" value={counts.total} active={filter === "all"} tone="muted" onClick={() => setFilter("all")} />
            <FilterChip label="Critici" value={counts.urgent} active={filter === "urgent"} tone="danger" onClick={() => setFilter(filter === "urgent" ? "all" : "urgent")} />
            {workflowPolicy.showWeekFilter && <FilterChip label="Questa settimana" value={counts.week} active={filter === "week"} tone="warning" onClick={() => setFilter(filter === "week" ? "all" : "week")} />}
            <FilterChip label="Da verificare" value={counts.review} active={filter === "review"} tone="accent" onClick={() => setFilter(filter === "review" ? "all" : "review")} />
            {hiddenQueue.length > 0 && <FilterChip label="Nascoste oggi" value={hiddenQueue.length} active={filter === "hidden"} tone="muted" onClick={() => setFilter(filter === "hidden" ? "all" : "hidden")} />}
          </div>
        </div>
      </section>

      {/* Coda operativa: il cuore della home */}
      {filteredQueue.length === 0 ? (
        <section className="rounded-lg border bg-white p-10 text-center shadow-soft" style={{ borderColor: "var(--color-border)" }}>
          <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: "var(--color-success)" }} />
          <h2 className="mt-3 text-[17px] font-semibold">Niente da controllare {filter !== "all" ? "in questo filtro" : "adesso"}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {filter !== "all"
              ? "Rimuovi il filtro per vedere il resto della coda."
              : "Ordini, materiali e documenti non richiedono interventi immediati. Le nuove email compariranno qui."}
          </p>
          {filter !== "all" && (
            <button type="button" onClick={() => setFilter("all")} className="mt-4 text-sm font-semibold hover:underline" style={{ color: "var(--color-accent)" }}>
              Mostra tutta la coda
            </button>
          )}
        </section>
      ) : (
        <div className="space-y-5">
          {PRIORITY_GROUPS.map((group) => {
            const items = grouped[group.key];
            if (!items?.length) return null;
            return (
              <section key={group.key}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: toneColor(group.tone) }} />
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                    {group.label}
                  </h2>
                  <span className="text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>· {items.length} {items.length === 1 ? "controparte" : "controparti"}</span>
                </div>
                <div className="space-y-2">
                  {items.map((counterparty) => (
                    <CounterpartyGroup
                      key={counterparty.id}
                      group={counterparty}
                      onOpenItem={openItem}
                      onSnoozeItem={filter === "hidden" ? restore : snooze}
                      hiddenMode={filter === "hidden"}
                      onPrepareSupplierOrder={onPrepareSupplierOrder}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {assistedMode && suggestions.length > 0 && (
        <section className="overflow-hidden rounded-lg border bg-white shadow-soft" style={{ borderColor: "var(--color-border)" }}>
          <button
            type="button"
            onClick={() => setSuggestionsOpen((value) => !value)}
            className="flex w-full items-center gap-3 p-4 text-left hover:bg-[color:var(--color-muted)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, white)", color: "var(--color-accent)" }}>
              <Lightbulb className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold">{suggestions.length} {suggestions.length === 1 ? "collegamento facoltativo" : "collegamenti facoltativi"}</h2>
              <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                Dati riconosciuti correttamente ma non ancora associati a un lavoro o ordine.
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: "var(--color-text-muted)", transform: suggestionsOpen ? "rotate(180deg)" : "none" }} />
          </button>
          {suggestionsOpen && (
            <div className="max-h-[480px] overflow-y-auto border-t" style={{ borderColor: "var(--color-border)" }}>
              {suggestions.map((item) => (
                <OperationalRow
                  key={item.id}
                  title={item.title}
                  subtitle={[item.subtitle, item.detail].filter(Boolean).join(" · ")}
                  meta={item.dueDate ? formatDate(item.dueDate) : "Senza data"}
                  status={<span className="rounded-full px-2 py-1 text-[10.5px] font-semibold" style={{ backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>Da collegare</span>}
                  onOpen={() => openItem(item)}
                  actions={[{
                    label: "Collega a lavoro o ordine",
                    icon: ArrowRight,
                    onClick: () => openItem(item)
                  }]}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Secondari, compatti: cosa arriva e ultimo flusso email */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SecondaryPanel icon={CalendarClock} title="Prossimi arrivi (7 giorni)" onAction={() => navigate(essentialMode ? "suppliers" : "orders")} actionLabel={essentialMode ? "Apri fornitori" : "Apri ordini"}>
          {upcomingArrivals.length ? (
            upcomingArrivals.slice(0, 6).map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => navigate(essentialMode ? "suppliers" : "orders", essentialMode ? {} : { orderCode: order.orderCode })}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition hover:bg-[color:var(--color-muted)]"
              >
                <span className="w-10 shrink-0 text-xs font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>
                  {order.dueDate ? new Intl.DateTimeFormat("it-IT", { weekday: "short" }).format(new Date(order.dueDate)) : "-"}
                </span>
                <span className="min-w-0 flex-1 truncate">{order.material || order.orderCode}</span>
                <span className="shrink-0 text-xs" style={{ color: "var(--color-text-muted)" }}>{order.days === 0 ? "oggi" : `${order.days} gg`}</span>
              </button>
            ))
          ) : (
            <EmptyMini text="Nessuna consegna promessa nei prossimi 7 giorni." />
          )}
        </SecondaryPanel>

        <SecondaryPanel icon={Inbox} title="Ultime email lette" onAction={() => navigate("imports")} actionLabel="Vedi importazioni">
          {processedEmails.length ? (
            processedEmails.slice(0, 6).map((email) => (
              <button
                key={email.id}
                type="button"
                onClick={() => navigate("imports")}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition hover:bg-[color:var(--color-muted)]"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: email.status === "Error" ? "var(--color-danger)" : email.classification === "OTHER" ? "#9CA3AF" : "var(--color-success)" }} />
                <span className="min-w-0 flex-1 truncate">{email.subject || "Email senza oggetto"}</span>
                <span className="shrink-0 text-xs" style={{ color: "var(--color-text-muted)" }}>{email.classification || email.status || "-"}</span>
              </button>
            ))
          ) : (
            <EmptyMini text="Nessuna email processata di recente." />
          )}
        </SecondaryPanel>
      </div>

      {selectedItem && (
        <ActionDrawer
          item={selectedItem}
          actionState={actionState}
          onClose={() => setSelectedItem(null)}
          onVerify={() => verifyItem(selectedItem)}
          onVerifyLine={(line) => verifyItem(line)}
          onLink={() => linkItem(selectedItem)}
          onLinkLine={(line) => linkItem(line)}
          onPrepareConfirmation={() => prepareConfirmation(selectedItem)}
          onSaveConfirmation={saveConfirmation}
          onSendConfirmation={sendConfirmation}
          onOpenFull={() => openFullView(selectedItem)}
          onSnooze={() => (filter === "hidden" ? restore(selectedItem) : snooze(selectedItem))}
          hiddenMode={filter === "hidden"}
          projects={data.projects || []}
          orders={data.orders || []}
          linkDraft={linkDraft}
          onLinkDraftChange={setLinkDraft}
          confirmationDraft={confirmationDraft}
          onConfirmationDraftChange={setConfirmationDraft}
          mailboxes={data.mailboxes || []}
          sourceEmail={selectedSourceEmail}
          evidenceLines={selectedEvidenceLines}
          sourceDocuments={selectedSourceDocuments}
          evidenceRevisions={selectedEvidenceRevisions}
        />
      )}
    </div>
  );
}

function CounterpartyGroup({ group, onOpenItem, onSnoozeItem, onPrepareSupplierOrder, hiddenMode = false }) {
  const [expanded, setExpanded] = useState(false);
  const tone = priorityTone(group.priority);
  const color = toneColor(tone);
  const Icon = group.type === "supplier"
    ? Building2
    : group.type === "customer"
      ? Users
      : group.type === "project"
        ? BriefcaseBusiness
        : Inbox;
  const typeLabel = group.type === "supplier"
    ? "Fornitore"
    : group.type === "customer"
      ? "Cliente"
      : group.type === "project"
        ? "Lavoro"
        : "Da identificare";

  return (
    <div className="rounded-lg border bg-white shadow-soft" style={{ borderColor: "var(--color-border)" }}>
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-3 px-3 py-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, white)`, color }}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold" style={{ color: "var(--color-text)" }}>{group.label}</span>
            <span className="hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase sm:inline" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>{typeLabel}</span>
          </span>
          <span className="mt-0.5 block text-[12px]" style={{ color: "var(--color-text-muted)" }}>
            {group.items.length} attività
            {group.urgentCount > 0 ? ` · ${group.urgentCount} urgenti` : ""}
            {group.reviewCount > 0 ? ` · ${group.reviewCount} da verificare` : ""}
            {group.type === "unassigned" ? " · Apri per identificare o collegare" : ""}
          </span>
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{ color: "var(--color-text-muted)", transform: expanded ? "rotate(180deg)" : "none" }}
        />
      </button>

      {expanded && (
        <div className="divide-y border-t" style={{ borderColor: "var(--color-border)" }}>
          {group.items.map((item) => (
            <CounterpartyTaskRow
              key={item.id}
              item={item}
              onOpen={() => onOpenItem(item)}
              onSnooze={() => onSnoozeItem(item)}
              hiddenMode={hiddenMode}
              onPrepareSupplierOrder={item.kind === "material_line" && item.canPrepareSupplierOrder && onPrepareSupplierOrder
                ? () => onPrepareSupplierOrder(item)
                : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CounterpartyTaskRow({ item, onOpen, onSnooze, onPrepareSupplierOrder, hiddenMode = false }) {
  const color = toneColor(priorityTone(item.priority));
  const reference = item.orderCode || item.projectCode;

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[11px] font-semibold uppercase" style={{ color }}>{KIND_LABEL[item.kind] || "Attività"}</span>
          {reference && <span className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>{reference}</span>}
        </span>
        <span className="mt-0.5 block text-[13.5px] font-semibold" style={{ color: "var(--color-text)" }}>{item.title || "Elemento da gestire"}</span>
        <span className="mt-0.5 line-clamp-1 block text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          {item.detail || item.actionLabel || "Apri per gestire"}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {item.dueDate && (
          <span className="hidden items-center gap-1 text-[11px] sm:inline-flex" style={{ color: "var(--color-text-muted)" }}>
            <Clock3 className="h-3 w-3" />
            {formatDate(item.dueDate)}
          </span>
        )}
        {onPrepareSupplierOrder && (
          <button type="button" onClick={onPrepareSupplierOrder} className="rounded-md border px-2 py-1 text-[11px] font-semibold hover:bg-[color:var(--color-muted)]" style={{ borderColor: "var(--color-border)", color: "var(--color-primary)" }}>
            Prepara ordine
          </button>
        )}
        <button type="button" onClick={onSnooze} className="rounded-md p-1.5 hover:bg-[color:var(--color-muted)]" aria-label={hiddenMode ? "Ripristina nella coda" : "Nascondi fino a domani"} title={hiddenMode ? "Ripristina nella coda" : "Nascondi fino a domani"}>
          {hiddenMode ? <Eye className="h-3.5 w-3.5" style={{ color: "var(--color-accent)" }} /> : <EyeOff className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />}
        </button>
        <button type="button" onClick={onOpen} className="rounded-md p-1.5 hover:bg-[color:var(--color-muted)]" aria-label="Apri attività">
          <ArrowRight className="h-3.5 w-3.5" style={{ color }} />
        </button>
      </div>
    </div>
  );
}

function ActionDrawer({
  item,
  actionState,
  onClose,
  onVerify,
  onVerifyLine,
  onLink,
  onLinkLine,
  onOpenFull,
  onSnooze,
  projects,
  orders,
  linkDraft,
  onLinkDraftChange,
  confirmationDraft,
  onConfirmationDraftChange,
  mailboxes,
  onPrepareConfirmation,
  onSaveConfirmation,
  onSendConfirmation,
  hiddenMode = false,
  sourceEmail,
  evidenceLines = [],
  sourceDocuments = [],
  evidenceRevisions = []
}) {
  const tone = priorityTone(item.priority);
  const color = toneColor(tone);
  const confidence = Number(item.confidence);
  const isImportProblem = item.kind === "processed_email" && ["error", "processing"].includes(item.status);
  const isContractBilling = item.kind === "operational_action" && item.actionLabel === "Emetti fattura";
  const canVerify = !isImportProblem && (item.status === "needs_review" || (Number.isFinite(confidence) && confidence < 0.85));
  const isMaterialGroup = item.kind === "supplier_material_group";
  const needsLink = item.status === "needs_link";
  const canLink = ["material_line", "quote", "delivery_note", "invoice", "processed_email", "buyer_action"].includes(item.kind);
  const groupNeedsLink = isMaterialGroup && (item.lineItems || []).some((line) => line.status === "needs_link");
  const canSelectLinkTarget = canLink || groupNeedsLink;
  const canConfirmCustomer = item.kind === "material_line" && item.sourceType === "customer_request";
  const connectedMailboxes = (mailboxes || []).filter((mailbox) => mailbox.active && mailbox.connectionStatus === "connected" && mailbox.hasPassword);
  const [senderMailboxId, setSenderMailboxId] = useState(connectedMailboxes[0]?.id || "");
  const openProjects = (projects || []).filter((project) => !["Chiuso", "Concluso", "Annullato"].includes(project.status));
  const openOrders = (orders || []).filter((order) => order.status !== "CLOSED");

  function updateProject(projectCode) {
    onLinkDraftChange({ ...linkDraft, projectCode });
  }

  function updateOrder(orderCode) {
    const order = openOrders.find((candidate) => candidate.orderCode === orderCode);
    onLinkDraftChange({
      projectCode: order?.projectCode || linkDraft.projectCode || "",
      orderCode
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20 px-3 py-3 sm:px-5">
      <section className="flex h-full w-full max-w-[460px] flex-col rounded-lg border bg-white shadow-2xl" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-start justify-between gap-3 border-b p-4" style={{ borderColor: "var(--color-border)" }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, white)`, color }}>
                {KIND_LABEL[item.kind] || "Task"}
              </span>
              <span className="text-[12px] font-semibold" style={{ color }}>
                {item.priority === "urgent" ? "Urgente" : item.priority === "high" ? "Importante" : "Da monitorare"}
              </span>
            </div>
            <h2 className="mt-2 text-[18px] font-semibold leading-snug">{item.title || "Elemento operativo"}</h2>
            {item.subtitle && <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>{item.subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 transition hover:bg-[color:var(--color-muted)]" aria-label="Chiudi pannello">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <InfoBlock label="Perché richiede attenzione" value={item.detail || "Elemento rilevante nella coda operativa."} />
          <div className="grid grid-cols-2 gap-3">
            <InfoBlock label="Azione consigliata" value={item.actionLabel || "Verifica"} />
            <InfoBlock label={isMaterialGroup ? "Prima consegna" : "Data"} value={item.dueDate ? formatDate(item.dueDate) : "Non indicata"} />
            <InfoBlock
              label={isContractBilling ? "Responsabile" : "Fornitore/cliente"}
              value={isContractBilling ? (item.responsibleName || "Non assegnato") : (item.supplierName || item.customerName || "Non identificata")}
            />
            <InfoBlock
              label={isContractBilling ? "SAL / importo" : "Riferimento"}
              value={isContractBilling
                ? [item.salNumber, item.amount !== null && item.amount !== undefined ? `${Number(item.amount).toLocaleString("it-IT", { minimumFractionDigits: 2 })} ${item.currency || "EUR"}` : null].filter(Boolean).join(" · ")
                : (item.orderCode || item.projectCode || "Non collegato")}
            />
          </div>

          {(sourceEmail || evidenceLines.length > 0 || sourceDocuments.length > 0 || evidenceRevisions.length > 0 || item.kind !== "operational_action") && (
            <SourceEvidence
              item={item}
              email={sourceEmail}
              lines={evidenceLines}
              documents={sourceDocuments}
              revisions={evidenceRevisions}
              onOpenSource={onOpenFull}
            />
          )}

          {isMaterialGroup && (
            <div className="rounded-md border" style={{ borderColor: "var(--color-border)" }}>
              <div className="border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                  Righe materiale ({item.lineItems?.length || 0})
                </div>
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                  Ogni materiale mantiene quantità, stato e data di consegna propri.
                </p>
              </div>
              {(item.lineItems || []).map((line) => (
                <MaterialLineRow
                  key={line.id}
                  line={line}
                  onVerify={line.status === "needs_review" ? () => onVerifyLine(line) : null}
                  onLink={line.status === "needs_link" ? () => onLinkLine(line) : null}
                  disabled={actionState.loading}
                />
              ))}
            </div>
          )}

          {needsLink && (
            <div className="rounded-md border p-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--color-warning) 35%, var(--color-border))", backgroundColor: "color-mix(in srgb, var(--color-warning) 8%, white)" }}>
              Questo elemento va collegato a un lavoro o a un ordine. Seleziona il riferimento corretto qui sotto e salva l'associazione.
            </div>
          )}

          {isImportProblem && (
            <div className="rounded-md border p-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--color-danger) 35%, var(--color-border))", backgroundColor: "color-mix(in srgb, var(--color-danger) 8%, white)" }}>
              Questa e' un'importazione tecnica da controllare nella vista completa. Non viene segnata come verificata dalla home per evitare di nascondere errori reali.
            </div>
          )}

          {canSelectLinkTarget && (
            <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                Collega a
              </div>
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-medium">
                  <span className="mb-1 block text-[12px]" style={{ color: "var(--color-text-muted)" }}>Lavoro</span>
                  <select
                    value={linkDraft.projectCode}
                    onChange={(event) => updateProject(event.target.value)}
                    className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <option value="">Nessun lavoro selezionato</option>
                    {openProjects.slice(0, 120).map((project) => (
                      <option key={project.id} value={project.projectCode}>
                        {project.projectCode} — {project.customer || project.owner || "Senza cliente"}
                      </option>
                    ))}
                  </select>
                </label>

                {item.kind !== "quote" && (
                  <label className="block text-sm font-medium">
                    <span className="mb-1 block text-[12px]" style={{ color: "var(--color-text-muted)" }}>Ordine fornitore</span>
                    <select
                      value={linkDraft.orderCode}
                      onChange={(event) => updateOrder(event.target.value)}
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <option value="">Nessun ordine selezionato</option>
                      {openOrders.slice(0, 160).map((order) => (
                        <option key={order.id} value={order.orderCode}>
                          {order.orderCode} — {order.supplierName || "Fornitore n.d."} — {order.material || "Materiale n.d."}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {item.kind === "quote" && (
                  <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                    I preventivi vengono collegati al lavoro. La conversione in ordine sara' lo step successivo.
                  </p>
                )}
              </div>
            </div>
          )}

          {canConfirmCustomer && (
            <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4" style={{ color: "var(--color-accent)" }} />
                <div className="text-sm font-semibold">Conferma ricezione cliente</div>
              </div>

              {!confirmationDraft ? (
                <div className="mt-3">
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                    OrderWatch prepara una conferma usando i materiali estratti. Non inserisce promesse di consegna e non invia nulla senza la tua approvazione.
                  </p>
                  <button
                    type="button"
                    onClick={onPrepareConfirmation}
                    disabled={actionState.loading || (!item.projectCode && !item.orderCode)}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition disabled:opacity-50"
                    style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}
                  >
                    <Mail className="h-4 w-4" />
                    {actionState.loading ? "Preparazione..." : "Prepara bozza"}
                  </button>
                  {!item.projectCode && !item.orderCode && (
                    <p className="mt-2 text-[12px]" style={{ color: "var(--color-warning)" }}>
                      Prima collega la richiesta a un lavoro o a un ordine.
                    </p>
                  )}
                </div>
              ) : confirmationDraft.status === "sent" ? (
                <div className="mt-3 rounded-md p-3 text-sm" style={{ backgroundColor: "color-mix(in srgb, var(--color-success) 10%, white)", color: "var(--color-success)" }}>
                  Conferma inviata a {confirmationDraft.customerEmail}.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium" style={{ color: "var(--color-text-muted)" }}>Destinatario</span>
                    <input
                      type="email"
                      value={confirmationDraft.customerEmail || ""}
                      onChange={(event) => onConfirmationDraftChange({ ...confirmationDraft, customerEmail: event.target.value })}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)" }}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium" style={{ color: "var(--color-text-muted)" }}>Oggetto</span>
                    <input
                      value={confirmationDraft.subject || ""}
                      onChange={(event) => onConfirmationDraftChange({ ...confirmationDraft, subject: event.target.value })}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)" }}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium" style={{ color: "var(--color-text-muted)" }}>Messaggio</span>
                    <textarea
                      rows={10}
                      value={confirmationDraft.body || ""}
                      onChange={(event) => onConfirmationDraftChange({ ...confirmationDraft, body: event.target.value })}
                      className="w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed"
                      style={{ borderColor: "var(--color-border)" }}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium" style={{ color: "var(--color-text-muted)" }}>Invia dalla casella</span>
                    <select
                      value={senderMailboxId}
                      onChange={(event) => setSenderMailboxId(event.target.value)}
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <option value="">Seleziona casella aziendale</option>
                      {connectedMailboxes.map((mailbox) => (
                        <option key={mailbox.id} value={mailbox.id}>{mailbox.mailboxName} — {mailbox.emailAddress}</option>
                      ))}
                    </select>
                  </label>
                  {confirmationDraft.lastError && (
                    <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>{confirmationDraft.lastError}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={onSaveConfirmation}
                      disabled={actionState.loading}
                      className="rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      Salva bozza
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendConfirmation(senderMailboxId)}
                      disabled={actionState.loading || !senderMailboxId}
                      className="flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: "var(--color-accent)" }}
                    >
                      <Send className="h-4 w-4" />
                      Invia conferma
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                    L'invio conferma esclusivamente la ricezione dell'ordine. Le date restano escluse finché non vengono validate.
                  </p>
                </div>
              )}
            </div>
          )}

          {actionState.error && (
            <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
              {actionState.error}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t p-4" style={{ borderColor: "var(--color-border)" }}>
          {canLink && (
            <button
              type="button"
              onClick={onLink}
              disabled={actionState.loading || (!linkDraft.projectCode && !linkDraft.orderCode)}
              className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              <CheckCircle2 className="h-4 w-4" />
              {actionState.loading ? "Collegamento..." : "Salva collegamento"}
            </button>
          )}
          {canVerify && !isMaterialGroup && (
            <button
              type="button"
              onClick={onVerify}
              disabled={actionState.loading}
              className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ backgroundColor: color }}
            >
              <CheckCircle2 className="h-4 w-4" />
              {actionState.loading ? "Salvataggio..." : "Segna verificato"}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenFull}
            className="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition hover:bg-[color:var(--color-muted)]"
            style={{ borderColor: "var(--color-border)" }}
          >
            Apri vista completa
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onSnooze}
            className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition hover:bg-[color:var(--color-muted)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {hiddenMode ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {hiddenMode ? "Ripristina nella coda" : "Nascondi fino a domani"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SourceEvidence({ item, email, lines = [], documents = [], revisions = [], onOpenSource }) {
  const isOther = String(email?.classification || "").toUpperCase() === "OTHER";
  const observedRows = revisions
    .map((revision) => revision.newValues || {})
    .filter((values) => values.description || values.item_code || values.quantity || values.due_date || values.required_date);
  const fallbackRows = observedRows.length ? observedRows : (!email && item ? [{
    description: item.title,
    item_code: item.itemCode,
    quantity: item.quantity,
    unit: item.unit,
    due_date: item.dueDate,
    confidence: item.confidence
  }] : []);
  const rows = lines.length ? lines : fallbackRows;

  return (
    <section className="overflow-hidden rounded-md border" style={{ borderColor: "var(--color-border)" }}>
      <div className="border-b px-3 py-2.5" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>Cosa ha trovato il sistema</div>
            <div className="mt-0.5 text-[13px] font-semibold">{email ? "Fonte e dati estratti dalla stessa email" : "Dati disponibili prima del collegamento"}</div>
          </div>
          {email && (
            <button type="button" onClick={onOpenSource} className="shrink-0 text-[11px] font-semibold hover:underline" style={{ color: "var(--color-accent)" }}>
              Apri fonte
            </button>
          )}
        </div>
      </div>

      {email && (
        <div className="space-y-1 px-3 py-2.5 text-[12px]">
          <div className="font-semibold" style={{ color: "var(--color-text)" }}>{email.subject || "Email senza oggetto"}</div>
          <div className="flex flex-wrap gap-x-2 gap-y-1" style={{ color: "var(--color-text-muted)" }}>
            {!isOther && email.from && <span>Da: {email.from}</span>}
            {email.receivedAt && <span>{formatDate(email.receivedAt)}</span>}
            {email.classification && <span>Classificazione: {email.classification}</span>}
          </div>
          {isOther && <div style={{ color: "var(--color-text-muted)" }}>Contenuto non esposto: email classificata come non operativa.</div>}
        </div>
      )}

      {documents.length > 0 && (
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
          <div className="text-[11px] font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>Documenti rilevati</div>
          <div className="mt-1 space-y-1">
            {documents.map((document) => (
              <div key={document.id} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate font-medium">{document.name || "Documento senza nome"}</span>
                <span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>{document.type || "Documento"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 ? (
        <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>
            {email ? "Righe estratte" : "Dati rilevati"} ({rows.length})
          </div>
          <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {rows.map((line, index) => {
              const confidence = Number(line.confidence);
              return (
                <div key={line.id || `${line.description || "dato"}-${index}`} className="px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold">{line.description || "Descrizione non riconosciuta"}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                        {(line.itemCode || line.item_code) && <span>Cod. {line.itemCode || line.item_code}</span>}
                        {line.quantity && <span>{line.quantity}{line.unit ? ` ${line.unit}` : ""}</span>}
                        {(line.dueDate || line.requiredDate || line.due_date || line.required_date) && <span>Data {formatDate(line.dueDate || line.requiredDate || line.due_date || line.required_date)}</span>}
                      </div>
                    </div>
                    {Number.isFinite(confidence) && (
                      <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold" style={{ borderColor: "var(--color-border)", color: confidence < 0.85 ? "var(--color-warning)" : "var(--color-success)" }}>
                        {Math.round(confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        !isOther && <div className="border-t px-3 py-2 text-[12px]" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>Nessuna riga materiale strutturata estratta da questa email.</div>
      )}
    </section>
  );
}

function MaterialLineRow({ line, compact = false, onVerify, onLink, disabled = false }) {
  const quantity = line.quantity
    ? `${line.quantity}${line.unit ? ` ${line.unit}` : ""}`
    : "Quantità non indicata";
  return (
    <div className={`flex items-center gap-3 border-b last:border-b-0 ${compact ? "px-3 py-2" : "px-3 py-3"}`} style={{ borderColor: "var(--color-border)" }}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{line.title || "Materiale senza descrizione"}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          {line.itemCode && <span>Cod. {line.itemCode}</span>}
          <span>{quantity}</span>
          {line.lineStatus && <span>{line.lineStatus}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[12px] font-medium">{line.dueDate ? formatDate(line.dueDate) : "Data n.d."}</div>
        {onVerify && (
          <button
            type="button"
            onClick={onVerify}
            disabled={disabled}
            className="mt-1 text-[11px] font-semibold hover:underline disabled:opacity-50"
            style={{ color: "var(--color-warning)" }}
          >
            Verifica riga
          </button>
        )}
        {onLink && (
          <button
            type="button"
            onClick={onLink}
            disabled={disabled}
            className="mt-1 block text-[11px] font-semibold hover:underline disabled:opacity-50"
            style={{ color: "var(--color-accent)" }}
          >
            Collega riga
          </button>
        )}
      </div>
    </div>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>{label}</div>
      <div className="mt-1 text-sm font-medium">{value || "-"}</div>
    </div>
  );
}

function FilterChip({ label, value, active, tone, onClick }) {
  const color = toneColor(tone);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition"
      style={{
        borderColor: active ? color : "var(--color-border)",
        backgroundColor: active ? `color-mix(in srgb, ${color} 10%, white)` : "transparent",
        color: active ? color : "var(--color-text)"
      }}
    >
      {label}
      <span className="rounded-full px-1.5 py-0.5 text-[11px]" style={{ backgroundColor: active ? `color-mix(in srgb, ${color} 18%, white)` : "var(--color-muted)", color: active ? color : "var(--color-text-muted)" }}>
        {value}
      </span>
    </button>
  );
}

function SecondaryPanel({ icon: Icon, title, actionLabel, onAction, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-white shadow-soft" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4" style={{ color: "var(--color-text-muted)" }} />
          <h2 className="truncate text-[14px] font-semibold">{title}</h2>
        </div>
        {actionLabel && (
          <button type="button" onClick={onAction} className="inline-flex items-center gap-1 text-[12.5px] font-semibold hover:underline" style={{ color: "var(--color-accent)" }}>
            {actionLabel}
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function EmptyMini({ text }) {
  return (
    <div className="px-2 py-4 text-sm" style={{ color: "var(--color-text-muted)" }}>{text}</div>
  );
}
