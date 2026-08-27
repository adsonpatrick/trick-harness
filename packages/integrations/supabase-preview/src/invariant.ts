/**
 * Startup invariant for cloud-only Supabase preview validation.
 *
 * The expectations are restated here as independent constants rather than
 * imported from the module they check. That is the point of the companion: a
 * later edit that widens the denied set widens it in one place, and this file
 * still holds the set the design was reviewed against.
 * @module @trick-harness/supabase-preview/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { branchCreateArgv, dbLintArgv, dbPushArgv, migrationListArgv } from './index.ts'

const PACKAGE_NAME = '@trick-harness/supabase-preview'

/** Cordis service name for this invariant. */
export const name = 'supabase-preview-invariant'

/** Services this invariant needs at startup. */
export const inject = ['invariants']

/** Flags no canonical command may carry, restated independently. */
const EXPECTED_DENIED_FLAGS = ['--local', '--linked']

/** Command words no canonical command may name, restated independently. */
const EXPECTED_DENIED_WORDS = ['start', 'reset', 'pull', 'diff']

/** A project ref shaped like a real one, used only to build sample commands. */
const SAMPLE_REF = 'abcdefghijklmnop'

/** A sample preview connection, which is not a credential of any real project. */
const SAMPLE_CONNECTION = 'postgresql://sample:sample@db.preview.example:5432/postgres'

/**
 * Check that no canonical command reaches a local stack or the parent project.
 * @param fail - Reporter for a violated expectation.
 */
function validateCanonicalCommands(fail: InvariantFailure): void {
  const commands: readonly (readonly string[])[] = [
    branchCreateArgv(SAMPLE_REF, 'preview-run'),
    dbPushArgv(SAMPLE_CONNECTION),
    migrationListArgv(SAMPLE_CONNECTION),
    dbLintArgv(SAMPLE_CONNECTION),
  ]
  for (const argv of commands) {
    for (const denied of EXPECTED_DENIED_FLAGS) {
      if (argv.includes(denied)) fail(`a canonical command carries ${denied}`)
    }
    for (const denied of EXPECTED_DENIED_WORDS) {
      if (argv.includes(denied)) fail(`a canonical command names ${denied}`)
    }
  }
}

/**
 * Check that every database command names its target explicitly.
 * @param fail - Reporter for a violated expectation.
 */
function validateExplicitTarget(fail: InvariantFailure): void {
  for (const argv of [dbPushArgv(SAMPLE_CONNECTION), migrationListArgv(SAMPLE_CONNECTION), dbLintArgv(SAMPLE_CONNECTION)]) {
    if (!argv.includes('--db-url')) fail('a database command does not name the database it targets')
  }
}

const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  validateCanonicalCommands(fail)
  validateExplicitTarget(fail)
}

/**
 * Register the invariant with the runtime.
 * @param ctx - Cordis context carrying the invariants service.
 * @returns Disposer for the registration.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
