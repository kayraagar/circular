// Test çalıştırıcı: ayrı bir SQLite dosyasına migration uygular ve node:test ile testleri koşar.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = {
  ...process.env,
  DATABASE_URL: "file:./test.db",
  NODE_ENV: "test",
  PASS_TOKEN_SECRET: "test-only-pass-token-secret-0123456789abcdef",
  APP_BASE_URL: "http://test.local",
};

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  if (r.error) console.error(r.error);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

for (const f of ["test.db", "test.db-journal"]) rmSync(join(root, "prisma", f), { force: true });
run("npx", ["prisma", "migrate", "deploy"]);

const files = readdirSync(join(root, "tests"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join("tests", f));

// react-server koşulu: "server-only" paketinin sunucu dışı hata atmasını engeller
run("npx", ["tsx", "--conditions=react-server", "--test", "--test-concurrency=1", ...files]);
