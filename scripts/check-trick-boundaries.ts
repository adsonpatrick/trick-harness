/**
 * Enforce the reusable Trick Harness boundary: generic packages own mechanism,
 * project profiles own policy, and the dependency direction between them runs
 * one way only.
 *
 * `packages/core`, `packages/providers`, `packages/integrations`, and
 * `packages/composition` may not import `profiles/**`, and may not name the strong identifiers that belong to
 * a consuming product. Profiles compose the generic layers freely, so the scan
 * is deliberately one-directional.
 *
 * The same scan enforces the arrow *between* those groups — `core` <-
 * `providers`/`integrations` <- `composition` — so a generic package cannot
 * quietly depend on a layer above it either.
 *
 * Run: `tsx scripts/check-trick-boundaries.ts`.
 */

import { globSync, readFileSync } from 'node:fs'
import { posix, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

/** Package groups that must stay project-agnostic. */
const GENERIC_PACKAGE_ROOTS = [
  'packages/core',
  'packages/providers',
  'packages/integrations',
  'packages/composition',
] as const

/**
 * Which fork-local package scopes each layer may import from.
 *
 * The one-way arrow — `core` <- `providers`/`integrations` <- `composition` <-
 * `profiles` — was documented and enforced only at its last hop: nothing
 * stopped `packages/core` from importing `@trick-harness/composition` and
 * inverting the whole thing. Placing a package in the right group is a
 * judgement call made once, at review time; this table is what keeps it true
 * afterwards. Layers are listed with the scopes they may reach, so a new group
 * has to state its position rather than inherit an accidental one.
 */
const LAYER_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  // The base of the stack: it may not reach any layer above it, because every
  // layer above is built on it.
  'packages/core': ['packages/core'],
  // Adapters bind one product to the core contracts and nothing else. They may
  // not reach the composition layer that assembles them.
  'packages/providers': ['packages/core', 'packages/providers'],
  'packages/integrations': ['packages/core', 'packages/integrations'],
  // Composition is the only layer allowed to know which providers exist.
  'packages/composition': [
    'packages/core',
    'packages/providers',
    'packages/integrations',
    'packages/composition',
  ],
}

/**
 * Fork-local package specifier, e.g. `@trick-harness/provider-codex/invariant`.
 *
 * The group each name belongs to is read from the workspace rather than listed
 * here, so adding a provider is a package directory and nothing else — a gate
 * that had to be edited for every new package would be edited without thought.
 */
const FORK_LOCAL_SPECIFIER = /^@trick-harness\/([^/]+)/

/** Trees inside a package that hold dependencies or build output rather than authored source. */
const NON_SOURCE_SEGMENTS = new Set(['node_modules', 'lib', 'dist', 'coverage'])

/** Extensions carrying authored source the boundary applies to. */
const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'mjs', 'cjs'] as const

/**
 * Identifiers naming a specific consuming product rather than a reusable
 * capability. The bare product name is absent on purpose: provenance comments
 * and tests that intentionally exercise the Plurora profile legitimately use
 * it, while these strings only ever appear when policy has leaked downward.
 */
export const PROJECT_POLICY_IDENTIFIERS = [
  'adsonpatrick/neuro-via',
  'neurovia-dev',
  'uljaajwwnygopsyvwsre',
  'Notion',
  'Linear',
  'Plurora Design System',
] as const

/**
 * Module specifier of a static import/export, a dynamic import, or a require
 * call. The optional paren covers `import('…')` alongside bare `import '…'`.
 */
const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

/**
 * Whether one repo-relative path is authored source inside a generic package.
 * @param file - Repo-relative path with `/` separators.
 * @returns True when the boundary rules apply to the file.
 */
