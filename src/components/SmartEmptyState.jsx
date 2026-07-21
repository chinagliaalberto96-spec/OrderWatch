import { ArrowRight, Inbox } from "lucide-react";

// Stesso pattern dell'empty state di AlteraView (STARTERS): invece di un
// messaggio passivo, offre azioni concrete cliccabili verso dove si trova
// il dato collegato ma non ancora visibile in questa vista.
export default function SmartEmptyState({ icon: Icon = Inbox, title, description, actions = [] }) {
  return (
    <section className="rounded-lg border border-dashed px-5 py-14 text-center" style={{ borderColor: "var(--color-border)" }}>
      <Icon className="mx-auto h-8 w-8" style={{ color: "var(--color-text-muted)" }} />
      <h2 className="mt-4 font-semibold">{title}</h2>
      {description && (
        <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </p>
      )}
      {actions.length > 0 && (
        <div className="mx-auto mt-6 grid max-w-xl gap-2 sm:grid-cols-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition hover:bg-[color:var(--color-muted)]"
              style={{ borderColor: "var(--color-border)" }}
            >
              {action.label}
              <ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
