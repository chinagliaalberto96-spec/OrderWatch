import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
const execute = Boolean(args.execute);
const sendInvite = Boolean(args["send-invite"]);
const email = String(args.email || "").trim().toLowerCase();
const fullName = String(args.name || "").trim();
const defaultOrganizationSlug = String(args["default-organization"] || "graphic-center").trim().toLowerCase();
const redirectTo = String(args["redirect-to"] || process.env.PUBLIC_APP_URL || "").trim();
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!email.includes("@")) throw new Error("--email non valida.");
if (!fullName) throw new Error("--name obbligatorio.");
if (!url || !serviceKey) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_KEY sono obbligatorie.");
if (sendInvite && !redirectTo) throw new Error("--redirect-to o PUBLIC_APP_URL obbligatorio con --send-invite.");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: organizations, error: organizationsError } = await admin
  .from("organizations")
  .select("id,slug,name")
  .order("slug");
if (organizationsError) throw organizationsError;
if (!organizations?.length) throw new Error("Nessuna organizzazione disponibile.");

const defaultOrganization = organizations.find((organization) => organization.slug === defaultOrganizationSlug);
if (!defaultOrganization) throw new Error(`Organizzazione predefinita non trovata: ${defaultOrganizationSlug}`);

if (!execute) {
  console.log(JSON.stringify({
    mode: "preview",
    administrator: { fullName, email, sendInvite },
    defaultOrganization: defaultOrganization.slug,
    memberships: organizations.map((organization) => ({ organization: organization.slug, role: "Admin" })),
    safety: "Nessuna modifica eseguita. Ripetere con --execute dopo la verifica."
  }, null, 2));
  process.exit(0);
}

let { data: appUser, error: appUserLookupError } = await admin
  .from("app_users")
  .select("*")
  .eq("email", email)
  .maybeSingle();
if (appUserLookupError) throw appUserLookupError;

let authUserId = appUser?.auth_user_id || null;
if (sendInvite && !authUserId) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name: fullName }
  });
  if (error) throw error;
  authUserId = data.user.id;
}

const profile = {
  organization_id: appUser?.organization_id || defaultOrganization.id,
  auth_user_id: authUserId,
  full_name: fullName,
  email,
  role: "Admin",
  active: true,
  receives_daily_report: false,
  can_manage_settings: true,
  is_platform_admin: true,
  notes: "Amministratore interno OrderWatch"
};

if (appUser) {
  const { data, error } = await admin
    .from("app_users")
    .update(profile)
    .eq("id", appUser.id)
    .select("*")
    .single();
  if (error) throw error;
  appUser = data;
} else {
  const { data, error } = await admin
    .from("app_users")
    .insert(profile)
    .select("*")
    .single();
  if (error) throw error;
  appUser = data;
}

const { error: clearDefaultError } = await admin
  .from("organization_memberships")
  .update({ is_default: false })
  .eq("app_user_id", appUser.id);
if (clearDefaultError) throw clearDefaultError;

const memberships = organizations.map((organization) => ({
  organization_id: organization.id,
  app_user_id: appUser.id,
  auth_user_id: authUserId,
  role: "Admin",
  active: true,
  is_default: organization.id === defaultOrganization.id
}));
const { error: membershipError } = await admin
  .from("organization_memberships")
  .upsert(memberships, { onConflict: "organization_id,app_user_id" });
if (membershipError) throw membershipError;

const { data: verifiedMemberships, error: verifyError } = await admin
  .from("organization_memberships")
  .select("organization_id,role,active,is_default")
  .eq("app_user_id", appUser.id);
if (verifyError) throw verifyError;
if (verifiedMemberships.length !== organizations.length) {
  throw new Error(`Membership incomplete: ${verifiedMemberships.length}/${organizations.length}`);
}

console.log(JSON.stringify({
  mode: "configured",
  administrator: {
    id: appUser.id,
    fullName: appUser.full_name,
    email: appUser.email,
    authCreated: Boolean(authUserId),
    inviteSent: sendInvite
  },
  defaultOrganization: defaultOrganization.slug,
  memberships: organizations.map((organization) => organization.slug)
}, null, 2));

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
