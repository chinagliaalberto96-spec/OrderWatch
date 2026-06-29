import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Mail,
  SlidersHorizontal,
  Workflow
} from "lucide-react";
import { useState } from "react";
import { formatDate } from "../utils/dateUtils";

const channelStatus = {
  active: { label: "Attivo", tone: "success" },
  planned: { label: "Pronto per attivazione", tone: "warning" },
  manual: { label: "Gestione manuale", tone: "muted" }
};

const thresholdLabels = {
  warningDays: { label: "Soglia attenzione", unit: "giorni" },
  criticalDays: { label: "Soglia critica", unit: "giorni" },
  overdueDays: { label: "Soglia scaduto", unit: "giorni" },
  reminderDaysBeforeDue: { label: "Promemoria fornitore", unit: "giorni prima" },
  escalationDaysBeforeDue: { label: "Escalation interna", unit: "giorni prima" }
};

// Sezione richiudibile in stile pannello admin: header a riga con chevron,
// contenuto nascosto di default tranne dove serve lettura immediata
// (vedi defaultOpen sotto). Nessuna card annidata: il contenitore esterno
// unico fa da cornice, ogni sezione e' solo una riga + corpo.
function Section({ title, hint, defaultOpen = false, right, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
          )}
          <span className="truncate text-[14px] font-semibold" style={{ color: "var(--color-text)" }}>
            {title}
          </span>
          {hint && (
            <span className="truncate text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              {hint}
            </span>
          )}
        </span>
        {right}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function StatInline({ label, value, tone = "text" }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      <span className="text-[13.5px] font-semibold tabular-nums" style={{ color: `var(--color-${tone})` }}>
        {value}
      </span>
    </div>
  );
}

function HealthRow({ label, description, status, tone = "success", icon: Icon = CheckCircle2 }) {
  return (
    <div className="grid grid-cols-[20px_1fr_140px] items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <Icon className="h-4 w-4" style={{ color: `var(--color-${tone})` }} />
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        <div className="mt-0.5 truncate text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </div>
      </div>
      <span className="justify-self-end text-[12.5px] font-semibold" style={{ color: `var(--color-${tone})` }}>
        {status}
      </span>
    </div>
  );
}

function NotificationRow({ name, trigger, channel, status }) {
  const meta = channelStatus[status] || channelStatus.manual;

  return (
    <div className="grid grid-cols-[1.1fr_1.5fr_140px_150px] items-center gap-3 border-b py-3 text-[13px] last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <div className="font-medium">{name}</div>
      <div className="truncate" style={{ color: "var(--color-text-muted)" }}>{trigger}</div>
      <div style={{ color: "var(--color-text-muted)" }}>{channel}</div>
      <span className="justify-self-end text-[12.5px] font-semibold" style={{ color: `var(--color-${meta.tone})` }}>
        {meta.label}
      </span>
    </div>
  );
}

