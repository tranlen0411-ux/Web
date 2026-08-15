import fs from 'fs';
import path from 'path';

const artifactsDir = path.join(process.cwd(), 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function mapOutcome(outcome) {
  if (outcome === 'success') return 'PASS';
  if (outcome === 'failure') return 'FAIL';
  return 'BLOCKED'; // maps skipped, cancelled, or undefined
}

const summary = {
  version: "15.8",
  commit: process.env.GITHUB_SHA || "local",
  timestamp: new Date().toISOString(),
  results: [
    {
      name: "Node Static Exercise Validator",
      status: mapOutcome(process.env.VALIDATOR_OUTCOME),
      evidence: process.env.VALIDATOR_OUTCOME === 'success' ? "All 7 static assertions passed (EXIT CODE 0)" : "Validator step did not pass"
    },
    {
      name: "Vite Production Build",
      status: mapOutcome(process.env.BUILD_OUTCOME),
      evidence: process.env.BUILD_OUTCOME === 'success' ? "Vite build created production bundle in dist/ (EXIT CODE 0)" : "Build step did not pass"
    },
    {
      name: "Deno Edge Function Typecheck",
      status: mapOutcome(process.env.DENO_OUTCOME),
      evidence: process.env.DENO_OUTCOME === 'success' ? "Deno typecheck completed with 0 errors" : "Deno typecheck did not pass"
    },
    {
      name: "Supabase Local Containers Start",
      status: mapOutcome(process.env.SUPABASE_START_OUTCOME),
      evidence: process.env.SUPABASE_START_OUTCOME === 'success' ? "Supabase local containers started on 127.0.0.1" : "Supabase start failed or was skipped"
    },
    {
      name: "Database Local Migration Test A & B",
      status: mapOutcome(process.env.MIGRATION_OUTCOME),
      evidence: process.env.MIGRATION_OUTCOME === 'success' ? "Baseline schema and ADD_ACADEMIC_EXERCISES.sql ran idempotently" : "Migration step failed or was skipped"
    },
    {
      name: "Postgres Parallel Concurrency Claim & Reset Test",
      status: mapOutcome(process.env.CONCURRENCY_OUTCOME),
      evidence: process.env.CONCURRENCY_OUTCOME === 'success' ? "Parallel psql workers verified FOR UPDATE lock and FOR UPDATE SKIP LOCKED" : "Concurrency step failed or was skipped"
    },
    {
      name: "Local Edge Function HTTP Integration Test",
      status: mapOutcome(process.env.EDGE_OUTCOME),
      evidence: process.env.EDGE_OUTCOME === 'success' ? "Local Edge Function returned valid counter invariants and mutual exclusion flags" : "Edge Function integration step failed or was skipped"
    }
  ]
};

const sanitizedJson = JSON.stringify(summary, null, 2)
  .replace(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, '[REDACTED_JWT]')
  .replace(/postgres:\/\/[^@]+@/g, 'postgres://[REDACTED]:[REDACTED]@');

fs.writeFileSync(path.join(artifactsDir, 'academic-exercises-verification-summary.json'), sanitizedJson, 'utf8');
console.log('✅ Sanitized artifact report generated dynamically at artifacts/academic-exercises-verification-summary.json');
