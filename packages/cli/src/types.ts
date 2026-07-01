export interface GlobalOptions {
  url?: string
  workspace?: string
  json?: boolean
  markdown?: boolean
  ci?: boolean
  dryRun?: boolean
  minimal?: boolean
  yes?: boolean
  nonInteractive?: boolean
}

export interface ListOptions extends GlobalOptions {
  limit?: number
  offset?: number
  project?: string
  space?: string
  assignee?: string
  status?: string
  priority?: string
  label?: string[]
}

export interface CreateOptions extends GlobalOptions {
  project?: string
  space?: string
  title?: string
  description?: string
  assignee?: string
  status?: string
  priority?: string
  label?: string[]
  due?: string
  parent?: string
  body?: string
  bodyFile?: string
  start?: string
  end?: string
  attendee?: string
  allDay?: boolean
  location?: string
}

export interface UpdateOptions extends GlobalOptions {
  set?: string[]
  unset?: string[]
}

export interface WsOptions {
  workspace?: string
  binary?: boolean
  noPing?: boolean
}

export interface ApiOptions {
  body?: string
  query?: string[]
  header?: string[]
}