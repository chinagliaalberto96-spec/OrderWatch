import { BarChart3, Bell, Boxes, BriefcaseBusiness, ContactRound, FileSearch, FileText, Inbox, LayoutDashboard, PackageCheck, Receipt, Settings, Sparkles, Truck } from "lucide-react";
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
  contract_watch: BriefcaseBusiness,
  suppliers: Truck,
  contacts: ContactRound,
  quotes: FileSearch,
  documents: FileText,
  invoices: Receipt,
  imports: Inbox,
  reminders: Bell,
  receiving: PackageCheck,
  altera: Sparkles,
  settings: Settings
};

// Raggruppamento puramente visivo: la stessa lista piatta di prima, spezzata
// in 3 sezioni per essere scansionabile a colpo d'occhio invece che un unico
// blocco di 10-12 voci identiche. Le chiavi non presenti in navItems (modulo
// disattivato o ruolo senza accesso) spariscono semplicemente dalla sezione.
const NAV_SECTIONS = [
  { label: "Operativo", keys: ["dashboard", "altera", "orders", "projects", "contract_watch", "receiving"] },
  { label: "Fornitori e documenti", keys: ["suppliers", "contacts", "quotes", "documents", "invoices", "imports"] },
  { label: "Sistema", keys: ["reminders", "settings"] }
];

export default function Sidebar({ config, navItems, activeView, onNavigate }) {
  const byKey = new Map(navItems.map((item) => [item.key, item]));
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.keys.map((key) => byKey.get(key)).filter(Boolean)
  })).filter((section) => section.items.length);

  return (
    <aside className="flex w-[72px] shrink-0 flex-col lg:w-[252px]" style={{ backgroundColor: SIDEBAR_INK }}>
      <div className="px-4 pb-5 pt-6 lg:px-5">
        <div className="w-10 overflow-hidden lg:hidden"><OrderWatchMark size="md" tone="dark" /></div>
        <div className="hidden lg:block"><OrderWatchMark size="md" tone="dark" /></div>
        <div className="mt-1.5 hidden text-[12px] font-medium text-white/55 lg:block">{config.product.tagline}</div>
      </div>
      <nav className="flex-1 space-y-4 px-2 lg:px-3">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="hidden px-3.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-white/35 lg:block">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = icons[item.key] || LayoutDashboard;
                const active = activeView === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onNavigate(item.key)}
                    className="relative flex w-full items-center justify-center gap-3 rounded-xl py-2 text-left text-[13.5px] transition lg:justify-start lg:pl-3.5 lg:pr-3"
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
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: active ? "rgba(255,255,255,0.12)" : "transparent",
                        color: active ? "#FFFFFF" : "rgba(255,255,255,0.62)"
                      }}
                    >
                      <Icon className="h-[16px] w-[16px]" strokeWidth={2.1} />
                    </span>
                    <span className="hidden truncate lg:block">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-5 py-5">
        <div className="flex items-center justify-center gap-2 text-[12px] text-white/45 lg:justify-start">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-success)" }} aria-hidden="true" />
          <span className="hidden lg:inline">Dati live · Backend operativo</span>
        </div>
      </div>
    </aside>
  );
}
