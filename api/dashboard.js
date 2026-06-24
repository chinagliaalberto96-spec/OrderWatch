import { createAirtableAdapter } from "../src/adapters/airtableAdapter.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const adapter = createAirtableAdapter({
      baseId: process.env.AIRTABLE_BASE_ID,
      apiKey: process.env.AIRTABLE_API_KEY
    });

    const data = await adapter.getDashboardData();
    response.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    response.status(200).json(data);
  } catch (error) {
    response.status(500).json({
      error: "Unable to load dashboard data",
      detail: error.message
    });
  }
}
