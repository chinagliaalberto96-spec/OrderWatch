import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Database,
  Mail,
  ShieldCheck,
  SlidersHorizontal,
  Workflow,
  XCircle
} from "lucide-react";
import Card from "../components/Card";
import { formatDate } from "../utils/dateUtils";

const channelStatus = {
  active: { label: "Attivo", tone: "success" },
  planned: { label: "Pronto per attivazione", tone: "warning" },
  manual: { label: "Gestione manuale", tone: "muted" }
};

function StatBox({ label, value, tone = "text", icon: Icon }) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {label}
        </div>
        {Icon && <Icon className="h-4 w-4" style={{ color: `var(--color-${tone})` }} />}
      </div>
      <div className="mt-2 text-2xl font-semibold" style={{ color: `var(--color-${tone})` }}>
        {value}
      </div>
    </div>
  );
}

function HealthRow({ label, description, status, tone = "success", icon: Icon = CheckCircle2 }) {
  return (
    <div className="grid grid-cols-[22px_1fr_150px] items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <Icon className="h-4 w-4" style={{ color: `var(--color-${tone})` }} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </div>
      </div>
      <span
        className="inline-flex justify-center rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{
          backgroundColor: `color-mix(in srgb, var(--color-${tone}) 13%, white)`,
          color: `var(--color-${tone})`
        }}
      >
        {status}
      </span>
    </div>
  );
}

function NotificationRow({ name, trigger, channel, status }) {
  const meta = channelStatus[status] || channelStatus.manual;

  return (
    <div className="grid grid-cols-[1.2fr_1.4fr_150px_170px] items-center gap-3 border-b py-3 text-sm last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <div className="font-semibold">{name}</div>
      <div style={{ color: "var(--color-text-muted)" }}>{trigger}</div>
      <div>{channel}</div>
      <span
        className="inline-flex justify-center rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{
          backgroundColor: `color-mix(in srgb, var(--color-${meta.tone}) 13%, white)`,
          color: `var(--color-${meta.tone})`
        }}
      >
        {meta.label}
      </span>
    </div>
  );
}

function formatTime(value) {
  if (!value) return "-";
  return value.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function getLatestDate(rows = [], key) {
  const timestamps = rows
    .map((row) => (row[key] ? new Date(row[key]).getTime() : 0))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);

  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps));
}

