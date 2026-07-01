import type { PlatformClient } from '@hcengineering/api-client'
import type { Doc, Ref, Class } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { buildIndex } from '../transport/ref-resolver.js'
import { readEnv } from '../auth/env.js'
import { CliError, ExitCode } from '../output/errors.js'
import { pickProject } from '../auth/prompts.js'

type Project = Doc & { name: string; identifier: string; _id: Ref<Project> }

export async function resolveProjectForCommand(client: PlatformClient, ref?: string): Promise<Project> {
  const env = readEnv()
  const candidate = ref ?? env.project
  if (candidate) {
    const idx = await buildIndex<Project>(client, CLASS.Project as Ref<Class<Project>>)
    // Normalize to a key first (the index uses string keys, not Refs).
    // Try the exact candidate, then a case-insensitive match against any key.
    const key = idx.has(candidate)
      ? candidate
      : [...idx.keys()].find((k) => k.toLowerCase() === candidate.toLowerCase())
    if (key !== undefined) {
      const id = idx.get(key)
      if (id !== undefined) {
        const doc = await client.findOne(CLASS.Project as Ref<Class<Project>>, { _id: id as Ref<Project> })
        if (doc) return doc
      }
    }
  }
  const all = (await client.findAll(CLASS.Project as Ref<Class<Project>>, {})) as Project[]
  if (all.length === 0) throw new CliError(ExitCode.NotFound, 'no projects found in this workspace')
  return await pickProject<Project>(all, 'Project:')
}
