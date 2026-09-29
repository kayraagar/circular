import "server-only";
import { db } from "@/lib/db";
import { brand } from "@/config/brand";
import { open } from "@/modules/campaigns/secret-box";
import { sendSms, toNetgsmNumber, type NetgsmCredentials } from "@/modules/campaigns/netgsm-api";

/**
 * Doğrulama SMS'i gönderimi.
 *
 * Doğrulama kodu **ticari ileti değildir**: İYS onayı aranmaz (`iysfilter: "0"`), çünkü
 * kişinin kendi başlattığı bir işlemin parçasıdır. Bu yüzden kampanya gönderiminden ayrı
 * tutulur ve kampanya kuyruğuna yazılmaz.
 */

export type SmsSender = { creds: NetgsmCredentials; msgheader: string; tenantName: string };

/** İşletmenin bağlı SMS hesabı; yoksa null (doğrulama sunulmaz). */
export async function smsSenderFor(tenantId: string): Promise<SmsSender | null> {
  const account = await db.smsAccount.findUnique({ where: { tenantId } });
  if (!account || account.status !== "ACTIVE") return null;
  const password = open(account.passwordEnc);
  if (!password) return null;
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  return {
    creds: { username: account.username, password },
    msgheader: account.msgheader,
    tenantName: tenant?.name ?? brand.name,
  };
}

/** Kod metni kısa tutulur: tek SMS'e sığsın ve kopyalanması kolay olsun. */
export function verificationMessage(tenantName: string, code: string): string {
  return `${tenantName} dogrulama kodunuz: ${code}. Kod 10 dakika gecerlidir. Bu istegi siz yapmadiysaniz dikkate almayin.`;
}

export async function sendVerificationSms(sender: SmsSender, phone: string, code: string): Promise<void> {
  await sendSms(sender.creds, {
    msgheader: sender.msgheader,
    messages: [{ msg: verificationMessage(sender.tenantName, code), no: toNetgsmNumber(phone) }],
    iysfilter: "0",
  });
}
