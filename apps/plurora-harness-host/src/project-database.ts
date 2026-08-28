/**
 * The project's database verification capability.
 *
 * The harness core knows only that a schema change has to be verified against a
 * real database before delivery; which database, and how, is the project's
 * business. For Plurora it is one fixed command run in the project checkout —
 * fixed, not configurable, because a host that could be told which command to
 * run for "database verification" is a host that can be told to run anything.
 *
 * The verdict is the command's, not this module's. A non-zero exit is a FAILED
 * verification, not a broken host; a command that could not be run at all is
 * BLOCKED, because nothing was verified and reporting a pass would be a lie.
 * Raw output never reaches the journal: the evidence ref points at the command
 * so a reader can rerun it, and the summary says only what the exit code means.
 *
 * @module apps/plurora-harness-host/project-database
 */

import type {
  DatabaseVerificationCapabilityPort,
  WorkflowDatabaseVerificationInput,
  WorkflowDatabaseVerificationResult,
} from '@trick-harness/engineering-workflow'

/**
 * The only command this host will run to verify a database.
 *
 * Stated as an argument vector rather than a string so it can never be
 * assembled, quoted, or extended from anything a run supplies.
 */
export const PROJECT_DATABASE_COMMAND = Object.freeze([
  'npm',
  'run',
  'db:verify:harness',
  '--',
  '--json',
] as const)

/** What running the fixed command produced. */
export interface ProjectDatabaseRun {
  /** The process exit code. */
  readonly exitCode: number
  /** Standard output, for the adapter that reads the command's JSON verdict. */
  readonly stdout: string
}

/**
 * Runs the fixed command in the project checkout.
 *
 * A port rather than a direct spawn so the verdict logic is testable without a
 * database, and so the host's one subprocess seam stays in one place.
 */
export interface ProjectDatabaseRunner {
  run(command: readonly string[], signal: AbortSignal): Promise<ProjectDatabaseRun>
}

/** Build the verdict for a completed run. */
function verdictFor(run: ProjectDatabaseRun, input: WorkflowDatabaseVerificationInput): WorkflowDatabaseVerificationResult {
  const passed = run.exitCode === 0
  return {
    status: passed ? 'PASSED' : 'FAILED',
    summary: passed
      ? 'the project database verification command passed against the shared development database'
      : `the project database verification command exited ${run.exitCode}`,
    evidence: [{
      kind: 'gate',
      locator: PROJECT_DATABASE_COMMAND.join(' '),
      summary: `database verification for stage ${input.stageId}`,
    }],
    findings: [],
  }
}

/**
 * Create the project's database verification capability.
 *
 * @param runner - the seam that runs the fixed command.
 * @returns a capability port the composition can supply to the workflow.
 */
export function createProjectDatabaseVerifier(runner: ProjectDatabaseRunner): DatabaseVerificationCapabilityPort {
  return {
    async verify(input, signal) {
      try {
        return verdictFor(await runner.run(PROJECT_DATABASE_COMMAND, signal), input)
      }
      catch {
        // Deliberately swallows the cause: it can carry a connection string or
        // a credential from the project's own tooling, and this result is
        // journalled. What a reader needs is that nothing was verified.
        return {
          status: 'BLOCKED',
          summary: 'the project database verification command could not be run, so nothing was verified',
          evidence: [{
            kind: 'gate',
            locator: PROJECT_DATABASE_COMMAND.join(' '),
            summary: `database verification for stage ${input.stageId} did not run`,
          }],
          findings: [],
        }
      }
    },
  }
}
