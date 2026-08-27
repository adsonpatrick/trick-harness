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
import ts from 'typescript'

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

/** One literal dependency the file declares, and where its specifier is written. */
interface ModuleReference {
  /** Module specifier exactly as it appears in source. */
  readonly specifier: string
  /** 1-based line the specifier's string literal starts on. */
  readonly line: number
}

/** The parser mode an authored file is read in, chosen from its extension. */
function scriptKindOf(file: string): ts.ScriptKind {
  const extension = file.split('.').at(-1)
  if (extension === 'tsx') return ts.ScriptKind.TSX
  if (extension === 'jsx') return ts.ScriptKind.JSX
  if (extension === 'js' || extension === 'mjs' || extension === 'cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * Read the literal module specifiers a source file declares.
 *
 * Syntax rather than text, because the boundary is a property of the program
 * and not of its formatting: a specifier split across lines is the same
 * dependency, and the same words inside a comment or a string are not a
 * dependency at all. Both facts are invisible to a line-by-line scan, which is
 * what made a load-bearing architecture gate depend on where a formatter chose
 * to wrap.
 *
 * Only literal specifiers are reported. A computed `import(`${base}/x`)` names
 * a module this gate cannot know statically, so it is left outside the rule
 * rather than guessed at from the fragments that happen to be spelled out.
 * @param file - Repo-relative path of the file, used to pick the parser mode.
 * @param source - The file's full text.
 * @returns One record per literal specifier, in source order.
 */
function moduleReferences(file: string, source: string): readonly ModuleReference[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file))
  const references: ModuleReference[] = []

  const record = (node: ts.Node | undefined): void => {
    if (node === undefined || !ts.isStringLiteralLike(node)) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    references.push({ specifier: node.text, line: line + 1 })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node.moduleReference.expression)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      record(node.argument.literal)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || (isRequire && node.arguments.length === 1)) record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)
  return references
}

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
  const from = groupOf(file)

  for (const { specifier, line } of moduleReferences(file, source)) {
    const resolved = resolveSpecifier(file, specifier)
    if (reachesProfiles(resolved)) {
      violations.push({ line, detail: `generic package must not import project policy (${resolved})` })
      continue
    }
    const scope = FORK_LOCAL_SPECIFIER.exec(specifier)
    const imported = scope === null ? undefined : groups.get(`@trick-harness/${scope[1] ?? ''}`)
    if (from === undefined || imported === undefined || layerAllows(from, imported)) continue
    violations.push({
      line,
      detail: `${from} must not import ${imported} (${specifier}): the dependency arrow runs one way`,
    })
  }

  // Deliberately textual, and deliberately separate from the syntax pass above.
  // A project identifier is forbidden wherever it is written — in a comment, a
  // template, a fixture string — because what leaks is the name itself, not a
  // dependency on it. There is no syntax node that means "names a product".
  for (const [index, line] of source.split('\n').entries()) {
    for (const identifier of PROJECT_POLICY_IDENTIFIERS) {
      if (!line.includes(identifier)) continue
      violations.push({
        line: index + 1,
        detail: `generic package must not name project-specific identifier ${JSON.stringify(identifier)}`,
      })
    }
  }

  // Stable by line, so a file failing both rules still reads top to bottom and
  // an import violation precedes an identifier one written on the same line.
  return violations
    .sort((left, right) => left.line - right.line)
    .map(({ line, detail }) => `${file}:${line}: ${detail}`)
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
