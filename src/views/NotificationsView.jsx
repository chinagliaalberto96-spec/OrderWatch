import { AlertTriangle, Bell, CheckCircle2, Clock3, Mail, Send, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate } from "../utils/dateUtils";
import { getOrderStatus } from "../utils/statusRules";

const statusMeta = {
  draft: { label: "Bozza", tone: "warning", icon: Clock3 },
  sent: { label: "Inviata", tone: "success", icon: Send },
  failed: { label: "Fallita", tone: "danger", icon: XCircle },
  replied: { label: "Risposta", tone: "success", icon: CheckCircle2 },
  critical: { label: "Critica", tone: "danger", icon: AlertTriangle },
  warning: { label: "Attenzione", tone: "warning", icon: Bell },
  error: { label: "Errore", tone: "danger", icon: XCircle },
  info: { label: "Info", tone: "primary", icon: Bell }
};

const filters = [
  { key: "all", label: "Tutte" },
  { key: "draft", label: "Bozze" },
  { key: "critical", label: "Critiche" },
  { key: "failed", label: "Fallite" },
  { key: "sent", label: "Inviate" }
];

function NotificationStatus({ status }) {
  const meta = statusMeta[status] || statusMeta.info;
  const Icon = meta.icon;

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: `var(--color-${meta.tone})` }}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

function buildNotificationItems({ orders, reminders, processedEmails, config }) {
  const orderItems = (orders || [])
    .map((order) => ({ ...order, computedStatus: getOrderStatus(order, config.alertRules) }))
    .filter((order) => ["OVERDUE", "CRITICAL", "WARNING", "TO_VERIFY"].includes(order.computedStatus))
    .map((order) => ({
      id: `order-${order.id}`,
      source: "Ordine",
      status: ["OVERDUE", "CRITICAL"].includes(order.computedStatus) ? "critical" : "warning",
      title: `${order.orderCode} · ${order.material || "Materiale da verificare"}`,
      detail: `${order.supplierName || "Fornitore"} · ${order.daysRemaining ?? "-"} giorni alla scadenza`,
      recipient: order.owner || "Buyer",
      date: order.dueDate
    }));

  const reminderItems = (reminders || []).map((reminder) => ({
    id: `reminder-${reminder.id}`,
    source: "Sollecito",
    status: reminder.status || "draft",
    title: `${reminder.orderCode || "Ordine"} · ${reminder.supplierName || "Fornitore"}`,
    detail: reminder.body || `Promemoria ${reminder.type || "fornitore"}`,
    recipient: reminder.sentTo || "Buyer",
    date: reminder.sentAt
  }));

  const importItems = (processedEmails || [])
    .filter((email) => email.status === "Error" || email.status?.trim() === "Processing")
    .map((email) => ({
      id: `import-${email.id}`,
      source: "Importazione",
      status: email.status === "Error" ? "error" : "warning",
      title: email.subject || email.messageId || "Email da controllare",
      detail: email.errorDetail || "Importazione non conclusa",
      recipient: "Operatore",
      date: email.receivedAt
    }));

  return [...orderItems, ...reminderItems, ...importItems].sort((a, b) => {
    const aDate = a.date ? new Date(a.date).getTime() : 0;
    const bDate = b.date ? new Date(b.date).getTime() : 0;
    return bDate - aDate;
  });
}

function parseSettingValue(settingsByKey, key, fallback = null) {
  const setting = settingsByKey[key];
  if (!setting) return fallback;
  if (setting.type === "boolean") return setting.value === true || setting.value === "true";
  if (setting.type === "number") {
    const value = Number(setting.value);
    return Number.isFinite(value) ? value : fallback;
  }
  return setting.value ?? fallback;
}

