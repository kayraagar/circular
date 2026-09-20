// Test çalıştırıcı: ayrı bir Postgres veritabanını sıfırlar ve node:test ile testleri koşar.
// Varsayılan yerel veritabanı: postgresql://<kullanıcı>@localhost:5432/circular_test
// Başka bir veritabanı için: TEST_DATABASE_URL=... npm test
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgresql://${process.env.USER ?? "postgres"}@localhost:5432/circular_test`,
  NODE_ENV: "test",
  PASS_TOKEN_SECRET: "test-only-pass-token-secret-0123456789abcdef",
  APP_BASE_URL: "http://test.local",
};

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  if (r.error) console.error(r.error);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Şemayı sıfırdan kurar: testler her koşuda temiz veritabanıyla başlar.
run("npx", ["tsx", "scripts/reset-test-db.ts"]);
run("npx", ["prisma", "migrate", "deploy"]);

const files = readdirSync(join(root, "tests"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join("tests", f));

// react-server koşulu: "server-only" paketinin sunucu dışı hata atmasını engeller
run("npx", ["tsx", "--conditions=react-server", "--test", "--test-concurrency=1", ...files]);
