/**
 * The project's database verification capability.
 *
 * The harness core knows only that a schema change has to be verified against a
 * real database before delivery; which database, and how, is the project's
 * business. For Plurora it is one fixed command run in the project checkout —
 * fixed, not configurable, because a host that could be told which command to
 * run for "database verification" is a host that can be told to run anything.
 *
 * The verdict is the command's, not this module's, and it is carried in a JSON
 * envelope rather than inferred from an exit code. An exit code can say a
 * process failed; it cannot say which project was checked, and a host that
 * verified the wrong database would report a pass that means nothing. So the
 * envelope names its target and this module refuses one that does not match the
 * project this deployment is pointed at.
 *
 * Nothing the child wrote reaches the journal unvalidated. Only the fields
 * below survive, they are refused outright when they carry something
 * credential-shaped, and raw stdout is bounded and never spilled to disk — the
 * child's output is a project's own tooling talking about a database, which is
 * exactly where a connection string would appear.
 *
 * @module apps/plurora-harness-host/project-database
 */

import type {
  DatabaseVerificationCapabilityPort,
  WorkflowDatabaseVerificationInput,
  WorkflowDatabaseVerificationResult,
} from '@trick-harness/engineering-workflow'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { looksLikeSecret } from './redaction.ts'

/**
 * The only command this host will run to verify a database.
 *
 * Stated as an argument vector rather than a string so it can never be
 * assembled, quoted, or extended from anything a run supplies, and so it
 * reaches the process seam without a shell between them.
 */
export const PROJECT_DATABASE_COMMAND = Object.freeze([
  'npm',
  'run',
  'db:verify:harness',
  '--',
  '--json',
] as const)

/**
 * How much of the child's stdout is retained.
 *
 * An envelope is a verdict, not a log. This is generous for the former and far
 * too small for the latter, which is the point: a command that starts streaming
 * its database session at this host loses the head of it and gets refused,
 * rather than getting a large amount of raw output past the parser.
 */
export const MAX_ENVELOPE_BYTES = 64 * 1024

/** The verdict envelope the fixed command is required to print. */
export interface ProjectDatabaseVerificationEnvelope {
  /** Pinned; this host is written against exactly one shape. */
  readonly schemaVersion: 1
  /** The command's own verdict. */
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'
  /** Which project was verified, checked against the deployment's own ref. */
  readonly targetProjectRef: string
  /** One line a reader can act on, carrying no output and no credential. */
  readonly summary: string
  /** Where a reader can go to see it for themselves. */
  readonly evidence: readonly {
    readonly kind: 'gate' | 'test'
    readonly locator: string
    readonly summary: string
  }[]
}

/** Raised when the child's envelope is not one this host will act on. */
export class ProjectDatabaseEnvelopeError extends Error {
  override readonly name = 'ProjectDatabaseEnvelopeError'
}

/** What the capability needs from the deployment. */
export interface ProjectDatabaseOptions {
  /** The checkout the command runs in, and the only directory it is given. */
  readonly projectRoot: string
  /** The project this deployment is pointed at, which the envelope must name. */
  readonly projectRef: string
  /** Subprocess termination grace for the managed process tree. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

const STATUSES = new Set(['PASSED', 'FAILED', 'BLOCKED'])
const EVIDENCE_KINDS = new Set(['gate', 'test'])

/**
 * Read one required string field, refusing a credential-shaped value.
 *
 * @param value - the field as the child sent it.
 * @param label - what to call the field in a failure, never its content.
 * @returns the validated string.
 * @throws {ProjectDatabaseEnvelopeError} when it is missing or looks like a secret.
 */
function safeString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new ProjectDatabaseEnvelopeError(`the database verification envelope has no ${label}`)
  }
  if (looksLikeSecret(value)) {
    throw new ProjectDatabaseEnvelopeError(
      `the database verification envelope put something credential-shaped in ${label}, so none of it is journalled`,
    )
  }
  return value
}

/**
 * Read the child's envelope, keeping only what this host will act on.
 *
 * Failures never quote the input. The input is the thing under suspicion, and a
 * parser that echoes it back to explain itself has published it.
 *
 * @param text - the child's whole standard output.
 * @param projectRef - the project this deployment is pointed at.
 * @returns the validated envelope.
 * @throws {ProjectDatabaseEnvelopeError} for any envelope this host will not act on.
 */
