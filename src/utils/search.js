// Filtro di ricerca generico usato dalla barra di ricerca in Topbar.
// Confronta la query (case-insensitive) con tutti i valori "semplici" della riga
// (stringhe, numeri, booleani) cosi' funziona senza dover elencare colonna per colonna.
export function filterRows(rows, query) {
  if (!Array.isArray(rows) || !query || !query.trim()) return rows || [];

  const needle = query.trim().toLowerCase();

  return rows.filter((row) =>
    Object.values(row).some((value) => {
      if (value === null || value === undefined) return false;
      if (typeof value === "object") return false;
      return String(value).toLowerCase().includes(needle);
    })
  );
}
