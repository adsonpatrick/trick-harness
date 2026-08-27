/**
 * The exact command vocabulary scoped delivery is allowed to speak, as pure
 * argv construction and the validation that guards it.
 *
 * Every command is an array whose first element is the program, so nothing a
 * caller supplies is ever concatenated into a shell string. A branch name, a
 * commit message and a PR title all arrive from a model or a run request; as
 * argv elements they are values, and there is no quoting mistake left to make.
 *
 * The denied set — force push, protected-branch mutation, merge, release and
 * any branch other than the one checked out — is refused here rather than at
 * the subprocess seam, because a command that was never constructed cannot be
 * spawned by mistake later.
 * @module @trick-harness/github-delivery/commands
 */

/** Branches a scoped delivery may never mutate, whatever it was asked to do. */
export const PROTECTED_BRANCHES: readonly string[] = ['main', 'master', 'trunk', 'release', 'production']

/** Arguments that would turn an allowed push into a denied one. */
export const DENIED_PUSH_ARGS: readonly string[] = [
  '--force',
  '-f',
  '--force-with-lease',
  '--force-if-includes',
  '--delete',
  '--mirror',
  '--prune',
]

/** Git and GitHub subcommands outside the allowed operation set. */
export const DENIED_SUBCOMMANDS: readonly string[] = ['merge', 'rebase', 'reset', 'filter-branch', 'tag']

/** A delivery operation that cannot be performed as asked. */
export class DeliveryError extends Error {
  /** Machine-readable cause, so a caller can branch without parsing prose. */
  readonly code:
    | 'protected-branch'
    | 'detached-head'
    | 'foreign-branch'
    | 'invalid-path'
    | 'denied-operation'
    | 'empty-write-set'
    | 'unexpected-stage'
    | 'nothing-to-commit'
    | 'unverified-push'
    | 'uncheckpointed-mutation'
    | 'command-failed'
    | 'teardown-failed'

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail, naming no credential or command output.
   */
  constructor(code: DeliveryError['code'], message: string) {
    super(message)
    this.name = 'DeliveryError'
    this.code = code
  }
}

/**
 * Whether a branch name is one no automated delivery may write to.
 *
 * The comparison is case-insensitive because a remote's default branch is a
 * name, not an identifier, and `Main` protects exactly as much as `main`.
 * @param branch - Branch name as git reports it.
 * @param protectedBranches - Names to treat as protected.
 * @returns True when the branch may not be mutated.
 */
export function isProtectedBranch(
  branch: string,
  protectedBranches: readonly string[] = PROTECTED_BRANCHES,
): boolean {
  const normalized = branch.trim().toLowerCase()
  return protectedBranches.some(name => name.toLowerCase() === normalized)
}

/**
 * Check that the branch a delivery was asked to write is the branch the
 * workspace actually has checked out, and that it is not protected.
 *
 * Both halves matter. A delivery that pushed a branch other than the one it
 * read would be pushing work it never saw, and a delivery that pushed a
 * protected branch would be doing the one thing a human merge exists for.
 * @param requested - Branch the caller asked to deliver.
 * @param checkedOut - Branch the workspace reports, or `HEAD` when detached.
 * @param protectedBranches - Names to treat as protected.
 * @throws DeliveryError when the branch is detached, foreign or protected.
 */
export function assertDeliverableBranch(
  requested: string,
  checkedOut: string,
  protectedBranches: readonly string[] = PROTECTED_BRANCHES,
): void {
  if (checkedOut === 'HEAD' || checkedOut === '') {
    throw new DeliveryError('detached-head', 'the workspace has no branch checked out, so there is nothing to deliver')
  }
  if (requested !== checkedOut) {
    throw new DeliveryError(
      'foreign-branch',
      `delivery was asked for ${JSON.stringify(requested)} but the workspace has ${JSON.stringify(checkedOut)} checked out`,
    )
  }
  if (isProtectedBranch(requested, protectedBranches)) {
    throw new DeliveryError(
      'protected-branch',
      `${JSON.stringify(requested)} is protected; an implementation reaches it through a reviewed merge, never through this`,
    )
  }
}

/**
 * Check one path in the approved write set.
 *
 * Paths are repository-relative and stay inside the repository. An absolute
 * path or a `..` segment would let a staged write set name a file the run was
 * never scoped to, and a leading dash would let a path be read as an option by
 * a git version that stopped honouring `--`.
 * @param path - Repository-relative path as the caller wrote it.
 * @throws DeliveryError when the path is not one a scoped delivery may stage.
 */
