/**
 * The Plurora host's deployment config: `plurora-harness.json` at the project
 * root, and the rules that file has to satisfy before the host will boot on it.
 *
 * The file states *where this deployment is pointed* — which checkout, which
 * profile, which control endpoint, which database, which model behind each
 * semantic tier. It deliberately cannot state *how the harness behaves*:
 * routing rules, permission modes and provider credentials all belong to the
 * profile or to the environment, and a deployment file that could override them
 * would move project policy out of review and into an untracked JSON blob on a
 * host machine. So every key this module does not know by name is refused
 * rather than ignored, and anything credential-shaped is refused at any depth —
 * a config file is read, logged and copied around, which is the wrong place for
 * a secret even when the secret is correct.
 *
 * @module apps/plurora-harness-host/config
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The deployment file the host reads, relative to the project root. */
export const DEPLOYMENT_CONFIG_FILE = 'plurora-harness.json'

/** The only checkout this host will run. */
const REPOSITORY = 'adsonpatrick/trick-harness'

/** The only profile this host will run. */
const PROFILE = 'plurora'

/** The only environment this host will run. */
const ENVIRONMENT = 'development'

/** The only database strategy this host will run. */
const DATABASE_STRATEGY = 'shared-cloud-development'

/**
 * Every semantic tier the Plurora routing policy can resolve.
 *
 * The registry has to cover exactly these: a missing tier is a route that
 * cannot dispatch, and an extra tier is a model nothing routes to, which reads
 * as configured capacity that no run will ever use.
 */
export const PLURORA_SEMANTIC_TIERS = [
  'codex.frontier',
  'codex.balanced',
  'opencode.workhorse',
  'opencode.reasoning-fast',
] as const

/** An exact git commit — a branch name would make the deployment unpinnable. */
const REVISION = /^[0-9a-f]{40}$/

/** Hostnames that keep the control server off the network. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** Key names that suggest a credential, matched case-insensitively at any depth. */
const CREDENTIAL_KEY = /token|secret|password|api[_-]?key|connection|dburl/i

/** The keys a deployment file may declare. Anything else is refused. */
const KNOWN_KEYS = new Set([
  'repository',
  'revision',
  'profile',
  'policyVersion',
  'controlServerUrl',
  'environment',
  'database',
  'project',
  'modelRegistry',
])

/** The keys `database` may declare. */
const KNOWN_DATABASE_KEYS = new Set(['strategy', 'projectRef'])

/** The keys `project` may declare. */
const KNOWN_PROJECT_KEYS = new Set(['protectedBranch'])

/**
 * A plain branch name, and nothing Git's revision grammar reads as an operator.
 *
 * The name is pasted into a revision range this host asks Git to resolve, so a
 * name carrying `..`, `~`, `^`, `:`, `@{`, a glob character, whitespace or a
 * leading `-` selects a range nobody configured — or is read as an option
 * rather than a ref. Allowing only this shape is narrower than Git's own rules
 * on purpose: a deployment file names a branch, not an expression.
 */
const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/

/** Raised when the deployment file cannot be read, parsed, or trusted. */
export class DeploymentConfigError extends Error {
  override readonly name = 'DeploymentConfigError'
}

/** Where this deployment is pointed. */
export interface PluroraDeploymentConfig {
  readonly repository: typeof REPOSITORY
  readonly revision: string
  readonly profile: typeof PROFILE
  readonly policyVersion: string
  readonly controlServerUrl: string
  readonly environment: typeof ENVIRONMENT
  readonly database: {
    readonly strategy: typeof DATABASE_STRATEGY
    readonly projectRef: string
  }
  readonly project: {
    readonly protectedBranch: string
  }
  readonly modelRegistry: Readonly<Record<string, string>>
}

/** Fail with a message that names the field rather than the shape. */
function refuse(message: string): never {
  throw new DeploymentConfigError(`${DEPLOYMENT_CONFIG_FILE}: ${message}`)
}

/** Whether `value` is a plain object rather than an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read `field` as a non-blank string. */
function requireText(source: Record<string, unknown>, field: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value.trim() === '') {
    refuse(`${field} must be a non-empty string`)
  }
  return value
}

/** Read `field` as a string that equals exactly `expected`. */
function requireExactly<T extends string>(source: Record<string, unknown>, field: string, expected: T): T {
  const value = requireText(source, field)
  if (value !== expected) refuse(`${field} must be ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`)
  return expected
}

/**
 * Walk the whole document refusing credential-shaped keys.
 *
 * This runs before any schema check so the message says "credential" rather
 * than "unknown key": someone who put a token in this file needs to be told
 * that tokens do not go here, not that the field name was unrecognised.
 */
function refuseCredentials(value: unknown, path: readonly string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => { refuseCredentials(entry, [...path, String(index)]) })
    return
  }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) {
      const where = [...path, key].join('.')
      refuse(`${where} looks like a credential; credentials are supplied by the environment, never by this file`)
    }
    refuseCredentials(entry, [...path, key])
  }
}

