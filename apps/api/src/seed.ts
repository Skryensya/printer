// Run once to create initial service keys: bun src/seed.ts
import { initDb, createApiKey, listApiKeys } from "./db";

initDb();

const existing = listApiKeys().map(k => k.name);

const keys: Record<string, string> = {};

for (const name of ["playground", "agent"]) {
  if (existing.includes(name)) {
    console.log(`  ${name}: already exists — skipping`);
  } else {
    const { raw } = await createApiKey(name);
    keys[name] = raw;
    console.log(`  ${name}: ${raw}`);
  }
}
