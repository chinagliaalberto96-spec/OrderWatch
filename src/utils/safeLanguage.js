const DEFAULT_SOURCE = Object.freeze({
  status: "unavailable",
  limitation: "La fonte non è configurata o la sua copertura non è verificabile."
});

export function createSafeLanguagePolicy(rows = []) {
  const coverage = new Map((rows || []).map((row) => [row.sourceKey || row.source_key, {
    status: row.status || "partial",
    limitation: row.limitation || row.message || null
  }]));

  const source = (key) => coverage.get(key) || DEFAULT_SOURCE;
  const isAvailable = (key) => source(key).status === "available";

  function sanitize(text) {
    if (!text) return text;
    let value = String(text)
      .replace(/\bnon esiste\b/gi, "non risulta registrato in OrderWatch")
      .replace(/\bmai inviat[oaie]\b/gi, "invio non osservato nelle fonti collegate")
      .replace(/\bnessuna risposta(?: ricevuta)?\b/gi, "nessuna risposta osservata nelle caselle collegate")
      .replace(/\bordine inviato senza conferma\b/gi, "ordine registrato come inviato; conferma non osservata nelle caselle collegate")
      .replace(/\bsolleciti gi[aà] inviat[oi]\b/gi, "solleciti registrati in OrderWatch");

    if (!isAvailable("outbound_email") && /invio non osservato|solleciti registrati/i.test(value)) {
      value = appendOnce(value, "Lo storico della posta in uscita è parziale.");
    }
    if (!isAvailable("inbound_email") && /risposta osservata|conferma non osservata/i.test(value)) {
      value = appendOnce(value, "La copertura della posta in entrata è parziale.");
    }
    return value;
  }

  return {
    absence: (label) => `Nessun ${label} registrato in OrderWatch per questa vista.`,
    isAvailable,
    sanitize,
    source
  };
}

function appendOnce(value, sentence) {
  if (value.includes(sentence)) return value;
  return `${value.trim()}${/[.!?]$/.test(value.trim()) ? "" : "."} ${sentence}`;
}
