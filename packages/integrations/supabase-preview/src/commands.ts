/**
 * The exact Supabase CLI vocabulary a preview-branch run is allowed to speak,
 * as pure argv construction and the validation that guards it.
 *
 * Two whole families of command are absent rather than guarded. The local
 * family — `supabase start`, `supabase test db`, `db reset`, `db pull`,
 * `db diff`, and anything carrying `--local` — needs Docker and a local
 * database, and this capability has neither by design. The `--linked` family
 * is absent for a sharper reason: linked means the parent project, and a run
 * that fell back to the parent would be validating a change by applying it to
 * the database everyone else is using.
 *
 * Every database command therefore names its target explicitly, as a
 * connection string read back from the preview branch that this run created.
 * @module @trick-harness/supabase-preview/commands
 */

/** Flags that would move a command off the preview branch this run owns. */
export const DENIED_TARGET_FLAGS: readonly string[] = ['--local', '--linked']

/** Command paths that require Docker or a local database, written as prefixes. */
export const DENIED_COMMAND_PATHS: readonly (readonly string[])[] = [
  ['start'],
  ['stop'],
  ['test', 'db'],
  ['db', 'reset'],
  ['db', 'pull'],
  ['db', 'diff'],
]

/** The only program this capability spawns for its own canonical commands. */
export const SUPABASE_PROGRAM = 'supabase'

/** A preview-branch operation that cannot be performed as asked. */
export class PreviewError extends Error {
  /** Machine-readable cause, so a caller can branch without parsing prose. */
  readonly code:
    | 'denied-operation'
    | 'invalid-project-ref'
    | 'invalid-branch-name'
    | 'unsafe-connection'
    | 'shared-parent'
    | 'unreadable-branch'
    | 'branch-unhealthy'
    | 'command-failed'
    | 'cancelled'

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail, naming no connection string or credential.
   */
  constructor(code: PreviewError['code'], message: string) {
    super(message)
    this.name = 'PreviewError'
    this.code = code
  }
}

/**
 * Reject an argv that would leave the preview branch or need a local stack.
 *
 * This is a second reading of commands this module already built, kept because
 * the denied set is the part of this package a reviewer looks for first and
 * should find stated once, as data.
 * @param argv - Fully constructed command.
 * @throws PreviewError when the command names a denied operation.
 */
export function assertAllowed(argv: readonly string[]): void {
  if (argv[0] !== SUPABASE_PROGRAM) {
    throw new PreviewError('denied-operation', 'this capability spawns the Supabase CLI and nothing else')
  }
  for (const argument of argv.slice(1)) {
    if (DENIED_TARGET_FLAGS.includes(argument)) {
      throw new PreviewError(
        'denied-operation',
        `${argument} would target a database other than the preview branch this run owns`,
      )
    }
  }
  const path = argv.slice(1).filter(part => !part.startsWith('-'))
  for (const denied of DENIED_COMMAND_PATHS) {
    if (denied.every((part, index) => path[index] === part)) {
      throw new PreviewError(
        'denied-operation',
        `supabase ${denied.join(' ')} needs a local stack, which this capability does not have`,
      )
    }
  }
}

/**
 * Check a parent project ref, which is non-secret project configuration.
 *
 * A ref is an opaque lowercase identifier. Validating its shape keeps it from
 * being a place to smuggle a flag into an argv that otherwise looks canonical.
 * @param projectRef - Parent project ref from project configuration.
 * @throws PreviewError when the ref is not a plain project identifier.
 */
export function assertProjectRef(projectRef: string): void {
  if (!/^[a-z]{16,32}$/.test(projectRef)) {
    throw new PreviewError(
      'invalid-project-ref',
      'a project ref is a plain lowercase identifier, and this one is not shaped like one',
    )
  }
}

/**
 * Check a preview branch name before it becomes part of a command.
 * @param branchName - Name for the preview branch.
 * @throws PreviewError when the name is empty or not a plain branch-safe name.
 */
export function assertBranchName(branchName: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branchName)) {
    throw new PreviewError(
      'invalid-branch-name',
      'a preview branch name is a plain name, and this one is empty or holds characters a name may not',
    )
  }
}

/**
 * Check that a connection string is safe to hand a database command, and that
 * it does not point at the shared parent project.
 *
 * The parent check is the whole point of the capability. Supabase reports the
 * parent ref inside the preview host name for the parent's own database, so a
 * connection carrying it is the shared database, whatever asked for it.
 * @param connection - Connection string read back from the preview branch.
 * @param parentRef - The parent project ref this run must never mutate.
 * @throws PreviewError when the connection is unusable or is the parent's.
 */
export function assertPreviewConnection(connection: string, parentRef: string): void {
  if (!/^postgres(?:ql)?:\/\/\S+$/.test(connection)) {
    throw new PreviewError('unsafe-connection', 'the preview branch reported no usable Postgres connection')
  }
  if (/\s/.test(connection)) {
    throw new PreviewError('unsafe-connection', 'the reported connection contains whitespace and is not one value')
  }
  if (connection.includes(parentRef)) {
    throw new PreviewError(
      'shared-parent',
      'the reported connection points at the shared parent project, which this capability never mutates',
    )
  }
}

