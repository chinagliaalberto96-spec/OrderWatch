// Ruoli generici del kit. Per Graphic Center Group la mappatura concreta
// (persona -> ruolo) e definita in src/config/customer.config.js -> roles.
//   admin   = Responsabile commerciale/operativo (vede e modifica tutto)
//   buyer   = Addetto acquisti (ordini, lavori, azioni, solleciti)
//   viewer  = Produzione (sola lettura stato lavori)
export const roles = {
  admin: ["view", "edit", "configure", "send_reminders"],
  buyer: ["view", "edit", "send_reminders"],
  operations: ["view", "edit"],
  viewer: ["view"]
};

export function can(role, permission) {
  return roles[role]?.includes(permission) || false;
}

// Permessi applicativi reali restituiti dalla sessione Supabase. Il backend
// continua a essere l'autorita' per ogni scrittura; questa matrice rende la
// navigazione coerente con il lavoro quotidiano dei diversi utenti.
const APP_VIEWS_BY_ROLE = {
  Owner: "*",
  IT: "*",
  Admin: "*",
  Buyer: new Set(["dashboard", "orders", "projects", "contract_watch", "suppliers", "quotes", "receiving", "documents", "invoices", "reminders"]),
  ReadOnly: new Set(["dashboard", "projects", "receiving", "documents", "invoices", "reminders"])
};

export function canAccessView(role, view) {
  if (!role) return true;
  const allowed = APP_VIEWS_BY_ROLE[role];
  return allowed === "*" || Boolean(allowed?.has(view));
}

export function canWriteOperationalData(role) {
  return ["Owner", "IT", "Admin", "Buyer"].includes(role);
}
