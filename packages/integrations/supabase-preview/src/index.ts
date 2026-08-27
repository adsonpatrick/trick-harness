/**
 * Cloud-only Supabase preview validation: provision an isolated hosted branch,
 * apply the repository's migration history to it, run the remote gates against
 * it, and then take it away again.
 *
 * There is no local path here and no shared-dev path either. A run either gets
 * its own hosted branch or it reports `BLOCKED`; it never falls back to the
 * parent project, because validating a migration by applying it to the database
 * everyone else is using is not validation, it is the incident.
 *
 * The preview connection string is a credential. It is read from the branch,
 * held for the length of the run, passed to database commands as an argv value
 * and to the project's own test suite as an environment variable, and redacted
 * out of everything this package reports. Supabase authentication itself stays
 * native to the CLI: this package reads no `.env` file, reads no token, and
 * constructs no environment beyond the one variable the project test command
 * was configured to read.
 * @module @trick-harness/supabase-preview
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  PreviewError,
  assertPreviewConnection,
  assertProjectRef,
  assertProjectTestCommand,
  branchCreateArgv,
  branchDeleteArgv,
  branchGetArgv,
  dbLintArgv,
  dbPushArgv,
  migrationListArgv,
  redactConnections,
} from './commands.ts'

export * from './commands.ts'
export type * from './types.ts'

import type {
  CleanupResult,
  CommandResult,
  GateResult,
  PreviewBranchIdentity,
  PreviewOutcome,
  PreviewRunRequest,
  SupabasePreviewOptions,
} from './types.ts'

/** Bytes of a command's output this package will hold in memory. */
const MAX_OUTPUT_BYTES = 64 * 1024

/** Default grace for the terminate escalation on a spawned command. */
const DEFAULT_GRACE_MS = 10_000

/** Default ceiling on waiting for a branch to report healthy. */
const DEFAULT_READY_TIMEOUT_MS = 300_000

/** Default gap between health reads. */
const DEFAULT_POLL_INTERVAL_MS = 5_000

/** Bytes of evidence one gate keeps. */
const MAX_EVIDENCE_BYTES = 4_000

/** Branch statuses that mean the branch is usable. */
const HEALTHY_STATUSES: readonly string[] = ['MIGRATIONS_PASSED', 'FUNCTIONS_DEPLOYED', 'ACTIVE_HEALTHY']

/** Branch statuses that mean waiting longer will not help. */
const TERMINAL_STATUSES: readonly string[] = ['MIGRATIONS_FAILED', 'FUNCTIONS_FAILED', 'INACTIVE', 'REMOVED']

/**
 * Read one settled stream, or the empty string when it was not collected.
 * @param handle - Settled subprocess handle.
 * @param stream - Which collected stream to read.
 * @returns The stream text, trimmed of trailing whitespace.
 */
function readStream(handle: SubprocessHandle, stream: 'stdout' | 'stderr'): string {
  return (handle.collected[stream]?.readFrom(0).text ?? '').replace(/\s+$/, '')
}

/**
 * Keep a bounded, redacted slice of a command's output as gate evidence.
 * @param result - The command result to summarise.
 * @returns Redacted evidence, truncated to a fixed budget.
 */
function evidenceOf(result: CommandResult): string {
  const joined = [result.stdout, result.stderr].filter(part => part !== '').join('\n')
  return redactConnections(joined).slice(0, MAX_EVIDENCE_BYTES)
}

/**
 * Pull one string field out of a parsed record, whatever case it was reported in.
 * @param record - Parsed JSON object.
 * @param names - Field names to try, in order.
 * @returns The first string value found.
 */
