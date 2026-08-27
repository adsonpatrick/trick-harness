/**
 * Runtime validation for scoped GitHub delivery.
 *
 * The denied operation set is the part of this package a reviewer checks
 * first, and it is the part a well-meaning edit is most likely to widen: one
 * more branch that "is fine to push", one force flag "just for the retry". The
 * expectations are restated here as independent constants rather than imported
 * from the module under check, so a change to the operation set has to be made
 * twice — once in the code and once in the statement of what the code is
 * allowed to do — and cannot be made by accident.
 * @module @trick-harness/github-delivery/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import {
  DENIED_PUSH_ARGS,
  DENIED_SUBCOMMANDS,
  PROTECTED_BRANCHES,
  isProtectedBranch,
  pushArgv,
} from './index.ts'

const PACKAGE_NAME = '@trick-harness/github-delivery'

/** Cordis companion plugin name. */
export const name = 'github-delivery-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The branches an automated delivery may never write, restated. */
const EXPECTED_PROTECTED = ['main', 'master', 'trunk', 'release', 'production']

/** The push arguments that would rewrite or remove remote history, restated. */
const EXPECTED_DENIED_PUSH_ARGS = ['--force', '-f', '--force-with-lease', '--force-if-includes', '--delete']

/** Git subcommands that stay with a person, restated. */
const EXPECTED_DENIED_SUBCOMMANDS = ['merge', 'rebase', 'reset']

/**
 * Check that the operation set has not been widened.
 * @param fail - report a violation.
 */
function validateOperationSet(fail: InvariantFailure): void {
  for (const branch of EXPECTED_PROTECTED) {
    if (!isProtectedBranch(branch)) {
      fail(`github delivery would write ${JSON.stringify(branch)}, which is protected`)
    }
  }
  if (PROTECTED_BRANCHES.length < EXPECTED_PROTECTED.length) {
    fail('github delivery protects fewer branches than the delivery scope names')
  }
  for (const argument of EXPECTED_DENIED_PUSH_ARGS) {
    if (!DENIED_PUSH_ARGS.includes(argument)) {
      fail(`github delivery no longer denies ${argument} on a push`)
    }
  }
  for (const subcommand of EXPECTED_DENIED_SUBCOMMANDS) {
    if (!DENIED_SUBCOMMANDS.includes(subcommand)) {
      fail(`github delivery no longer denies git ${subcommand}`)
    }
  }
}

/**
 * Check that the one command that reaches the remote is still the narrow one.
 *
 * A push is the only irreversible thing this package does, and its shape —
 * one explicit refspec, no force, one remote — is what keeps it recoverable.
 * @param fail - report a violation.
 */
function validatePush(fail: InvariantFailure): void {
  const argv = pushArgv('feature-branch')
  if (argv[0] !== 'git' || argv[1] !== 'push') {
    fail('github delivery no longer publishes through git push')
    return
  }
  if (!argv.includes('origin')) {
    fail('github delivery pushes to a remote other than origin')
  }
  if (!argv.includes('refs/heads/feature-branch:refs/heads/feature-branch')) {
    fail('github delivery no longer names the branch it validated in its own push refspec')
  }
  for (const argument of argv) {
    if (EXPECTED_DENIED_PUSH_ARGS.includes(argument)) {
      fail(`github delivery constructs a push carrying ${argument}`)
    }
  }
}

/** Install validation for scoped GitHub delivery on this runtime. */
const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  validateOperationSet(fail)
  validatePush(fail)
}

/**
 * Register the scoped delivery invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
