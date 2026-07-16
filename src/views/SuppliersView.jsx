import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Clock3,
  Mail,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  Users
} from "lucide-react";
import Button from "../components/Button";
import StatusBadge from "../components/StatusBadge";
import { formatPercent } from "../utils/formatters";
import { formatDate } from "../utils/dateUtils";

const CLOSED_STATUSES = new Set(["closed", "ricevuto", "annullato", "ok", "completato", "consegnato"]);
const CRITICAL_STATUSES = new Set(["critical", "critico", "overdue", "scaduto", "late", "in ritardo"]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function supplierMatch(item, supplier) {
  if (!item || !supplier) return false;
  if (item.supplierId && item.supplierId === supplier.id) return true;
  return Boolean(item.supplierName && normalize(item.supplierName) === normalize(supplier.name));
}

function isClosed(order) {
  return CLOSED_STATUSES.has(String(order?.status || "").trim().toLowerCase());
}

function isCritical(item) {
  return CRITICAL_STATUSES.has(String(item?.status || "").trim().toLowerCase());
}

function latestDate(values) {
  const valid = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b - a);
  return valid[0] || null;
}

function relativeDate(value) {
  if (!value) return "Nessuna attivita";
  const days = Math.max(0, Math.floor((Date.now() - value.getTime()) / 86400000));
  if (days === 0) return "Oggi";
  if (days === 1) return "Ieri";
  return `${days} giorni fa`;
}

function enrichSuppliers(suppliers, orders, materialLines, activities) {
  return suppliers.map((supplier) => {
    const supplierOrders = orders.filter((item) => supplierMatch(item, supplier));
    const supplierLines = materialLines.filter((item) => supplierMatch(item, supplier));
    const supplierActivities = activities.filter((item) => supplierMatch(item, supplier));
    const openOrders = supplierOrders.filter((item) => !isClosed(item));
    const completedOrders = supplierOrders.filter(isClosed);
    const criticalItems = [...openOrders, ...supplierLines].filter(isCritical);
    const lastActivity = latestDate([
      ...supplierActivities.map((item) => item.date || item.createdAt),
      ...supplierLines.map((item) => item.createdAt),
      ...supplierOrders.map((item) => item.createdAt || item.orderDate)
    ]);

    return {
      ...supplier,
      supplierOrders,
      supplierLines,
      supplierActivities,
      openOrderCount: openOrders.length,
      completedOrderCount: completedOrders.length,
      materialCount: supplierLines.length,
      criticalCount: criticalItems.length,
      lastActivity,
      hasOperationalHistory: supplierOrders.length > 0 || supplierLines.length > 0
    };
  });
}

