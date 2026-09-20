import "server-only";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { loadSendingAccount } from "./accounts";
import { isOneOf } from "@/lib/domain";
import {
  NAME_VARIABLE,
  SAMPLE_FIRST_NAME,
  TEMPLATE_LIMITS,
  TEMPLATE_STATUSES,
  templateNameFrom,
  templateVariables,
  usesNameVariable,
  type TemplateStatus,
} from "./rules";
import { GraphError, createMarketingTemplate, getTemplateStatus } from "./whatsapp-api";

/**
 * WhatsApp pazarlama şablonları. Şablon Circular'da yazılır, işletmenin WhatsApp hesabında Meta onayına gönderilir;
 * onay durumu Meta bildirimiyle (webhook) veya "Durumu yenile" ile güncellenir.
 * Her pazarlama şablonunda ret bilgisi (alt metin) ve "Abonelikten çık" düğmesi zorunludur.
 */

export type TemplateView = {
  id: string;
  name: string;
  language: string;
  headerText: string | null;
  bodyText: string;
  footerText: string;
  optOutLabel: string;
  status: TemplateStatus;
  rejectionReason: string | null;
  submittedAt: Date;
  statusUpdatedAt: Date | null;
  /** Şu an bağlı numarayla gönderimde kullanılabilir mi? */
  usable: boolean;
  /** Şablon başka (önceden bağlı) bir WhatsApp hesabında oluşturulmuş */
  otherAccount: boolean;
};

/** Meta'nın şablon durumlarını Circular'ın durumlarına indirger. */
export function mapMetaTemplateStatus(status: string): TemplateStatus {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "APPROVED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "PAUSED") return "PAUSED";
  if (s === "DISABLED" || s === "DELETED" || s === "PENDING_DELETION" || s === "LIMIT_EXCEEDED") return "DISABLED";
  return "PENDING";
}

export async function listTemplates(ctx: ServiceContext): Promise<TemplateView[]> {
  assertCan(ctx, "campaigns.manage");
  const [account, rows] = await Promise.all([
    db.whatsAppAccount.findUnique({ where: { tenantId: ctx.tenantId }, select: { wabaId: true, status: true } }),
    db.messageTemplate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" } }),
  ]);
  return rows.map((t) => {
    const sameAccount = account?.wabaId === t.wabaId;
    return {
      id: t.id,
      name: t.name,
      language: t.language,
      headerText: t.headerText,
      bodyText: t.bodyText,
      footerText: t.footerText,
      optOutLabel: t.optOutLabel,
      status: isOneOf(TEMPLATE_STATUSES, t.status) ? t.status : "PENDING",
      rejectionReason: t.rejectionReason,
      submittedAt: t.submittedAt,
      statusUpdatedAt: t.statusUpdatedAt,
      usable: t.status === "APPROVED" && sameAccount && account?.status === "ACTIVE",
      otherAccount: Boolean(account) && !sameAccount,
    };
  });
}

function checkNoVariables(text: string, field: string, label: string, errors: FieldErrors) {
  if (templateVariables(text).length > 0 || /[{}]/.test(text)) errors[field] = [`${label} değişken veya süslü parantez içeremez.`];
}

