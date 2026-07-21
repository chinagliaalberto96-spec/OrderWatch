const SECRET_KEYS = [
  "authorization",
  "encrypted_password",
  "password",
  "pass",
  "token",
  "api_key",
  "apikey",
  "service_role",
  "service key",
  "connection_string",
  "imap_password",
  "smtp_password"
];

const SECRET_ENV_KEYS = [
  "ENCRYPTION_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SECRET_KEY",
  "SMTP_PASS",
  "IMAP_ADMIN_PASS",
  "IMAP_TITOLARE_PASS"
];

export function redactSensitiveText(value, fallback = "Errore tecnico non disponibile.") {
  let text = String(value || "").trim();
  if (!text) return fallback;

  for (const key of SECRET_ENV_KEYS) {
    const secret = String(process.env[key] || "");
    if (secret.length >= 6) text = text.split(secret).join("[REDACTED]");
  }

  const keyPattern = SECRET_KEYS.map(escapeRegExp).join("|");
  text = text
    .replace(
      new RegExp(`\\b(${keyPattern})\\b\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;]+)`, "gi"),
      "$1=[REDACTED]"
    )
    .replace(/\b((?:imap|smtp|postgres(?:ql)?)s?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");

  return text.slice(0, 500);
}

export function sanitizeSecurityError(error, fallback = "Errore tecnico non disponibile.") {
  return redactSensitiveText(error?.message || error, fallback);
}

export function publicMailboxError(value) {
  if (!value) return null;
  return "Verifica connessione non riuscita. Controllare la configurazione della casella.";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
