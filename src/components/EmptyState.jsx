import { Inbox } from "lucide-react";

export default function EmptyState({ title = "Nessun dato", description = "Non ci sono record da mostrare." }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center" style={{ borderColor: "var(--color-border)" }}>
      <Inbox className="h-8 w-8" style={{ color: "var(--color-text-muted)" }} />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm" style={{ color: "var(--color-text-muted)" }}>
        {description}
      </p>
    </div>
  );
}
