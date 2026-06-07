import "./load-env.mjs";
import { createBetaGateEnv, npmStep, runSteps } from "./gate-utils.mjs";

const dryRun = process.argv.includes("--dry-run");
const betaEnv = createBetaGateEnv();
const steps = [
  npmStep("strict beta readiness", "test:beta-ready", betaEnv),
  npmStep("local phase gate", "test:phase-gate", betaEnv),
  npmStep("live Supabase smoke", "test:supabase-smoke", betaEnv),
  npmStep("deployed beta health", "test:beta-health", betaEnv),
  npmStep("external worker handoff", "test:worker-handoff", betaEnv),
  npmStep("real AI smoke", "test:ai-smoke", betaEnv),
];

const code = await runSteps(steps, { dryRun });
if (code === 0) {
  console.log(dryRun ? "[gate] Beta gate dry run complete." : "[gate] Beta gate passed.");
}
process.exit(code);