export default function NotificationsView({ config, data }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const settingsByKey = useMemo(
    () => Object.fromEntries((data.settings || []).map((setting) => [setting.settingKey, setting])),
    [data.settings]
  );
  const items = useMemo(() => buildNotificationItems({
    orders: data.orders,
    reminders: data.reminders,
    processedEmails: data.processedEmails,
    config
  }), [config, data.orders, data.processedEmails, data.reminders]);

  const visibleItems = activeFilter === "all" ? items : items.filter((item) => item.status === activeFilter);
  const draftCount = items.filter((item) => item.status === "draft").length;
  const criticalCount = items.filter((item) => item.status === "critical").length;
  const failedCount = items.filter((item) => item.status === "failed" || item.status === "error").length;
  const dailyReports = [...(data.dailyReports || [])].sort((a, b) => {
    const aDate = a.sentAt || a.reportDate;
    const bDate = b.sentAt || b.reportDate;
    return (bDate ? new Date(bDate).getTime() : 0) - (aDate ? new Date(aDate).getTime() : 0);
  });
  const latestReport = dailyReports[0];
  const reportEnabled = parseSettingValue(settingsByKey, "daily_report.enabled", false);
  const reportTime = parseSettingValue(settingsByKey, "daily_report.send_time", "09:00");
  const reportRecipient = parseSettingValue(settingsByKey, "daily_report.recipient_name", "Buyer");
  const reportEmail = parseSettingValue(settingsByKey, "daily_report.recipient_email", "-");
  const reportChannel = parseSettingValue(settingsByKey, "daily_report.channel", "email");

  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold">Notifiche buyer</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            Coda operativa per alert, solleciti e problemi di importazione.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[13px]">
          <span><strong>{draftCount}</strong> bozze</span>
          <span><strong>{criticalCount}</strong> critiche</span>
          <span><strong>{failedCount}</strong> errori</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const active = filter.key === activeFilter;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className="rounded-full border px-3 py-1.5 text-[13px] font-semibold transition"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-border)",
                color: active ? "white" : "var(--color-text-muted)",
                backgroundColor: active ? "var(--color-primary)" : "var(--color-card)"
              }}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <section className="rounded-lg border bg-white" style={{ borderColor: "var(--color-border)" }}>
        <div className="grid grid-cols-[1fr_150px_220px_180px] items-center gap-4 px-4 py-3 text-[13px]">
          <div className="min-w-0">
            <div className="font-semibold">Report giornaliero criticita'</div>
            <div className="mt-0.5 truncate" style={{ color: "var(--color-text-muted)" }}>
              Una sola email riepilogativa al buyer, alle {reportTime}, solo se ci sono ordini critici.
            </div>
          </div>
          <div>
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>Stato</div>
            <div className="font-semibold" style={{ color: reportEnabled ? "var(--color-success)" : "var(--color-warning)" }}>
              {reportEnabled ? "Pianificato" : "Disattivo"}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>Destinatario</div>
            <div className="truncate font-semibold">{reportRecipient}</div>
            <div className="truncate text-[12px]" style={{ color: "var(--color-text-muted)" }}>{reportEmail}</div>
          </div>
          <div>
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>Ultimo report</div>
            <div className="font-semibold">
              {latestReport ? `${latestReport.status || "-"} · ${latestReport.criticalOrdersCount || 0} critici` : "Non ancora inviato"}
            </div>
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>{reportChannel}</div>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: "var(--color-border)" }}>
        <div className="grid grid-cols-[130px_1.2fr_1.4fr_160px_120px] gap-3 border-b px-4 py-3 text-[12px] font-semibold uppercase tracking-wide" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>
          <div>Stato</div>
          <div>Evento</div>
          <div>Dettaglio</div>
          <div>Destinatario</div>
          <div>Data</div>
        </div>
        {visibleItems.map((item) => (
          <div key={item.id} className="grid grid-cols-[130px_1.2fr_1.4fr_160px_120px] items-center gap-3 border-b px-4 py-3 text-[13px] last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
            <NotificationStatus status={item.status} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{item.title}</div>
              <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>{item.source}</div>
            </div>
            <div className="line-clamp-2" style={{ color: "var(--color-text-muted)" }}>{item.detail}</div>
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
              <span className="truncate">{item.recipient}</span>
            </div>
            <div style={{ color: "var(--color-text-muted)" }}>{item.date ? formatDate(item.date) : "-"}</div>
          </div>
        ))}
        {!visibleItems.length && (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            Nessuna notifica in questa vista.
          </div>
        )}
      </div>
    </div>
  );
}
