import { createAirtableAdapter } from "../../src/adapters/airtableAdapter.js";
import { createSupabaseAdapter } from "../../src/adapters/supabaseServerAdapter.js";

// La sorgente dati e' una scelta di configurazione del deployment, mai della
// richiesta: questo modulo non riceve query string, body o header del client.
// - "supabase" (default) -> prodotto ufficiale, ogni query filtrata per
//   organizationId ricavato dalla membership autenticata.
// - "airtable" -> fallback storico a singolo tenant (base Graphic Center, senza
//   concetto di organizzazione). E' ammesso solo se il server imposta
//   DATA_SOURCE=airtable, AIRTABLE_ORGANIZATION_SLUG coincide con lo slug
//   dell'organizzazione autenticata E quell'organizzazione e' Graphic Center.
//   In ogni altro caso la richiesta fallisce chiusa: nessun ripiego silenzioso
//   su un'altra sorgente.
const SERVER_SOURCES = new Set(["supabase", "airtable"]);

// Unica azienda proprietaria della base Airtable storica. Lo slug e' unico in
// public.organizations ed e' fissato dalla migrazione tenant_isolation_gate2.
// Non e' configurabile: il deployment di un'altra azienda non puo' abilitare
// il fallback nemmeno impostando AIRTABLE_ORGANIZATION_SLUG sul proprio slug.
export const HISTORICAL_AIRTABLE_ORGANIZATION_SLUG = "graphic-center";

export class DataSourceConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataSourceConfigError";
  }
}

const normalized = (value) => String(value ?? "").trim().toLowerCase();

export function resolveDataSource(env = process.env) {
  const configured = normalized(env.DATA_SOURCE);
  if (!configured) return "supabase";
  if (!SERVER_SOURCES.has(configured)) {
    throw new DataSourceConfigError("Sorgente dati del server non riconosciuta.");
  }
  return configured;
}

// context = utente restituito da authorizeApiRequest (organizationId e
// organizationSlug derivano dalla membership, mai dal client).
export function selectDataAdapter(context, env = process.env) {
  if (!context || typeof context !== "object") {
    throw new TypeError("selectDataAdapter richiede il contesto organizzativo autenticato.");
  }
  const organizationId = context.organizationId;
  if (!organizationId) {
    throw new DataSourceConfigError("Contesto organizzativo mancante.");
  }

  const source = resolveDataSource(env);
  if (source === "supabase") {
    return {
      source,
      adapter: createSupabaseAdapter({
        url: env.SUPABASE_URL,
        serviceKey: env.SUPABASE_SERVICE_KEY,
        organizationId
      })
    };
  }

  const allowedSlug = normalized(env.AIRTABLE_ORGANIZATION_SLUG);
  const organizationSlug = normalized(context.organizationSlug);
  if (organizationSlug !== HISTORICAL_AIRTABLE_ORGANIZATION_SLUG || allowedSlug !== organizationSlug) {
    throw new DataSourceConfigError("Fallback Airtable non ammesso per questa organizzazione.");
  }
  if (!env.AIRTABLE_BASE_ID || !env.AIRTABLE_API_KEY) {
    throw new DataSourceConfigError("Fallback Airtable non configurato.");
  }
  return {
    source,
    adapter: createAirtableAdapter({
      baseId: env.AIRTABLE_BASE_ID,
      apiKey: env.AIRTABLE_API_KEY
    })
  };
}

export function sendDataSourceUnavailable(response) {
  response.setHeader("Cache-Control", "no-store");
  response.status(503).json({ error: "Sorgente dati non disponibile per questa organizzazione." });
}