export function assertWritablePath(path: string): void {
  if (path.trim() === '') {
    throw new DeliveryError('invalid-path', 'the write set contains an empty path')
  }
  if (path.includes('\0')) {
    throw new DeliveryError('invalid-path', 'a path in the write set contains a null byte')
  }
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) {
    throw new DeliveryError('invalid-path', `${JSON.stringify(path)} is absolute; the write set is repository-relative`)
  }
  if (path.startsWith('-')) {
    throw new DeliveryError('invalid-path', `${JSON.stringify(path)} starts with a dash and would be read as an option`)
  }
  if (path.split(/[/\\]/).includes('..')) {
    throw new DeliveryError('invalid-path', `${JSON.stringify(path)} leaves the repository, which no write set may do`)
  }
}

/**
 * Normalise an approved write set into the exact, ordered, de-duplicated list
 * that will be staged and then read back.
 *
 * Sorting is what makes the read-back comparable: git reports staged paths in
 * its own order, and a delivery that could not compare the two would be
 * asserting nothing about what it actually committed.
 * @param files - Repository-relative paths the run is scoped to write.
 * @returns The same paths, validated, de-duplicated and sorted.
 * @throws DeliveryError when the set is empty or holds a path outside the scope.
 */
export function approvedWriteSet(files: readonly string[]): readonly string[] {
  if (files.length === 0) {
    throw new DeliveryError('empty-write-set', 'a delivery stages an explicit set of paths, and this one names none')
  }
  for (const file of files) assertWritablePath(file)
  return [...new Set(files.map(file => file.replaceAll('\\', '/')))].sort()
}

/**
 * Reject an argv that would perform a denied operation.
 *
 * This is a second reading of a command already built by this module, kept
 * because the denied set is the part of this package a reviewer will look for
 * first and should be able to find stated once, as data.
 * @param argv - Fully constructed command.
 * @throws DeliveryError when the command names a denied operation.
 */
export function assertAllowed(argv: readonly string[]): void {
  const [program] = argv
  // `git -c key=value <subcommand>` is still that subcommand. Reading argv[1]
  // literally would let a configuration flag hide a denied operation behind it,
  // so the leading `-c` pairs are stepped over rather than counted.
  let at = 1
  while (argv[at] === '-c') at += 2
  const subcommand = argv[at]
  if (program === 'git' && subcommand !== undefined && DENIED_SUBCOMMANDS.includes(subcommand)) {
    throw new DeliveryError('denied-operation', `git ${subcommand} is outside the delivery operation set`)
  }
  if (program === 'git' && subcommand === 'push') {
    for (const argument of argv.slice(at + 1)) {
      // Compared on the flag name alone, because git accepts the value forms
      // `--force-with-lease=<ref>` and `--force-if-includes=<ref>`, and a
      // comparison against the whole argument would wave those through while
      // stopping only the bare spelling nobody would reach for on purpose.
      const flag = argument.startsWith('--') ? (argument.split('=')[0] ?? argument) : argument
      if (DENIED_PUSH_ARGS.includes(flag)) {
        throw new DeliveryError('denied-operation', `${flag} would rewrite or remove remote history`)
      }
      // A refspec whose source half is empty deletes the destination branch.
      // `git push origin :refs/heads/main` removes it as surely as `--delete`
      // does, and carries no flag for a flag list to catch.
      if (argument.startsWith(':')) {
        throw new DeliveryError('denied-operation', 'a refspec with no source would delete the remote branch')
      }
    }
  }
  if (program === 'gh' && (argv[2] === 'merge' || argv[1] === 'release' || argv[1] === 'workflow')) {
    throw new DeliveryError('denied-operation', 'merging, releasing and deploying stay with a person')
  }
}

/**
 * Read the branch currently checked out.
 * @returns The `git rev-parse` command; it prints `HEAD` when detached.
 */
export const currentBranchArgv = (): readonly string[] => ['git', 'rev-parse', '--abbrev-ref', 'HEAD']

/**
 * Read the working tree state in machine-readable form.
 * @returns The `git status --porcelain` command.
 */
export const statusArgv = (): readonly string[] => ['git', 'status', '--porcelain']

