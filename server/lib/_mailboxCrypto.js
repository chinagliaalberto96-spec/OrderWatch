import crypto from "crypto";

const VERSION = "v1";

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY missing.");

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

  const buffer = Buffer.from(raw, "base64");
  if (buffer.length === 32) return buffer;

  throw new Error("ENCRYPTION_KEY must be 32 bytes, hex or base64.");
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(":");
}

export function decryptSecret(payload) {
  if (!payload) return "";
  const [version, iv, tag, encrypted] = String(payload).split(":");
  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error("Invalid encrypted secret format.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}
