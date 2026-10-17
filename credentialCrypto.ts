import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  const encoded = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error("Refusing to encrypt an empty credential");
  if (isEncryptedSecret(plaintext)) return plaintext;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([nonce, tag, ciphertext]).toString("base64");
}

export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) {
    throw new Error("Credential is not encrypted. Run the credential migration before starting trading.");
  }
  const payload = Buffer.from(value.slice(PREFIX.length), "base64");
  if (payload.length < 29) throw new Error("Encrypted credential payload is invalid");
  const nonce = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
