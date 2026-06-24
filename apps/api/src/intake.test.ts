import { describe, test, expect, beforeEach } from "bun:test";
import { resetDbForTest, getJob } from "./db";
import { initQueue } from "./queue";
import { intakeMessage } from "./intake";

beforeEach(async () => {
  await resetDbForTest();
  initQueue({ broadcast: () => {}, pushToAgent: () => true });
});

// The wall relays the real end user; the request IP the API sees is the wall's,
// not the sender's. A trusted relay (one allowed to set a custom `from`) may
// therefore attribute a job to a sender; an ordinary service key may not — it
// must never be able to spoof who sent a print.
describe("intakeMessage sender attribution", () => {
  test("stores sender_ip + sender_account for a trusted relay (custom-from grant)", async () => {
    const r = await intakeMessage(
      { message: "hi", from: "alice", sender_ip: "203.0.113.7", sender_account: "alice" },
      "wall", true,
    );
    if (!r.ok) throw new Error(r.error);
    const job = await getJob(r.job.id);
    expect(job?.sender_ip).toBe("203.0.113.7");
    expect(job?.sender_account).toBe("alice");
  });

  test("anonymous sender → ip stored, account null", async () => {
    const r = await intakeMessage(
      { message: "hi", sender_ip: "203.0.113.8", sender_account: null },
      "wall", true,
    );
    if (!r.ok) throw new Error(r.error);
    const job = await getJob(r.job.id);
    expect(job?.sender_ip).toBe("203.0.113.8");
    expect(job?.sender_account).toBeNull();
  });

  test("ignores sender_* from an untrusted key (no custom-from grant)", async () => {
    const r = await intakeMessage(
      { message: "hi", sender_ip: "203.0.113.9", sender_account: "spoofed" },
      "some-service", false,
    );
    if (!r.ok) throw new Error(r.error);
    const job = await getJob(r.job.id);
    expect(job?.sender_ip).toBeNull();
    expect(job?.sender_account).toBeNull();
  });
});
