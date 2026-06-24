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
          {rows.map((row) => (
            <tr
              key={row.id}
              className={onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}
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
