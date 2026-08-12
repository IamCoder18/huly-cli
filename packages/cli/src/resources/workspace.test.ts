import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import {
  listWorkspaces,
  currentWorkspace,
  useWorkspace,
  createWorkspace,
  deleteWorkspace,
  listMembers,
  updateMemberRole,
  workspaceInfo,
  updateWorkspaceName,
  workspaceGuests,
  createAccessLink,
  listRegions,
} from './workspace.js'
import { ExitCode } from '../output/errors.js'

const mockAc = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => ({})),
  connectAccountCli: vi.fn(async () => mockAc.current),
}))

let tmpHome: string

beforeEach(() => {
  tmpHome = join(tmpdir(), `huly-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpHome, { recursive: true })
  process.env.XDG_CONFIG_HOME = tmpHome
  vi.stubEnv('CI', '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockAc.current = {
    getSocialIds: vi.fn(async () => [{ isPrimary: true, value: 'me@example.com' }]),
    getPerson: vi.fn(async () => ({ uuid: 'me-uuid' })),
    getUserWorkspaces: vi.fn(async () => [{ name: 'ws1', url: 'http://x', uuid: 'u-1' }]),
    getWorkspaceMembers: vi.fn(async () => []),
    getRegionInfo: vi.fn(async () => []),
    getWorkspaceInfo: vi.fn(async () => ({ name: 'ws', url: 'http://x', uuid: 'u-1' })),
    createWorkspace: vi.fn(async () => ({ name: 'ws', uuid: 'new' })),
    deleteWorkspace: vi.fn(async () => {}),
    updateWorkspaceRole: vi.fn(async () => {}),
    updateWorkspaceName: vi.fn(async () => {}),
    updateAllowReadOnlyGuests: vi.fn(async () => {}),
    updateAllowGuestSignUp: vi.fn(async () => {}),
    createAccessLink: vi.fn(async () => 'http://invite'),
  }
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('listWorkspaces / currentWorkspace / useWorkspace', () => {
  it('listWorkspaces returns JSON', async () => {
    await listWorkspaces({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('currentWorkspace prints "(no workspace set)" when none', async () => {
    await currentWorkspace({})
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    )
    expect(logs.some((l) => /no workspace/.test(l))).toBe(true)
  })
  it('useWorkspace writes the active-workspace file', async () => {
    await useWorkspace('myws')
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    )
    expect(logs.some((l) => /active workspace: myws/.test(l))).toBe(true)
  })
  it('useWorkspace throws Validation when --workspace/HULY_WORKSPACE set', async () => {
    await expect(useWorkspace('myws', { workspace: 'other' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
})

describe('createWorkspace / deleteWorkspace', () => {
  it('createWorkspace throws Validation on missing --name', async () => {
    await expect(createWorkspace({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createWorkspace throws Validation without --yes', async () => {
    await expect(createWorkspace({ name: 'X' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createWorkspace dry-run skips SDK', async () => {
    await createWorkspace({ name: 'X', yes: true, dryRun: true })
    expect(
      mockAc.current && (mockAc.current as { createWorkspace: ReturnType<typeof vi.fn> }).createWorkspace,
    ).toBeDefined()
  })
  it('deleteWorkspace throws Validation on no target', async () => {
    await expect(deleteWorkspace({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('deleteWorkspace throws Validation without --yes', async () => {
    await expect(deleteWorkspace({ name: 'ws' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('deleteWorkspace with --yes calls the SDK', async () => {
    await deleteWorkspace({ name: 'ws', yes: true })
    expect(
      (mockAc.current as { deleteWorkspace: ReturnType<typeof vi.fn> }).deleteWorkspace,
    ).toHaveBeenCalled()
  })
})

describe('listMembers / updateMemberRole / workspaceInfo', () => {
  it('listMembers returns JSON', async () => {
    await listMembers({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(out).toBeDefined()
  })
  it('listMembers filters by --role', async () => {
    ;(mockAc.current as { getWorkspaceMembers: ReturnType<typeof vi.fn> }).getWorkspaceMembers = vi.fn(
      async () => [
        { account: { uuid: 'u-1', role: 'Owner' }, name: 'alice', email: 'a@x' },
        { account: { uuid: 'u-2', role: 'Guest' }, name: 'bob', email: 'b@x' },
      ],
    )
    await listMembers({ role: 'owner', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed.length).toBe(1)
    expect(parsed[0].role).toBe('Owner')
  })
  it('updateMemberRole throws Validation on missing <account>', async () => {
    await expect(updateMemberRole({ role: 'Admin' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateMemberRole throws Validation on missing --role', async () => {
    await expect(updateMemberRole({ target: 'me' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateMemberRole throws Validation on invalid role', async () => {
    await expect(updateMemberRole({ target: 'me', role: 'Foo' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('updateMemberRole normalizes case and aliases', async () => {
    await updateMemberRole({ target: 'me', role: 'maintainer' })
    expect(
      (mockAc.current as { updateWorkspaceRole: ReturnType<typeof vi.fn> }).updateWorkspaceRole,
    ).toHaveBeenCalledWith('me', 'Admin')
  })
  it('workspaceInfo returns JSON', async () => {
    await workspaceInfo({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).name).toBe('ws')
  })
})

describe('updateWorkspaceName / workspaceGuests / createAccessLink / listRegions', () => {
  it('updateWorkspaceName throws Validation on missing --name', async () => {
    await expect(updateWorkspaceName({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('workspaceGuests throws Validation when no flags', async () => {
    await expect(workspaceGuests({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createAccessLink throws Validation on missing --role', async () => {
    await expect(createAccessLink({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createAccessLink returns the link', async () => {
    await createAccessLink({ role: 'Guest' })
    expect(
      (mockAc.current as { createAccessLink: ReturnType<typeof vi.fn> }).createAccessLink,
    ).toHaveBeenCalled()
  })
  it('listRegions returns JSON', async () => {
    await listRegions({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(out).toBeDefined()
  })
})
