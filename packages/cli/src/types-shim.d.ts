declare module '@hcengineering/api-client' {
  export class MarkupContent {
    constructor(content: string, kind: 'markup' | 'html' | 'markdown')
    content: string
    kind: 'markup' | 'html' | 'markdown'
  }

  export type MarkupFormat = 'markup' | 'html' | 'markdown'
  export type MarkupRef = string

  export interface MarkupOperations {
    fetchMarkup: (...args: any[]) => Promise<string>
    uploadMarkup: (...args: any[]) => Promise<MarkupRef>
  }

  export interface PlatformClient {
    getHierarchy(): any
    getModel(): any
    getAccount(): Promise<{ uuid: string; role: string; primarySocialId?: string; socialIds?: string[]; fullSocialIds?: any[]; person?: string }>
    close(): Promise<void>
    findOne<T = any>(_class: any, query: any, options?: any): Promise<T | undefined>
    findAll<T = any>(_class: any, query: any, options?: any): Promise<T[]>
    createDoc<T = any>(_class: any, space: any, attributes: any, id?: any): Promise<string>
    updateDoc<T = any>(_class: any, space: any, objectId: any, operations: any, retrieve?: boolean): Promise<any>
    removeDoc<T = any>(_class: any, space: any, objectId: any): Promise<any>
    addCollection<T = any, P = any>(_class: any, space: any, attachedTo: any, attachedToClass: any, collection: any, attributes: any, id?: any): Promise<string>
    updateCollection<T = any, P = any>(_class: any, space: any, objectId: any, attachedTo: any, attachedToClass: any, collection: any, operations: any, retrieve?: boolean): Promise<any>
    removeCollection<T = any, P = any>(_class: any, space: any, objectId: any, attachedTo: any, attachedToClass: any, collection: any): Promise<any>
    createMixin(...args: any[]): Promise<any>
    updateMixin(...args: any[]): Promise<any>
    fetchMarkup(_class: any, id: any, attr: string, markup: MarkupRef, format: MarkupFormat): Promise<string>
    uploadMarkup(_class: any, id: any, attr: string, markup: string, format: MarkupFormat): Promise<MarkupRef>
    [Symbol.asyncDispose](): Promise<void>
  }

  export type WithMarkup<T> = T

  export interface PasswordAuthOptions {
    email: string
    password: string
    workspace: string
  }

  export interface TokenAuthOptions {
    token: string
    workspace: string
  }

  export type AuthOptions = PasswordAuthOptions | TokenAuthOptions

  export interface ConnectSocketOptions {
    socketFactory?: any
    connectionTimeout?: number
  }

  export type ConnectOptions = ConnectSocketOptions & AuthOptions

  export function connect(url: string, options: ConnectOptions): Promise<PlatformClient>
}

declare module '@hcengineering/account-client' {
  export interface WorkspaceInfoWithStatus {
    uuid: string
    name: string
    url: string
    region?: string
    branding?: string
    createdOn: number
    mode: string
    isDisabled?: boolean
    lastVisit?: number
    versionMajor: number
    versionMinor: number
    versionPatch: number
    backupInfo?: any
    usageInfo?: any
    processingAttemps?: number
    [k: string]: any
  }

  export interface WorkspaceLoginInfo {
    account: string
    workspace: string
    workspaceUrl: string
    endpoint: string
    token: string
    role: string
    [k: string]: any
  }

  export interface LoginInfo {
    account: string
    name?: string
    token?: string
    [k: string]: any
  }

  export interface SocialId {
    _id: string
    type: string
    value: string
    isPrimary?: boolean
    isDeleted?: boolean
    key: string
    [k: string]: any
  }

  export interface AccountClient {
    getProviders(): Promise<any[]>
    getUserWorkspaces(): Promise<WorkspaceInfoWithStatus[]>
    selectWorkspace(workspaceUrl: string, kind?: string, externalRegions?: string[]): Promise<WorkspaceLoginInfo>
    login(email: string, password: string): Promise<LoginInfo>
    getSocialIds(includeDeleted?: boolean): Promise<SocialId[]>
    findPersonBySocialKey(socialKey: string, requireAccount?: boolean): Promise<string | undefined>
    [k: string]: any
  }

  export function getClient(accountsUrl?: string, token?: string, retryTimeoutMs?: number): AccountClient
}

declare module '@hcengineering/core' {
  export type Ref<T = any> = string & { __ref?: T }
  export type Class<T = any> = Ref<T>

  export interface Doc {
    _id: Ref<Doc>
    _class: Ref<Class<Doc>>
    space: Ref<Doc>
    modifiedOn: number
    modifiedBy: string
    createdOn?: number
    createdBy?: string
    [k: string]: any
  }

  export interface Space extends Doc {}

  export type Data<T extends Doc> = Partial<T>

  export interface DocumentQuery<T extends Doc = Doc> {
    [k: string]: any
  }

  export interface FindOptions<T extends Doc = Doc> {
    limit?: number
    sort?: any
    lookup?: any
  }

  export interface FindResult<T extends Doc = Doc> {
    total: number
    value: T[]
  }

  export interface WithLookup<T extends Doc> extends T {}

  export interface TxResult {
    objectId?: string
    [k: string]: any
  }

  export interface DocumentUpdate<T extends Doc> {
    [k: string]: any
  }

  export interface AttachedDoc extends Doc {
    attachedTo: Ref<Doc>
    attachedToClass: Ref<Class<Doc>>
    collection: string
  }

  export type AttachedData<P extends AttachedDoc> = Partial<P>

  export interface Mixin<D = any, M = any> {}

  export type MixinData<D, M> = Partial<M>
  export type MixinUpdate<D, M> = Partial<M>

  export interface Hierarchy {
    getDomain(_class: Ref<Class<Doc>>): string
    [k: string]: any
  }

  export interface ModelDb {
    [k: string]: any
  }

  export interface Account {
    uuid: string
    role: string
    primarySocialId?: string
    socialIds?: string[]
    fullSocialIds?: any[]
  }
}