/** Refuse any key outside `allowed`, naming the first one found. */
function refuseUnknownKeys(source: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) continue
    refuse(`${where}${key} is not a deployment setting; behaviour is owned by the profile, not by this file`)
  }
}

/** Read the control endpoint, holding it to loopback. */
function requireLoopbackUrl(source: Record<string, unknown>): string {
  const value = requireText(source, 'controlServerUrl')
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    refuse(`controlServerUrl must be an absolute URL, got ${JSON.stringify(value)}`)
  }
  if (!LOOPBACK.has(url.hostname)) {
    refuse(`controlServerUrl must be loopback, got host ${JSON.stringify(url.hostname)}`)
  }
  return value
}

/** Read the database target. */
function requireDatabase(source: Record<string, unknown>): PluroraDeploymentConfig['database'] {
  const database = source['database']
  if (!isRecord(database)) refuse('database must be a JSON object')
  refuseUnknownKeys(database, KNOWN_DATABASE_KEYS, 'database.')
  const strategy = requireExactly(database, 'strategy', DATABASE_STRATEGY)
  const projectRef = database['projectRef']
  if (typeof projectRef !== 'string' || projectRef.trim() === '') {
    refuse('database.projectRef must be a non-empty string')
  }
  return { strategy, projectRef }
}

/** Read the project settings the host reads Git under. */
function requireProject(source: Record<string, unknown>): PluroraDeploymentConfig['project'] {
  const project = source['project']
  if (!isRecord(project)) refuse('project must be a JSON object')
  refuseUnknownKeys(project, KNOWN_PROJECT_KEYS, 'project.')
  const branch = project['protectedBranch']
  if (typeof branch !== 'string' || branch.trim() === '') {
    refuse('project.protectedBranch must be a non-empty string')
  }
  if (!BRANCH_NAME.test(branch) || branch.includes('..')) {
    refuse('project.protectedBranch must be a plain branch name')
  }
  return { protectedBranch: branch }
}

/** Read the tier-to-model table, holding it to exactly the routed tiers. */
function requireModelRegistry(source: Record<string, unknown>): Readonly<Record<string, string>> {
  const registry = source['modelRegistry']
  if (!isRecord(registry)) refuse('modelRegistry must be a JSON object')
  for (const tier of PLURORA_SEMANTIC_TIERS) {
    if (!(tier in registry)) refuse(`modelRegistry names no model for the routed tier ${tier}`)
  }
  for (const [tier, model] of Object.entries(registry)) {
    if (!(PLURORA_SEMANTIC_TIERS as readonly string[]).includes(tier)) {
      refuse(`modelRegistry names the tier ${tier}, which the Plurora routing policy never asks for`)
    }
    if (typeof model !== 'string' || model.trim() === '') {
      refuse(`modelRegistry entry ${tier} must name a model`)
    }
  }
  return { ...registry as Record<string, string> }
}

/**
 * Validate an already-parsed deployment document.
 *
 * @param raw - the parsed JSON document.
 * @returns the config, with every field checked.
 * @throws {DeploymentConfigError} on the first rule the document breaks.
 */
export function parseDeploymentConfig(raw: unknown): PluroraDeploymentConfig {
  refuseCredentials(raw)
  if (!isRecord(raw)) refuse('the deployment file must contain a JSON object')
  refuseUnknownKeys(raw, KNOWN_KEYS, '')

  const revision = requireText(raw, 'revision')
  if (!REVISION.test(revision)) {
    refuse(`revision must be an exact 40-character lowercase commit sha, got ${JSON.stringify(revision)}`)
  }

  return {
    repository: requireExactly(raw, 'repository', REPOSITORY),
    revision,
    profile: requireExactly(raw, 'profile', PROFILE),
    policyVersion: requireText(raw, 'policyVersion'),
    controlServerUrl: requireLoopbackUrl(raw),
    environment: requireExactly(raw, 'environment', ENVIRONMENT),
    database: requireDatabase(raw),
    project: requireProject(raw),
    modelRegistry: requireModelRegistry(raw),
  }
}

/**
 * Read and validate `plurora-harness.json` under `projectRoot`.
 *
 * @param projectRoot - the directory holding the deployment file.
 * @returns the validated config.
 * @throws {DeploymentConfigError} when the file is missing, unparseable, or breaks a rule.
 */
export async function loadDeploymentConfig(projectRoot: string): Promise<PluroraDeploymentConfig> {
  const path = join(projectRoot, DEPLOYMENT_CONFIG_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  }
  catch {
    throw new DeploymentConfigError(`${DEPLOYMENT_CONFIG_FILE}: no deployment file at ${path}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  }
  catch {
    throw new DeploymentConfigError(`${DEPLOYMENT_CONFIG_FILE}: ${path} is not valid JSON`)
  }
  return parseDeploymentConfig(raw)
}
