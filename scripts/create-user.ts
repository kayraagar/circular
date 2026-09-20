/**
 * Var olan bir işletmeye ekip üyesi ekler (kapı görevlisi, PR, garson, CRM yöneticisi).
 * Panelde ekip yönetimi ekranı gelene kadar kullanılır.
 *
 * Çalıştırma:
 *   npm run create:user -- --isletme circular-demo --rol DOOR \
 *     --ad "Kapı Görevlisi" --eposta kapi@ornek.com --sifre "..." [--mekan orbita-kulup]
 *
 * --isletme: işletme kısa adı (slug). Tek işletme varsa yazılmasa da olur.
 * --mekan:   verilirse üye yalnızca o mekana erişir (kapı/garson için tipik).
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { ROLES, ROLE_LABELS, isOneOf } from "../src/lib/domain";

const db = new PrismaClient();

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return "";
  const parts: string[] = [];
  for (let k = i + 1; k < process.argv.length && !process.argv[k].startsWith("--"); k++) parts.push(process.argv[k]);
  return parts.join(" ").trim();
}

async function main() {
  if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
    console.error('DATABASE_URL tanımlı değil veya geçersiz (postgresql:// ile başlamalı).');
    process.exit(1);
  }
  const role = arg("rol").toUpperCase();
  const name = arg("ad");
  const email = arg("eposta").toLowerCase();
  const password = arg("sifre");
  const tenantSlug = arg("isletme");
  const venueSlug = arg("mekan");

  if (!isOneOf(ROLES, role)) {
    console.error(`--rol şunlardan biri olmalı: ${ROLES.map((r) => `${r} (${ROLE_LABELS[r]})`).join(", ")}`);
    process.exit(1);
  }
  if (!name || !email || password.length < 10) {
    console.error("--ad, --eposta ve en az 10 karakterli --sifre zorunludur.");
    process.exit(1);
  }

  const tenants = await db.tenant.findMany({ select: { id: true, name: true, slug: true } });
  const tenant = tenantSlug ? tenants.find((t) => t.slug === tenantSlug) : tenants.length === 1 ? tenants[0] : undefined;
  if (!tenant) {
    console.error(tenantSlug ? `İşletme bulunamadı: ${tenantSlug}` : `--isletme yazın. Mevcut işletmeler: ${tenants.map((t) => t.slug).join(", ") || "yok"}`);
    process.exit(1);
  }

  const venue = venueSlug ? await db.venue.findFirst({ where: { tenantId: tenant.id, slug: venueSlug } }) : null;
  if (venueSlug && !venue) {
    const all = await db.venue.findMany({ where: { tenantId: tenant.id }, select: { slug: true } });
    console.error(`Mekan bulunamadı: ${venueSlug}. Mevcut mekanlar: ${all.map((v) => v.slug).join(", ") || "yok"}`);
    process.exit(1);
  }

  const existing = await db.user.findUnique({ where: { email }, include: { memberships: true } });
  if (existing?.memberships.some((m) => m.tenantId === tenant.id)) {
    console.error(`Bu kullanıcı zaten ${tenant.name} işletmesinde üye: ${email}`);
    process.exit(1);
  }

  const user = existing ?? (await db.user.create({ data: { email, name, passwordHash: await hashPassword(password) } }));
  const membership = await db.membership.create({ data: { userId: user.id, tenantId: tenant.id, role } });
  if (venue) await db.membershipVenue.create({ data: { membershipId: membership.id, venueId: venue.id, tenantId: tenant.id } });

  console.log(`✔ ${ROLE_LABELS[role]}: ${user.email} → ${tenant.name}${venue ? ` (yalnızca ${venue.name})` : ""}`);
  if (existing) console.log("ℹ Bu e-posta zaten kayıtlıydı; mevcut şifresi geçerli, yeni şifre uygulanmadı.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
