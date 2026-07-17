import EmptyState from "./EmptyState";

export default function DataTable({ columns, rows, renderCell, onRowClick, getRowId, isRowHighlighted }) {
  if (!rows?.length) return <EmptyState />;

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
      <table className="min-w-full border-collapse bg-white text-sm">
        <thead style={{ backgroundColor: "var(--color-muted)" }}>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="border-b px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              id={getRowId?.(row)}
              className={`transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
              style={isRowHighlighted?.(row)
                ? { backgroundColor: "var(--color-primary-soft)", boxShadow: "inset 3px 0 0 var(--color-primary)" }
                : { backgroundColor: index % 2 === 1 ? "color-mix(in srgb, var(--color-muted) 55%, white)" : "var(--color-card)" }}
              onMouseEnter={(event) => {
                if (onRowClick) event.currentTarget.style.backgroundColor = "var(--color-primary-soft)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor =
                  isRowHighlighted?.(row)
                    ? "var(--color-primary-soft)"
                    : index % 2 === 1 ? "color-mix(in srgb, var(--color-muted) 55%, white)" : "var(--color-card)";
              }}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((column) => (
                <td key={column.key} className="border-b px-3 py-2.5 align-middle" style={{ borderColor: "var(--color-border)" }}>
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
