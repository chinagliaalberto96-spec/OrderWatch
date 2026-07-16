import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
const execute = Boolean(args.execute);
const temporaryTest = Boolean(args["temporary-test"]);
const organizationOnly = Boolean(args["organization-only"]);
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_KEY sono obbligatorie.");
}

const stamp = Date.now();
const input = temporaryTest
  ? {
      slug: `provision-test-${stamp}`,
      name: `Provision Test ${stamp}`,
      displayName: `Provision Test ${stamp}`,
      ownerName: "Owner Test OrderWatch",
      ownerEmail: `owner-${stamp}@orderwatch.local`,
      internalDomains: "orderwatch.local",
      invite: false,
      organizationOnly
    }
  : normalizeInput(args);

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

if (!execute) {
  console.log(JSON.stringify({
    mode: "preview",
    organization: {
      slug: input.slug,
      name: input.name,
      displayName: input.displayName,
      authMode: "supabase",
      status: "trial",
      timezone: input.timezone || "Europe/Rome",
      locale: input.locale || "it-IT",
      internalDomains: input.internalDomains || ""
    },
    owner: input.organizationOnly ? null : {
      fullName: input.ownerName,
      email: input.ownerEmail,
      role: "Owner",
      inviteWillBeSent: input.invite
    },
    safety: "Nessuna modifica eseguita. Ripetere con --execute dopo la verifica."
  }, null, 2));
  process.exit(0);
}

const created = { organizationId: null, appUserId: null, authUserId: null };

try {
  await ensureAvailable(input);

  const { data: organization, error: orgError } = await admin
    .from("organizations")
    .insert({
      slug: input.slug,
      name: input.name,
      display_name: input.displayName,
      status: "trial",
      auth_mode: "supabase",
      timezone: input.timezone || "Europe/Rome",
      locale: input.locale || "it-IT"
    })
    .select("*")
    .single();
  if (orgError) throw orgError;
  created.organizationId = organization.id;

  let authUser = null;
  let appUser = null;
  if (!input.organizationOnly && input.invite) {
    const redirectTo = input.redirectTo || process.env.PUBLIC_APP_URL;
    if (!redirectTo) throw new Error("PUBLIC_APP_URL o --redirect-to e' obbligatorio per inviare l'invito.");
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.ownerEmail, {
      redirectTo,
      data: { full_name: input.ownerName, organization_slug: input.slug }
    });
    if (error) throw error;
    authUser = data.user;
    created.authUserId = authUser.id;
  }

  if (!input.organizationOnly) {
    const { data, error: userError } = await admin
      .from("app_users")
      .insert({
        organization_id: organization.id,
        auth_user_id: authUser?.id || null,
        full_name: input.ownerName,
        email: input.ownerEmail,
        role: "Owner",
        active: true,
        receives_daily_report: false,
        can_manage_settings: true,
        notes: "Primo Owner creato dal provisioning OrderWatch"
      })
      .select("*")
      .single();
    if (userError) throw userError;
    appUser = data;
    created.appUserId = appUser.id;

    const { error: membershipError } = await admin.from("organization_memberships").insert({
      organization_id: organization.id,
      app_user_id: appUser.id,
      auth_user_id: authUser?.id || null,
      role: "Owner",
      active: true,
      is_default: true
    });
    if (membershipError) throw membershipError;
  }

  const platformAdminMemberships = await attachPlatformAdministrators(organization.id, appUser?.id || null);

  const settings = await buildSettings(organization.id, input);
  const { error: settingsError } = await admin.from("settings").insert(settings);
  if (settingsError) throw settingsError;

  await verifyProvisioning(
    organization.id,
    (appUser ? 1 : 0) + platformAdminMemberships,
    settings.length
  );

  console.log(JSON.stringify({
    mode: temporaryTest ? "temporary-test" : "created",
    organization: { id: organization.id, slug: organization.slug, status: organization.status },
    owner: appUser ? { id: appUser.id, email: appUser.email, invited: Boolean(authUser) } : null,
    settingsCreated: settings.length,
    platformAdministratorsAdded: platformAdminMemberships
  }, null, 2));

  if (temporaryTest) {
    await cleanup(created);
    console.log("Temporary tenant cleanup: OK");
  }
} catch (error) {
  await cleanup(created).catch((cleanupError) => {
    console.error(`Rollback incompleto: ${cleanupError.message}`);
  });
  throw error;
}

async function ensureAvailable(input) {
  const { data: org } = await admin.from("organizations").select("id").eq("slug", input.slug).maybeSingle();
  if (org) throw new Error(`Slug gia' esistente: ${input.slug}`);
  if (input.organizationOnly) return;
  const { data: user } = await admin.from("app_users").select("id").eq("email", input.ownerEmail).maybeSingle();
  if (user) throw new Error(`Email Owner gia' registrata: ${input.ownerEmail}`);
}

