/**
 * Test veritabanını sıfırlar: public şemasını düşürüp yeniden oluşturur.
 * Yalnızca test veritabanında çalışır (adı "test" içermeyen veritabanında durur).
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/test/i.test(url)) {
  console.error("reset-test-db: DATABASE_URL bir test veritabanı değil, iptal edildi.");
  process.exit(1);
}

const db = new PrismaClient();
async function reset() {
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "public" CASCADE');
  await db.$executeRawUnsafe('CREATE SCHEMA "public"');
  await db.$disconnect();
}
reset();
