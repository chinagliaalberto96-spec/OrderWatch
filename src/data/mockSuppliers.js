// Fornitori attivi indicati da Graphic Center Group (sezione 4.1 onboarding).
// onTimeRate, risk e score sono "N/D" per tutti: il pilota non ha ancora
// storico misurato di puntualita' e non vogliamo inventare numeri di
// affidabilita' per fornitori reali senza dati a supporto. Verranno calcolati
// automaticamente da OrderWatch (tabella SupplierScorecard) durante il pilota.
// Le email sono segnate "Da raccogliere": non sono state fornite nel form di
// onboarding e non vanno presunte.
export const mockSuppliers = [
  { id: "sup_fedrigoni", name: "Fedrigoni", email: "Da raccogliere", category: "Carta e cartoncino", onTimeRate: null, openOrders: 1, risk: "N/D", score: null },
  { id: "sup_cartaria_subalpina", name: "Cartaria Subalpina", email: "Da raccogliere", category: "Carta e cartoncino", onTimeRate: null, openOrders: 1, risk: "N/D", score: null },
  { id: "sup_burgo", name: "Burgo", email: "Da raccogliere", category: "Carta e cartoncino", onTimeRate: null, openOrders: 0, risk: "N/D", score: null },
  { id: "sup_antalis", name: "Antalis", email: "Da raccogliere", category: "Carta, vinile, pannelli", onTimeRate: null, openOrders: 1, risk: "N/D", score: null },
  { id: "sup_sunclear", name: "Sunclear Italia", email: "Da raccogliere", category: "Pannelli e materiali per display", onTimeRate: null, openOrders: 1, risk: "N/D", score: null },
  { id: "sup_sun_chemical", name: "Sun Chemical", email: "Da raccogliere", category: "Inchiostri e lastre", onTimeRate: null, openOrders: 0, risk: "N/D", score: null },
  { id: "sup_litohelio", name: "Litohelio", email: "Da raccogliere", category: "Lavorazioni speciali", onTimeRate: null, openOrders: 0, risk: "N/D", score: null },
  { id: "sup_ferrania", name: "Ferrania", email: "Da raccogliere", category: "Lavorazioni speciali (serigrafia)", onTimeRate: null, openOrders: 0, risk: "N/D", score: null },
  { id: "sup_konica_minolta", name: "Konica Minolta", email: "Da raccogliere", category: "Lavorazioni speciali (espositori)", onTimeRate: null, openOrders: 0, risk: "N/D", score: null }
];
