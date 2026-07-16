import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const apiBase = process.env.AUTH_TEST_API_BASE || "http://127.0.0.1:5174";

if (!url || !serviceKey || !publishableKey) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY e SUPABASE_PUBLISHABLE_KEY sono obbligatorie.");
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const publicClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const email = `auth-test-${stamp}@orderwatch.local`;
const password = `Ow-Test-${stamp}-Secure!`;
let authUserId;
let appUserId;

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError) throw createError;
  authUserId = created.user.id;

  const targetSlug = process.env.AUTH_TEST_ORGANIZATION_SLUG || "nova-vision";
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", targetSlug)
    .single();
  if (organizationError) throw organizationError;
  const { data: otherOrganization, error: otherOrganizationError } = await admin
    .from("organizations")
    .select("id")
    .neq("id", organization.id)
    .limit(1)
    .single();
  if (otherOrganizationError) throw otherOrganizationError;

  const { data: profile, error: profileError } = await admin.from("app_users").insert({
    organization_id: otherOrganization.id,
    auth_user_id: authUserId,
    full_name: "Test Auth OrderWatch",
    email,
    role: "Buyer",
    active: true,
    can_manage_settings: false,
    is_platform_admin: true
  }).select("id").single();
  if (profileError) throw profileError;
  appUserId = profile.id;

  const { error: membershipError } = await admin.from("organization_memberships").insert([
    {
      organization_id: otherOrganization.id,
      app_user_id: appUserId,
      auth_user_id: authUserId,
      role: "ReadOnly",
      active: true,
      is_default: true
    },
    {
      organization_id: organization.id,
      app_user_id: appUserId,
      auth_user_id: authUserId,
      role: "Buyer",
      active: true,
      is_default: false
    }
  ]);
  if (membershipError) throw membershipError;

  const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const token = signedIn.session.access_token;

  const sessionResponse = await fetch(`${apiBase}/api/session`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200, JSON.stringify(sessionPayload));
  assert.equal(sessionPayload.user.email, email);
  assert.equal(sessionPayload.user.role, "Buyer");
  assert.equal(sessionPayload.user.organizationSlug, targetSlug);
  assert.equal(sessionPayload.user.isPlatformAdmin, true);

  const dashboardResponse = await fetch(`${apiBase}/api/dashboard`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(dashboardResponse.status, 200);

  const settingsResponse = await fetch(`${apiBase}/api/settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "not-used" })
  });
  assert.equal(settingsResponse.status, 403);

  const { error: deactivateError } = await admin
    .from("organization_memberships")
    .update({ active: false })
    .eq("organization_id", organization.id)
    .eq("app_user_id", appUserId);
  if (deactivateError) throw deactivateError;

  const blockedSessionResponse = await fetch(`${apiBase}/api/session`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(blockedSessionResponse.status, 403);
  const blockedPayload = await blockedSessionResponse.json();
  assert.match(blockedPayload.error, /Nessuna organizzazione associata/);

  console.log("Secure auth end-to-end test: OK");
} finally {
  if (authUserId) {
    if (appUserId) await admin.from("organization_memberships").delete().eq("app_user_id", appUserId);
    await admin.from("app_users").delete().eq("auth_user_id", authUserId);
    await admin.auth.admin.deleteUser(authUserId);
  }
}
