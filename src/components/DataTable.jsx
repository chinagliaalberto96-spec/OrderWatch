import EmptyState from "./EmptyState";

export default function DataTable({ columns, rows, renderCell, onRowClick }) {
  if (!rows?.length) return <EmptyState />;

  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
      <table className="min-w-full border-collapse bg-white text-sm">
        <thead style={{ backgroundColor: "var(--color-muted)" }}>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="border-b px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className={`transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
              style={{ backgroundColor: index % 2 === 1 ? "color-mix(in srgb, var(--color-muted) 55%, white)" : "var(--color-card)" }}
              onMouseEnter={(event) => {
                if (onRowClick) event.currentTarget.style.backgroundColor = "var(--color-primary-soft)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor =
                  index % 2 === 1 ? "color-mix(in srgb, var(--color-muted) 55%, white)" : "var(--color-card)";
              }}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((column) => (
                <td key={column.key} className="border-b px-3 py-3 align-middle" style={{ borderColor: "var(--color-border)" }}>
                  {renderCell ? renderCell(row, column.key) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
