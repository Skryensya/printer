// Run once to create initial service keys: bun src/seed.ts
import { migrate, createApiKey, listApiKeys } from "./db";

await migrate();

const existing = (await listApiKeys()).map(k => k.name);

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
