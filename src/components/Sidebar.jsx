import { BarChart3, Boxes, FileText, Inbox, LayoutDashboard, Settings, Truck } from "lucide-react";
import Button from "./Button";
import OrderWatchMark from "./OrderWatchMark";

const icons = {
  dashboard: LayoutDashboard,
  orders: Boxes,
  projects: BarChart3,
  suppliers: Truck,
  documents: FileText,
  imports: Inbox,
  settings: Settings
};

export default function Sidebar({ config, navItems, activeView, onNavigate }) {
  const initials = config.brand?.clientInitials || config.company.name?.slice(0, 2)?.toUpperCase();

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r" style={{ backgroundColor: "var(--color-sidebar)", borderColor: "var(--color-border)" }}>
      <div
        className="px-4 py-5"
        style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {initials && (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
              style={{ backgroundColor: "rgba(255,255,255,0.16)" }}
            >
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">Workspace</div>
            <div className="truncate text-[15px] font-semibold text-white">{config.company.name}</div>
          </div>
        </div>
        <div className="mt-2 truncate text-xs text-white/55">Pilota operativo</div>
      </div>
      <nav className="space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = icons[item.key] || LayoutDashboard;
          const active = activeView === item.key;
          return (
            <Button
              key={item.key}
              variant="ghost"
              className={`w-full justify-start transition ${active ? "font-semibold shadow-soft" : ""}`}
              onClick={() => onNavigate(item.key)}
              style={{
                backgroundColor: active ? "var(--color-sidebar-active)" : "transparent",
                color: active ? "#FFFFFF" : "var(--color-text)"
              }}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </nav>
      <div className="mt-auto border-t p-4" style={{ borderColor: "var(--color-border)" }}>
        <div className="rounded-lg border px-4 py-4" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-primary-soft)" }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
            Powered by
          </div>
          <OrderWatchMark variant="full" size="sm" className="mt-3" />
        </div>
      </div>
    </aside>
  );
}
