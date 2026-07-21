import nodemailer from "nodemailer";
import { decryptSecret } from "./_mailboxCrypto.js";
import { normalizePublicMailHostname, resolvePublicMailHost } from "./_mailHostSecurity.js";

export function buildMailboxSmtpOptions(mailbox, password) {
  const host = normalizePublicMailHostname(mailbox?.smtp_host);
  const user = String(mailbox?.email_address || "").trim();
  const port = Number(mailbox?.smtp_port || 465);

  if (!host || !user || !password || !Number.isInteger(port) || port <= 0) {
    throw new Error("Configurazione SMTP non valida.");
  }

  const implicitTls = port === 465;
  return {
    host,
    port,
    secure: implicitTls,
    ...(implicitTls ? {} : { requireTLS: true }),
    auth: { user, pass: password },
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    }
  };
}

export async function createMailboxSmtpTransport(mailbox, {
  dryRun = false,
  decrypt = decryptSecret,
  createTransport = nodemailer.createTransport,
  resolveHost = resolvePublicMailHost
} = {}) {
  if (dryRun) return createTransport({ jsonTransport: true });

  const password = decrypt(mailbox?.encrypted_password);
  const target = await resolveHost(mailbox?.smtp_host);
  const options = buildMailboxSmtpOptions(mailbox, password);
  options.host = target.address;
  options.tls.servername = target.hostname;
  return createTransport(options);
}
