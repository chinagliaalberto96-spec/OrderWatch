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
