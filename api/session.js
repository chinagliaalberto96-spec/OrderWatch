import { authorizeApiRequest } from "../server/lib/_auth.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const user = await authorizeApiRequest(request, response);
  if (!user) return;
  response.status(200).json({ user });
}
