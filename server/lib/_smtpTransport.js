import nodemailer from "nodemailer";
import { decryptSecret } from "./_mailboxCrypto.js";

export function buildMailboxSmtpOptions(mailbox, password) {
  const host = String(mailbox?.smtp_host || "").trim();
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

export function createMailboxSmtpTransport(mailbox, {
  dryRun = false,
  decrypt = decryptSecret,
  createTransport = nodemailer.createTransport
} = {}) {
  if (dryRun) return createTransport({ jsonTransport: true });

  const password = decrypt(mailbox?.encrypted_password);
  return createTransport(buildMailboxSmtpOptions(mailbox, password));
}
