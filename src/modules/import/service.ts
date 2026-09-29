import "server-only";
import { db, isUniqueViolation } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ValidationError } from "@/lib/errors";
import { cleanText, foldText, normalizeEmail, normalizePhone } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { IMPORT_FIELDS, MAX_ROWS, guessMapping, looksLikeHeader, parseCsv, type ImportField } from "./csv";

/**
 * CSV ile müşteri içe aktarma.
 *
 * **İzin içe aktarılmaz.** Bir dosyada telefon bulunması o kişinin ticari ileti almaya razı
 * olduğunu göstermez; İYS ve KVKK açısından iznin nasıl alındığı kanıtlanabilir olmalıdır.
 * Bu yüzden içe aktarılan kayıtlar izinsiz açılır. İşletme izinlerin nasıl alındığını
 * yazarak (personel kaydı gibi) toplu izin işaretleyebilir — o zaman not zorunludur ve
 * her izin kaydına yazılır.
 *
 * Mükerrer kayıt **asla ezilmez**: aynı telefon/e-posta zaten varsa satır ya atlanır ya da
 * yalnızca **boş** alanları doldurulur (seçime bağlı). Var olan bilgi hiçbir durumda değişmez.
 */

export type RowIssue = "NO_NAME" | "BAD_PHONE" | "NO_CONTACT" | "BAD_EMAIL" | "BAD_BIRTHDATE" | "DUPLICATE_IN_FILE";

export type ParsedRow = {
  line: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  tags: string[];
  notes: string | null;
  issues: RowIssue[];
  /** Aynı işletmede eşleşen mevcut kayıt (telefon veya e-posta ile). */
  existingId: string | null;
  existingName: string | null;
};

export type ImportPreview = {
  total: number;
  ready: number;
  duplicates: number;
  invalid: number;
  rows: ParsedRow[];
  mapping: Record<ImportField, number>;
  headerSkipped: boolean;
  truncated: boolean;
};

const BIRTH_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BIRTH_TR_RE = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;

/** "1990-05-05" veya "05.05.1990" kabul edilir. */
function parseBirthDate(raw: string): { value: string | null; bad: boolean } {
  const value = raw.trim();
  if (!value) return { value: null, bad: false };
  if (BIRTH_RE.test(value)) return { value, bad: false };
  const tr = BIRTH_TR_RE.exec(value);
  if (!tr) return { value: null, bad: true };
  const [, d, m, y] = tr;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return BIRTH_RE.test(iso) ? { value: iso, bad: false } : { value: null, bad: true };
}

function cell(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index].trim() : "";
}

/**
 * Dosyayı okur, satırları doğrular ve mevcut kayıtlarla eşleştirir. Hiçbir şey yazmaz.
 * `mapping` verilmezse başlıktan tahmin edilir.
 */
export async function previewImport(
  ctx: ServiceContext,
  text: string,
  override?: Partial<Record<ImportField, number>>,
): Promise<ImportPreview> {
  assertCan(ctx, "customers.create");
  const all = parseCsv(text);
  if (all.length === 0) throw new ValidationError({ file: ["Dosyada satır bulunamadı."] });

  const headerSkipped = looksLikeHeader(all[0]);
  const mapping = { ...guessMapping(all[0]), ...override } as Record<ImportField, number>;
  if (mapping.firstName === -1 && mapping.lastName === -1) {
    throw new ValidationError({ file: ["Ad sütunu bulunamadı. Başlık satırını kontrol edin."] });
  }

  const body = headerSkipped ? all.slice(1) : all;
  const truncated = body.length > MAX_ROWS;
  const limited = body.slice(0, MAX_ROWS);

  const rows: ParsedRow[] = [];
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();

  for (const [i, raw] of limited.entries()) {
    const issues: RowIssue[] = [];
    const firstName = cleanText(cell(raw, mapping.firstName)).slice(0, 80);
    const lastName = cleanText(cell(raw, mapping.lastName)).slice(0, 80);
    if (!firstName && !lastName) issues.push("NO_NAME");

    const phoneRaw = cell(raw, mapping.phone);
    const parsedPhone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const phone = parsedPhone && parsedPhone.ok ? parsedPhone.e164 : null;
    if (phoneRaw && !phone) issues.push("BAD_PHONE");

    const emailRaw = cell(raw, mapping.email);
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    if (emailRaw && (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) issues.push("BAD_EMAIL");

    if (!phone && !email) issues.push("NO_CONTACT");

    const birth = parseBirthDate(cell(raw, mapping.birthDate));
    if (birth.bad) issues.push("BAD_BIRTHDATE");

    // Dosyanın kendi içindeki tekrarlar: ilk satır geçerli sayılır.
    if (phone && seenPhone.has(phone)) issues.push("DUPLICATE_IN_FILE");
    if (email && seenEmail.has(email)) issues.push("DUPLICATE_IN_FILE");
    if (phone) seenPhone.add(phone);
    if (email) seenEmail.add(email);

    rows.push({
      line: i + (headerSkipped ? 2 : 1),
      firstName,
      lastName,
      phone,
      email: email && !issues.includes("BAD_EMAIL") ? email : null,
      birthDate: birth.value,
      tags: cell(raw, mapping.tags)
        .split(/[,;|]/)
        .map((t) => cleanText(t).slice(0, 40))
        .filter(Boolean)
        .slice(0, 10),
      notes: cleanText(cell(raw, mapping.notes)).slice(0, 500) || null,
      issues,
      existingId: null,
      existingName: null,
    });
  }

  // Mevcut kayıtlarla eşleştirme tek sorguda yapılır.
  const phones = rows.map((r) => r.phone).filter((p): p is string => p !== null);
  const emails = rows.map((r) => r.email).filter((e): e is string => e !== null);
  const existing = await db.customer.findMany({
    where: { tenantId: ctx.tenantId, OR: [{ phone: { in: phones } }, { email: { in: emails } }] },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true },
  });
  const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [c.phone!, c]));
  const byEmail = new Map(existing.filter((c) => c.email).map((c) => [c.email!, c]));
  for (const row of rows) {
    const match = (row.phone ? byPhone.get(row.phone) : undefined) ?? (row.email ? byEmail.get(row.email) : undefined);
    if (match) {
      row.existingId = match.id;
      row.existingName = `${match.firstName} ${match.lastName}`.trim();
    }
  }

  const invalid = rows.filter((r) => r.issues.length > 0).length;
  const duplicates = rows.filter((r) => r.issues.length === 0 && r.existingId).length;
  return {
    total: rows.length,
    ready: rows.length - invalid - duplicates,
    duplicates,
    invalid,
    rows,
    mapping,
    headerSkipped,
    truncated,
  };
}

