import { requireApiUser } from "../server/lib/_auth.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const user = await requireApiUser(request, response);
    if (!user) return;
    response.status(200).json({ user });
  } catch (error) {
    response.status(500).json({ error: "Unable to validate session", detail: error.message });
  }
}
