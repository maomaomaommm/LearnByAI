import { spawn } from "node:child_process";
import "./load-env.mjs";
import "./clean-next-for-e2e.mjs";

const port = readPort(process.env.E2E_PORT ?? "3100");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const serverCommand = process.platform === "win32"
  ? ["cmd.exe", ["/d", "/s", "/c", `npm.cmd run dev -- -p ${port}`]]
  : [npmBin, ["run", "dev", "--", "-p", port]];
const server = spawn(serverCommand[0], serverCommand[1], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  await killProcessTree(server.pid);
  process.exit(signal ? 0 : (server.exitCode ?? 0));
}

server.on("exit", (code, signal) => {
  if (!shuttingDown) {
    process.exit(code ?? (signal ? 1 : 0));
  }
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on("exit", () => {
  if (!shuttingDown && server.pid) {
    server.kill();
  }
});

async function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", resolve);
      killer.on("close", resolve);
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
}

function readPort(value) {
  if (!/^\d{2,5}$/.test(value)) {
    throw new Error(`Invalid E2E_PORT: ${value}`);
  }
  return value;
}