function field(record: Record<string, unknown>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/**
 * Read a branch record out of `supabase branches get --output json`.
 *
 * The CLI reports one object, but has reported a single-element array in the
 * past, so both are accepted. Anything else is unreadable rather than empty:
 * a run that could not read its branch must not go on to assume it is healthy.
 * @param json - Raw stdout of the get command.
 * @returns The branch record.
 * @throws PreviewError when the output is not a branch record.
 */
function parseBranchRecord(json: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    throw new PreviewError('unreadable-branch', 'the branch read returned output that is not JSON')
  }
  const candidate: unknown = Array.isArray(parsed) ? (parsed as readonly unknown[])[0] : parsed
  if (typeof candidate !== 'object' || candidate === null) {
    throw new PreviewError('unreadable-branch', 'the branch read returned no branch record')
  }
  return candidate as Record<string, unknown>
}

/**
 * The cloud-only preview validation capability, bound to one parent project.
 *
 * One instance owns one repository and one parent project ref. It owns no
 * branch: a branch belongs to a single run, and is created and destroyed inside
 * {@link SupabasePreview.run}.
 */
export class SupabasePreview {
  readonly #cwd: string
  readonly #spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly #projectRef: string
  readonly #options: SupabasePreviewOptions
  readonly #graceMs: number

  /**
   * @param options - The repository, the subprocess seam and the parent project.
   * @throws PreviewError when the parent project ref is not a project ref.
   */
  constructor(options: SupabasePreviewOptions) {
    assertProjectRef(options.projectRef)
    if (options.testCommand !== undefined) assertProjectTestCommand(options.testCommand)
    this.#cwd = options.cwd
    this.#spawn = options.spawn
    this.#projectRef = options.projectRef
    this.#options = options
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS
  }