export function parseVerificationEnvelope(
  text: string,
  projectRef: string,
): ProjectDatabaseVerificationEnvelope {
  const trimmed = text.trim()
  let document: unknown
  try {
    document = JSON.parse(trimmed)
  } catch {
    throw new ProjectDatabaseEnvelopeError('the database verification command printed something that is not an envelope')
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new ProjectDatabaseEnvelopeError('the database verification envelope is not an object')
  }
  const raw = document as Record<string, unknown>

  if (raw['schemaVersion'] !== 1) {
    throw new ProjectDatabaseEnvelopeError('the database verification envelope is not schema version 1')
  }
  const status = raw['status']
  if (typeof status !== 'string' || !STATUSES.has(status)) {
    throw new ProjectDatabaseEnvelopeError('the database verification envelope carries no status this host understands')
  }
  const target = safeString(raw['targetProjectRef'], 'targetProjectRef')
  if (target !== projectRef) {
    throw new ProjectDatabaseEnvelopeError(
      'the database verification command verified a different project than this deployment is pointed at',
    )
  }
  const evidence = raw['evidence']
  if (!Array.isArray(evidence)) {
    throw new ProjectDatabaseEnvelopeError('the database verification envelope carries no evidence list')
  }

  return {
    schemaVersion: 1,
    status: status as ProjectDatabaseVerificationEnvelope['status'],
    targetProjectRef: target,
    summary: safeString(raw['summary'], 'summary'),
    evidence: evidence.map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new ProjectDatabaseEnvelopeError('the database verification envelope carries a malformed evidence entry')
      }
      const item = entry as Record<string, unknown>
      const kind = item['kind']
      if (typeof kind !== 'string' || !EVIDENCE_KINDS.has(kind)) {
        throw new ProjectDatabaseEnvelopeError('the database verification envelope carries an evidence kind the journal does not accept')
      }
      return {
        kind: kind as 'gate' | 'test',
        locator: safeString(item['locator'], 'an evidence locator'),
        summary: safeString(item['summary'], 'an evidence summary'),
      }
    }),
  }
}

/**
 * The result for a verification that did not happen.
 *
 * @param input - the stage being verified.
 * @param reason - what a reader needs, stated without quoting the child.
 * @returns a BLOCKED result.
 */
function blocked(input: WorkflowDatabaseVerificationInput, reason: string): WorkflowDatabaseVerificationResult {
  return {
    status: 'BLOCKED',
    summary: `${reason}, so nothing was verified`,
    evidence: [{
      kind: 'gate',
      locator: PROJECT_DATABASE_COMMAND.join(' '),
      summary: `database verification for stage ${input.stageId} did not run`,
    }],
    findings: [],
  }
}

/**
 * Create the project's database verification capability.
 *
 * @param options - the checkout, the project ref, and how to spawn.
 * @returns a capability port the composition can supply to the workflow.
 */
export function createProjectDatabaseVerifier(
  options: ProjectDatabaseOptions,
): DatabaseVerificationCapabilityPort {
  return {
    async verify(input, signal) {
      let child: SubprocessHandle
      try {
        child = options.spawn({
          argv: [...PROJECT_DATABASE_COMMAND],
          cwd: options.projectRoot,
          // No stdin: this command answers about a database, it is never asked
          // anything. No spill file: a bounded buffer that is then written to
          // disk in full is not bounded in the way that matters here.
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_ENVELOPE_BYTES },
            stderr: { maxBytes: MAX_ENVELOPE_BYTES },
          },
          graceMs: options.disposeGraceMs,
          signal,
        })
      } catch {
        // The cause is dropped here and everywhere below: it comes from the
        // project's own tooling talking about a database, and this result is
        // journalled.
        return blocked(input, 'the database verification command could not be started')
      }

      try {
        const outcome = await child.done
        // The direct child exiting is not the tree going quiet. A migration
        // helper still holding the database open would otherwise be reported
        // as a finished verification.
        if (!await child.waitForExit()) {
          return blocked(input, 'the database verification process tree did not go quiescent')
        }

        const read = child.collected.stdout?.readFrom(0)
        if (read === undefined) return blocked(input, 'the database verification command produced no output')
        if (read.lossy) return blocked(input, 'the database verification output outgrew the bound this host reads it under')

        const envelope = parseVerificationEnvelope(read.text, options.projectRef)
        // An exit code and an envelope that disagree is not a verdict either
        // way. Trusting the envelope would let a crashed command report a pass;
        // trusting the code would discard a verdict the command did reach.
        if ((outcome.exitCode === 0) !== (envelope.status === 'PASSED')) {
          return blocked(input, 'the database verification exit code and envelope disagree')
        }
        return {
          status: envelope.status,
          summary: envelope.summary,
          evidence: envelope.evidence,
          findings: [],
        }
      } catch {
        return blocked(input, 'the database verification command did not produce a usable envelope')
      } finally {
        // Idempotent, and a no-op once the tree is gone: this host owns the
        // process it started even on the paths that gave up on its answer.
        child.terminate()
      }
    },
  }
}
