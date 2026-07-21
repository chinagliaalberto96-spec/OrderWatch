import { AlertTriangle, Bell, CheckCircle2, Clock3, Mail, Send, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate } from "../utils/dateUtils";
import { getOrderStatus } from "../utils/statusRules";
import { createSafeLanguagePolicy } from "../utils/safeLanguage";

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

function buildNotificationItems({ orders, reminders, config, languagePolicy }) {
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
    detail: languagePolicy.sanitize(reminder.body || `Promemoria ${reminder.type || "fornitore"}`),
    recipient: reminder.sentTo || "Buyer",
    date: reminder.sentAt
  }));

  return [...orderItems, ...reminderItems].sort((a, b) => {
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

export default function NotificationsView({ config, data, onNavigate }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const settingsByKey = useMemo(
    () => Object.fromEntries((data.settings || []).map((setting) => [setting.settingKey, setting])),
    [data.settings]
  );
  const languagePolicy = useMemo(
    () => createSafeLanguagePolicy(data.dataCoverage || []),
    [data.dataCoverage]
  );
  const items = useMemo(() => buildNotificationItems({
    orders: data.orders,
    reminders: data.reminders,
    config,
    languagePolicy
  }), [config, data.orders, data.reminders, languagePolicy]);

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
  const activeReportRecipients = (data.reportRecipients || []).filter((recipient) => recipient.active && recipient.dailyReport && recipient.channel === "email");
  const reportRecipient = activeReportRecipients.length
    ? activeReportRecipients.map((recipient) => recipient.recipientName).join(", ")
    : parseSettingValue(settingsByKey, "daily_report.recipient_name", "Buyer");
  const reportEmail = activeReportRecipients.length
    ? activeReportRecipients.map((recipient) => recipient.email).join(", ")
    : parseSettingValue(settingsByKey, "daily_report.recipient_email", "-");
  const reportChannel = parseSettingValue(settingsByKey, "daily_report.channel", "email");
  const systemHealthAlerts = data.systemHealthAlerts || [];

  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold">Notifiche buyer</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            Coda operativa per scadenze e solleciti. Gli avvisi tecnici restano separati.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[13px]">
          <span><strong>{draftCount}</strong> bozze</span>
          <span><strong>{criticalCount}</strong> critiche</span>
          <span><strong>{failedCount}</strong> errori</span>
        </div>
      </div>

      {systemHealthAlerts.length > 0 && (
        <section className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
            <div>
              <div className="text-[13.5px] font-semibold">Avvisi tecnici di sistema</div>
              <div className="mt-0.5 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                Non sono attivita del buyer e non entrano nella coda Oggi.
              </div>
            </div>
            <span className="text-[12px] font-semibold" style={{ color: "var(--color-warning)" }}>
              {systemHealthAlerts.length} da controllare
            </span>
          </div>
          {systemHealthAlerts.map((alert) => (
            <div key={alert.id} className="grid gap-2 border-b px-4 py-3 last:border-b-0 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center" style={{ borderColor: "var(--color-border)" }}>
              <NotificationStatus status={alert.severity} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{alert.title}</div>
                <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>{alert.message}</div>
              </div>
              {alert.targetView && onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(alert.targetView)}
                  className="rounded-md border px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-primary)" }}
                >
                  {alert.actionLabel || "Apri"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

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
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>Destinatari effettivi</div>
            <div className="truncate font-semibold">{reportRecipient}</div>
            <div className="truncate text-[12px]" style={{ color: "var(--color-text-muted)" }}>{reportEmail}</div>
          </div>
          <div>
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>Ultimo report</div>
            <div className="font-semibold">
              {latestReport ? `${latestReport.status || "-"} · ${latestReport.criticalOrdersCount || 0} critici` : "Nessun report registrato"}
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