export default function SettingsView({ config, data = {}, meta = {} }) {
  const activeModules = Object.entries(config.modules).filter(([, active]) => active);
  const { mode, lastUpdated, counts = {} } = meta;
  const processedEmails = data.processedEmails || [];
  const orders = data.orders || [];
  const documents = data.documents || [];
  const latestImport = getLatestDate(processedEmails, "receivedAt");
  const latestActivity = getLatestDate(data.activities || [], "date");
  const doneImports = processedEmails.filter((email) => email.status === "Done").length;
  const processingImports = processedEmails.filter((email) => email.status?.trim() === "Processing").length;
  const errorImports = processedEmails.filter((email) => email.status === "Error").length;
  const reviewDocuments = documents.filter((document) => document.needsHumanReview).length;
  const lowConfidenceOrders = orders.filter((order) => Number(order.aiConfidence || 1) < 0.7 || order.needsReview).length;
  const reviewTotal = counts.review ?? reviewDocuments + lowConfidenceOrders;
  const monitoredMailbox = "Da collegare: mailbox Graphic Center";
  const isLive = mode !== "mock";
  const errorTone = errorImports ? "danger" : "success";

  const healthRows = [
    {
      label: "Dashboard",
      description: "Frontend Vercel e API dashboard disponibili",
      status: "Online",
      tone: "success",
      icon: CheckCircle2
    },
    {
      label: "Airtable",
      description: "Base dati collegata alla dashboard",
      status: isLive ? "Live" : "Demo",
      tone: isLive ? "success" : "warning",
      icon: Database
    },
    {
      label: "Make",
      description: "Scenario pronto con controllo duplicati e gestione errori critici",
      status: "Pronto",
      tone: "success",
      icon: Workflow
    },
    {
      label: "Mailbox monitorata",
      description: monitoredMailbox,
      status: "Da collegare",
      tone: "warning",
      icon: Mail
    },
    {
      label: "Notifiche",
      description: "Regole definite; invio automatico da attivare dopo test reali",
      status: "Pianificate",
      tone: "warning",
      icon: Bell
    }
  ];

  const notificationRules = [
    {
      name: "Ordine critico",
      trigger: `Mancano ${config.alertRules.criticalDays} giorni o meno alla scadenza`,
      channel: "Dashboard",
      status: "active"
    },
    {
      name: "Sollecito fornitore",
      trigger: `${config.alertRules.reminderDaysBeforeDue} giorni prima della scadenza`,
      channel: "Email/Make",
      status: "planned"
    },
    {
      name: "Escalation interna",
      trigger: `${config.alertRules.escalationDaysBeforeDue} giorno prima della scadenza`,
      channel: "Email responsabile",
      status: "planned"
    },
    {
      name: "Importazione fallita",
      trigger: "Record Processed Emails in Error",
      channel: "Dashboard",
      status: "active"
    },
    {
      name: "Processing bloccato",
      trigger: "Email ferma in lavorazione oltre soglia operativa",
      channel: "Controllo manuale",
      status: "manual"
    }
  ];

  return (
    <div className="mx-auto max-w-[1540px] space-y-5">
      <section className="rounded-lg border bg-white px-5 py-4 shadow-soft" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Console operativa</div>
            <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Stato backend, importazioni, regole e notifiche del pilota {config.company.name}.
            </div>
          </div>
          <div
            className="rounded-md border px-3 py-2 text-sm font-semibold"
            style={{
              borderColor: "var(--color-border)",
              color: isLive ? "var(--color-success)" : "var(--color-warning)",
              backgroundColor: "var(--color-muted)"
            }}
          >
            {isLive ? "Ambiente live" : "Ambiente demo"}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatBox label="Ultimo refresh dashboard" value={formatTime(lastUpdated)} icon={Clock3} tone="primary" />
        <StatBox label="Ultima email importata" value={latestImport ? formatDate(latestImport) : "-"} icon={Mail} tone="primary" />
        <StatBox label="Da verificare" value={reviewTotal} icon={AlertTriangle} tone={reviewTotal ? "danger" : "success"} />
        <StatBox label="Importazioni in errore" value={errorImports} icon={errorImports ? XCircle : ShieldCheck} tone={errorTone} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card title="Stato sistema">
          <div>
            {healthRows.map((row) => (
              <HealthRow key={row.label} {...row} />
            ))}
          </div>
        </Card>

        <Card title="Importazioni">
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Completate" value={doneImports} icon={CheckCircle2} tone="success" />
            <StatBox label="In lavorazione" value={processingImports} icon={Clock3} tone={processingImports ? "warning" : "text"} />
            <StatBox label="Errori" value={errorImports} icon={XCircle} tone={errorTone} />
          </div>
          <div className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
            <div className="font-semibold">Regola anti-duplicati</div>
            <div className="mt-1" style={{ color: "var(--color-text-muted)" }}>
              Ogni email viene controllata tramite Message ID prima di essere processata. Se e' gia' presente, Make ferma il flusso.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Notifiche e automazioni">
        <div>
          {notificationRules.map((rule) => (
            <NotificationRow key={rule.name} {...rule} />
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card title="Soglie operative">
          <div className="grid grid-cols-5 gap-3 text-sm">
            {Object.entries(config.alertRules).map(([key, value]) => (
              <div key={key} className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
                <div style={{ color: "var(--color-text-muted)" }}>{key}</div>
                <div className="mt-1 text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Configurazione cliente">
          <dl className="grid grid-cols-[170px_1fr] gap-x-4 gap-y-3 text-sm">
            <dt style={{ color: "var(--color-text-muted)" }}>Prodotto</dt>
            <dd className="font-medium">{config.product.name}</dd>
            <dt style={{ color: "var(--color-text-muted)" }}>Azienda</dt>
            <dd className="font-medium">{config.company.name}</dd>
            <dt style={{ color: "var(--color-text-muted)" }}>Settore</dt>
            <dd className="font-medium">{config.company.sector}</dd>
            <dt style={{ color: "var(--color-text-muted)" }}>Mailbox</dt>
            <dd className="font-medium">{monitoredMailbox}</dd>
            <dt style={{ color: "var(--color-text-muted)" }}>Ultima attivita'</dt>
            <dd className="font-medium">{latestActivity ? formatDate(latestActivity) : "-"}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Moduli attivi">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {activeModules.map(([module]) => (
            <div
              key={module}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--color-border)" }}
            >
              <SlidersHorizontal className="h-4 w-4" style={{ color: "var(--color-primary)" }} />
              {module}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