export function validateTemplateInput(raw: Record<string, unknown>) {
  const errors: FieldErrors = {};
  const name = templateNameFrom(String(raw.name ?? ""));
  const headerText = cleanText(String(raw.headerText ?? ""));
  const bodyText = String(raw.bodyText ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const footerText = cleanText(String(raw.footerText ?? ""));
  const optOutLabel = cleanText(String(raw.optOutLabel ?? ""));

  if (name.length < 3) errors.name = ["Şablona en az 3 harfli bir ad verin."];
  if (headerText.length > TEMPLATE_LIMITS.header) errors.headerText = [`Başlık en fazla ${TEMPLATE_LIMITS.header} karakter olabilir.`];
  else if (headerText) checkNoVariables(headerText, "headerText", "Başlık", errors);

  if (bodyText.length < 10) errors.bodyText = ["Mesaj metnini yazın (en az 10 karakter)."];
  else if (bodyText.length > TEMPLATE_LIMITS.body) errors.bodyText = [`Mesaj en fazla ${TEMPLATE_LIMITS.body} karakter olabilir.`];
  else {
    const unknown = templateVariables(bodyText).filter((v) => v !== NAME_VARIABLE);
    if (unknown.length > 0) errors.bodyText = [`Yalnızca {{${NAME_VARIABLE}}} değişkeni kullanılabilir.`];
    else if (/^\{\{\s*ad\s*\}\}/.test(bodyText) || /\{\{\s*ad\s*\}\}[\s.!?]*$/.test(bodyText)) {
      errors.bodyText = ["Meta kuralı: mesaj değişkenle başlayamaz veya bitemez."];
    } else if (/[{}]/.test(bodyText.replace(/\{\{\s*ad\s*\}\}/g, ""))) {
      errors.bodyText = ["Süslü parantez yalnızca {{ad}} değişkeninde kullanılabilir."];
    }
  }

  if (footerText.length < 5) errors.footerText = ["Ret bilgisi zorunlu: kişinin mesaj almayı nasıl durduracağını yazın."];
  else if (footerText.length > TEMPLATE_LIMITS.footer) errors.footerText = [`Alt metin en fazla ${TEMPLATE_LIMITS.footer} karakter olabilir.`];
  else checkNoVariables(footerText, "footerText", "Alt metin", errors);

  if (optOutLabel.length < 3) errors.optOutLabel = ["Abonelikten çıkma düğmesinin metnini yazın."];
  else if (optOutLabel.length > TEMPLATE_LIMITS.button) errors.optOutLabel = [`Düğme metni en fazla ${TEMPLATE_LIMITS.button} karakter olabilir.`];

  return { errors, value: { name, headerText: headerText || null, bodyText, footerText, optOutLabel } };
}

export async function createTemplate(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "campaigns.manage");
  const sending = await loadSendingAccount(ctx.tenantId);
  if (!sending) throw new ConflictError("Şablonu Meta onayına göndermek için önce WhatsApp numarasını bağlayın.", "NO_ACCOUNT");

  const { errors, value } = validateTemplateInput(raw);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const language = "tr";

  const taken = await db.messageTemplate.findUnique({
    where: { wabaId_name_language: { wabaId: sending.account.wabaId, name: value.name, language } },
    select: { id: true },
  });
  if (taken) throw new ValidationError({ name: ["Bu adla bir şablon zaten var; farklı bir ad verin."] });

  let meta: { id: string; status: string };
  try {
    meta = await createMarketingTemplate(sending.account.wabaId, sending.token, {
      ...value,
      language,
      usesName: usesNameVariable(value.bodyText),
      sampleName: SAMPLE_FIRST_NAME,
    });
  } catch (error) {
    if (error instanceof GraphError) throw new ConflictError(`Meta şablonu kabul etmedi: ${error.message}`, "META_ERROR");
    throw error;
  }

  const now = new Date();
  return db.$transaction(async (tx) => {
    const template = await tx.messageTemplate.create({
      data: {
        tenantId: ctx.tenantId,
        accountId: sending.account.id,
        wabaId: sending.account.wabaId,
        name: value.name,
        language,
        category: "MARKETING",
        headerText: value.headerText,
        bodyText: value.bodyText,
        footerText: value.footerText,
        optOutLabel: value.optOutLabel,
        status: mapMetaTemplateStatus(meta.status),
        metaTemplateId: meta.id,
        submittedAt: now,
        statusUpdatedAt: now,
        createdByUserId: ctx.userId,
      },
    });
    await logActivity(tx, ctx, { action: "whatsapp.template_submitted", entityType: "whatsapp", entityId: template.id, metadata: { name: template.name } });
    return template;
  });
}

/** Meta'dan şablonun güncel onay durumunu çeker. */
export async function refreshTemplateStatus(ctx: ServiceContext, id: string) {
  assertCan(ctx, "campaigns.manage");
  const template = await db.messageTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!template || !template.metaTemplateId) throw new NotFoundError("Şablon bulunamadı.");
  const sending = await loadSendingAccount(ctx.tenantId);
  if (!sending || sending.account.wabaId !== template.wabaId) {
    throw new ConflictError("Bu şablonun oluşturulduğu WhatsApp hesabı bağlı değil.", "NO_ACCOUNT");
  }
  try {
    const meta = await getTemplateStatus(template.metaTemplateId, sending.token);
    return db.messageTemplate.update({
      where: { id: template.id },
      data: { status: mapMetaTemplateStatus(meta.status), rejectionReason: meta.rejectedReason, statusUpdatedAt: new Date() },
    });
  } catch (error) {
    if (error instanceof GraphError) throw new ConflictError(`Meta: ${error.message}`, "META_ERROR");
    throw error;
  }
}

/** Webhook: Meta şablon durum bildirimi. Şablon Meta kimliği ve hesabıyla eşleşmelidir. */
export async function applyTemplateStatusUpdate(input: { wabaId: string; metaTemplateId: string; event: string; reason: string | null }) {
  const status = mapMetaTemplateStatus(input.event);
  const reason = input.reason && input.reason !== "NONE" ? input.reason.slice(0, 300) : null;
  return db.messageTemplate.updateMany({
    where: { metaTemplateId: input.metaTemplateId, wabaId: input.wabaId },
    data: { status, rejectionReason: status === "REJECTED" ? reason : null, statusUpdatedAt: new Date() },
  });
}
