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
 * The Supabase rule names the project and no branch. A branch name written down
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
    'supabase-preview-branches',
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
      when: { integration: 'supabase-preview-branches' },
      use: {
        projectRef: 'uljaajwwnygopsyvwsre',
        execution: 'cloud-only',
        previewBranchRequired: true,
        previewBranchIdentity: 'pull-request',
        onPreviewUnavailable: 'blocked',
        allowLocalFallback: false,
        allowSharedDevFallback: false,
      },
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
