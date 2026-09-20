import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Kanal erişim token'ları için şifreleme (AES-256-GCM).
 * Anahtar CHANNEL_TOKEN_SECRET'tan türetilir; biçim: v1.<iv>.<tag>.<şifreli metin> (base64url).
 * Anahtar değişirse kayıtlı token'lar çözülemez ve numaranın yeniden bağlanması gerekir.
 */

function key(): Buffer {
  const secret = process.env.CHANNEL_TOKEN_SECRET ?? "";
  if (secret.length < 32) throw new Error("CHANNEL_TOKEN_SECRET tanımlı değil veya 32 karakterden kısa (.env dosyasını kontrol edin).");
  return createHash("sha256").update(`circular-channel:v1:${secret}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Çözülemezse (anahtar değişmiş, veri bozuk) null döner. */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
