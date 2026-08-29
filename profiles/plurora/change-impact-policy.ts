/**
 * What Plurora's repository paths mean for risk, stages and evidence.
 *
 * Deterministic policy a person wrote and a reviewer can read: the run's risk,
 * the stages it must pass and the evidence it must produce are decided from
 * these rules and the paths a change touches, never from a stage's own account
 * of what it did.
 *
 * Rules accumulate rather than winning outright. A file under
 * `src/features/auth/` is an auth surface and a UI surface at once, and a
 * policy that had to pick one would drop the half that decides the bar.
 *
 * @module profiles/plurora/change-impact-policy
 */

import type { ChangeImpactPolicyDefinition } from '@trick-harness/profile'

/** Plurora's path rules and write-volume bands. */
export const changeImpactPolicy: ChangeImpactPolicyDefinition = {
  writeVolume: { smallMaxFiles: 3, mediumMaxFiles: 12 },
  rules: [
    // Database. A migration changes stored state and is the one family that
    // needs a preview branch before a person merges; tests and tooling read
    // that state, so they carry the surface without the mutation marker.
    { id: 'database-migrations', paths: ['supabase/migrations/**'], use: { surface: 'database', riskFloor: 'critical', requiredCapability: 'database-verification', evidenceProfile: 'db-standard', databaseMutation: true } },
    { id: 'database-tests', paths: ['supabase/tests/**'], use: { surface: 'database', riskFloor: 'critical', evidenceProfile: 'db-standard' } },
    { id: 'database-tooling', paths: ['scripts/db/**'], use: { surface: 'database', riskFloor: 'high', evidenceProfile: 'db-standard' } },

    // Auth. Stated as three rules rather than one list because the reason each
    // family is auth differs, and a reviewer reading a matched rule id should
    // learn which one fired.
    { id: 'auth-library', paths: ['src/lib/auth/**'], use: { surface: 'auth', riskFloor: 'critical', taskClass: 'auth', evidenceProfile: 'auth-standard' } },
    { id: 'auth-feature', paths: ['src/features/auth/**', 'src/features/admin-auth/**'], use: { surface: 'auth', riskFloor: 'critical', taskClass: 'auth', evidenceProfile: 'auth-standard' } },
    { id: 'auth-proxy', paths: ['src/proxy.ts'], use: { surface: 'auth', riskFloor: 'critical', taskClass: 'auth', evidenceProfile: 'auth-standard' } },

    // Supply chain and delivery. A workflow file is deliberately claimed twice:
    // it decides which dependencies enter the build and it decides what gets
    // published, and dropping either half would understate the change.
    { id: 'dependencies', paths: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'], use: { surface: 'dependencies', riskFloor: 'high', taskClass: 'dependency', evidenceProfile: 'dependency-standard' } },
    { id: 'workflow-supply-chain', paths: ['.github/workflows/**'], use: { surface: 'dependencies', riskFloor: 'high', taskClass: 'dependency', evidenceProfile: 'dependency-standard' } },
    { id: 'delivery-automation', paths: ['.github/**', 'scripts/git/**'], use: { surface: 'delivery', riskFloor: 'high', taskClass: 'delivery', evidenceProfile: 'delivery-standard' } },

    // UI. Last, so a path that is also auth or database has already contributed
    // the floor that decides the run.
    { id: 'design-system', paths: ['src/components/ui/**'], use: { surface: 'ui', riskFloor: 'medium', evidenceProfile: 'ui-standard' } },
    { id: 'application-ui', paths: ['src/features/**', 'src/app/**', 'src/shell/**'], use: { surface: 'ui', riskFloor: 'medium', evidenceProfile: 'ui-standard' } },
  ],
}
