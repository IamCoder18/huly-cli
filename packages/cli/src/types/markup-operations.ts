import type { Doc, Ref, Class } from '@hcengineering/core'

/**
 * Subset of `MarkupOperations` (the `client.markup` surface added by
 * `PlatformClientImpl` at runtime) that the CLI actually calls. Centralized
 * here so `uploadMarkup`, `updateMarkup`, and any future caller can share
 * one cast instead of each re-asserting the same duck-typed shape.
 *
 * The full SDK types are not exported, so the surface is described via
 * structural typing. The runtime cast `client as unknown as
 * PlatformClientWithMarkup` is the only way to reach `markup.*` from
 * `PlatformClient` (which intentionally hides it on the public type).
 */
export interface MarkupCollaboratorId {
  objectClass: Ref<Class<Doc>>
  objectId: Ref<Doc>
  objectAttr: string
}

export interface CollaboratorClient {
  updateMarkup: (collabId: MarkupCollaboratorId, markup: string) => Promise<void>
}

export interface MarkupClient {
  uploadMarkup: (
    objectClass: Ref<Class<Doc>>,
    objectId: Ref<Doc>,
    objectAttr: string,
    markup: string,
    format: 'markup' | 'markdown' | 'html'
  ) => Promise<string>
  collaborator: CollaboratorClient
}

export interface PlatformClientWithMarkup {
  markup: MarkupClient
}
