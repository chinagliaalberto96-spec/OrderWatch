import { BarChart3, Boxes, FileText, Inbox, LayoutDashboard, Settings, Truck } from "lucide-react";
import OrderWatchMark, { SIDEBAR_INK } from "./OrderWatchMark";

// Sidebar v3 (giugno 2026): identita' sempre OrderWatch (nessun nome/colore
// cliente qui dentro — il cliente compare solo come testo in Topbar).
// Sfondo navy scuro (SIDEBAR_INK, lo stesso ink del pannello hero del Login)
// per un look da prodotto SaaS moderno; Topbar e contenuto centrale restano
// chiari. Logo allineato a sinistra (non centrato), nav con accento corallo
// a sinistra dell'item attivo e icona in contenitore arrotondato.
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
  return (
    <aside className="flex w-[252px] shrink-0 flex-col" style={{ backgroundColor: SIDEBAR_INK }}>
      <div className="px-5 pb-5 pt-6">
        <OrderWatchMark size="md" tone="dark" />
        <div className="mt-1.5 text-[12px] font-medium text-white/55">{config.product.tagline}</div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const Icon = icons[item.key] || LayoutDashboard;
          const active = activeView === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              className="relative flex w-full items-center gap-3 rounded-xl py-2.5 pl-3.5 pr-3 text-left text-[14px] transition"
              style={{
                fontWeight: active ? 600 : 500,
                color: active ? "#FFFFFF" : "rgba(255,255,255,0.62)",
                backgroundColor: active ? "rgba(255,255,255,0.09)" : "transparent"
              }}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                  style={{ backgroundColor: "var(--color-accent)" }}
                  aria-hidden="true"
                />
              )}
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: active ? "rgba(255,255,255,0.12)" : "transparent",
                  color: active ? "#FFFFFF" : "rgba(255,255,255,0.62)"
                }}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={2.1} />
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="px-5 py-5">
        <div className="flex items-center gap-2 text-[12px] text-white/45">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-success)" }} aria-hidden="true" />
          Dati live · Pilota operativo
        </div>
      </div>
    </aside>
  );
}
