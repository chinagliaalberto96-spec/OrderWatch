import { BarChart3, Boxes, FileText, LayoutDashboard, Settings, Truck } from "lucide-react";
import Button from "./Button";

const icons = {
  dashboard: LayoutDashboard,
  orders: Boxes,
  projects: BarChart3,
  suppliers: Truck,
  documents: FileText,
  settings: Settings
};

export default function Sidebar({ config, navItems, activeView, onNavigate }) {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r" style={{ backgroundColor: "var(--color-sidebar)", borderColor: "var(--color-border)" }}>
      <div className="border-b px-4 py-5" style={{ borderColor: "var(--color-border)" }}>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
            Workspace
          </div>
          <div className="mt-2 truncate text-[15px] font-semibold" style={{ color: "var(--color-text)" }}>
            {config.company.name}
          </div>
          <div className="mt-1 truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
            Pilota operativo
          </div>
        </div>
      </div>
      <nav className="space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = icons[item.key] || LayoutDashboard;
          const active = activeView === item.key;
          return (
            <Button
              key={item.key}
              variant="ghost"
              className={`w-full justify-start ${active ? "font-semibold" : ""}`}
              onClick={() => onNavigate(item.key)}
              style={{
                backgroundColor: active ? "color-mix(in srgb, var(--color-primary) 9%, white)" : "transparent",
                color: active ? "var(--color-primary)" : "var(--color-text)"
              }}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </nav>
      <div className="mt-auto border-t p-4" style={{ borderColor: "var(--color-border)" }}>
        <div className="rounded-lg border px-4 py-4" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
            Powered by
          </div>
          {config.brand?.orderWatchLogoUrl ? (
            <img className="mt-3 h-12 w-auto max-w-[190px] object-contain" src={config.brand.orderWatchLogoUrl} alt={config.product.name} />
          ) : (
            <div className="mt-3 text-lg font-semibold" style={{ color: "var(--color-primary)" }}>
              {config.product.name}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
