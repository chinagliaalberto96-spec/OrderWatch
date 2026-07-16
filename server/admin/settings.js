import { createDataAdapter } from "../lib/_dataSource.js";
import { authorizeApiRequest } from "../lib/_auth.js";
import { WORKFLOW_MODE_VALUES } from "../../src/config/workflowModes.js";

const editableStatuses = new Set(["Active", "Planned", "Manual", "Disabled"]);
const traceabilityModes = new Set(WORKFLOW_MODE_VALUES);

function normalizeValueByType(value, type) {
  if (type === "number") {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      throw new Error("Value must be a valid number.");
    }
    return String(numberValue);
  }

  if (type === "boolean") {
    if (value === true || value === "true") return "true";
    if (value === false || value === "false") return "false";
    throw new Error("Value must be true or false.");
  }

  return String(value ?? "").trim();
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin"] });
  if (!user) return;
  if (request.method !== "PATCH") {
    response.setHeader("Allow", "PATCH");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const adapter = createDataAdapter(request.query?.source || request.body?.source, user.organizationId);

    const { id, value, status, description } = request.body || {};

    if (!id) {
      response.status(400).json({ error: "Missing setting id." });
      return;
    }

    const settings = await adapter.getSettings();
    const setting = settings.find((item) => item.id === id);

    if (!setting) {
      response.status(404).json({ error: "Setting not found." });
      return;
    }

    if (setting.customerVisible === "No") {
      response.status(403).json({ error: "This setting is not editable from the dashboard." });
      return;
    }

    const fields = {};

    if ("value" in request.body) {
      fields.value = normalizeValueByType(value, setting.type);
      if (setting.settingKey === "workflow.traceability_mode" && !traceabilityModes.has(fields.value)) {
        response.status(400).json({ error: "Invalid traceability mode." });
        return;
      }
    }

    if ("status" in request.body) {
      if (!editableStatuses.has(status)) {
        response.status(400).json({ error: "Invalid setting status." });
        return;
      }
      fields.status = status;
    }

    if ("description" in request.body) {
      fields.description = String(description ?? "").trim();
    }

    if (!Object.keys(fields).length) {
      response.status(400).json({ error: "No editable fields provided." });
      return;
    }

    const updated = await adapter.updateSetting(id, fields);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ setting: updated });
  } catch (error) {
    response.status(500).json({
      error: "Unable to update setting",
      detail: error.message
    });
  }
}
