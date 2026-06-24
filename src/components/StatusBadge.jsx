import { getStatusTone, statusLabels } from "../utils/statusRules";

export default function StatusBadge({ status }) {
  const tone = getStatusTone(status);

  return (
    <span
      className="inline-flex min-w-24 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-${tone}) 13%, white)`,
        color: `var(--color-${tone})`
      }}
    >
      {statusLabels[status] || status}
    </span>
  );
}
