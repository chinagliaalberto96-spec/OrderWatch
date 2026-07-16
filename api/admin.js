import appUsersHandler from "../server/admin/app-users.js";
import reportRecipientsHandler from "../server/admin/report-recipients.js";
import settingsHandler from "../server/admin/settings.js";

const handlers = {
  "app-users": appUsersHandler,
  "report-recipients": reportRecipientsHandler,
  settings: settingsHandler
};

export default async function handler(request, response) {
  const route = String(request.query?.route || "").trim();
  const selected = handlers[route];
  if (!selected) {
    response.status(404).json({ error: "Administrative route not found." });
    return;
  }
  await selected(request, response);
}
