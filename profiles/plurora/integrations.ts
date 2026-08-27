/**
 * Plurora's enabled integrations and the constraints they run under.
 *
 * This is the file the reusable layers are forbidden to reach: the strong
 * project identifiers live here, in policy, so that `packages/core`,
 * `packages/providers`, and `packages/integrations` stay usable by a second
 * project without edits. The boundary gate enforces that direction.
 *
 * @module profiles/plurora/integrations
 */

import type { IntegrationPolicyDefinition } from '@trick-harness/profile'

/**
 * Integration capabilities Plurora turns on, and the limits placed on each.
 *
 * Delivery automation is bounded on purpose. The harness may push the current
 * feature branch and open or update its pull request; it may not force-push,
 * rewrite history, push to the protected default branch, merge, or release.
 * Merge stays a human decision, so an automated run can never be the last
 * approval on its own work.
 *
 * Database work is cloud-only against an isolated Supabase Preview Branch, with
 * no local or shared-dev fallback: a fallback path is exactly the path that
 * eventually runs a migration against something that matters.
 *
 * The names here are the names the composition consumes, exactly. A capability
 * this file spells differently is a capability nothing turns on, and the run
 * that needed it does not fail loudly — it simply never had it.
 *
 * The Supabase rule names the parent project and no branch. A branch name written down
 * here would be a standing execution target — the integration would have every
 * reason to read it as "run the migration against this" — and the only branch
 * worth naming is the ephemeral one belonging to the pull request currently in
 * flight, which no file checked into the repository can know. So the policy
 * states the requirement instead: the branch is the current PR's, and if one
 * cannot be resolved or created the workflow is BLOCKED rather than pointed at
 * whatever else happens to be reachable.
 */
export const integrationPolicy: IntegrationPolicyDefinition = {
  enabled: [
    'github-delivery',
    'supabase-preview',
    'control-server',
    'notion-knowledge',
    'linear-issues',
  ],
  rules: [
    {
      id: 'github-delivery',
      when: { integration: 'github-delivery' },
      use: {
        repository: 'adsonpatrick/neuro-via',
        pushBranch: 'current-feature-branch',
        allowForcePush: false,
        allowHistoryRewrite: false,
        allowDefaultBranchPush: false,
        allowMerge: false,
        allowRelease: false,
      },
    },
    {
      id: 'supabase-preview',
      when: { integration: 'supabase-preview' },
      use: {
        // The parent, and only ever the parent: this ref is what branches are
        // created under and asked about, never what a migration is run against.
        parentProjectRef: 'uljaajwwnygopsyvwsre',
        execution: 'cloud-only',
        previewBranchRequired: true,
        previewBranchIdentity: 'pull-request',
        onPreviewUnavailable: 'blocked',
        allowLocalFallback: false,
        allowSharedDevFallback: false,
      },
    },
    {
      id: 'control-server',
      when: { integration: 'control-server' },
      use: { bind: 'loopback', auth: 'bearer-token', resume: 'never-automatic' },
    },
    {
      id: 'notion-knowledge',
      when: { integration: 'notion-knowledge' },
      use: { system: 'Notion', access: 'read-write', scope: 'project-workspace' },
    },
    {
      id: 'linear-issues',
      when: { integration: 'linear-issues' },
      use: { system: 'Linear', access: 'read-write', scope: 'project-team' },
    },
  ],
}