/**
 * Remove connection strings from text that will be reported or logged.
 *
 * Diagnostics from a database command routinely echo the URL they were given,
 * and that URL carries a password. Redacting at the boundary means a caller
 * cannot leak one by reporting a failure faithfully.
 * @param text - Command output or message.
 * @returns The same text with any Postgres connection string replaced.
 */
export function redactConnections(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]')
}

/**
 * Create a preview branch on the parent project.
 * @param projectRef - Parent project ref.
 * @param branchName - Name for the new preview branch.
 * @param options - Optional region and instance size from project configuration.
 * @returns The `supabase branches create` command.
 * @throws PreviewError when the ref, the name or the command is not allowed.
 */
export function branchCreateArgv(
  projectRef: string,
  branchName: string,
  options: { readonly region?: string | undefined; readonly size?: string | undefined } = {},
): readonly string[] {
  assertProjectRef(projectRef)
  assertBranchName(branchName)
  const argv = [SUPABASE_PROGRAM, 'branches', 'create', branchName, '--project-ref', projectRef, '--experimental']
  if (options.region !== undefined) argv.push('--region', options.region)
  if (options.size !== undefined) argv.push('--size', options.size)
  assertAllowed(argv)
  return argv
}

/**
 * Read one preview branch, including its status and connection details.
 * @param projectRef - Parent project ref.
 * @param branchName - Branch name or id.
 * @returns The `supabase branches get` command, in JSON output mode.
 * @throws PreviewError when the ref, the name or the command is not allowed.
 */
export function branchGetArgv(projectRef: string, branchName: string): readonly string[] {
  assertProjectRef(projectRef)
  assertBranchName(branchName)
  const argv = [
    SUPABASE_PROGRAM, 'branches', 'get', branchName,
    '--project-ref', projectRef,
    '--experimental',
    '--output', 'json',
  ]
  assertAllowed(argv)
  return argv
}

/**
 * Delete the preview branch this run created.
 * @param projectRef - Parent project ref.
 * @param branchName - Branch name or id.
 * @returns The `supabase branches delete` command.
 * @throws PreviewError when the ref, the name or the command is not allowed.
 */
export function branchDeleteArgv(projectRef: string, branchName: string): readonly string[] {
  assertProjectRef(projectRef)
  assertBranchName(branchName)
  const argv = [
    SUPABASE_PROGRAM, 'branches', 'delete', branchName,
    '--project-ref', projectRef,
    '--experimental',
    '--yes',
  ]
  assertAllowed(argv)
  return argv
}

/**
 * Apply the repository's pending migration history to the preview database.
 * @param connection - Preview branch connection string.
 * @returns The `supabase db push` command, targeting the preview branch alone.
 * @throws PreviewError when the command is not allowed.
 */
export function dbPushArgv(connection: string): readonly string[] {
  const argv = [SUPABASE_PROGRAM, 'db', 'push', '--db-url', connection, '--include-all', '--yes']
  assertAllowed(argv)
  return argv
}

/**
 * Read which migrations the preview database now holds.
 *
 * This is the evidence that the push did what the repository's history says,
 * rather than the push's own claim that it succeeded.
 * @param connection - Preview branch connection string.
 * @returns The `supabase migration list` command.
 * @throws PreviewError when the command is not allowed.
 */
export function migrationListArgv(connection: string): readonly string[] {
  const argv = [SUPABASE_PROGRAM, 'migration', 'list', '--db-url', connection]
  assertAllowed(argv)
  return argv
}

/**
 * Lint the preview database schema remotely.
 * @param connection - Preview branch connection string.
 * @param options - Schemas to include and the level that fails the gate.
 * @returns The `supabase db lint` command.
 * @throws PreviewError when the command is not allowed.
 */
export function dbLintArgv(
  connection: string,
  options: { readonly schema?: string | undefined; readonly failOn?: 'none' | 'warning' | 'error' | undefined } = {},
): readonly string[] {
  const argv = [SUPABASE_PROGRAM, 'db', 'lint', '--db-url', connection]
  if (options.schema !== undefined) argv.push('--schema', options.schema)
  argv.push('--fail-on', options.failOn ?? 'error')
  assertAllowed(argv)
  return argv
}

/**
 * Check a project-provided test command before it is spawned.
 *
 * The pgTAP and RLS suites belong to the project, not to this package, so the
 * command is configuration. It is still read for the same denied flags: a
 * project test command carrying `--local` or `--linked` would quietly move the
 * gate off the branch the run provisioned.
 * @param argv - Test command as the project configured it.
 * @throws PreviewError when the command is empty or names a denied operation.
 */
export function assertProjectTestCommand(argv: readonly string[]): void {
  if (argv.length === 0) {
    throw new PreviewError('denied-operation', 'a project test command was configured as an empty argv')
  }
  for (const argument of argv) {
    if (DENIED_TARGET_FLAGS.includes(argument)) {
      throw new PreviewError(
        'denied-operation',
        `${argument} in the project test command would move the gate off the preview branch`,
      )
    }
  }
  if (argv[0] === SUPABASE_PROGRAM) assertAllowed(argv)
}