async function buildSettings(organizationId, input) {
  const templateSlug = input.template || "graphic-center";
  const { data: templateOrg, error: orgError } = await admin
    .from("organizations").select("id").eq("slug", templateSlug).single();
  if (orgError) throw new Error(`Tenant modello non trovato: ${templateSlug}`);

  const { data: rows, error } = await admin
    .from("settings")
    .select("key,value,type,group,description,customer_visible,status")
    .eq("organization_id", templateOrg.id);
  if (error) throw error;

  const overrides = new Map([
    ["client.company_name", input.displayName],
    ["client.internal_domains", input.internalDomains || ""],
    ["client.monitored_mailboxes", ""],
    ["daily_report.recipient_email", ""],
    ["daily_report.recipient_name", "Buyer"],
    ["daily_report.enabled", "false"],
    ["customer_confirmation.auto_send", "false"],
    ["supplier_orders.auto_send", "false"],
    ["supplier_reminders.auto_send", "false"],
    ["workflow.traceability_mode", "assisted_link"]
  ]);

  return rows.map((row) => ({
    ...row,
    organization_id: organizationId,
    value: overrides.has(row.key) ? overrides.get(row.key) : row.value
  }));
}

async function attachPlatformAdministrators(organizationId, ownerAppUserId) {
  const { data: administrators, error } = await admin
    .from("app_users")
    .select("id,auth_user_id")
    .eq("is_platform_admin", true)
    .eq("active", true);
  if (error) throw error;

  const memberships = (administrators || [])
    .filter((administrator) => administrator.id !== ownerAppUserId)
    .map((administrator) => ({
      organization_id: organizationId,
      app_user_id: administrator.id,
      auth_user_id: administrator.auth_user_id || null,
      role: "Admin",
      active: true,
      is_default: false
    }));
  if (!memberships.length) return 0;

  const { error: membershipError } = await admin
    .from("organization_memberships")
    .upsert(memberships, { onConflict: "organization_id,app_user_id" });
  if (membershipError) throw membershipError;
  return memberships.length;
}

async function verifyProvisioning(organizationId, expectedMemberships, expectedSettings) {
  const [{ count: membershipCount, error: membershipError }, { count: settingsCount, error: settingsError }] = await Promise.all([
    admin.from("organization_memberships").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    admin.from("settings").select("id", { count: "exact", head: true }).eq("organization_id", organizationId)
  ]);
  if (membershipError) throw membershipError;
  if (settingsError) throw settingsError;
  if (membershipCount !== expectedMemberships) {
    throw new Error(`Membership non coerenti: ${membershipCount}/${expectedMemberships}.`);
  }
  if (settingsCount !== expectedSettings) throw new Error(`Settings incomplete: ${settingsCount}/${expectedSettings}`);
}

async function cleanup({ organizationId, authUserId }) {
  if (organizationId) {
    // Le FK non hanno tutte ON DELETE CASCADE: rimuoviamo esplicitamente
    // i record creati dal provisioning prima dell'organizzazione.
    for (const table of ["organization_memberships", "settings", "app_users"]) {
      const { error } = await admin.from(table).delete().eq("organization_id", organizationId);
      if (error) throw error;
    }
    const { error: organizationError } = await admin.from("organizations").delete().eq("id", organizationId);
    if (organizationError) throw organizationError;
  }
  if (authUserId) {
    const { error } = await admin.auth.admin.deleteUser(authUserId);
    if (error) throw error;
  }
}

function normalizeInput(values) {
  const slug = slugify(values.slug || "");
  const name = String(values.name || "").trim();
  const displayName = String(values["display-name"] || name).trim();
  const ownerName = String(values["owner-name"] || "").trim();
  const ownerEmail = String(values["owner-email"] || "").trim().toLowerCase();
  if (!slug) throw new Error("--slug obbligatorio.");
  if (!name) throw new Error("--name obbligatorio.");
  if (!organizationOnly && !ownerName) throw new Error("--owner-name obbligatorio senza --organization-only.");
  if (!organizationOnly && !ownerEmail.includes("@")) throw new Error("--owner-email non valida senza --organization-only.");
  return {
    slug, name, displayName, ownerName, ownerEmail,
    internalDomains: String(values["internal-domains"] || "").trim().toLowerCase(),
    timezone: String(values.timezone || "Europe/Rome").trim(),
    locale: String(values.locale || "it-IT").trim(),
    template: String(values.template || "graphic-center").trim(),
    redirectTo: values["redirect-to"],
    invite: organizationOnly ? false : values["no-invite"] !== true,
    organizationOnly
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function slugify(value) {
  return String(value).trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
