import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Check,
  Database,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Server,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Workflow,
  X
} from "lucide-react";
import { useState } from "react";
import { formatDate } from "../utils/dateUtils";
import { WORKFLOW_MODES } from "../config/workflowModes";

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
function Section({ id, title, hint, defaultOpen = false, right, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div id={id}>
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

const systemAlertMeta = {
  critical: { label: "Critico", tone: "danger" },
  warning: { label: "Attenzione", tone: "warning" },
  info: { label: "Informazione", tone: "primary" }
};

function SystemHealthAlertRow({ alert, onNavigate }) {
  const meta = systemAlertMeta[alert.severity] || systemAlertMeta.warning;

  const handleAction = () => {
    if (alert.targetView === "settings") {
      const anchorId = alert.category === "mailbox" ? "system-status-section" : "data-coverage-section";
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    onNavigate?.(alert.targetView);
  };

  return (
    <div className="grid gap-2 border-b py-3.5 last:border-b-0 md:grid-cols-[20px_minmax(0,1fr)_auto] md:gap-3" style={{ borderColor: "var(--color-border)" }}>
      <AlertTriangle className="mt-0.5 h-4 w-4" style={{ color: `var(--color-${meta.tone})` }} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-semibold">{alert.title}</span>
          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        </div>
        <div className="mt-1 text-[12.5px] leading-5" style={{ color: "var(--color-text-muted)" }}>
          {alert.message}
        </div>
        {alert.detectedAt && (
          <div className="mt-1 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            Rilevato: {formatDate(alert.detectedAt)}
          </div>
        )}
      </div>
      {alert.targetView && onNavigate && (
        <button
          type="button"
          onClick={handleAction}
          className="self-start rounded-md border px-3 py-1.5 text-[12px] font-semibold transition hover:bg-black/[0.02]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-primary)" }}
        >
          {alert.actionLabel || "Apri"}
        </button>
      )}
    </div>
  );
}

const coverageStatus = {
  available: { label: "Disponibile", tone: "success", icon: CheckCircle2 },
  partial: { label: "Parziale", tone: "warning", icon: AlertTriangle },
  unavailable: { label: "Non disponibile", tone: "danger", icon: AlertTriangle }
};

function CoverageRow({ item }) {
  const meta = coverageStatus[item.status] || coverageStatus.partial;
  const Icon = meta.icon;

  return (
    <div className="grid gap-2 border-b py-3.5 last:border-b-0 md:grid-cols-[20px_minmax(0,1fr)_150px] md:gap-3" style={{ borderColor: "var(--color-border)" }}>
      <Icon className="mt-0.5 h-4 w-4" style={{ color: `var(--color-${meta.tone})` }} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13.5px] font-semibold">{item.label}</span>
          <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>{item.category}</span>
        </div>
        <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          {item.message}
        </div>
        {item.limitation && (
          <div className="mt-1 text-[12.5px] font-medium" style={{ color: `var(--color-${meta.tone})` }}>
            Limite: {item.limitation}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 md:justify-self-end">
        <span className="text-[11.5px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
          {Math.round(item.reliability * 100)}%
        </span>
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
      </div>
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

function StatusPill({ children, tone = "muted" }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
      style={{ backgroundColor: `var(--color-${tone}-soft, var(--color-muted))`, color: `var(--color-${tone})` }}
    >
      {children}
    </span>
  );
}

function EmptyState({ children }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-5 text-center text-[13px]" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
      {children}
    </div>
  );
}

function UserAccessPanel({ users = [], onSaveAppUser }) {
  const [draft, setDraft] = useState({
    fullName: "",
    email: "",
    role: "Buyer",
    receivesDailyReport: true,
    canManageSettings: false,
    active: true
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (!onSaveAppUser) return;
    setSaving(true);
    setMessage("");

    try {
      await onSaveAppUser(draft);
      setDraft({
        fullName: "",
        email: "",
        role: "Buyer",
        receivesDailyReport: true,
        canManageSettings: false,
        active: true
      });
      setMessage("Utente salvato.");
    } catch (error) {
      setMessage(error.message || "Impossibile salvare l'utente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        {users.length ? (
          users.map((user) => (
            <div key={user.id || user.email} className="grid grid-cols-[20px_1fr_120px_150px] items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
              <UserRound className="h-4 w-4" style={{ color: "var(--color-primary)" }} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">{user.fullName}</div>
                <div className="truncate text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{user.email}</div>
              </div>
              <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{user.role}</span>
              <div className="justify-self-end">
                <StatusPill tone={user.active ? "success" : "muted"}>{user.active ? "Attivo" : "Disattivato"}</StatusPill>
              </div>
            </div>
          ))
        ) : (
          <EmptyState>Nessun utente configurato.</EmptyState>
        )}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 rounded-md p-3" style={{ backgroundColor: "var(--color-muted)" }}>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_130px]">
          <input
            value={draft.fullName}
            onChange={(event) => setDraft((value) => ({ ...value, fullName: event.target.value }))}
            placeholder="Nome e cognome"
            className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
            style={{ borderColor: "var(--color-border)" }}
          />
          <input
            value={draft.email}
            onChange={(event) => setDraft((value) => ({ ...value, email: event.target.value }))}
            placeholder="email@azienda.it"
            className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
            style={{ borderColor: "var(--color-border)" }}
          />
          <select
            value={draft.role}
            onChange={(event) => setDraft((value) => ({ ...value, role: event.target.value }))}
            className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
            style={{ borderColor: "var(--color-border)" }}
          >
            <option value="Buyer">Buyer</option>
            <option value="Admin">Admin</option>
            <option value="IT">IT</option>
            <option value="Owner">Owner</option>
            <option value="ReadOnly">ReadOnly</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.receivesDailyReport}
                onChange={(event) => setDraft((value) => ({ ...value, receivesDailyReport: event.target.checked }))}
              />
              Riceve report giornaliero
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.canManageSettings}
                onChange={(event) => setDraft((value) => ({ ...value, canManageSettings: event.target.checked }))}
              />
              Gestisce impostazioni
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {saving ? "Salvo" : "Aggiungi utente"}
          </button>
        </div>
        {message && <div className="text-[12px]" style={{ color: message.includes("Impossibile") ? "var(--color-danger)" : "var(--color-success)" }}>{message}</div>}
      </form>
    </div>
  );
}

function ReportRecipientsPanel({ recipients = [], onSaveReportRecipient, onDeleteReportRecipient }) {
  const [draft, setDraft] = useState({
    id: "",
    recipientName: "",
    email: "",
    role: "Buyer",
    active: true,
    dailyReport: true,
    channel: "email"
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (!onSaveReportRecipient) return;
    setSaving(true);
    setMessage("");

    try {
      await onSaveReportRecipient(draft);
      setDraft({
        id: "",
        recipientName: "",
        email: "",
        role: "Buyer",
        active: true,
        dailyReport: true,
        channel: "email"
      });
      setMessage("Destinatario report salvato.");
    } catch (error) {
      setMessage(error.message || "Impossibile salvare il destinatario.");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(recipient) {
    setMessage("");
    setDraft({
      id: recipient.id || "",
      recipientName: recipient.recipientName || "",
      email: recipient.email || "",
      role: recipient.role || "Buyer",
      active: recipient.active !== false,
      dailyReport: recipient.dailyReport !== false,
      channel: recipient.channel || "email"
    });
  }

  function cancelEdit() {
    setDraft({
      id: "",
      recipientName: "",
      email: "",
      role: "Buyer",
      active: true,
      dailyReport: true,
      channel: "email"
    });
    setMessage("");
  }

  async function handleDelete(recipient) {
    if (!onDeleteReportRecipient || !recipient?.id) return;
    const confirmed = window.confirm(`Rimuovere ${recipient.email} dai destinatari del report giornaliero?`);
    if (!confirmed) return;

    setDeletingId(recipient.id);
    setMessage("");

    try {
      await onDeleteReportRecipient(recipient.id);
      setMessage("Destinatario report rimosso.");
    } catch (error) {
      setMessage(error.message || "Impossibile rimuovere il destinatario.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        {recipients.length ? (
          recipients.map((recipient) => (
            <div key={recipient.id || recipient.email} className="grid grid-cols-[20px_1fr_110px_120px_150px] items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
              <Bell className="h-4 w-4" style={{ color: "var(--color-primary)" }} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">{recipient.recipientName}</div>
                <div className="truncate text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{recipient.email}</div>
              </div>
              <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{recipient.role}</span>
              <StatusPill tone={recipient.active && recipient.dailyReport ? "success" : "muted"}>
                {recipient.active && recipient.dailyReport ? "Riceve report" : "Disattivo"}
              </StatusPill>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => handleEdit(recipient)}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold underline-offset-2 hover:underline"
                  style={{ color: "var(--color-primary)" }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Modifica
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(recipient)}
                  disabled={deletingId === recipient.id}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold underline-offset-2 hover:underline disabled:opacity-60"
                  style={{ color: "var(--color-danger)" }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingId === recipient.id ? "Rimuovo" : "Rimuovi"}
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState>Nessun destinatario report configurato.</EmptyState>
        )}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 rounded-md p-3" style={{ backgroundColor: "var(--color-muted)" }}>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_130px]">
          <input
            value={draft.recipientName}
            onChange={(event) => setDraft((value) => ({ ...value, recipientName: event.target.value }))}
            placeholder="Nome destinatario"
            className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
            style={{ borderColor: "var(--color-border)" }}
          />
          <input
            value={draft.email}
            onChange={(event) => setDraft((value) => ({ ...value, email: event.target.value }))}
            placeholder="report@azienda.it"
            className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
            style={{ borderColor: "var(--color-border)" }}
          />
          <select
            value={draft.role}
            onChange={(event) => setDraft((value) => ({ ...value, role: event.target.value }))}
            className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
            style={{ borderColor: "var(--color-border)" }}
          >
            <option value="Buyer">Buyer</option>
            <option value="Owner">Owner</option>
            <option value="Administration">Amministrazione</option>
            <option value="Manager">Manager</option>
            <option value="Other">Altro</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.dailyReport}
                onChange={(event) => setDraft((value) => ({ ...value, dailyReport: event.target.checked }))}
              />
              Riceve report giornaliero
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft((value) => ({ ...value, active: event.target.checked }))}
              />
              Attivo
            </label>
          </div>
          <div className="flex items-center gap-2">
            {draft.id && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md border bg-white px-3 py-2 text-[12.5px] font-semibold"
                style={{ borderColor: "var(--color-border)" }}
              >
                Annulla
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded-md px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {saving ? "Salvo" : draft.id ? "Salva modifiche" : "Aggiungi destinatario"}
            </button>
          </div>
        </div>
        {message && <div className="text-[12px]" style={{ color: message.includes("Impossibile") ? "var(--color-danger)" : "var(--color-success)" }}>{message}</div>}
      </form>
    </div>
  );
}

const providerPresets = {
  Hostinger: {
    label: "Hostinger",
    hint: "Caselle dominio aziendale",
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    passwordLabel: "Password casella"
  },
  Gmail: {
    label: "Gmail / Google Workspace",
    hint: "Serve una password per app",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    passwordLabel: "Password per app Google"
  },
  Microsoft: {
    label: "Outlook / Microsoft 365",
    hint: "Account Microsoft aziendale",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    passwordLabel: "Password o app password"
  },
  Aruba: {
    label: "Aruba",
    hint: "Dominio o PEC Aruba",
    imapHost: "imaps.aruba.it",
    imapPort: 993,
    smtpHost: "smtps.aruba.it",
    smtpPort: 465,
    passwordLabel: "Password casella"
  },
  Zoho: {
    label: "Zoho Mail",
    hint: "Account Zoho aziendale",
    imapHost: "imap.zoho.eu",
    imapPort: 993,
    smtpHost: "smtp.zoho.eu",
    smtpPort: 465,
    passwordLabel: "Password o app password"
  },
  Other: {
    label: "Altro provider",
    hint: "Inserisci server manualmente",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
    passwordLabel: "Password casella"
  }
};

const mailboxRoles = [
  { value: "Owner", label: "Titolare / Owner", defaultName: "Mail titolare" },
  { value: "Administration", label: "Amministrazione", defaultName: "Mail amministrazione" },
  { value: "Purchasing", label: "Ufficio acquisti", defaultName: "Mail acquisti" },
  { value: "Suppliers", label: "Fornitori", defaultName: "Mail fornitori" },
  { value: "General", label: "Generale", defaultName: "Mail generale" },
  { value: "Other", label: "Altro", defaultName: "Nuova casella" }
];

function createMailboxDraft(role = "General", provider = "Hostinger") {
  const preset = providerPresets[provider];
  const roleMeta = mailboxRoles.find((item) => item.value === role) || mailboxRoles[4];

  return {
    mailboxName: roleMeta.defaultName,
    emailAddress: "",
    provider,
    role,
    imapHost: preset.imapHost,
    imapPort: preset.imapPort,
    smtpHost: preset.smtpHost,
    smtpPort: preset.smtpPort,
    password: "",
    active: true
  };
}

function MailboxPanel({ mailboxes = [], onSaveMailbox, onTestMailbox, onDisconnectMailbox, managementEnabled = true }) {
  const [draft, setDraft] = useState(createMailboxDraft("Owner"));
  const [formOpen, setFormOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const provider = providerPresets[draft.provider] || providerPresets.Other;

  function updateDraft(fields) {
    setDraft((value) => ({ ...value, ...fields }));
  }

  function startNew(role = "General") {
    setDraft(createMailboxDraft(role, draft.provider || "Hostinger"));
    setMessage("");
    setAdvancedOpen(false);
    setFormOpen(true);
  }

  function changeProvider(nextProvider) {
    const preset = providerPresets[nextProvider] || providerPresets.Other;
    updateDraft({
      provider: nextProvider,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort
    });
  }

  function changeRole(nextRole) {
    const roleMeta = mailboxRoles.find((item) => item.value === nextRole);
    updateDraft({
      role: nextRole,
      mailboxName: draft.mailboxName && draft.mailboxName !== "Nuova casella" ? draft.mailboxName : roleMeta?.defaultName || "Nuova casella"
    });
  }

  async function run(action) {
    const fn = action === "test" ? onTestMailbox : onSaveMailbox;
    if (!fn) return;
    setBusy(true);
    setMessage("");

    try {
      const result = await fn(draft);
      const unread = result.test?.unread;
      setMessage(action === "test" ? `Connessione OK${Number.isFinite(unread) ? `, ${unread} non lette` : ""}.` : "Casella collegata e salvata.");
      if (action !== "test") {
        setDraft((value) => ({ ...value, password: "" }));
        setFormOpen(false);
      }
    } catch (error) {
      setMessage(error.message || "Connessione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  if (!managementEnabled) {
    return (
      <div className="rounded-md border px-4 py-3 text-[12.5px]" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>
        La gestione delle caselle e' temporaneamente disabilitata. La configurazione esistente resta protetta e non puo' essere modificata finche' l'accesso sicuro non viene attivato.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          Aggiungi tutte le caselle che OrderWatch deve leggere: titolare, amministrazione, acquisti o altre caselle operative.
        </div>
        <button
          type="button"
          onClick={() => startNew("General")}
          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px] font-semibold text-white"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <Plus className="h-3.5 w-3.5" />
          Aggiungi casella
        </button>
      </div>

      <div>
        {mailboxes.length ? (
          mailboxes.map((mailbox) => {
            const itemProvider = providerPresets[mailbox.provider] || providerPresets.Other;

            return (
              <div key={mailbox.id || mailbox.emailAddress} className="grid grid-cols-[20px_1fr_150px_130px_100px] items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
                <Mail className="h-4 w-4" style={{ color: "var(--color-primary)" }} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">{mailbox.mailboxName}</div>
                  <div className="truncate text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{mailbox.emailAddress || "Email da inserire"}</div>
                </div>
                <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{mailboxRoles.find((role) => role.value === mailbox.role)?.label || mailbox.role}</span>
                <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{itemProvider.label}</span>
                <div className="flex items-center justify-end gap-3">
                  <StatusPill tone={mailbox.connectionStatus === "connected" ? "success" : mailbox.connectionStatus === "error" ? "danger" : "warning"}>
                    {mailbox.connectionStatus === "connected" ? "Collegata" : "Da collegare"}
                  </StatusPill>
                  {mailbox.hasPassword && onDisconnectMailbox ? (
                    <button
                      type="button"
                      onClick={() => onDisconnectMailbox(mailbox.id)}
                      className="text-[12px] font-semibold underline-offset-2 hover:underline"
                      style={{ color: "var(--color-danger)" }}
                    >
                      Scollega
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState>Nessuna casella monitorata.</EmptyState>
        )}
      </div>

      {!formOpen && (
        <div className="flex flex-wrap gap-2">
          {mailboxRoles.slice(0, 4).map((role) => (
            <button
              key={role.value}
              type="button"
              onClick={() => startNew(role.value)}
              className="rounded-md border bg-white px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
            >
              + {role.label}
            </button>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="grid gap-4 rounded-md p-3" style={{ backgroundColor: "var(--color-muted)" }}>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <label className="grid gap-1 text-[12.5px] font-semibold">
              Tipo casella
              <select
                value={draft.role}
                onChange={(event) => changeRole(event.target.value)}
                className="rounded-md border bg-white px-3 py-2 text-[13px] font-normal outline-none"
                style={{ borderColor: "var(--color-border)" }}
              >
                {mailboxRoles.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[12.5px] font-semibold">
              Provider email
              <select
                value={draft.provider}
                onChange={(event) => changeProvider(event.target.value)}
                className="rounded-md border bg-white px-3 py-2 text-[13px] font-normal outline-none"
                style={{ borderColor: "var(--color-border)" }}
              >
                {Object.entries(providerPresets).map(([key, preset]) => (
                  <option key={key} value={key}>{preset.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-md border bg-white px-3 py-2 text-[12.5px]" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
            <span className="font-semibold" style={{ color: "var(--color-text)" }}>{provider.label}. </span>
            {provider.hint}. Server impostati automaticamente: IMAP {draft.imapHost || "-"}:{draft.imapPort}, SMTP {draft.smtpHost || "-"}:{draft.smtpPort}.
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1.2fr_1fr]">
            <input
              value={draft.mailboxName}
              onChange={(event) => updateDraft({ mailboxName: event.target.value })}
              placeholder="Nome casella"
              className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--color-border)" }}
            />
            <input
              value={draft.emailAddress}
              onChange={(event) => updateDraft({ emailAddress: event.target.value })}
              placeholder="casella@azienda.it"
              className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--color-border)" }}
            />
            <input
              value={draft.password}
              type="password"
              onChange={(event) => updateDraft({ password: event.target.value })}
              placeholder={provider.passwordLabel}
              className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--color-border)" }}
            />
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            className="inline-flex w-fit items-center gap-2 text-[12.5px] font-semibold underline-offset-2 hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            <Server className="h-3.5 w-3.5" />
            {advancedOpen ? "Nascondi impostazioni server" : "Impostazioni server avanzate"}
          </button>

          {advancedOpen && (
            <div className="grid gap-3 md:grid-cols-[1.2fr_90px_1.2fr_90px]">
              <input
                value={draft.imapHost}
                onChange={(event) => updateDraft({ imapHost: event.target.value })}
                placeholder="IMAP host"
                className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: "var(--color-border)" }}
              />
              <input
                value={draft.imapPort}
                type="number"
                onChange={(event) => updateDraft({ imapPort: Number(event.target.value) })}
                className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: "var(--color-border)" }}
              />
              <input
                value={draft.smtpHost}
                onChange={(event) => updateDraft({ smtpHost: event.target.value })}
                placeholder="SMTP host"
                className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: "var(--color-border)" }}
              />
              <input
                value={draft.smtpPort}
                type="number"
                onChange={(event) => updateDraft({ smtpPort: Number(event.target.value) })}
                className="rounded-md border bg-white px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: "var(--color-border)" }}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              <KeyRound className="h-3.5 w-3.5" />
              Le credenziali vengono cifrate prima di essere salvate.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={busy}
                className="rounded-md border bg-white px-3 py-2 text-[12.5px] font-semibold disabled:opacity-60"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => run("test")}
                disabled={busy}
                className="rounded-md border bg-white px-3 py-2 text-[12.5px] font-semibold disabled:opacity-60"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
              >
                Test connessione
              </button>
              <button
                type="button"
                onClick={() => run("connect")}
                disabled={busy}
                className="rounded-md px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                {busy ? "Verifico" : "Salva e collega"}
              </button>
            </div>
          </div>
          {message && <div className="text-[12px]" style={{ color: message.includes("OK") || message.includes("salvata") ? "var(--color-success)" : "var(--color-danger)" }}>{message}</div>}
        </div>
      )}
    </div>
  );
}

const SETTING_GROUP_LABELS = {
  alerts: "Scadenze e priorità",
  automation: "Automazione",
  client: "Dati aziendali",
  customer_confirmation: "Conferme ai clienti",
  daily_report: "Report giornaliero",
  notifications: "Promemoria",
  privacy: "Privacy",
  receiving: "Ricezione merce e DDT",
  review: "Controllo umano",
  runtime: "Lettura delle email",
  supplier_orders: "Ordini e conferme fornitori",
  supplier_reminders: "Solleciti ai fornitori",
  suppliers: "Riconoscimento fornitori",
  workflow: "Flusso operativo"
};

const SEND_MODE_OPTIONS = [
  { value: "approval_required", label: "Prepara e chiedi approvazione" },
  { value: "draft_only", label: "Prepara solo la bozza" },
  { value: "manual", label: "Gestione completamente manuale" },
  { value: "automatic", label: "Invia automaticamente" }
];

const SETTING_PRESENTATION = {
  "alerts.critical_days": {
    label: "Quando una scadenza diventa critica",
    description: "Numero di giorni mancanti alla scadenza per mostrare la priorità come critica.",
    suffix: "giorni prima"
  },
  "alerts.overdue_days": {
    label: "Quando una scadenza risulta scaduta",
    description: "Ritardo tollerato prima di indicare definitivamente una consegna come scaduta.",
    suffix: "giorni dopo"
  },
  "alerts.warning_days": {
    label: "Quando mostrare il primo avviso",
    description: "Numero di giorni mancanti alla scadenza per iniziare a richiamare l'attenzione.",
    suffix: "giorni prima"
  },
  "automation.mode": {
    label: "Livello generale di automazione",
    description: "Decide quanto OrderWatch può agire autonomamente dopo aver letto email e documenti.",
    options: [
      { value: "monitor", label: "Solo controllo: non prepara azioni" },
      { value: "assisted", label: "Assistita: propone azioni da approvare" },
      { value: "automatic", label: "Automatica: esegue le azioni consentite" }
    ]
  },
  "client.company_name": { label: "Nome breve dell'azienda", description: "Nome utilizzato nei titoli e nelle schermate di OrderWatch." },
  "client.internal_domains": { label: "Domini email aziendali", description: "Domini riconosciuti come interni all'azienda. Se sono più di uno, separarli con una virgola." },
  "client.legal_name": { label: "Ragione sociale", description: "Nome legale completo dell'azienda." },
  "client.mailbox_source": {
    label: "Gestione delle caselle monitorate",
    description: "Le caselle vengono gestite in modo sicuro dalla sezione Caselle email.",
    valueLabels: { mailboxes_table: "Gestite dalla sezione Caselle email" },
    readOnly: true
  },
  "client.monitored_mailboxes": { label: "Caselle email indicate", description: "Elenco informativo delle caselle da monitorare.", emptyLabel: "Nessuna casella indicata" },
  "client.operating_office": { label: "Sede operativa", description: "Indirizzo della sede in cui si svolgono le attività operative." },
  "client.owner_email": { label: "Email del referente aziendale", description: "Indirizzo personale del referente principale.", emptyLabel: "Da definire" },
  "client.owner_name": { label: "Referente aziendale", description: "Persona di riferimento per il progetto OrderWatch." },
  "client.registered_office": { label: "Sede legale", description: "Indirizzo ufficiale della sede legale." },
  "client.vat_number": { label: "Partita IVA", description: "Partita IVA dell'azienda." },
  "client.website_domain": { label: "Dominio del sito aziendale", description: "Dominio pubblico dell'azienda, senza https://." },
  "customer_confirmation.auto_send": {
    label: "Invio automatico delle conferme",
    description: "Se attivo, la conferma può partire senza approvazione manuale quando tutte le regole sono rispettate.",
    trueLabel: "Invio automatico consentito",
    falseLabel: "Approvazione manuale richiesta"
  },
  "customer_confirmation.enabled": {
    label: "Gestione conferme ai clienti",
    description: "Attiva il flusso che prepara la conferma di ricezione di un ordine cliente.",
    trueLabel: "Gestione attiva",
    falseLabel: "Gestione disattivata"
  },
  "customer_confirmation.minimum_confidence": {
    label: "Affidabilità minima dei dati estratti",
    description: "Sotto questa percentuale la conferma richiede un controllo umano.",
    format: "percentage",
    input: { min: 0, max: 1, step: 0.01 }
  },
  "customer_confirmation.prepare_drafts": {
    label: "Preparazione automatica delle bozze",
    description: "Crea una bozza usando i dati letti dall'ordine, senza inviarla.",
    trueLabel: "Bozze automatiche attive",
    falseLabel: "Bozze automatiche disattivate"
  },
  "customer_confirmation.send_mode": {
    label: "Come gestire l'invio delle conferme",
    description: "Stabilisce se OrderWatch deve preparare una bozza, chiedere approvazione o inviare.",
    options: SEND_MODE_OPTIONS
  },
  "daily_report.deduplication_policy": {
    label: "Frequenza massima del report",
    description: "Evita che lo stesso report venga inviato più volte nella stessa giornata.",
    valueLabels: { one_report_per_day: "Al massimo un report al giorno" },
    readOnly: true
  },
  "daily_report.enabled": {
    label: "Invio del report giornaliero",
    description: "Attiva il riepilogo giornaliero delle priorità operative.",
    trueLabel: "Report attivo",
    falseLabel: "Report disattivato"
  },
  "daily_report.recipient_email": { label: "Email destinatario di riserva", description: "Campo storico: i destinatari attivi si modificano nella sezione Destinatari report.", emptyLabel: "Non configurata", readOnly: true },
  "daily_report.recipient_name": { label: "Nome destinatario di riserva", description: "Campo storico: il nome effettivo si modifica nella sezione Destinatari report.", readOnly: true },
  "daily_report.recipient_source": {
    label: "Gestione dei destinatari",
    description: "I destinatari vengono gestiti dalla sezione Destinatari report.",
    valueLabels: { report_recipients_table: "Gestiti dalla sezione Destinatari report" },
    readOnly: true
  },
  "daily_report.send_if_no_critical": {
    label: "Invia il report anche senza urgenze",
    description: "Se disattivo, il report non parte nelle giornate senza elementi critici.",
    trueLabel: "Invia sempre",
    falseLabel: "Invia solo se serve"
  },
  "daily_report.send_time": { label: "Orario del report giornaliero", description: "Ora locale in cui preparare il riepilogo.", inputType: "time" },
  "notifications.escalation_days_before_due": {
    label: "Anticipo dell'avviso interno",
    description: "Quanti giorni prima della scadenza avvisare il responsabile interno.",
    suffix: "giorni prima"
  },
  "notifications.reminder_days_before_due": {
    label: "Anticipo del promemoria al fornitore",
    description: "Quanti giorni prima della scadenza proporre un promemoria al fornitore.",
    suffix: "giorni prima"
  },
  "privacy.other_email_policy": {
    label: "Dati conservati per le email non operative",
    description: "Per le email non collegate a ordini o documenti vengono conservati soltanto i dati minimi necessari.",
    valueLabels: { metadata_only: "Solo mittente, oggetto, data e identificativo" },
    readOnly: true
  },
  "receiving.overdelivery_tolerance_percent": {
    label: "Tolleranza per quantità ricevute in eccesso",
    description: "Percentuale massima accettata oltre la quantità ordinata prima di chiedere una verifica.",
    suffix: "%",
    input: { min: 0, max: 100, step: 1 }
  },
  "receiving.require_confirmation": {
    label: "Conferma umana dei DDT acquisiti",
    description: "Richiede una verifica prima di registrare definitivamente le quantità lette da un DDT.",
    trueLabel: "Conferma richiesta",
    falseLabel: "Registrazione diretta"
  },
  "receiving.scanner_sender": {
    label: "Email mittente dello scanner",
    description: "Indirizzo usato dalla stampante o dallo scanner per inviare i DDT scansionati.",
    emptyLabel: "Scanner non ancora configurato"
  },
  "review.low_confidence_threshold": {
    label: "Soglia per richiedere un controllo umano",
    description: "Se l'affidabilità del dato è inferiore a questa percentuale, OrderWatch lo mette da verificare.",
    format: "percentage",
    input: { min: 0, max: 1, step: 0.01 }
  },
  "runtime.poll_window_minutes": {
    label: "Intervallo di recupero delle email",
    description: "Ogni controllo riprende anche le email degli ultimi minuti, così non perde messaggi già aperti da una persona.",
    suffix: "minuti"
  },
  "runtime.read_outbound_mail": {
    label: "Lettura delle email inviate",
    description: "Permette di riconoscere ordini, conferme e solleciti inviati dall'azienda.",
    trueLabel: "Email inviate incluse",
    falseLabel: "Solo email ricevute"
  },
  "supplier_confirmations.matching_enabled": {
    label: "Collegamento delle conferme dei fornitori",
    description: "Prova a collegare automaticamente la risposta del fornitore all'ordine corretto.",
    trueLabel: "Collegamento automatico attivo",
    falseLabel: "Collegamento manuale"
  },
  "supplier_orders.auto_send": {
    label: "Invio automatico degli ordini fornitori",
    description: "Se attivo, gli ordini possono partire senza approvazione manuale quando tutte le regole sono rispettate.",
    trueLabel: "Invio automatico consentito",
    falseLabel: "Approvazione manuale richiesta"
  },
  "supplier_orders.enabled": {
    label: "Gestione ordini fornitori",
    description: "Attiva la preparazione degli ordini da inviare ai fornitori.",
    trueLabel: "Gestione attiva",
    falseLabel: "Gestione disattivata"
  },
  "supplier_orders.prepare_drafts": {
    label: "Preparazione automatica delle bozze ordine",
    description: "Prepara una bozza d'ordine usando i materiali richiesti, senza inviarla.",
    trueLabel: "Bozze automatiche attive",
    falseLabel: "Bozze automatiche disattivate"
  },
  "supplier_orders.send_mode": {
    label: "Come gestire l'invio degli ordini fornitori",
    description: "Stabilisce se OrderWatch deve preparare una bozza, chiedere approvazione o inviare.",
    options: SEND_MODE_OPTIONS
  },
  "supplier_reminders.days_after_send": {
    label: "Attesa prima del primo sollecito",
    description: "Giorni da attendere dopo l'invio dell'ordine se il fornitore non risponde.",
    suffix: "giorni"
  },
  "supplier_reminders.enabled": {
    label: "Gestione solleciti ai fornitori",
    description: "Attiva la proposta di sollecito quando manca la conferma del fornitore.",
    trueLabel: "Solleciti attivi",
    falseLabel: "Solleciti disattivati"
  },
  "supplier_reminders.max_attempts": {
    label: "Numero massimo di solleciti",
    description: "Limite di solleciti proposti per lo stesso ordine.",
    suffix: "tentativi"
  },
  "supplier_reminders.auto_send": {
    label: "Invio automatico dei solleciti",
    description: "Se attivo, il sollecito può partire senza approvazione manuale.",
    trueLabel: "Invio automatico consentito",
    falseLabel: "Approvazione manuale richiesta"
  },
  "suppliers.excluded_keywords": {
    label: "Aziende da non considerare fornitori",
    description: "Nomi che OrderWatch deve escludere dal riconoscimento dei fornitori, per esempio gestori di luce, telefonia o servizi generali. Separare i nomi con una virgola.",
    groupLabel: "Riconoscimento fornitori"
  }
};

const SETTING_STATUS_LABELS = {
  Active: "Attiva",
  Planned: "Pronta da attivare",
  Manual: "Gestione manuale",
  Disabled: "Disattivata"
};

function settingPresentation(setting) {
  return SETTING_PRESENTATION[setting.settingKey] || {
    label: "Impostazione operativa",
    description: "Configurazione gestita da OrderWatch. Contatta l'amministratore prima di modificarla."
  };
}

function settingDisplayValue(setting, presentation) {
  const rawValue = String(setting.value ?? "");
  if (!rawValue.trim()) return presentation.emptyLabel || "Non configurato";
  if (presentation.valueLabels?.[rawValue]) return presentation.valueLabels[rawValue];
  const option = presentation.options?.find((item) => item.value === rawValue);
  if (option) return option.label;
  if (presentation.format === "percentage") {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? `${Math.round(numericValue * 100)}%` : rawValue;
  }
  let suffix = presentation.suffix || "";
  if (Number(rawValue) === 1) {
    suffix = suffix
      .replace("giorni", "giorno")
      .replace("minuti", "minuto")
      .replace("tentativi", "tentativo");
  }
  return `${rawValue}${suffix ? ` ${suffix}` : ""}`;
}

function SettingRow({ setting, onUpdateSetting }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    value: String(setting.value ?? ""),
    status: setting.status || "Active",
    description: setting.description || ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const presentation = settingPresentation(setting);
  const description = presentation.description || setting.description;
  const hasDescription = Boolean(description);
  const editable = setting.customerVisible !== "No" && Boolean(onUpdateSetting) && !presentation.readOnly;
  const booleanEnabled = String(setting.value).toLowerCase() === "true";

  function resetDraft() {
    setDraft({
      value: String(setting.value ?? ""),
      status: setting.status || "Active",
      description: setting.description || ""
    });
    setError("");
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      await onUpdateSetting(setting.id, {
        value: draft.value,
        status: draft.status,
        description: draft.description
      });
      setEditing(false);
    } catch (err) {
      setError(err.message || "Impossibile salvare.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBooleanToggle() {
    if (!editable || saving) return;
    setSaving(true);
    setError("");
    try {
      await onUpdateSetting(setting.id, {
        value: String(setting.value).toLowerCase() === "true" ? "false" : "true",
        status: setting.status,
        description: setting.description
      });
    } catch (err) {
      setError(err.message || "Impossibile salvare.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b py-2.5 text-[13px] last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <div className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="font-medium">{presentation.label}</div>
          {(setting.group || presentation.groupLabel) && (
            <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
              {presentation.groupLabel || SETTING_GROUP_LABELS[setting.group] || "Configurazione operativa"}
            </div>
          )}
        </div>
        <div className="min-w-0">
          {editing ? (
            setting.type === "boolean" ? (
              <select
                value={draft.value}
                onChange={(event) => setDraft((value) => ({ ...value, value: event.target.value }))}
                className="w-full rounded-md border px-2 py-1.5 text-[13px] outline-none"
                style={{ borderColor: "var(--color-border)" }}
              >
                <option value="true">{presentation.trueLabel || "Attiva"}</option>
                <option value="false">{presentation.falseLabel || "Disattivata"}</option>
              </select>
            ) : presentation.options ? (
              <select
                value={draft.value}
                onChange={(event) => setDraft((value) => ({ ...value, value: event.target.value }))}
                className="w-full rounded-md border px-2 py-1.5 text-[13px] outline-none"
                style={{ borderColor: "var(--color-border)" }}
              >
                {presentation.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                value={draft.value}
                type={presentation.inputType || (setting.type === "number" ? "number" : "text")}
                min={presentation.input?.min}
                max={presentation.input?.max}
                step={presentation.input?.step}
                onChange={(event) => setDraft((value) => ({ ...value, value: event.target.value }))}
                className="w-full rounded-md border px-2 py-1.5 text-[13px] outline-none"
                style={{ borderColor: "var(--color-border)" }}
              />
            )
          ) : setting.type === "boolean" ? (
            <button
              type="button"
              role="switch"
              aria-checked={booleanEnabled}
              onClick={handleBooleanToggle}
              disabled={!editable || saving}
              className="inline-flex items-center gap-2 disabled:opacity-60"
            >
              <span
                className="relative h-5 w-9 rounded-full transition"
                style={{ backgroundColor: booleanEnabled ? "var(--color-success)" : "var(--color-border)" }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition"
                  style={{ left: booleanEnabled ? "18px" : "2px" }}
                />
              </span>
              <span className="text-[12px] font-semibold">
                {booleanEnabled ? (presentation.trueLabel || "Attiva") : (presentation.falseLabel || "Disattivata")}
              </span>
            </button>
          ) : (
            <div className="truncate font-semibold">
              {settingDisplayValue(setting, presentation)}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3">
          {editing ? (
            <select
              value={draft.status}
              onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}
              className="rounded-md border px-2 py-1.5 text-[12px] outline-none"
              style={{ borderColor: "var(--color-border)" }}
            >
              {Object.entries(SETTING_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          ) : setting.status ? (
            <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
              {SETTING_STATUS_LABELS[setting.status] || "Configurata"}
            </span>
          ) : null}
          {!editing && hasDescription && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="text-[11.5px] font-semibold underline-offset-2 hover:underline"
              style={{ color: "var(--color-primary)" }}
            >
              {expanded ? "Nascondi" : "Dettagli"}
            </button>
          )}
          {!editing && editable && setting.type !== "boolean" && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold underline-offset-2 hover:underline"
              style={{ color: "var(--color-primary)" }}
            >
              <Pencil className="h-3 w-3" />
              Modifica
            </button>
          )}
          {editing && (
            <span className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold disabled:opacity-60"
                style={{ backgroundColor: "var(--color-primary)", color: "white" }}
              >
                <Check className="h-3.5 w-3.5" />
                {saving ? "Salvo" : "Salva"}
              </button>
              <button
                type="button"
                onClick={resetDraft}
                disabled={saving}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] font-semibold disabled:opacity-60"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-1.5 text-[12px]" style={{ color: "var(--color-danger)" }}>
          {error}
        </div>
      )}
      {hasDescription && expanded && (
        <div className="mt-1.5 text-[12.5px] leading-5" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </div>
      )}
    </div>
  );
}

function TraceabilityModePanel({ setting, onUpdateSetting }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = setting?.value || "required_link";

  async function choose(value) {
    if (!setting || !onUpdateSetting || value === current || saving) return;
    setSaving(true);
    setError("");
    try {
      await onUpdateSetting(setting.id, { value, status: setting.status, description: setting.description });
    } catch (err) {
      setError(err.message || "Impossibile cambiare livello.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2 md:grid-cols-3">
      {WORKFLOW_MODES.map((level, index) => {
        const selected = current === level.value;
        const included = WORKFLOW_MODES.findIndex((item) => item.value === current) >= index;
        return (
          <button
            key={level.value}
            type="button"
            onClick={() => choose(level.value)}
            disabled={saving || !setting || !onUpdateSetting}
            className="rounded-lg border p-3 text-left transition disabled:opacity-60"
            style={{
              borderColor: selected ? "var(--color-primary)" : "var(--color-border)",
              backgroundColor: selected ? "color-mix(in srgb, var(--color-primary) 7%, white)" : "white"
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{index + 1}. {level.label}</span>
              {included && <Check className="h-4 w-4" style={{ color: "var(--color-success)" }} />}
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: "var(--color-text)" }}>{level.summary}</div>
            <div className="mt-2 space-y-1 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
              <div><span className="font-semibold">Oggi:</span> {level.today}</div>
              <div><span className="font-semibold">Collegamenti:</span> {level.links}</div>
              <div><span className="font-semibold">DDT:</span> {level.ddt}</div>
              <div><span className="font-semibold">Fatture:</span> {level.invoices}</div>
            </div>
          </button>
        );
      })}
      {error && <div className="text-[12px] md:col-span-3" style={{ color: "var(--color-danger)" }}>{error}</div>}
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

export default function SettingsView({
  config,
  data = {},
  meta = {},
  onUpdateSetting,
  onSaveAppUser,
  onSaveReportRecipient,
  onDeleteReportRecipient,
  onSaveMailbox,
  onTestMailbox,
  onDisconnectMailbox,
  mailboxManagementEnabled = true,
  onNavigate
}) {
  const { mode, lastUpdated, counts = {} } = meta;
  const processedEmails = data.processedEmails || [];
  const settings = data.settings || [];
  const settingsByKey = Object.fromEntries(settings.map((setting) => [setting.settingKey, setting]));
  const orders = data.orders || [];
  const documents = data.documents || [];
  const appUsers = data.appUsers || [];
  const mailboxes = data.mailboxes || [];
  const dataCoverage = data.dataCoverage || [];
  const systemHealthAlerts = data.systemHealthAlerts || [];
  const reportRecipients = data.reportRecipients || [];
  const latestImport = getLatestDate(processedEmails, "receivedAt");
  const latestActivity = getLatestDate(data.activities || [], "date");
  const doneImports = processedEmails.filter((email) => email.status === "Done").length;
  const processingImports = processedEmails.filter((email) => email.status?.trim() === "Processing").length;
  const errorImports = processedEmails.filter((email) => email.status === "Error").length;
  const reviewDocuments = documents.filter((document) => document.needsHumanReview).length;
  const lowConfidenceOrders = orders.filter((order) => Number(order.aiConfidence || 1) < 0.7 || order.needsReview).length;
  const reviewTotal = counts.review ?? reviewDocuments + lowConfidenceOrders;
  const connectedMailboxes = mailboxes.filter((mailbox) => mailbox.connectionStatus === "connected");
  const mailboxHealthAlerts = systemHealthAlerts.filter((alert) => alert.category === "mailbox");
  const monitoredMailbox =
    connectedMailboxes.map((mailbox) => mailbox.emailAddress).filter(Boolean).join(", ") ||
    parseSettingValue(settingsByKey["client.monitored_mailbox"]) ||
    "Da collegare: mailbox Graphic Center";
  const alertRules = {
    warningDays: parseSettingValue(settingsByKey["alerts.warning_days"]) ?? config.alertRules.warningDays,
    criticalDays: parseSettingValue(settingsByKey["alerts.critical_days"]) ?? config.alertRules.criticalDays,
    overdueDays: parseSettingValue(settingsByKey["alerts.overdue_days"]) ?? config.alertRules.overdueDays,
    reminderDaysBeforeDue:
      parseSettingValue(settingsByKey["notifications.supplier_reminder_days_before_due"]) ?? config.alertRules.reminderDaysBeforeDue,
    escalationDaysBeforeDue:
      parseSettingValue(settingsByKey["notifications.escalation_days_before_due"]) ?? config.alertRules.escalationDaysBeforeDue
  };
  const traceabilitySetting = settingsByKey["workflow.traceability_mode"];
  const customerVisibleSettings = settings.filter((setting) => setting.customerVisible !== "No" && setting.settingKey !== "workflow.traceability_mode");
  // Moduli gestiti dal piano (settings modules.*, non editabili dal cliente).
  // Default abilitato se il setting non e' ancora presente (compatibilita').
  const moduleDefs = [
    { key: "dashboard", label: "Oggi" },
    { key: "orders", label: config.terminology.ordersPlural },
    { key: "projects", label: config.terminology.projectsPlural },
    { key: "suppliers", label: config.terminology.suppliersPlural },
    { key: "quotes", label: "Quotazioni" },
    { key: "documents", label: config.terminology.documentsPlural },
    { key: "imports", label: "Importazioni" },
    { key: "reminders", label: "Notifiche" },
    { key: "supplier_orders", label: "Ordini verso fornitori" }
  ];
  const moduleEnabled = (key) => {
    const setting = settingsByKey[`modules.${key}`];
    return setting ? String(setting.value).toLowerCase() !== "false" : true;
  };
  const isLive = mode !== "mock";
  const errorTone = errorImports ? "danger" : "success";
  const dataSource = data.meta?.dataSource || "supabase";
  const isSupabase = dataSource === "supabase";

  const healthRows = [
    {
      label: "Dashboard",
      description: "Frontend Vercel e API dashboard disponibili",
      status: "Online",
      tone: "success",
      icon: CheckCircle2
    },
    isSupabase
      ? {
          label: "Database OrderWatch",
          description: "Backend prodotto (Supabase) collegato alla dashboard",
          status: isLive ? "Live" : "Demo",
          tone: isLive ? "success" : "warning",
          icon: Database
        }
      : {
          label: "Database",
          description: "Base dati collegata alla dashboard",
          status: isLive ? "Live" : "Demo",
          tone: isLive ? "success" : "warning",
          icon: Database
        },
    isSupabase
      ? {
          label: "Worker email",
          description: "Lettura mailbox, classificazione AI ed estrazione automatica con controllo duplicati",
          status: mailboxHealthAlerts.length ? "Da verificare" : "Attivo",
          tone: mailboxHealthAlerts.length ? "danger" : "success",
          icon: Workflow
        }
      : {
          label: "Make",
          description: "Scenario pronto con controllo duplicati e gestione errori critici",
          status: "Pronto",
          tone: "success",
          icon: Workflow
        },
    {
      label: "Mailbox monitorata",
      description: monitoredMailbox,
      status: connectedMailboxes.length ? "Collegata" : "Da collegare",
      tone: connectedMailboxes.length ? "success" : "warning",
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
      channel: isSupabase ? "Email automatica" : "Email/Make",
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
            Stato del sistema, importazioni e configurazione operativa {config.company.name}.
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
        <Section
          title="Avvisi tecnici"
          hint={systemHealthAlerts.length ? `${systemHealthAlerts.length} da controllare` : "Nessun problema rilevato"}
          defaultOpen={systemHealthAlerts.length > 0}
        >
          {systemHealthAlerts.length ? (
            <div>
              {systemHealthAlerts.map((alert) => (
                <SystemHealthAlertRow key={alert.id} alert={alert} onNavigate={onNavigate} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2 text-[13px]" style={{ color: "var(--color-success)" }}>
              <CheckCircle2 className="h-4 w-4" />
              Caselle, elaborazioni e copertura dati non presentano anomalie tecniche.
            </div>
          )}
        </Section>

        <Section id="system-status-section" title="Stato sistema" defaultOpen>
          <div>
            {healthRows.map((row) => (
              <HealthRow key={row.label} {...row} />
            ))}
          </div>
        </Section>

        <Section
          id="data-coverage-section"
          title="Copertura dati"
          hint={`${dataCoverage.filter((item) => item.status === "available").length}/${dataCoverage.length || 0} fonti disponibili`}
          defaultOpen
        >
          <div className="mb-2 rounded-md p-3 text-[12.5px]" style={{ backgroundColor: "var(--color-muted)" }}>
            <span className="font-semibold">Cosa puo sapere OrderWatch. </span>
            <span style={{ color: "var(--color-text-muted)" }}>
              Le conclusioni operative tengono conto delle fonti realmente osservabili. Una fonte parziale non viene trattata come prova di assenza.
            </span>
          </div>
          {dataCoverage.length ? (
            <div>
              {dataCoverage.map((item) => <CoverageRow key={item.sourceKey} item={item} />)}
            </div>
          ) : (
            <EmptyState>Copertura non ancora calcolata.</EmptyState>
          )}
        </Section>

        <Section
          title="Importazioni"
          defaultOpen
          hint={`${doneImports} completate · ${processingImports} in lavorazione · ${errorImports} errori`}
        >
          <div className="rounded-md p-3 text-[12.5px]" style={{ backgroundColor: "var(--color-muted)" }}>
            <span className="font-semibold">Regola anti-duplicati. </span>
            <span style={{ color: "var(--color-text-muted)" }}>
              Ogni email viene controllata tramite Message ID prima di essere processata: se e' gia' presente, il flusso si ferma.
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

        <Section title="Utenti e accessi" hint={`${appUsers.length} configurati`}>
          <UserAccessPanel users={appUsers} onSaveAppUser={onSaveAppUser} />
        </Section>

        <Section title="Destinatari report" hint={`${reportRecipients.filter((recipient) => recipient.active && recipient.dailyReport).length} attivi`}>
          <ReportRecipientsPanel
            recipients={reportRecipients}
            onSaveReportRecipient={onSaveReportRecipient}
            onDeleteReportRecipient={onDeleteReportRecipient}
          />
        </Section>

        <Section title="Caselle monitorate" hint={`${connectedMailboxes.length}/${mailboxes.length || 0} collegate`} defaultOpen>
          <MailboxPanel
            mailboxes={mailboxes}
            onSaveMailbox={onSaveMailbox}
            onTestMailbox={onTestMailbox}
            onDisconnectMailbox={onDisconnectMailbox}
            managementEnabled={mailboxManagementEnabled}
          />
        </Section>

        <Section title="Livello operativo" hint={WORKFLOW_MODES.find((item) => item.value === (traceabilitySetting?.value || "required_link"))?.label} defaultOpen>
          <div className="mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            Il livello e progressivo: Completo include anche le funzioni dei livelli Essenziale e Assistito. Puoi cambiarlo quando il processo aziendale evolve, senza perdere lo storico.
          </div>
          <TraceabilityModePanel setting={traceabilitySetting} onUpdateSetting={onUpdateSetting} />
        </Section>

        <Section title="Impostazioni operative" hint={`${customerVisibleSettings.length} visibili`}>
          <div>
            {customerVisibleSettings.map((setting) => (
              <SettingRow key={setting.id} setting={setting} onUpdateSetting={onUpdateSetting} />
            ))}
            {!customerVisibleSettings.length && (
              <div className="py-4 text-center text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                Nessuna impostazione visibile.
              </div>
            )}
          </div>
        </Section>

        <Section title="Moduli attivi" hint={`${moduleDefs.filter((m) => moduleEnabled(m.key)).length}/${moduleDefs.length} attivi`}>
          <div className="mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            L'attivazione dei moduli e' gestita da OrderWatch in base al piano acquistato. Per modificarla contatta il tuo referente.
          </div>
          <div className="flex flex-wrap gap-2">
            {moduleDefs.map(({ key, label }) => {
              const enabled = moduleEnabled(key);
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium"
                  style={{
                    borderColor: enabled ? "var(--color-border)" : "color-mix(in srgb, var(--color-text-muted) 30%, white)",
                    color: enabled ? "var(--color-text)" : "var(--color-text-muted)",
                    backgroundColor: enabled ? "transparent" : "var(--color-muted)"
                  }}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: enabled ? "var(--color-primary)" : "var(--color-text-muted)" }} />
                  {label}
                  {!enabled && <span className="text-[11px]">· non incluso nel piano</span>}
                </span>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
