import { createAirtableAdapter } from "../../src/adapters/airtableAdapter.js";
import { createSupabaseAdapter } from "../../src/adapters/supabaseServerAdapter.js";

// Selettore della sorgente dati, lato server (mai nel browser).
// - "supabase" -> prodotto ufficiale
// - "airtable" -> fallback tecnico del pilota storico
// La UI cliente non espone piu' questa scelta. L'override resta solo per test
// tecnici/server-side e viene comunque validato con whitelist.
const ALLOWED_SOURCES = new Set(["airtable", "supabase"]);

export function resolveDataSource(override) {
  const requested = String(override || "").toLowerCase();
  if (ALLOWED_SOURCES.has(requested)) return requested;
  const fallback = (process.env.DATA_SOURCE || "supabase").toLowerCase();
  return ALLOWED_SOURCES.has(fallback) ? fallback : "supabase";
}

// organizationId e' obbligatorio in modalita' supabase: arriva sempre dal
// contesto server-side (api/_auth.js), mai da un parametro client. Il
// fallback Airtable resta a singolo tenant (pilota storico Graphic Center,
// nessun concetto di organizzazione in quella base).
export function createDataAdapter(override, organizationId) {
  const source = resolveDataSource(override);

  if (source === "supabase") {
    return createSupabaseAdapter({
      url: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_KEY,
      organizationId
    });
  }

  return createAirtableAdapter({
    baseId: process.env.AIRTABLE_BASE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
  });
}