export type ImportOptions = {
  /** Mevcut kayıtta yalnızca boş alanları doldur (var olan bilgi asla değişmez). */
  fillExisting: boolean;
  /** İşaretlenen kanallar için izin kaydı açılır; nasıl alındığı `consentNote` ile yazılır. */
  consentChannels: string[];
  consentNote: string;
};

export type ImportResult = { created: number; updated: number; skipped: number; invalid: number };

/** Önizlemedeki satırları yazar. Doğrulamadan geçmeyen satırlar atlanır. */
export async function runImport(ctx: ServiceContext, text: string, options: ImportOptions, override?: Partial<Record<ImportField, number>>): Promise<ImportResult> {
  assertCan(ctx, "customers.create");
  const channels = options.consentChannels.filter((c) => c === "WHATSAPP" || c === "SMS" || c === "EMAIL");
  const note = cleanText(options.consentNote).slice(0, 300);
  if (channels.length > 0 && note.length < 5) {
    // İzin kaydı kanıt ister: nasıl alındığı yazılmadan toplu izin verilemez.
    throw new ValidationError({ consentNote: ["İznin nasıl alındığını yazın (İYS ve KVKK için gereklidir)."] });
  }
  if (channels.length > 0) assertCan(ctx, "consents.manage");

  const preview = await previewImport(ctx, text, override);
  const now = new Date();
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, invalid: preview.invalid };

  for (const row of preview.rows) {
    if (row.issues.length > 0) continue;

    if (row.existingId) {
      if (!options.fillExisting) {
        result.skipped += 1;
        continue;
      }
      const current = await db.customer.findFirst({ where: { id: row.existingId, tenantId: ctx.tenantId } });
      if (!current) continue;
      // Yalnızca boş alanlar doldurulur; dolu alan asla ezilmez.
      const data: Record<string, unknown> = {};
      if (!current.phone && row.phone) data.phone = row.phone;
      if (!current.email && row.email) data.email = row.email;
      if (!current.birthDate && row.birthDate) data.birthDate = row.birthDate;
      if (!current.notes && row.notes) data.notes = row.notes;
      if (Object.keys(data).length === 0) {
        result.skipped += 1;
        continue;
      }
      await db.$transaction(async (tx) => {
        await tx.customer.update({ where: { id: current.id }, data });
        await logActivity(tx, ctx, {
          action: "customer.updated",
          entityType: "customer",
          entityId: current.id,
          customerId: current.id,
          metadata: { customerName: `${current.firstName} ${current.lastName}`.trim(), via: "IMPORT", fields: Object.keys(data) },
        });
      });
      result.updated += 1;
      continue;
    }

    try {
      await db.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            tenantId: ctx.tenantId,
            firstName: row.firstName || row.lastName,
            lastName: row.firstName ? row.lastName : "",
            searchName: foldText(`${row.firstName} ${row.lastName}`),
            phone: row.phone,
            email: row.email,
            birthDate: row.birthDate,
            notes: row.notes,
            source: "IMPORT",
            createdByUserId: ctx.userId,
          },
        });
        const customerName = `${customer.firstName} ${customer.lastName}`.trim();

        for (const name of row.tags) {
          const nameKey = foldText(name);
          const tag = await tx.tag.upsert({
            where: { tenantId_nameKey: { tenantId: ctx.tenantId, nameKey } },
            create: { tenantId: ctx.tenantId, name, nameKey },
            update: {},
          });
          await tx.customerTag.create({ data: { tenantId: ctx.tenantId, customerId: customer.id, tagId: tag.id } });
        }

        await logActivity(tx, ctx, {
          action: "customer.created",
          entityType: "customer",
          entityId: customer.id,
          customerId: customer.id,
          metadata: { customerName, sourceLabel: "İçe aktarım" },
        });

        for (const channel of channels) {
          const consent = await tx.contactConsent.create({
            data: {
              tenantId: ctx.tenantId,
              customerId: customer.id,
              channel,
              status: "GRANTED",
              source: "STAFF_RECORDED",
              note,
              recordedByUserId: ctx.userId,
              grantedAt: now,
            },
          });
          await logActivity(tx, ctx, {
            action: "consent.granted",
            entityType: "consent",
            entityId: consent.id,
            customerId: customer.id,
            metadata: { customerName, channel, note, via: "IMPORT" },
          });
        }
      });
      result.created += 1;
    } catch (error) {
      // Eşzamanlı ikinci içe aktarım aynı kişiyi açmış olabilir: satır atlanır.
      if (isUniqueViolation(error)) result.skipped += 1;
      else throw error;
    }
  }

  return result;
}

export { IMPORT_FIELDS };