export default function SuppliersView({
  config,
  suppliers,
  supplierContacts = [],
  materialLines = [],
  orders = [],
  activities = [],
  onSupplierAction
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("operational");
  const [query, setQuery] = useState("");

  const enriched = useMemo(
    () => enrichSuppliers(suppliers, orders, materialLines, activities),
    [suppliers, orders, materialLines, activities]
  );
  const selected = enriched.find((item) => item.id === selectedId) || null;

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);

  const counts = useMemo(() => ({
    operational: enriched.filter((item) => item.registryStatus !== "candidate" && item.hasOperationalHistory).length,
    registry: enriched.filter((item) => item.registryStatus !== "candidate").length,
    review: enriched.filter((item) => item.registryStatus === "candidate").length
  }), [enriched]);

  const visible = useMemo(() => {
    const needle = normalize(query);
    return enriched
      .filter((item) => {
        if (view === "operational") return item.registryStatus !== "candidate" && item.hasOperationalHistory;
        if (view === "review") return item.registryStatus === "candidate";
        return item.registryStatus !== "candidate";
      })
      .filter((item) => !needle || normalize(`${item.name} ${item.email || ""}`).includes(needle))
      .sort((a, b) => {
        if (a.criticalCount !== b.criticalCount) return b.criticalCount - a.criticalCount;
        if (a.openOrderCount !== b.openOrderCount) return b.openOrderCount - a.openOrderCount;
        return a.name.localeCompare(b.name, "it");
      });
  }, [enriched, query, view]);

  if (selected) {
    return (
      <SupplierProfile
        supplier={selected}
        terminology={config.terminology}
        contacts={supplierContacts.filter((item) => item.supplierId === selected.id)}
        onBack={() => setSelectedId(null)}
        onSupplierAction={onSupplierAction}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-1 pb-10">
      <header className="flex flex-col gap-5 border-b pb-5 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>{config.terminology.suppliersPlural}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Contatti, ordini e materiali raccolti in un'unica anagrafica.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca fornitore"
            className="h-10 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--color-border)", "--tw-ring-color": "color-mix(in srgb, var(--color-primary) 20%, transparent)" }}
          />
        </div>
      </header>

      <nav className="flex gap-6 overflow-x-auto border-b" style={{ borderColor: "var(--color-border)" }} aria-label="Viste fornitori">
        <ViewTab active={view === "operational"} onClick={() => setView("operational")} label="Operativi" count={counts.operational} />
        <ViewTab active={view === "registry"} onClick={() => setView("registry")} label="Anagrafica" count={counts.registry} />
        <ViewTab active={view === "review"} onClick={() => setView("review")} label="Da verificare" count={counts.review} />
      </nav>

      <div className="mt-3 hidden grid-cols-[minmax(240px,1.5fr)_120px_150px_140px_32px] gap-4 px-4 py-2 text-xs font-semibold uppercase md:grid" style={{ color: "var(--color-text-muted)" }}>
        <span>Fornitore</span>
        <span>Ordini aperti</span>
        <span>Materiali rilevati</span>
        <span>Ultima attivita</span>
        <span />
      </div>

      <div className="divide-y border-y" style={{ borderColor: "var(--color-border)" }}>
        {visible.map((supplier) => (
          <button
            key={supplier.id}
            type="button"
            onClick={() => setSelectedId(supplier.id)}
            className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--color-muted)] md:grid-cols-[minmax(240px,1.5fr)_120px_150px_140px_32px]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold" style={{ color: "var(--color-text)" }}>{supplier.name}</span>
                {supplier.registryStatus === "candidate" && <RegistryBadge>Da verificare</RegistryBadge>}
                {supplier.criticalCount > 0 && <RegistryBadge tone="danger">{supplier.criticalCount} criticita</RegistryBadge>}
              </div>
              {supplier.email && (
                <div className="mt-0.5 truncate text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                  {supplier.email}
                </div>
              )}
            </div>
            <Metric value={supplier.openOrderCount} empty="Nessuno" />
            <Metric value={supplier.materialCount} empty="Nessuno" />
            <span className="hidden text-sm md:block" style={{ color: "var(--color-text-muted)" }}>{relativeDate(supplier.lastActivity)}</span>
            <ChevronRight className="h-4 w-4" style={{ color: "var(--color-text-muted)" }} />
          </button>
        ))}
        {!visible.length && (
          <div className="px-6 py-14 text-center">
            <div className="font-medium">Nessun fornitore in questa vista</div>
            <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {query ? "Prova a modificare la ricerca." : "I nuovi soggetti da controllare compariranno qui."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SupplierProfile({ supplier, terminology, contacts, onBack, onSupplierAction }) {
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ email: supplier.email || "", phone: supplier.phone || "", notes: supplier.notes || "" });
  const [newContact, setNewContact] = useState({ name: "", email: "", role: "" });
  const [addingContact, setAddingContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft({ email: supplier.email || "", phone: supplier.phone || "", notes: supplier.notes || "" });
    setEditing(false);
    setMessage("");
  }, [supplier.id, supplier.email, supplier.phone, supplier.notes]);

  async function run(action, payload, successMessage) {
    if (!onSupplierAction) return;
    setBusy(true);
    setMessage("");
    try {
      await onSupplierAction({ action, ...payload });
      setMessage(successMessage);
    } catch (error) {
      setMessage(`Errore: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveSupplier() {
    await run("update", { id: supplier.id, ...draft }, "Fornitore aggiornato.");
    setEditing(false);
  }

  async function addContact() {
    if (!newContact.email.trim()) {
      setMessage("Errore: inserisci almeno l'email del contatto.");
      return;
    }
    await run("add_contact", { supplierId: supplier.id, ...newContact }, "Contatto aggiunto.");
    setNewContact({ name: "", email: "", role: "" });
    setAddingContact(false);
  }

  const tabs = [
    ["overview", "Panoramica"],
    ["orders", `${terminology.ordersPlural} (${supplier.supplierOrders.length})`],
    ["materials", `Materiali (${supplier.supplierLines.length})`],
    ["contacts", `Contatti (${contacts.length})`],
    ["activity", "Attivita"]
  ];

  return (
    <div className="mx-auto w-full max-w-[1280px] pb-12">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--color-text-muted)" }}>
        <ArrowLeft className="h-4 w-4" /> Torna ai fornitori
      </button>

      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{supplier.name}</h1>
            {supplier.registryStatus === "candidate" && <RegistryBadge>Da verificare</RegistryBadge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4" />{supplier.email || "Email non disponibile"}</span>
            <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{supplier.phone || "Telefono non disponibile"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {supplier.registryStatus === "candidate" && onSupplierAction && (
            <>
              <Button onClick={() => run("update", { id: supplier.id, registryStatus: "verified" }, "Fornitore confermato.")} disabled={busy}>Conferma fornitore</Button>
              <Button variant="secondary" onClick={() => run("update", { id: supplier.id, registryStatus: "ignored" }, "Soggetto rimosso dall'anagrafica.")} disabled={busy}>Ignora</Button>
            </>
          )}
          {supplier.registryStatus !== "candidate" && onSupplierAction && (
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}><Pencil className="h-4 w-4" /> Modifica</Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 border-b py-5 sm:grid-cols-4" style={{ borderColor: "var(--color-border)" }}>
        <SummaryMetric icon={PackageCheck} label="Ordini aperti" value={supplier.openOrderCount} />
        <SummaryMetric icon={AlertTriangle} label="Criticita" value={supplier.criticalCount} tone={supplier.criticalCount ? "danger" : null} />
        <SummaryMetric icon={Users} label="Contatti" value={contacts.length} />
        <SummaryMetric icon={Clock3} label="Ultima attivita" value={relativeDate(supplier.lastActivity)} />
      </div>

      <nav className="flex gap-6 overflow-x-auto border-b" style={{ borderColor: "var(--color-border)" }}>
        {tabs.map(([key, label]) => <ViewTab key={key} active={tab === key} onClick={() => setTab(key)} label={label} />)}
      </nav>

      {message && (
        <div className="mt-5 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: "var(--color-muted)", color: message.startsWith("Errore") ? "var(--color-danger)" : "var(--color-text)" }}>{message}</div>
      )}

      {editing && (
        <section className="mt-6 max-w-2xl border-b pb-6" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="font-semibold">Dati principali</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Email" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} />
            <Field label="Telefono" value={draft.phone} onChange={(phone) => setDraft({ ...draft, phone })} />
            <label className="sm:col-span-2"><span className="text-sm font-semibold">Note</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="mt-1 h-24 w-full rounded-md border p-2 text-sm" style={{ borderColor: "var(--color-border)" }} /></label>
          </div>
          <div className="mt-3 flex gap-2"><Button onClick={saveSupplier} disabled={busy}>Salva</Button><Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Annulla</Button></div>
        </section>
      )}

      <div className="pt-7">
        {tab === "overview" && <Overview supplier={supplier} contacts={contacts} />}
        {tab === "orders" && <OrdersList orders={supplier.supplierOrders} />}
        {tab === "materials" && <MaterialsList lines={supplier.supplierLines} />}
        {tab === "contacts" && (
          <ContactsList
            contacts={contacts}
            adding={addingContact}
            setAdding={setAddingContact}
            draft={newContact}
            setDraft={setNewContact}
            addContact={addContact}
            run={run}
            busy={busy}
            editable={Boolean(onSupplierAction)}
          />
        )}
        {tab === "activity" && <ActivityList activities={supplier.supplierActivities} />}
      </div>
    </div>
  );
}

function Overview({ supplier, contacts }) {
  const primary = contacts.find((item) => item.isPrimary) || contacts[0];
  const hasReliableHistory = supplier.completedOrderCount >= 3;
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <SectionTitle>Situazione operativa</SectionTitle>
        <InfoRow label="Ordini registrati" value={supplier.supplierOrders.length} />
        <InfoRow label="Materiali rilevati" value={supplier.materialCount} />
        <InfoRow label="Puntualita" value={hasReliableHistory ? formatPercent(supplier.onTimeRate) : "Dati insufficienti"} />
        <InfoRow label="Livello di rischio" value={hasReliableHistory ? supplier.risk || "Non calcolato" : "Dati insufficienti"} />
      </section>
      <section>
        <SectionTitle>Riferimenti</SectionTitle>
        <InfoRow label="Contatto principale" value={primary?.name || primary?.email || "Non impostato"} />
        <InfoRow label="Email" value={primary?.email || supplier.email || "Non disponibile"} />
        <InfoRow label="Ultimo aggiornamento" value={relativeDate(supplier.lastActivity)} />
        {supplier.notes && <p className="mt-5 border-l-2 pl-3 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>{supplier.notes}</p>}
      </section>
    </div>
  );
}

function OrdersList({ orders }) {
  if (!orders.length) return <EmptyState text="Nessun ordine collegato a questo fornitore." />;
  return <div className="divide-y border-y" style={{ borderColor: "var(--color-border)" }}>{orders.map((order) => <div key={order.id} className="grid gap-2 px-3 py-4 sm:grid-cols-[150px_1fr_130px_120px] sm:items-center"><strong>{order.orderCode || "Senza codice"}</strong><span>{order.material || "Materiale non specificato"}</span><span className="text-sm" style={{ color: "var(--color-text-muted)" }}>{formatDate(order.dueDate) || "Senza data"}</span><StatusBadge status={order.status} /></div>)}</div>;
}

function MaterialsList({ lines }) {
  if (!lines.length) return <EmptyState text="Nessuna riga materiale collegata a questo fornitore." />;
  return <div className="divide-y border-y" style={{ borderColor: "var(--color-border)" }}>{lines.map((line) => <div key={line.id} className="grid gap-2 px-3 py-4 sm:grid-cols-[1fr_120px_140px_120px] sm:items-center"><div><strong>{line.description || "Materiale"}</strong><div className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{line.orderCode || line.sourceType || "Origine non indicata"}</div></div><span>{line.quantity ? `${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : "-"}</span><span className="text-sm" style={{ color: "var(--color-text-muted)" }}>{formatDate(line.dueDate || line.requiredDate) || "Senza data"}</span><StatusBadge status={line.status} /></div>)}</div>;
}

function ContactsList({ contacts, adding, setAdding, draft, setDraft, addContact, run, busy, editable }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between"><SectionTitle>Contatti del fornitore</SectionTitle>{editable && !adding && <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Aggiungi</Button>}</div>
      {adding && <div className="mb-6 grid gap-3 border-b pb-6 sm:grid-cols-3" style={{ borderColor: "var(--color-border)" }}><Field label="Nome" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} /><Field label="Email *" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} /><Field label="Ruolo" value={draft.role} onChange={(role) => setDraft({ ...draft, role })} /><div className="flex gap-2 sm:col-span-3"><Button onClick={addContact} disabled={busy}>Salva contatto</Button><Button variant="secondary" onClick={() => setAdding(false)}>Annulla</Button></div></div>}
      {!contacts.length ? <EmptyState text="Nessun contatto salvato." /> : <div className="divide-y border-y" style={{ borderColor: "var(--color-border)" }}>{contacts.map((contact) => <div key={contact.id} className="flex items-center justify-between gap-4 px-3 py-4"><div className="min-w-0"><div className="flex items-center gap-2 font-semibold">{contact.isPrimary && <Star className="h-4 w-4" fill="currentColor" style={{ color: "var(--color-warning)" }} />}{contact.name || contact.email}</div><div className="mt-1 truncate text-sm" style={{ color: "var(--color-text-muted)" }}>{contact.email}{contact.role ? ` · ${contact.role}` : ""}</div></div>{editable && <div className="flex gap-1">{!contact.isPrimary && <button type="button" title="Imposta come principale" onClick={() => run("update_contact", { id: contact.id, isPrimary: true }, "Contatto principale aggiornato.")} className="rounded p-2 hover:bg-[color:var(--color-muted)]"><Star className="h-4 w-4" /></button>}<button type="button" title="Elimina contatto" onClick={() => run("delete_contact", { id: contact.id }, "Contatto eliminato.")} className="rounded p-2 hover:bg-[color:var(--color-muted)]"><Trash2 className="h-4 w-4" style={{ color: "var(--color-danger)" }} /></button></div>}</div>)}</div>}
    </div>
  );
}