/**
 * Read the paths currently staged.
 *
 * `core.quotePath=false` is set for this one command rather than left to the
 * repository's configuration: with the default, git renders a path holding any
 * byte outside ASCII as an escaped, quoted string, and the read-back this feeds
 * would then refuse a perfectly ordinary write set for not matching itself.
 * @returns The `git diff --cached --name-only` command.
 */
export const stagedPathsArgv = (): readonly string[] =>
  ['git', '-c', 'core.quotePath=false', 'diff', '--cached', '--name-only']

/**
 * Read the commit one ref resolves to.
 * @param ref - Ref to resolve, such as `HEAD` or a remote branch.
 * @returns The `git rev-parse --verify` command.
 */
export const revParseArgv = (ref: string): readonly string[] => ['git', 'rev-parse', '--verify', ref]

/**
 * Stage exactly the approved write set and nothing else.
 * @param files - Already-normalised write set.
 * @returns The `git add` command, with `--` separating paths from options.
 */
export function addArgv(files: readonly string[]): readonly string[] {
  const argv = ['git', 'add', '--', ...approvedWriteSet(files)]
  assertAllowed(argv)
  return argv
}

/**
 * Record the staged set as one commit.
 * @param message - Commit message, passed as one argv element.
 * @returns The `git commit` command.
 */
export function commitArgv(message: string): readonly string[] {
  const argv = ['git', 'commit', '-m', message]
  assertAllowed(argv)
  return argv
}

/**
 * Publish the current branch to its own upstream, and nothing else.
 *
 * The refspec is written out rather than left to `HEAD` so the command names
 * the branch it was validated against; `push -u origin HEAD` on a workspace
 * that moved underneath would push whatever is now checked out.
 * @param branch - Validated, non-protected feature branch.
 * @param protectedBranches - Names to treat as protected.
 * @returns The `git push` command.
 * @throws DeliveryError when the branch is protected.
 */
export function pushArgv(
  branch: string,
  protectedBranches: readonly string[] = PROTECTED_BRANCHES,
): readonly string[] {
  if (isProtectedBranch(branch, protectedBranches)) {
    throw new DeliveryError('protected-branch', `${JSON.stringify(branch)} is protected and is never pushed by delivery`)
  }
  const argv = ['git', 'push', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]
  assertAllowed(argv)
  return argv
}

/** Fields read back from GitHub after a PR operation. */
export const PR_FIELDS = 'number,url,state,headRefName'

/**
 * Read the pull request for one branch, if there is one.
 * @param branch - Head branch of the pull request.
 * @returns The `gh pr view` command, in JSON mode.
 */
export function prViewArgv(branch: string): readonly string[] {
  const argv = ['gh', 'pr', 'view', branch, '--json', PR_FIELDS]
  assertAllowed(argv)
  return argv
}

/** What a pull request is opened or updated to say. */
export interface PullRequestSpec {
  readonly title: string
  readonly body: string
  readonly base: string
}

/**
 * Open a pull request from the delivered branch.
 * @param branch - Head branch, already validated.
 * @param spec - Title, body and base branch.
 * @returns The `gh pr create` command.
 */
export function prCreateArgv(branch: string, spec: PullRequestSpec): readonly string[] {
  const argv = [
    'gh', 'pr', 'create',
    '--head', branch,
    '--base', spec.base,
    '--title', spec.title,
    '--body', spec.body,
  ]
  assertAllowed(argv)
  return argv
}

/**
 * Read the CI state of one branch's pull request.
 *
 * This is a description of the delivery, not part of it, and its caller treats
 * a failure here as a gap in the description rather than a failed delivery.
 * @param branch - Head branch of the pull request.
 * @returns The `gh pr checks` command.
 */
export function checksArgv(branch: string): readonly string[] {
  const argv = ['gh', 'pr', 'checks', branch]
  assertAllowed(argv)
  return argv
}

/**
 * Update the pull request that already exists for the delivered branch.
 * @param number - Pull request number, as GitHub reported it.
 * @param spec - Title, body and base branch.
 * @returns The `gh pr edit` command.
 */
export function prUpdateArgv(number: number, spec: PullRequestSpec): readonly string[] {
  const argv = ['gh', 'pr', 'edit', String(number), '--title', spec.title, '--body', spec.body]
  assertAllowed(argv)
  return argv
}
