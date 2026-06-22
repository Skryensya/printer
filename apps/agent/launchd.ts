#!/usr/bin/env bun
// Manage the printer agent as a macOS launchd daemon.
//   bun run daemon:start    install env + plist, load with KeepAlive (starts on boot)
//   bun run daemon:stop     unload + disable (stays off across reboots)
//   bun run daemon:restart  re-copy env, then restart the running daemon
import { $ } from "bun";

const DIR       = import.meta.dir;
const ENV_SRC   = `${DIR}/agent.env`;
const PLIST_SRC = `${DIR}/com.printer.agent.plist`;
const ENV_DST   = "/usr/local/etc/printer-agent.env";
const PLIST_DST = "/Library/LaunchDaemons/com.printer.agent.plist";
const LABEL     = "system/com.printer.agent";

async function copyEnv() {
  if (!(await Bun.file(ENV_SRC).exists())) {
    console.error(`Missing ${ENV_SRC} — copy agent.env.example to agent.env and fill it in.`);
    process.exit(1);
  }
  await $`sudo cp ${ENV_SRC} ${ENV_DST}`;
  await $`sudo chown root:wheel ${ENV_DST}`;
  await $`sudo chmod 600 ${ENV_DST}`;
}

async function start() {
  await copyEnv();
  await $`sudo cp ${PLIST_SRC} ${PLIST_DST}`;
  await $`sudo chown root:wheel ${PLIST_DST}`;
  await $`sudo chmod 644 ${PLIST_DST}`;
  // Reload cleanly if it was already loaded
  await $`sudo launchctl unload ${PLIST_DST}`.nothrow().quiet();
  await $`sudo launchctl load -w ${PLIST_DST}`;
  console.log("✓ Agent daemon running (KeepAlive, starts on boot). Logs: /var/log/printer-agent.log");
}

async function stop() {
  await $`sudo launchctl unload -w ${PLIST_DST}`;
  console.log("✓ Agent daemon stopped and disabled (won't return on reboot).");
}

async function restart() {
  await copyEnv();
  await $`sudo launchctl kickstart -k ${LABEL}`;
  console.log("✓ Agent daemon restarted with current config.");
}

const action = process.argv[2];
if (action === "start")        await start();
else if (action === "stop")    await stop();
else if (action === "restart") await restart();
else {
  console.error("Usage: bun launchd.ts <start|stop|restart>");
  process.exit(1);
}
