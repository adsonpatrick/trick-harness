/**
 * The one definition of what makes a package fork-local.
 *
 * Several upstream scanners glob `packages/*​/*` and then assert that every
 * manifest they find names an `@deepseek-ai` package. Fork-local Trick Harness
 * packages sit under the same hierarchy but are private to this fork and belong
 * to no release family, so each of those scanners needs to skip them. Keeping
 * the rule here means the fork edits one line per scanner instead of restating
 * the namespace in each.
 *
 * See docs/trick-harness/upstream.md.
 *
 * @module scripts/trick-fork
 */

/** npm namespace reserved for private fork-local Trick Harness packages. */
const FORK_LOCAL_PACKAGE_SCOPE = '@trick-harness/'

/**
 * Report whether a package name belongs to the fork-local namespace.
 * @param name - the package's declared `name` field.
 * @returns true when the package is private to this fork.
 */
export function isForkLocalPackage(name: string | undefined): boolean {
  return name?.startsWith(FORK_LOCAL_PACKAGE_SCOPE) === true
}
