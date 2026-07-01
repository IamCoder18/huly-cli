import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import { CLASS } from '../transport/identifiers.js'
import { connectCli, connectAccountCli } from '../transport/sdk.js'
import { resolveRef } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { accountClient, resolveToken } from '../auth/client.js'
import { readEnv } from '../auth/env.js'
import type { GlobalOpts } from '../cli.js'

type Person = Doc & {
  name: string
  city?: string
  country?: string
  bio?: string
  [k: string]: unknown
}

export async function getUser(opts: GlobalOpts & { ref?: string } = {}): Promise<void> {
  if (opts.ref) {
    return getUserByRef(opts.ref, opts)
  }
  // Default: current logged-in user. AccountClient's getPerson() works with the
  // workspace-scoped token; getPersonInfo requires higher permissions.
  const ac = await connectAccountCli({ url: opts.url })
  const socialIds = await withSpinner('Loading account…', () => ac.getSocialIds(false), opts)
  const primary = socialIds.find((s: { isPrimary?: boolean }) => s.isPrimary) ?? socialIds[0]
  const person = await withSpinner('Fetching person…', () => ac.getPerson(), opts)
  if (shouldJson({ json: opts.json, ci: opts.ci })) {
    json(person)
    return
  }
  const p = person as Record<string, unknown>
  kv([
    ['Name', [p.firstName, p.lastName].filter(Boolean).join(' ') || (p.name as string | undefined) || '—'],
    ['Email', primary?.value ?? '—'],
    ['UUID', (p.uuid as string | undefined) ?? '—']
  ])
}

async function getUserByRef(ref: string, opts: GlobalOpts): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Person as Ref<Class<Doc>>,
    })
    const person = await client.findOne(CLASS.Person as Ref<Class<Person>>, { _id: id as Ref<Person> })
    if (!person) throw new CliError(ExitCode.NotFound, `person ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json(person)
      return
    }
    kv([
      ['Name', person.name],
      ['UUID', person._id],
      ['City', person.city ?? '—'],
      ['Country', person.country ?? '—']
    ])
  } finally {
    await client.close()
  }
}

export async function updateUser(opts: {
  name?: string
  bio?: string
  city?: string
  country?: string
  url?: string
  workspace?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
}): Promise<void> {
  if (!opts.name && !opts.bio && !opts.city && !opts.country) {
    throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --name, --bio, --city, or --country')
  }
  const ac = await connectAccountCli({ url: opts.url })
  const person = (await withSpinner('Fetching person…', () => ac.getPerson(), opts)) as { uuid?: string; _id?: string } | undefined
  const personUuid = person?.uuid ?? person?._id
  if (!personUuid) throw new CliError(ExitCode.NotFound, 'current person not found')

  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const existing = await client.findOne(
      CLASS.Person as Ref<Class<Person>>,
      { _id: personUuid as Ref<Person> }
    )
    if (!existing) {
      throw new CliError(
        ExitCode.NotFound,
        `person doc ${personUuid} not present in workspace`,
        'hint: this command updates the contact:class:Person record; some workspaces use a separate profile'
      )
    }
    const ops: Record<string, unknown> = {}
    if (opts.name) ops.name = opts.name
    if (opts.bio !== undefined) ops.bio = opts.bio
    if (opts.city !== undefined) ops.city = opts.city
    if (opts.country !== undefined) ops.country = opts.country

    if (opts.dryRun) {
      console.log('would update person:')
      console.log(JSON.stringify({ _class: CLASS.Person, objectId: existing._id, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating profile…',
      () => client.updateDoc(
        CLASS.Person as Ref<Class<Person>>,
        existing.space as unknown as Ref<Space>,
        existing._id as Ref<Person>,
        ops as any
      ),
      opts
    )
    console.log('updated profile')
  } finally {
    await client.close()
  }
}

export async function findUser(email: string, opts: GlobalOpts = {}): Promise<void> {
  // Try account-level findPersonBySocialKey first (works after Fix #1).
  // Fall back to workspace-local Person scan on Forbidden / error.
  const env = readEnv()
  const url = opts.url ?? env.url
  try {
    const token = await resolveToken({ email: env.email, url: opts.url })
    const acc = await accountClient(url!, token)
    const result = await withSpinner(
      `Looking up ${email} (account)…`,
      () => acc.findPersonBySocialKey(email, false),
      opts
    ) as { personUuid?: string } | undefined
    if (result?.personUuid !== undefined) {
      if (shouldJson({ json: opts.json, ci: opts.ci })) {
        json({ email, personUuid: result.personUuid, source: 'account' })
        return
      }
      console.log(`${email}\t${result.personUuid}`)
      return
    }
  } catch {
    // fall through to workspace scan
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const persons = (await withSpinner(
      `Looking up ${email} (workspace)…`,
      () => client.findAll('contact:class:Person' as Ref<Class<Doc>>, {}, { limit: 200 }),
      opts
    )) as Array<Doc & { name?: string }>
    const lower = email.toLowerCase()
    const hit = persons.find((p) => p.name?.toLowerCase() === lower || (p.name ?? '').toLowerCase().includes(lower))
    if (!hit) throw new CliError(ExitCode.NotFound, `no person matching ${email} in this workspace`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ email, personId: hit._id, name: hit.name, source: 'workspace' })
      return
    }
    console.log(`${email}\t${hit._id}`)
  } finally { await client.close() }
}
