import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const nextDir = join(process.cwd(), ".next");
const buildArtifacts = [
  "cache",
  "server",
  "static",
  "types",
  "app-build-manifest.json",
  "build-manifest.json",
  "package.json",
  "prerender-manifest.json",
  "react-loadable-manifest.json",
  "routes-manifest.json",
  "trace",
];

for (const artifact of buildArtifacts) {
  const target = join(nextDir, artifact);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
}
