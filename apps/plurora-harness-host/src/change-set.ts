/**
 * What the published branch actually changed, read from Git.
 *
 * Change impact has two readings. The planned one comes from the Plan a person
 * approved; this is the delivered one, and it is read here by running two Git
 * commands and parsing their bytes — never by asking the stage that did the
 * work what it touched. A stage that could report its own diff could report a
 * smaller one, and a smaller diff is a lower risk and a thinner evidence bar,
 * decided by the thing about to be measured against it.
 *
 * The reader only reads. It resolves a merge base and asks for a diff; it does
 * not fetch, check out, reset, merge, or move a ref. A verification step that
 * mutated the checkout it was verifying would change the thing under test.
 *
 * @module apps/plurora-harness-host/change-set
 */

import { ChangeImpactError, normalizeRepositoryPath } from '@trick-harness/change-impact'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/**
 * How much diff output this host will read.
 *
 * A name-status diff is a list of paths, so this is generous for any change a
 * person would review in one pull request. What outgrows it is refused rather
 * than truncated: half a change set is a smaller change set, and a smaller
 * change set scores as lower risk.
 */
export const MAX_DIFF_BYTES = 1024 * 1024

/** An exact commit, which is the only thing a merge base may be. */
const COMMIT = /^[0-9a-f]{40}$/

/**
 * A status token this host understands.
 *
 * `R`/`C` carry a similarity score and name two paths; the rest name one.
 * Anything else — including `U` from an unfinished merge — is refused, because
 * a token this reader guessed at is a path it may have mis-assigned.
 */
const STATUS = /^(?:[AMTUXB]|[RC]\d{1,3})$/

/** Statuses whose record names an old path and a new one. */
const TWO_PATH_STATUS = /^[RC]\d{1,3}$/

/** Raised when the published change set could not be read. */
export class ChangeSetError extends Error {
  override readonly name = 'ChangeSetError'
}

/** The delivered half of change impact, once there is a branch to read it from. */
export interface ProjectChangeSetReader {
  /**
   * The repository paths the published branch changed.
   *
   * @param signal - abort carried into every command started.
   */
  actualPaths(signal: AbortSignal): Promise<readonly string[]>
}

/** What the reader needs from the deployment. */
export interface GitChangeSetReaderOptions {
  /** The checkout to read, and the only directory Git is given. */
  readonly projectRoot: string
  /** The branch a delivery is measured against, from the deployment file. */
  readonly protectedBranch: string
  /** Subprocess termination grace for the managed process tree. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

/**
 * Read a `--name-status -z` stream into the paths it names.
 *
 * NUL-separated because `-z` is the only form that survives a repository path
 * containing a newline: a line-based reader can be handed a filename that
 * fabricates records, and the fabricated ones would look exactly like real
 * changes to files nobody touched.
 *
 * @param text - Git's output, verbatim.
 * @returns the paths, deduplicated, in the order the diff named them.
 * @throws {ChangeSetError} when a record is malformed or names a path Git could
 * not have produced from inside the repository.
 */
export function parseNameStatus(text: string): readonly string[] {
  const fields = text.split('\0').filter(field => field !== '')
  const paths = new Set<string>()

  let index = 0
  while (index < fields.length) {
    const status = fields[index] ?? ''
    if (!STATUS.test(status)) {
      throw new ChangeSetError('the published diff carries a record status this host does not read')
    }
    const expected = TWO_PATH_STATUS.test(status) ? 2 : 1
    // A record that stops before naming its paths is refused rather than
    // dropped: the missing path is a file the branch changed, and leaving it
    // out understates what was delivered.
    if (fields.length - index - 1 < expected) {
      throw new ChangeSetError('the published diff ends in the middle of a record')
    }
    for (let offset = 1; offset <= expected; offset += 1) {
      paths.add(readPath(fields[index + offset] ?? ''))
    }
    index += expected + 1
  }

  return Object.freeze([...paths])
}

/**
 * Read one path out of a record, refusing what Git cannot have meant.
 *
 * @param raw - the field as Git wrote it.
 * @returns the path in repository-relative POSIX form.
 * @throws {ChangeSetError} when it is not repository-relative.
 */
function readPath(raw: string): string {
  try {
    return normalizeRepositoryPath(raw)
  }
  catch (cause) {
    // Never quoted back. Git output is repository content, and this refusal is
    // journalled.
    if (cause instanceof ChangeImpactError) {
      throw new ChangeSetError('the published diff names a path that is not repository-relative')
    }
    throw cause
  }
}

/**
 * Run one read-only Git command and hand back its standard output.
 *
 * @param options - the checkout and how to spawn.
 * @param argv - the whole command, as a vector, so nothing is ever assembled.
 * @param signal - abort carried into the child.
 * @param what - what this call was for, for a failure that quotes no output.
 * @returns the child's standard output.
 * @throws {ChangeSetError} when the command could not run or did not succeed.
 */
async function git(
  options: GitChangeSetReaderOptions,
  argv: readonly string[],
  signal: AbortSignal,
  what: string,
): Promise<string> {
  let child: SubprocessHandle
  try {
    child = options.spawn({
      argv: [...argv],
      cwd: options.projectRoot,
      // No stdin: Git is asked, never answered. A bounded stdout because the
      // whole point of this reading is that its size is not known in advance.
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_DIFF_BYTES },
        stderr: { maxBytes: MAX_DIFF_BYTES },
      },
      graceMs: options.disposeGraceMs,
      signal,
    })
  }
  catch {
    // The cause is dropped here and below. It comes from a project checkout and
    // this failure is journalled.
    throw new ChangeSetError(`git could not be started to ${what}`)
  }

  try {
    const outcome = await child.done
    // The direct child exiting is not the tree going quiet, and a Git that is
    // still writing is a diff this host would read half of.
    if (!await child.waitForExit()) {
      throw new ChangeSetError(`the git process tree did not go quiescent while trying to ${what}`)
    }
    if (outcome.exitCode !== 0) {
      throw new ChangeSetError(`git could not ${what}`)
    }
    const read = child.collected.stdout?.readFrom(0)
    if (read === undefined) throw new ChangeSetError(`git produced no output while trying to ${what}`)
    if (read.lossy) throw new ChangeSetError(`the output outgrew the bound this host reads it under while trying to ${what}`)
    return read.text
  }
  finally {
    // This host owns the process it started, including on the paths that gave
    // up on its answer.
    child.terminate()
  }
}

/**
 * Create the reader for this deployment's checkout.
 *
 * @param options - the checkout, the protected branch, and how to spawn.
 * @returns a reader that answers with the delivered change set.
 */
export function createGitChangeSetReader(options: GitChangeSetReaderOptions): ProjectChangeSetReader {
  return {
    async actualPaths(signal) {
      // The merge base rather than the branch tip: a diff against the tip would
      // report every commit that landed on the protected branch since this work
      // started as part of this delivery.
      const base = (await git(
        options,
        ['git', 'merge-base', 'HEAD', `origin/${options.protectedBranch}`],
        signal,
        'resolve the merge base with the protected branch',
      )).trim()
      if (!COMMIT.test(base)) {
        throw new ChangeSetError('git named something other than one commit as the merge base')
      }

      const diff = await git(
        options,
        ['git', 'diff', '--name-status', '-z', '--diff-filter=ACMRTUXB', `${base}..HEAD`],
        signal,
        'read the published diff',
      )
      return parseNameStatus(diff)
    },
  }
}
