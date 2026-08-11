import type { Doc, Ref, Class } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, COLUMNS, success, updated, bulkRemoved } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'
import { uploadMarkup, generateId } from './_helpers.js'

type ChatMessage = Doc & {
  message: string
  attachments?: number
  editedOn?: number
  attachedTo?: Ref<Doc>
  attachedToClass?: Ref<Class<Doc>>
  collection?: string
}

async function readBodyText(opts: { body?: string; bodyFile?: string }): Promise<string | undefined> {
  if (opts.body && opts.bodyFile) {
    throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  }
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    return (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  return opts.body
}

export async function listComments(opts: {
  issue?: string
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.issue) throw new CliError(ExitCode.Validation, 'missing --issue')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const issueId = await resolveRef(opts.issue, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      defaultProjectIdentifier: readEnv().project,
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Doc>>, { _id: issueId })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${opts.issue} not found`)
    const comments = (await client.findAll(CLASS.ChatMessage as Ref<Class<ChatMessage>>, {
      attachedTo: issueId,
      attachedToClass: CLASS.Issue,
      collection: 'comments',
    })) as ChatMessage[]
    let r = comments
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json(r)
      return
    }
    table(r as unknown as Record<string, unknown>[], COLUMNS.comment(), { count: true, title: 'comments' })
  } finally {
    await client.close()
  }
}

export async function addComment(opts: {
  issue?: string
  body?: string
  bodyFile?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.issue) throw new CliError(ExitCode.Validation, 'missing --issue')
  const body = await readBodyText(opts)
  if (!body) throw new CliError(ExitCode.Validation, 'missing --body or --body-file')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const issueId = await resolveRef(opts.issue, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      defaultProjectIdentifier: readEnv().project,
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Doc>>, { _id: issueId })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${opts.issue} not found`)
    // HULY-20: pre-upload the markup so the `message` field stores a
    // MarkupBlobRef (pointing to a prosemirror-JSON blob in MinIO) instead of
    // a raw HTML string. Generating the id up-front lets us use the same
    // id for both the markup blob's collabId and the ChatMessage doc.
    const newMessageId = generateId()
    const messageRef = await uploadMarkup(
      client,
      CLASS.ChatMessage as Ref<Class<Doc>>,
      newMessageId,
      'message',
      body,
      'markup',
    )
    const id = await withSpinner(
      'Adding comment…',
      () =>
        client.addCollection(
          CLASS.ChatMessage as Ref<Class<ChatMessage>>,
          (issue as Doc).space as Ref<Doc>,
          issueId,
          CLASS.Issue,
          'comments',
          { message: messageRef } as any,
          newMessageId,
        ),
      opts,
    )
    invalidateIndex(client, CLASS.ChatMessage)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, attachedTo: issueId, message: messageRef })
    } else {
      success('added comment', `on ${opts.issue}`, id)
    }
  } finally {
    await client.close()
  }
}

export async function updateComment(
  ref: string,
  opts: {
    body?: string
    bodyFile?: string
    json?: boolean
    ci?: boolean
    workspace?: string
    url?: string
  },
): Promise<void> {
  const body = await readBodyText(opts)
  if (!body) throw new CliError(ExitCode.Validation, 'missing --body or --body-file')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const commentId = await resolveRef(ref, {
      client,
      classId: CLASS.ChatMessage as Ref<Class<Doc>>,
    })
    const comment = await client.findOne(CLASS.ChatMessage as Ref<Class<ChatMessage>>, { _id: commentId })
    if (!comment) throw new CliError(ExitCode.NotFound, `comment ${ref} not found`)
    // HULY-20: same fix as addComment — upload the markup first so the
    // update lands a MarkupBlobRef in `message`, not raw HTML.
    const messageRef = await uploadMarkup(
      client,
      CLASS.ChatMessage as Ref<Class<Doc>>,
      commentId,
      'message',
      body,
      'markup',
    )
    await withSpinner(
      'Updating comment…',
      () =>
        client.updateDoc(
          CLASS.ChatMessage as Ref<Class<ChatMessage>>,
          (comment as Doc).space as Ref<Doc>,
          commentId as Ref<Doc>,
          { message: messageRef, editedOn: Date.now() } as any,
        ),
      opts,
    )
    updated(`updated comment`, commentId)
  } finally {
    await client.close()
  }
}

export async function deleteComments(
  refs: string[],
  opts: { workspace?: string; url?: string; yes?: boolean } = {},
): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.ChatMessage as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1) {
      throw new CliError(
        ExitCode.Validation,
        `destructive: deleting ${ids.length} comments requires --yes`,
        're-run with --yes to confirm',
      )
    }
    let deleted = 0,
      skipped = 0
    for (const id of ids) {
      const comment = await client.findOne(CLASS.ChatMessage as Ref<Class<ChatMessage>>, {
        _id: id as Ref<ChatMessage>,
      })
      if (!comment) {
        skipped++
        continue
      }
      try {
        await client.removeCollection(
          CLASS.ChatMessage as Ref<Class<Doc>>,
          (comment as Doc).space as Ref<Doc>,
          id as Ref<Doc>,
          (comment as ChatMessage).attachedTo as Ref<Doc>,
          ((comment as ChatMessage).attachedToClass ?? CLASS.Issue) as Ref<Class<Doc>>,
          (comment as ChatMessage).collection ?? 'comments',
        )
        deleted++
      } catch (e) {
        console.error(`failed to delete ${id}: ${(e as Error).message}`)
        skipped++
      }
    }
    bulkRemoved(deleted, skipped)
  } finally {
    await client.close()
  }
}
