/**
 * Üretimde ilk işletmeyi ve işletme sahibini oluşturur (demo verisi yüklemeden).
 *
 * Çalıştırma:
 *   npm run create:owner -- --isletme "Orbita Hospitality" --mekan "Orbita Kulüp" \
 *     --ad "Kayra Ağar" --eposta "kayra@ornek.com" --sifre "..."
 *
 * Var olan e-posta ile çalıştırılırsa kullanıcıyı mevcut işletmeye eklemez, hata verir.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { foldText } from "../src/lib/normalize";

const db = new PrismaClient();

/** --ad Kayra Ağar → "Kayra Ağar" (tırnak unutulsa da sonraki --seçeneğe kadar okur). */
function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return "";
  const parts: string[] = [];
  for (let k = i + 1; k < process.argv.length && !process.argv[k].startsWith("--"); k++) parts.push(process.argv[k]);
  return parts.join(" ").trim();
}

const slugify = (value: string) =>
  foldText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error(
      [
        "DATABASE_URL tanımlı değil veya geçersiz.",
        "Komutun başına veritabanı adresini ekleyin; adres postgresql:// ile başlamalı:",
        '  DATABASE_URL="postgresql://..." DATABASE_URL_UNPOOLED="postgresql://..." npm run create:owner -- --isletme "..." ...',
      ].join("\n"),
    );
    process.exit(1);
  }
  const tenantName = arg("isletme");
  const venueName = arg("mekan");
  const name = arg("ad");
  const email = arg("eposta").toLowerCase();
  const password = arg("sifre");

  const missing = [
    ["--isletme", tenantName],
    ["--mekan", venueName],
    ["--ad", name],
    ["--eposta", email],
    ["--sifre", password],
  ].filter(([, v]) => !v);
  if (missing.length) {
    console.error(`Eksik parametre: ${missing.map(([k]) => k).join(", ")}`);
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("Şifre en az 10 karakter olmalı.");
    process.exit(1);
  }
  if (await db.user.findUnique({ where: { email } })) {
    console.error(`Bu e-posta zaten kayıtlı: ${email}`);
    process.exit(1);
  }

  const tenantSlug = slugify(tenantName);
  const venueSlug = slugify(venueName);
  if (await db.tenant.findUnique({ where: { slug: tenantSlug } })) {
    console.error(`Bu işletme adı zaten kullanılıyor: ${tenantSlug}`);
    process.exit(1);
  }

  const result = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: tenantName, slug: tenantSlug } });
    const venue = await tx.venue.create({ data: { tenantId: tenant.id, name: venueName, slug: venueSlug, type: "CLUB" } });
    const user = await tx.user.create({ data: { email, name, passwordHash: await hashPassword(password) } });
    await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER_ADMIN" } });
    return { tenant, venue, user };
  });

  console.log(`✔ İşletme: ${result.tenant.name} (/${result.tenant.slug})`);
  console.log(`✔ Mekan:   ${result.venue.name}`);
  console.log(`✔ Sahip:   ${result.user.email}`);
  console.log("Menü adresi: /m/" + result.tenant.slug);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