function ThresholdRow({ label, unit, value }) {
  return (
    <div className="flex items-center justify-between border-b py-2.5 text-[13px] last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span className="font-semibold tabular-nums">
        {value} <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>{unit}</span>
      </span>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2.5 text-[13px] last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function SettingRow({ setting }) {
  const [expanded, setExpanded] = useState(false);
  const hasDescription = Boolean(setting.description);

  return (
    <div className="border-b py-2.5 text-[13px] last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <div className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="font-medium">{setting.settingKey}</div>
          {setting.group && (
            <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>{setting.group}</div>
          )}
        </div>
        <div className="min-w-0 truncate font-semibold">{String(setting.value)}</div>
        <div className="flex items-center justify-end gap-3">
          {setting.status && (
            <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>{setting.status}</span>
          )}
          {hasDescription && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="text-[11.5px] font-semibold underline-offset-2 hover:underline"
              style={{ color: "var(--color-primary)" }}
            >
              {expanded ? "Nascondi" : "Dettagli"}
            </button>
          )}
        </div>
      </div>
      {hasDescription && expanded && (
        <div className="mt-1.5 text-[12.5px] leading-5" style={{ color: "var(--color-text-muted)" }}>
          {setting.description}
        </div>
      )}
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

function parseSettingValue(setting) {
  if (!setting) return null;
  if (setting.type === "number") {
    const value = Number(setting.value);
    return Number.isFinite(value) ? value : null;
  }
  if (setting.type === "boolean") return setting.value === true || setting.value === "true";
  return setting.value;
}

export default function SettingsView({ config, data = {}, meta = {} }) {
  const activeModules = Object.entries(config.modules).filter(([, active]) => active);
  const { mode, lastUpdated, counts = {} } = meta;
  const processedEmails = data.processedEmails || [];
  const settings = data.settings || [];
  const settingsByKey = Object.fromEntries(settings.map((setting) => [setting.settingKey, setting]));
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
  const monitoredMailbox = parseSettingValue(settingsByKey["client.monitored_mailbox"]) || "Da collegare: mailbox Graphic Center";
  const alertRules = {
    warningDays: parseSettingValue(settingsByKey["alerts.warning_days"]) ?? config.alertRules.warningDays,
    criticalDays: parseSettingValue(settingsByKey["alerts.critical_days"]) ?? config.alertRules.criticalDays,
    overdueDays: parseSettingValue(settingsByKey["alerts.overdue_days"]) ?? config.alertRules.overdueDays,
    reminderDaysBeforeDue:
      parseSettingValue(settingsByKey["notifications.supplier_reminder_days_before_due"]) ?? config.alertRules.reminderDaysBeforeDue,
    escalationDaysBeforeDue:
      parseSettingValue(settingsByKey["notifications.escalation_days_before_due"]) ?? config.alertRules.escalationDaysBeforeDue
  };
  const customerVisibleSettings = settings.filter((setting) => setting.customerVisible !== "No");
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
      trigger: `Mancano ${alertRules.criticalDays} giorni o meno alla scadenza`,
      channel: "Dashboard",
      status: "active"
    },
    {
      name: "Sollecito fornitore",
      trigger: `${alertRules.reminderDaysBeforeDue} giorni prima della scadenza`,
      channel: "Email/Make",
      status: "planned"
    },
    {
      name: "Escalation interna",
      trigger: `${alertRules.escalationDaysBeforeDue} giorno prima della scadenza`,
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

  const clientInfoRows = [
    { label: "Prodotto", value: config.product.name },
    { label: "Azienda", value: config.company.name },
    { label: "Settore", value: config.company.sector },
    { label: "Mailbox", value: monitoredMailbox },
    { label: "Ultima attivita'", value: latestActivity ? formatDate(latestActivity) : "-" }
  ];

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: "var(--color-text)" }}>
            Impostazioni
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            Stato del sistema, importazioni e configurazione del pilota {config.company.name}.
          </p>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold"
          style={{ borderColor: "var(--color-border)", color: isLive ? "var(--color-success)" : "var(--color-warning)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--color-${isLive ? "success" : "warning"})` }} />
          {isLive ? "Ambiente live" : "Ambiente demo"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-white px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
        <StatInline label="Ultimo refresh" value={formatTime(lastUpdated)} tone="text" />
        <StatInline label="Ultima email importata" value={latestImport ? formatDate(latestImport) : "-"} tone="text" />
        <StatInline label="Da verificare" value={reviewTotal} tone={reviewTotal ? "danger" : "success"} />
        <StatInline label="Importazioni in errore" value={errorImports} tone={errorTone} />
      </div>

      <div className="divide-y rounded-lg border bg-white" style={{ borderColor: "var(--color-border)" }}>
        <Section title="Stato sistema" defaultOpen>
          <div>
            {healthRows.map((row) => (
              <HealthRow key={row.label} {...row} />
            ))}
          </div>
        </Section>

        <Section
          title="Importazioni"
          defaultOpen
          hint={`${doneImports} completate · ${processingImports} in lavorazione · ${errorImports} errori`}
        >
          <div className="rounded-md p-3 text-[12.5px]" style={{ backgroundColor: "var(--color-muted)" }}>
            <span className="font-semibold">Regola anti-duplicati. </span>
            <span style={{ color: "var(--color-text-muted)" }}>
              Ogni email viene controllata tramite Message ID prima di essere processata: se e' gia' presente, Make ferma il flusso.
            </span>
          </div>
        </Section>

        <Section title="Notifiche e automazioni" hint={`${notificationRules.length} regole`}>
          <div>
            {notificationRules.map((rule) => (
              <NotificationRow key={rule.name} {...rule} />
            ))}
          </div>
        </Section>

        <Section title="Soglie operative">
          <div>
            {Object.entries(alertRules).map(([key, value]) => {
              const meta = thresholdLabels[key] || { label: key, unit: "" };
              return <ThresholdRow key={key} label={meta.label} unit={meta.unit} value={value} />;
            })}
          </div>
        </Section>

        <Section title="Configurazione cliente">
          <div>
            {clientInfoRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </Section>

        <Section title="Settings da Airtable" hint={`${customerVisibleSettings.length} visibili`}>
          <div>
            {customerVisibleSettings.map((setting) => (
              <SettingRow key={setting.id} setting={setting} />
            ))}
            {!customerVisibleSettings.length && (
              <div className="py-4 text-center text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                Nessuna impostazione visibile.
              </div>
            )}
          </div>
        </Section>

        <Section title="Moduli attivi" hint={`${activeModules.length} attivi`}>
          <div className="flex flex-wrap gap-2">
            {activeModules.map(([module]) => (
              <span
                key={module}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium"
                style={{ borderColor: "var(--color-border)" }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: "var(--color-primary)" }} />
                {module}
              </span>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
