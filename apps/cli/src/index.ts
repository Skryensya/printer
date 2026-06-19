import {
  Printer,
  cmd, line,
  buildImage,
  executeJob,
  type Task, type Priority, type Status, type BorderStyle,
} from "@printer/core";

const COMMANDS = ["hello", "borders", "test", "ticket", "image", "qr", "barcode", "status", "heart"] as const;
type Command = (typeof COMMANDS)[number];

async function main() {
  const [command = "hello", ...args] = Bun.argv.slice(2);

  if (!COMMANDS.includes(command as Command)) {
    console.error(`Unknown command: ${command}`);
    console.error(`Usage: bun run src/index.ts [${COMMANDS.join("|")}] [...args]`);
    process.exit(1);
  }

  const printer = new Printer();

  if (command === "hello") {
    await printer.job(async (p) => {
      await p.send(
        cmd.alignCenter(),
        cmd.bold(true),
        cmd.charSize(2, 2),
        line("Hello"),
        line("World!"),
        cmd.charSize(1, 1),
        cmd.bold(false),
        cmd.alignLeft(),
        line(),
        line("  POS-58 Thermal Printer"),
        line("  bun run src/index.ts"),
      );
    });
    console.log("Printed: Hello World");
    return;
  }

  if (command === "heart") {
    await printer.job(async (p) => {
      await p.send(
        cmd.alignCenter(),
        cmd.bold(true),
        cmd.charSize(2, 2),
        line("Te amo"),
        line("Camila"),
        cmd.charSize(1, 1),
        cmd.bold(false),
        line(""),
        line("   ████    ████   "),
        line("  ██████  ██████  "),
        line(" ████████████████ "),
        line("  ██████████████  "),
        line("   ████████████   "),
        line("    ██████████    "),
        line("      ██████      "),
        line("        ██        "),
      );
    });
    console.log("Printed heart");
    return;
  }

  if (command === "status") {
    await printer.connect();
    try {
      const s = await printer.readStatus();
      if (!s) { console.log("Status: unavailable (no IN endpoint)"); return; }
      console.log(`Paper:    ${s.paper   ? "OK"  : "OUT"}`);
      console.log(`Near end: ${s.nearEnd ? "YES" : "no"}`);
      console.log(`Raw byte: 0b${s.raw.toString(2).padStart(8, "0")}`);
    } finally {
      await printer.disconnect();
    }
    return;
  }

  if (command === "image") {
    const filePath = args[0];
    if (!filePath) {
      console.error("Usage: bun run src/index.ts image <file>");
      process.exit(1);
    }
    const chunks = await buildImage(filePath);
    await printer.job(async (p) => {
      await p.send(cmd.alignCenter(), ...chunks);
    });
    console.log(`Printed image: ${filePath}`);
    return;
  }

  if (command === "borders") {
    await printer.job(async (p) => executeJob("borders", {}, p));
    console.log("Printed: border styles");
    return;
  }

  if (command === "test") {
    await printer.job(async (p) => executeJob("test", {}, p));
    console.log("Printed test page");
    return;
  }

  if (command === "qr") {
    const text = args[0] ?? "https://example.com";
    await printer.job(async (p) => executeJob("qr", { text, size: 8 }, p));
    console.log(`Printed QR: ${text}`);
    return;
  }

  if (command === "barcode") {
    const data = args[0];
    if (!data) {
      console.error("Usage: bun run src/index.ts barcode <data>");
      process.exit(1);
    }
    await printer.job(async (p) => executeJob("barcode", { data, height: 80 }, p));
    console.log(`Printed barcode: ${data}`);
    return;
  }

  if (command === "ticket") {
    const task: Task = {
      id:       args[0] ?? "001",
      title:    args[1] ?? "Example task title here",
      priority: (args[2]?.toUpperCase() as Priority) ?? "MEDIUM",
      status:   (args[3]?.toUpperCase() as Status)   ?? "TODO",
      assignee: args[4],
      due:      args[5],
    };
    const style = (args[6] as BorderStyle) ?? "thin";
    await printer.job(async (p) => executeJob("ticket", { ...task, style }, p));
    console.log(`Printed ticket #${task.id}`);
    return;
  }
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
