import { describe, expect, it } from 'vitest'
import {
  PreviewError,
  assertPreviewConnection,
  assertProjectRef,
  assertProjectTestCommand,
  assertAllowed,
  branchCreateArgv,
  branchDeleteArgv,
  branchGetArgv,
  dbLintArgv,
  dbPushArgv,
  migrationListArgv,
  redactConnections,
} from '../src/commands.ts'

const PARENT_REF = 'abcdefghijklmnop'
const PREVIEW_CONNECTION = 'postgresql://postgres:pw@db.qrstuvwxyzabcdef.supabase.co:5432/postgres'

/**
 * Pull the code off a thrown PreviewError, failing loudly on anything else.
 * @param run - the call under test.
 * @returns the error code.
 */
function codeOf(run: () => unknown): string {
  try {
    run()
  }
  catch (error) {
    if (error instanceof PreviewError) return error.code
    throw error
  }
  throw new Error('expected a PreviewError')
}

/** Every command this package will ever spawn on its own behalf. */
const canonicalCommands: readonly (readonly string[])[] = [
  branchCreateArgv(PARENT_REF, 'preview-run'),
  branchGetArgv(PARENT_REF, 'preview-run'),
  branchDeleteArgv(PARENT_REF, 'preview-run'),
  dbPushArgv(PREVIEW_CONNECTION),
  migrationListArgv(PREVIEW_CONNECTION),
  dbLintArgv(PREVIEW_CONNECTION),
]

describe('the local stack that is absent rather than guarded', () => {
  it('builds no canonical command that carries --local', () => {
    for (const argv of canonicalCommands) expect(argv).not.toContain('--local')
  })

  it('builds no canonical command that starts, stops or tests a local stack', () => {
    for (const argv of canonicalCommands) {
      expect(argv).not.toContain('start')
      expect(argv).not.toContain('stop')
      expect(argv.join(' ')).not.toContain('test db')
      expect(argv.join(' ')).not.toContain('db reset')
      expect(argv.join(' ')).not.toContain('db pull')
      expect(argv.join(' ')).not.toContain('db diff')
    }
  })

  it('refuses those commands outright if a later edit builds one', () => {
    for (const argv of [
      ['supabase', 'start'],
      ['supabase', 'stop'],
      ['supabase', 'test', 'db'],
      ['supabase', 'db', 'reset', '--db-url', PREVIEW_CONNECTION],
      ['supabase', 'db', 'pull'],
      ['supabase', 'db', 'diff'],
      ['supabase', 'db', 'push', '--local'],
    ]) {
      expect(codeOf(() => { assertAllowed(argv) })).toBe('denied-operation')
    }
  })

  it('spawns nothing but the Supabase CLI for its own commands', () => {
    for (const argv of canonicalCommands) expect(argv[0]).toBe('supabase')
    expect(codeOf(() => { assertAllowed(['docker', 'compose', 'up']) })).toBe('denied-operation')
  })
})

describe('the shared parent that is never a fallback', () => {
  it('refuses --linked, which means the parent project', () => {
    expect(codeOf(() => { assertAllowed(['supabase', 'db', 'push', '--linked']) })).toBe('denied-operation')
    expect(codeOf(() => { assertAllowed(['supabase', 'migration', 'list', '--linked']) })).toBe('denied-operation')
    for (const argv of canonicalCommands) expect(argv).not.toContain('--linked')
  })

  it('makes every database command name the database it targets', () => {
    for (const argv of [dbPushArgv(PREVIEW_CONNECTION), migrationListArgv(PREVIEW_CONNECTION), dbLintArgv(PREVIEW_CONNECTION)]) {
      expect(argv).toContain('--db-url')
      expect(argv[argv.indexOf('--db-url') + 1]).toBe(PREVIEW_CONNECTION)
    }
  })

  it('refuses a connection that points back at the parent project', () => {
    const parentConnection = `postgresql://postgres:pw@db.${PARENT_REF}.supabase.co:5432/postgres`

    expect(codeOf(() => { assertPreviewConnection(parentConnection, PARENT_REF) })).toBe('shared-parent')
  })

  it('refuses a branch that reported no usable connection at all', () => {
    expect(codeOf(() => { assertPreviewConnection('', PARENT_REF) })).toBe('unsafe-connection')
    expect(codeOf(() => { assertPreviewConnection('mysql://host/db', PARENT_REF) })).toBe('unsafe-connection')
  })

  it('accepts a preview connection that is not the parent', () => {
    expect(() => { assertPreviewConnection(PREVIEW_CONNECTION, PARENT_REF) }).not.toThrow()
  })
})

describe('values that could become syntax', () => {
  it('refuses a project ref that is not a project ref', () => {
    expect(codeOf(() => { assertProjectRef('--project-ref=evil') })).toBe('invalid-project-ref')
    expect(codeOf(() => { assertProjectRef('') })).toBe('invalid-project-ref')
  })

  it('refuses a branch name that would be read as an option', () => {
    expect(codeOf(() => branchCreateArgv(PARENT_REF, '--experimental'))).toBe('invalid-branch-name')
    expect(codeOf(() => branchDeleteArgv(PARENT_REF, ''))).toBe('invalid-branch-name')
  })

  it('refuses a connection carrying whitespace, which would not be one value', () => {
    expect(codeOf(() => { assertPreviewConnection('postgresql://a b', PARENT_REF) })).toBe('unsafe-connection')
  })
})

describe('a project test command is configuration, not an exemption', () => {
  it('refuses a project suite that would move the gate off the branch', () => {
    expect(codeOf(() => { assertProjectTestCommand(['supabase', 'test', 'db', '--local']) })).toBe('denied-operation')
    expect(codeOf(() => { assertProjectTestCommand(['pnpm', 'run', 'db:test', '--linked']) })).toBe('denied-operation')
  })

  it('refuses an empty project suite rather than silently skipping it', () => {
    expect(codeOf(() => { assertProjectTestCommand([]) })).toBe('denied-operation')
  })

  it('accepts a project suite that reads its connection from the environment', () => {
    expect(() => { assertProjectTestCommand(['pnpm', 'run', 'db:pgtap']) }).not.toThrow()
  })
})

describe('what a report is allowed to contain', () => {
  it('redacts a connection string out of anything reported', () => {
    const noisy = `failed to connect to ${PREVIEW_CONNECTION} after 3 tries`

    expect(redactConnections(noisy)).not.toContain('pw@')
    expect(redactConnections(noisy)).toContain('[redacted]')
  })
})
