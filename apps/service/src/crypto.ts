import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** 平台 key:tr- + 32 hex;只存 SHA-256 哈希 */
export function generatePlatformKey(): string {
  return `tr-${randomBytes(16).toString("hex")}`;
}

export function hashPlatformKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** 服务商 key 用 AES-256-GCM 加密落库(masterKey 派生) */
export function encryptProviderKey(masterKey: string, plaintext: string): string {
  const key = createHash("sha256").update(masterKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptProviderKey(masterKey: string, stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== "v1") throw new Error(`unsupported provider key format: ${version}`);
  const key = createHash("sha256").update(masterKey).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
