import { createDataAdapter, resolveDataSource } from "../server/lib/_dataSource.js";
import { authorizeApiRequest } from "../server/lib/_auth.js";

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response);
  if (!user) return;
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const source = resolveDataSource(request.query?.source);
    const adapter = createDataAdapter(source, user.organizationId);
    const data = await adapter.getDashboardData();
    data.meta = {
      dataSource: source,
      generatedAt: new Date().toISOString(),
      organization: { id: user.organizationId, slug: user.organizationSlug, name: user.organizationName }
    };
    response.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    response.status(200).json(data);
  } catch (error) {
    response.status(500).json({
      error: "Unable to load dashboard data",
      detail: error.message
    });
  }
}
