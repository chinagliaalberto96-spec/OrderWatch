import { AlertTriangle, CheckCircle2, FileText, MailCheck, RotateCw } from "lucide-react";

const icons = {
  alert: AlertTriangle,
  document: FileText,
  reminder: MailCheck,
  status: RotateCw,
  ok: CheckCircle2
};

function formatActivityDate(value) {
  if (!value) return "";
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
    .format(date)
    .replace(",", " ·");
}

export default function ActivityFeed({ activities, onSelect }) {
  return (
    <div className="space-y-1">
      {activities.map((activity) => {
        const Icon = icons[activity.type] || icons.ok;
        const tone = activity.type === "alert" ? "danger" : activity.type === "reminder" ? "warning" : "primary";
        // Cliccabile solo se collegata a un ordine/lavoro e se il chiamante
        // ha fornito la navigazione.
        const interactive = typeof onSelect === "function" && Boolean(activity.orderCode || activity.projectCode);
        const Tag = interactive ? "button" : "div";

        return (
          <Tag
            key={activity.id}
            type={interactive ? "button" : undefined}
            onClick={interactive ? () => onSelect(activity) : undefined}
            className={`flex w-full gap-3 rounded-md px-2 py-2 text-left ${
              interactive ? "cursor-pointer transition hover:bg-[color:var(--color-muted)]" : ""
            }`}
            title={interactive ? `Apri ${activity.orderCode || activity.projectCode}` : undefined}
          >
            <div
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{
                backgroundColor: `color-mix(in srgb, var(--color-${tone}) 12%, white)`,
                color: `var(--color-${tone})`
              }}
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1 border-b pb-2 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold leading-5">{activity.title}</div>
                <div className="shrink-0 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {formatActivityDate(activity.date)}
                </div>
              </div>
              <div className="mt-1 text-[13px] leading-5" style={{ color: "var(--color-text-muted)" }}>
                {activity.detail}
              </div>
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