function ActivityList({ activities }) {
  if (!activities.length) return <EmptyState text="Nessuna attivita registrata." />;
  return <div className="divide-y border-y" style={{ borderColor: "var(--color-border)" }}>{activities.map((activity) => <div key={activity.id} className="px-3 py-4"><div className="font-semibold">{activity.title}</div><div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>{activity.detail || activity.type}</div></div>)}</div>;
}

function ViewTab({ active, onClick, label, count }) {
  return <button type="button" onClick={onClick} className="whitespace-nowrap border-b-2 px-1 py-3 text-sm font-semibold" style={{ borderColor: active ? "var(--color-primary)" : "transparent", color: active ? "var(--color-primary)" : "var(--color-text-muted)" }}>{label}{count !== undefined ? ` ${count}` : ""}</button>;
}

function RegistryBadge({ children, tone = "warning" }) {
  return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, var(--color-${tone}) 13%, white)`, color: `var(--color-${tone})` }}>{children}</span>;
}

function Metric({ value, empty }) {
  return <span className="hidden text-sm font-medium md:block" style={{ color: value ? "var(--color-text)" : "var(--color-text-muted)" }}>{value || empty}</span>;
}

function SummaryMetric({ icon: Icon, label, value, tone }) {
  return <div className="border-r px-3 py-2 last:border-r-0 sm:px-5" style={{ borderColor: "var(--color-border)" }}><div className="flex items-center gap-2 text-xs sm:text-sm" style={{ color: "var(--color-text-muted)" }}><Icon className="h-4 w-4" />{label}</div><div className="mt-2 text-lg font-semibold sm:text-xl" style={{ color: tone ? `var(--color-${tone})` : "var(--color-text)" }}>{value}</div></div>;
}

function SectionTitle({ children }) {
  return <h2 className="text-sm font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>{children}</h2>;
}

function InfoRow({ label, value }) {
  return <div className="flex items-start justify-between gap-6 border-b py-3 text-sm" style={{ borderColor: "var(--color-border)" }}><span style={{ color: "var(--color-text-muted)" }}>{label}</span><strong className="text-right">{value}</strong></div>;
}

function Field({ label, value, onChange }) {
  return <label><span className="text-sm font-semibold">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border px-3 text-sm" style={{ borderColor: "var(--color-border)" }} /></label>;
}

function EmptyState({ text }) {
  return <div className="border-y px-4 py-12 text-center text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>{text}</div>;
}