export function isGenericPackageSource(file: string): boolean {
  if (!GENERIC_PACKAGE_ROOTS.some(base => file.startsWith(`${base}/`))) return false
  const segments = file.split('/')
  if (segments.some(segment => NON_SOURCE_SEGMENTS.has(segment))) return false
  const extension = segments.at(-1)?.split('.').at(-1)
  return extension !== undefined && (SOURCE_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Resolve one module specifier to the repo-relative path it names.
 *
 * A relative specifier is resolved against the importing file so that
 * `../../../profiles/plurora` is recognised for what it reaches; anything else
 * is already a bare path or package name and is compared as written.
 * @param file - Repo-relative path of the importing file.
 * @param specifier - Module specifier exactly as it appears in source.
 * @returns The repo-relative path the specifier reaches.
 */
function resolveSpecifier(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  return posix.normalize(posix.join(posix.dirname(file), specifier))
}

/** Whether a resolved specifier reaches into the project-profile tree. */
function reachesProfiles(resolved: string): boolean {
  return /(?:^|\/)profiles\//.test(resolved)
}

/**
 * Map every fork-local package name to the group directory it lives in.
 *
 * Read from `package.json` files rather than declared, so the layer table above
 * stays a statement about direction and never becomes a package inventory.
 * @param repositoryRoot - Absolute path of the repository root.
 * @returns Package name to owning group, e.g. `@trick-harness/executor` to `packages/core`.
 */
export function forkLocalPackageGroups(repositoryRoot: string): ReadonlyMap<string, string> {
  const groups = new Map<string, string>()
  for (const match of globSync('packages/*/*/package.json', { cwd: repositoryRoot })) {
    const file = match.split('\\').join('/')
    const group = file.split('/').slice(0, 2).join('/')
    if (!(group in LAYER_IMPORTS)) continue
    const manifest: unknown = JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8'))
    const name = (manifest as { name?: unknown }).name
    if (typeof name === 'string') groups.set(name, group)
  }
  return groups
}

/** The group directory a generic source file belongs to. */
function groupOf(file: string): string | undefined {
  return Object.keys(LAYER_IMPORTS).find(group => file.startsWith(`${group}/`))
}

/**
 * Whether one layer may import a fork-local package from another.
 * @param from - The importing file's group directory.
 * @param to - The imported package's group directory.
 * @returns True when the dependency runs with the one-way arrow, not against it.
 */
function layerAllows(from: string, to: string): boolean {
  return LAYER_IMPORTS[from]?.includes(to) ?? false
}

/**
 * Apply both boundary rules to one authored source file.
 * @param file - Repo-relative path with `/` separators.
 * @param source - The file's full text.
 * @returns One message per violation, ordered by line.
 */
export function collectSourceViolations(
  file: string,
  source: string,
  groups: ReadonlyMap<string, string> = new Map(),
): string[] {
  const violations: { line: number; detail: string }[] = []
  const lines = source.split('\n')
  const from = groupOf(file)

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(SPECIFIER_PATTERN)) {
      // The capture group is guaranteed by the pattern, but the compiler cannot
      // see that under `noUncheckedIndexedAccess`.
      const specifier = match[1]
      if (specifier === undefined) continue
      const resolved = resolveSpecifier(file, specifier)
      if (reachesProfiles(resolved)) {
        violations.push({
          line: index + 1,
          detail: `generic package must not import project policy (${resolved})`,
        })
        continue
      }
      const scope = FORK_LOCAL_SPECIFIER.exec(specifier)
      const imported = scope === null ? undefined : groups.get(`@trick-harness/${scope[1] ?? ''}`)
      if (from === undefined || imported === undefined || layerAllows(from, imported)) continue
      violations.push({
        line: index + 1,
        detail: `${from} must not import ${imported} (${specifier}): the dependency arrow runs one way`,
      })
    }
    for (const identifier of PROJECT_POLICY_IDENTIFIERS) {
      if (!line.includes(identifier)) continue
      violations.push({
        line: index + 1,
        detail: `generic package must not name project-specific identifier ${JSON.stringify(identifier)}`,
      })
    }
  }

  return violations.map(({ line, detail }) => `${file}:${line}: ${detail}`)
}

/**
 * Scan every generic package source in the repository.
 * @param repositoryRoot - Absolute path of the repository root.
 * @returns One message per violation across the whole scan.
 */
export function collectBoundaryViolations(repositoryRoot: string): string[] {
  const files = globSync(
    GENERIC_PACKAGE_ROOTS.map(base => `${base}/*/**/*.{${SOURCE_EXTENSIONS.join(',')}}`),
    { cwd: repositoryRoot },
  )
    .map(match => relative(repositoryRoot, resolve(repositoryRoot, match)).split('\\').join('/'))
    .filter(isGenericPackageSource)
    .sort()

  const groups = forkLocalPackageGroups(repositoryRoot)
  return files.flatMap(file =>
    collectSourceViolations(file, readFileSync(resolve(repositoryRoot, file), 'utf8'), groups))
}

/** Run the reusable-boundary gate. */
export function main(): void {
  const violations = collectBoundaryViolations(root)
  if (violations.length > 0) {
    console.error(violations.join('\n'))
    process.exitCode = 1
    return
  }
  console.log('check-trick-boundaries: generic packages carry no project-policy dependency.')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
