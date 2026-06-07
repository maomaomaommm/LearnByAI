import { spawn } from "node:child_process";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import "./load-env.mjs";
import "./clean-next-for-e2e.mjs";

const port = readPort(process.env.E2E_PORT ?? "3100");
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const aiSmoke = process.env.AI_SMOKE === "true";
const root = process.cwd();
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const playwrightCli = "node_modules/@playwright/test/cli.js";

const e2eEnv = {
  ...process.env,
  AI_MOCK_MODE: aiSmoke ? "false" : "true",
  AI_API_BASE_URL: process.env.AI_API_BASE_URL ?? "https://api.yzccc.cloud/v1",
  AI_API_KEY: aiSmoke ? (process.env.AI_API_KEY ?? "") : "",
  AI_MODEL: process.env.AI_MODEL ?? "gpt-5.5",
  E2E_QUOTA_LIMIT: process.env.E2E_QUOTA_LIMIT ?? "2",
  INTERNAL_WORKER_SECRET: process.env.INTERNAL_WORKER_SECRET ?? "e2e-worker-secret",
  PLAYWRIGHT_BASE_URL: baseURL,
};

const serverCommand = process.platform === "win32"
  ? ["cmd.exe", ["/d", "/s", "/c", `npm.cmd run dev -- -p ${port}`]]
  : [npmBin, ["run", "dev", "--", "-p", port]];
const server = spawn(serverCommand[0], serverCommand[1], {
  cwd: root,
  env: e2eEnv,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let serverExited = false;
server.stdout.on("data", (chunk) => process.stdout.write(`[e2e-server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[e2e-server] ${chunk}`));
server.on("exit", (code, signal) => {
  serverExited = true;
  if (code && code !== 0) {
    process.stderr.write(`[e2e-server] exited with code ${code}${signal ? ` (${signal})` : ""}\n`);
  }
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void stopServer().finally(() => process.exit(130));
  });
}

try {
  await waitForServer();
  const code = await runPlaywright();
  await stopServer();
  process.exit(code);
} catch (error) {
  await stopServer();
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (serverExited) {
      throw new Error("E2E dev server exited before it became ready.");
    }

    if (await canConnectToServer()) return;

    await delay(500);
  }

  throw new Error(`Timed out waiting for E2E dev server at ${baseURL}.`);
}

function canConnectToServer() {
  const url = new URL(baseURL);
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  const targetPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));

  return new Promise((resolve) => {
    const socket = connect({ host, port: targetPort });
    socket.setTimeout(1_000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function runPlaywright() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
      cwd: root,
      env: {
        ...e2eEnv,
        PLAYWRIGHT_EXTERNAL_SERVER: "true",
      },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function stopServer() {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", resolve);
      killer.on("close", resolve);
    });
    return;
  }

  server.kill("SIGTERM");
  await delay(1_000);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
  }
}

function readPort(value) {
  if (!/^\d{2,5}$/.test(value)) {
    throw new Error(`Invalid E2E_PORT: ${value}`);
  }
  return value;
}
