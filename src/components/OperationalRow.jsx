import { MoreHorizontal } from "lucide-react";
import { useRef } from "react";

export function RowActionsMenu({ actions = [], label = "Azioni riga" }) {
  const detailsRef = useRef(null);
  const visibleActions = actions.filter(Boolean);
  if (!visibleActions.length) return null;

  function run(action) {
    detailsRef.current?.removeAttribute("open");
    action.onClick?.();
  }

  return (
    <details ref={detailsRef} className="relative">
      <summary
        aria-label={label}
        title={label}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md transition hover:bg-[color:var(--color-muted)] [&::-webkit-details-marker]:hidden"
        style={{ color: "var(--color-text-muted)" }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-9 z-20 min-w-48 overflow-hidden rounded-md border bg-white py-1 shadow-elevated" style={{ borderColor: "var(--color-border)" }}>
        {visibleActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => run(action)}
              disabled={action.disabled}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium transition hover:bg-[color:var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ color: action.tone ? `var(--color-${action.tone})` : "var(--color-text)" }}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {action.label}
            </button>
          );
        })}
      </div>
    </details>
  );
}

export default function OperationalRow({
  leading,
  title,
  subtitle,
  meta,
  status,
  actions,
  selected = false,
  highlighted = false,
  onSelect,
  onOpen,
  rowId
}) {
  return (
    <div
      id={rowId}
      className="group flex min-h-[58px] items-center gap-2.5 border-b px-3 py-2 transition-colors last:border-b-0"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: highlighted ? "color-mix(in srgb, var(--color-primary) 6%, white)" : "var(--color-card)",
        boxShadow: highlighted ? "inset 2px 0 0 var(--color-primary)" : "none"
      }}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Seleziona ${title || "riga"}`}
          className="h-4 w-4 shrink-0"
        />
      )}
      {leading && <div className="shrink-0">{leading}</div>}
      <button type="button" onClick={onOpen} disabled={!onOpen} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <span className="block truncate text-[13px] font-semibold" style={{ color: "var(--color-text)" }}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>{subtitle}</span>}
      </button>
      {meta && <div className="hidden shrink-0 text-right text-[11.5px] leading-5 sm:block" style={{ color: "var(--color-text-muted)" }}>{meta}</div>}
      {status && <div className="shrink-0">{status}</div>}
      <RowActionsMenu actions={actions} />
    </div>
  );
}
