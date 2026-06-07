import { createLocalGateEnv, npmStep, runSteps } from "./gate-utils.mjs";

const dryRun = process.argv.includes("--dry-run");
const env = createLocalGateEnv();
const steps = [
  npmStep("lint", "lint", env),
  npmStep("unit tests", "test:unit", env),
  npmStep("schema verification", "test:schema", env),
  npmStep("production build", "build", env),
  npmStep("mock E2E", "test:e2e", env),
];

const code = await runSteps(steps, { dryRun });
if (code === 0) {
  console.log(dryRun ? "[gate] Local phase gate dry run complete." : "[gate] Local phase gate passed.");
}
process.exit(code);