  /**
   * Run one already-constructed command and collect its bounded output.
   *
   * `argv` reaches the subprocess seam as an array, which is never shell
   * interpreted, so a branch name or a connection string is a value here and
   * cannot become syntax.
   * @param argv - Fully constructed command.
   * @param signal - Cancellation for the run.
   * @param env - Extra environment for this command alone.
   * @returns Exit code and collected streams.
   */
  async #run(
    argv: readonly string[],
    signal?: AbortSignal,
    env?: NodeJS.ProcessEnv,
  ): Promise<CommandResult> {
    const collect = { maxBytes: MAX_OUTPUT_BYTES } as const
    const handle = this.#spawn({
      argv,
      cwd: this.#cwd,
      stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
      graceMs: this.#graceMs,
      ...signal === undefined ? {} : { signal },
      // Absent unless a project test command needs its connection: the
      // subprocess seam scrubs credential-shaped entries from the parent
      // environment, and the Supabase CLI reads its own stored login.
      ...env === undefined ? {} : { env },
    })
    const outcome = await handle.done
    // `done` says the direct child closed. The Supabase CLI starts helpers —
    // psql among them — and a run that read `done` and moved on would apply
    // its next migration while the previous command still holds a connection
    // to the branch. Quiescence is what settlement means here.
    await this.#quiescent(handle)
    return {
      argv,
      exitCode: outcome.exitCode,
      stdout: readStream(handle, 'stdout'),
      stderr: readStream(handle, 'stderr'),
    }
  }

  /**
   * Wait for one command's owned process tree to be gone.
   *
   * A wait that ends any other way — a rejection, or the seam saying it stopped
   * waiting — is a tree still standing, and neither is converted into a
   * successful command: whatever the child's exit code said, the branch is not
   * in a state this capability may keep acting on.
   *
   * The run's cancellation signal is deliberately not passed along. A cancelled
   * run still owns whatever it started, and releasing it while that tree is up
   * would delete a branch something is still connected to.
   * @param handle - The settled subprocess handle.
   * @throws PreviewError when the tree cannot be observed to have exited.
   */
  async #quiescent(handle: SubprocessHandle): Promise<void> {
    let exited: boolean
    try {
      exited = await handle.waitForExit()
    }
    catch {
      // The cause is deliberately not carried into the message: it comes from a
      // command that was given a connection string, and Supabase echoes it.
      throw new PreviewError('teardown-failed', 'the process tree of a preview command could not be reaped')
    }
    if (!exited) {
      throw new PreviewError('teardown-failed', 'the wait for a preview command`s process tree ended before it exited')
    }
  }

  /**
   * Run a command that must succeed, or stop the run.
   * @param argv - Fully constructed command.
   * @param what - What the command was for, for the failure message.
   * @param code - The failure code to raise.
   * @param signal - Cancellation for the run.
   * @returns The command's stdout.
   * @throws PreviewError when the command exits non-zero.
   */
  async #must(
    argv: readonly string[],
    what: string,
    code: PreviewError['code'],
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.#run(argv, signal)
    if (result.exitCode !== 0) {
      // The message names the operation and the exit code, never the output:
      // Supabase stderr echoes the connection string it was given, and this
      // string reaches a durable event.
      throw new PreviewError(code, `${what} failed with exit code ${String(result.exitCode)}`)
    }
    return result.stdout
  }

  /**
   * Read the branch once, returning its identity and its connection apart.
   *
   * The connection is returned separately from the identity so that the value
   * a caller may keep and the value it may not are different objects.
   * @param branchName - Branch to read.
   * @param signal - Cancellation for the run.
   * @returns The branch identity and the connection string, when there is one.
   * @throws PreviewError when the branch cannot be read.
   */
  async #readBranch(
    branchName: string,
    signal?: AbortSignal,
  ): Promise<{ identity: PreviewBranchIdentity; connection: string | undefined }> {
    const stdout = await this.#must(
      branchGetArgv(this.#projectRef, branchName),
      'reading the preview branch',
      'unreadable-branch',
      signal,
    )
    const record = parseBranchRecord(stdout)
    const status = field(record, ['status', 'Status'])
    return {
      identity: {
        id: field(record, ['id', 'ID']),
        name: branchName,
        projectRef: field(record, ['project_ref', 'ref', 'PROJECT_REF']),
        status,
        healthy: status !== undefined && HEALTHY_STATUSES.includes(status),
      },
      connection: field(record, ['db_url', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL', 'postgres_url']),
    }
  }

  /**
   * Wait until the branch reports a healthy status, or stop waiting.
   * @param branchName - Branch to watch.
   * @param signal - Cancellation for the run.
   * @returns The healthy branch identity and its connection string.
   * @throws PreviewError when the branch fails, times out or is cancelled.
   */
  async #waitForHealthy(
    branchName: string,
    signal?: AbortSignal,
  ): Promise<{ identity: PreviewBranchIdentity; connection: string }> {
    const deadline = Date.now() + (this.#options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    const interval = this.#options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    for (;;) {
      if (signal?.aborted === true) {
        throw new PreviewError('cancelled', 'the run was cancelled while waiting for the preview branch')
      }
      const read = await this.#readBranch(branchName, signal)
      if (read.identity.healthy) {
        const connection = read.connection ?? ''
        // Checked before the first database command rather than at the end:
        // a connection that turned out to be the parent's must never have been
        // handed to anything, not even a read.
        assertPreviewConnection(connection, this.#projectRef)
        return { identity: read.identity, connection }
      }
      if (read.identity.status !== undefined && TERMINAL_STATUSES.includes(read.identity.status)) {
        throw new PreviewError('branch-unhealthy', `the preview branch reported ${read.identity.status}`)
      }
      if (Date.now() >= deadline) {
        throw new PreviewError('branch-unhealthy', 'the preview branch did not become healthy in time')
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, interval) })
    }
  }

  /**
   * Run one gate command and record what it observed.
   * @param name - Gate name.
   * @param argv - Fully constructed command.
   * @param signal - Cancellation for the run.
   * @param env - Extra environment for this command alone.
   * @returns The gate result, with redacted evidence.
   */
  async #gate(
    name: string,
    argv: readonly string[],
    signal?: AbortSignal,
    env?: NodeJS.ProcessEnv,
  ): Promise<GateResult> {
    const result = await this.#run(argv, signal, env)
    return {
      name,
      passed: result.exitCode === 0,
      exitCode: result.exitCode,
      evidence: evidenceOf(result),
    }
  }

  /**
   * Delete the branch this run created, whatever happened to the run.
   *
   * Cleanup never throws. Its failure is a separate fact from the run's result
   * because a leaked hosted branch costs money and needs a person, while a
   * failed migration needs a repair cycle, and confusing the two sends the
   * wrong call to the wrong place.
   * @param branchName - Branch to delete.
   * @returns What happened to the branch.
   */
  async #cleanup(branchName: string): Promise<CleanupResult> {
    try {
      // Deliberately not given the run's signal: a cancelled run is exactly the
      // case where the branch would otherwise be left behind.
      const result = await this.#run(branchDeleteArgv(this.#projectRef, branchName))
      if (result.exitCode === 0) return { attempted: true, succeeded: true, message: undefined }
      return {
        attempted: true,
        succeeded: false,
        message: `deleting the preview branch failed with exit code ${String(result.exitCode)}`,
      }
    }
    catch (error) {
      return {
        attempted: true,
        succeeded: false,
        message: redactConnections(error instanceof Error ? error.message : 'deleting the preview branch failed'),
      }
    }
  }

  /**
   * Provision a preview branch, validate the repository against it, tear it down.
   *
   * The order is fixed: create, wait for healthy, read the preview connection
   * back, apply pending migrations, read the migration list as evidence, lint
   * remotely, then run the project's own suite. Every one of those steps names
   * the preview connection explicitly, so there is no step at which the parent
   * project could be the target by omission.
   * @param request - The branch to create and the run's cancellation.
   * @returns What the run observed and what happened to the branch.
   */
  async run(request: PreviewRunRequest): Promise<PreviewOutcome> {
    const { branchName, signal } = request
    const gates: GateResult[] = []
    let branch: PreviewBranchIdentity | undefined
    let created = false

    try {
      const createArgv = branchCreateArgv(this.#projectRef, branchName, {
        region: this.#options.region,
        size: this.#options.size,
      })
      const withGit = request.gitBranch === undefined
        ? createArgv
        : [...createArgv, '--git-branch', request.gitBranch]
      await this.#must(withGit, 'creating the preview branch', 'command-failed', signal)
      created = true

      const healthy = await this.#waitForHealthy(branchName, signal)
      branch = healthy.identity
      const connection = healthy.connection

      gates.push(await this.#gate('migrations', dbPushArgv(connection), signal))
      gates.push(await this.#gate('migration-list', migrationListArgv(connection), signal))
      gates.push(await this.#gate(
        'lint',
        dbLintArgv(connection, { schema: this.#options.schema, failOn: this.#options.lintFailOn }),
        signal,
      ))

      const testCommand = this.#options.testCommand
      if (testCommand !== undefined) {
        assertProjectTestCommand(testCommand)
        const variable = this.#options.testConnectionEnv ?? 'SUPABASE_PREVIEW_DB_URL'
        gates.push(await this.#gate('project-tests', testCommand, signal, { [variable]: connection }))
      }

      const cleanup = await this.#cleanup(branchName)
      const failed = gates.find(gate => !gate.passed)
      if (failed !== undefined) {
        return {
          status: 'FAILED',
          branch,
          gates,
          summary: `the ${failed.name} gate failed on preview branch ${branchName}`,
          failure: undefined,
          cleanup,
        }
      }
      return {
        status: 'PASSED',
        branch,
        gates,
        summary: `every gate passed on preview branch ${branchName}`,
        failure: undefined,
        cleanup,
      }
    }
    catch (error) {
      // Cleanup first, and for every error rather than only the ones this
      // package names. A failure it did not anticipate — the subprocess seam
      // refusing to spawn, a reader throwing on malformed output — leaves the
      // same hosted branch behind as one it did, and a leaked branch costs
      // money and needs a person whatever raised it.
      const cleanup = created
        ? await this.#cleanup(branchName)
        : { attempted: false, succeeded: false, message: undefined }
      if (!(error instanceof PreviewError)) throw error
      return {
        status: 'BLOCKED',
        branch,
        gates,
        summary: `no safe preview database could be used, so nothing was validated: ${redactConnections(error.message)}`,
        failure: { code: error.code, message: redactConnections(error.message) },
        cleanup,
      }
    }
  }
}
