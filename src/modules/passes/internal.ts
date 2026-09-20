import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { qrSvgPath } from "@/lib/qr/encoder";
import { evaluateEntryPass, evaluatePerkPass, type PassPurpose, type PassState } from "./rules";
import { derivePassToken, hashPassToken, isWellFormedPassToken, passScanUrl, passViewUrl } from "./token";

/** Pass oluşturur: id önceden üretilir, token id'den türetilir, DB'ye yalnızca token özeti yazılır. */
export async function createPass(
  tx: Tx,
  data: {
    tenantId: string;
    purpose: PassPurpose;
    customerId: string;
    registrationId?: string | null;
    perkId?: string | null;
    maxUses: number;
    /** null: herkese açık akışta sistemin verdiği kod (ör. menüden kayıt olan yeni üyeye avantaj) */
    issuedByUserId: string | null;
  },
) {
  const id = randomUUID();
  return tx.pass.create({ data: { id, tokenHash: hashPassToken(derivePassToken(id)), ...data } });
}

export type PassShare = {
  passId: string;
  /** Müşteriye gönderilecek kişisel QR sayfası */
  viewUrl: string;
  /** QR'ın içeriği (okutulunca açılan doğrulama adresi) */
  scanUrl: string;
  qr: { viewBox: number; d: string };
  useCount: number;
  maxUses: number;
  issuedAt: string;
};

export function sharePass(pass: { id: string; useCount: number; maxUses: number; createdAt: Date }): PassShare {
  const token = derivePassToken(pass.id);
  const scanUrl = passScanUrl(token);
  return {
    passId: pass.id,
    viewUrl: passViewUrl(token),
    scanUrl,
    qr: qrSvgPath(scanUrl),
    useCount: pass.useCount,
    maxUses: pass.maxUses,
    issuedAt: pass.createdAt.toISOString(),
  };
}

const PASS_INCLUDE = {
  // Pass'in tenant'ı, composite FK ile aynı tenant'a bağlı müşteri üzerinden okunur.
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      archivedAt: true,
      tenant: { select: { id: true, name: true, status: true } },
    },
  },
  registration: { include: { event: { include: { venue: { select: { id: true, name: true } } } } } },
  perk: { include: { venue: { select: { id: true, name: true } } } },
} satisfies Prisma.PassInclude;

/** Token ile pass bulur. tenantId verilirse yalnızca o tenant içinde arar. Biçimsiz token DB'ye gitmez. */
export async function findPassByToken(token: string, tenantId?: string) {
  if (!isWellFormedPassToken(token)) return null;
  const pass = await db.pass.findFirst({
    where: { tokenHash: hashPassToken(token), ...(tenantId ? { tenantId } : {}) },
    include: PASS_INCLUDE,
  });
  return pass ? { ...pass, tenant: pass.customer.tenant } : null;
}

export type LoadedPass = NonNullable<Awaited<ReturnType<typeof findPassByToken>>>;

/** Pass'in güncel durumunu hesaplar (avantajlarda kişinin toplam kullanımını da sayar). */
export async function evaluateLoadedPass(pass: LoadedPass, now = new Date()): Promise<{ state: PassState; redemptions: number }> {
  if (pass.tenant.status !== "ACTIVE") return { state: "REVOKED", redemptions: 0 };
  if (pass.purpose === "EVENT_ENTRY" && pass.registration) {
    return { state: evaluateEntryPass(pass, pass.registration, pass.registration.event, now), redemptions: 0 };
  }
  if (pass.purpose === "PERK_REDEMPTION" && pass.perk) {
    const redemptions = await db.perkRedemption.count({
      where: { tenantId: pass.tenantId, perkId: pass.perk.id, customerId: pass.customerId },
    });
    return { state: evaluatePerkPass(pass, pass.perk, redemptions, now), redemptions };
  }
  return { state: "REVOKED", redemptions: 0 };
}

export const SERIALIZABLE = { isolationLevel: "Serializable" as Prisma.TransactionIsolationLevel };
