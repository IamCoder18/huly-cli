import chalk from 'chalk'

const useColor = !process.env.NO_COLOR && process.stdout.isTTY !== false
const noColor = (s: string): string => s
const c: typeof chalk = useColor ? chalk : (Object.fromEntries(
  Object.keys(chalk).map((k) => [k, noColor])
) as unknown as typeof chalk)

export function dim(s: string): string {
  return useColor ? chalk.dim(s) : s
}

export function bold(s: string): string {
  return useColor ? chalk.bold(s) : s
}

export function red(s: string): string {
  return useColor ? chalk.red(s) : s
}

export function green(s: string): string {
  return useColor ? chalk.green(s) : s
}

export function yellow(s: string): string {
  return useColor ? chalk.yellow(s) : s
}

export function blue(s: string): string {
  return useColor ? chalk.blue(s) : s
}

export function cyan(s: string): string {
  return useColor ? chalk.cyan(s) : s
}

export function gray(s: string): string {
  return useColor ? chalk.gray(s) : s
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

export interface TableColumn<T> {
  key: keyof T | string
  header: string
  width?: number
  format?: (row: T) => string
}

export function table<T extends Record<string, unknown>>(
  rows: T[],
  columns: TableColumn<T>[]
): void {
  if (rows.length === 0) {
    console.log(dim('(no results)'))
    return
  }

  const rendered = rows.map((row) => {
    const r: Record<string, string> = {}
    for (const col of columns) {
      const raw = row[col.key as string]
      r[col.key as string] = col.format ? col.format(row) : raw == null ? '' : String(raw)
    }
    return r
  })

  const widths: Record<string, number> = {}
  for (const col of columns) {
    let w = col.header.length
    if (col.width) {
      widths[col.key as string] = col.width
      continue
    }
    for (const row of rendered) {
      w = Math.max(w, (row[col.key as string] ?? '').length)
    }
    widths[col.key as string] = Math.min(w, 60)
  }

  const headerLine = columns
    .map((col) => bold(col.header.padEnd(widths[col.key as string])))
    .join('  ')
  console.log(headerLine)
  console.log(dim(columns.map((col) => '─'.repeat(widths[col.key as string])).join('  ')))

  for (const row of rendered) {
    const line = columns
      .map((col) => {
        const val = row[col.key as string] ?? ''
        const w = widths[col.key as string]
        return val.length > w ? val.slice(0, w - 1) + '…' : val.padEnd(w)
      })
      .join('  ')
    console.log(line)
  }
}

export function kv(rows: Array<[string, string | undefined | null]>): void {
  const w = Math.max(...rows.map(([k]) => k.length))
  for (const [k, v] of rows) {
    console.log(`${bold(k.padEnd(w))}  ${v ?? dim('(none)')}`)
  }
}

export function shouldJson(opts: { json?: boolean; ci?: boolean }): boolean {
  return Boolean(opts.json || opts.ci || process.env.CI)
}

function shortId(id: unknown): string {
  return String(id ?? '').slice(-12)
}

function trim(s: unknown, n: number): string {
  return String(s ?? '').slice(0, n)
}

function isoDate(ms: unknown): string {
  if (ms == null) return ''
  return new Date(Number(ms)).toISOString().slice(0, 16)
}

function isoDay(ms: unknown): string {
  if (ms == null) return ''
  return new Date(Number(ms)).toISOString().slice(0, 10)
}

// Resource-specific column presets. Each preset returns TableColumn[] compatible
// with table<T> in this module.

export const COLUMNS = {
  idShort: <T>(): TableColumn<T>[] => [
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  issue: <T>(): TableColumn<T>[] => [
    { key: 'identifier', header: 'ID' },
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) },
    { key: 'status', header: 'STATUS' },
    { key: 'priority', header: 'PRIORITY' },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  issueTemplate: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE' },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  project: <T>(): TableColumn<T>[] => [
    { key: 'identifier', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'description', header: 'DESCRIPTION', format: (r) => trim((r as Record<string, unknown>).description, 60) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  card: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) },
    { key: 'status', header: 'STATUS' },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  task: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) },
    { key: 'status', header: 'STATUS' },
    { key: 'assignee', header: 'ASSIGNEE' },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  document: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  event: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) },
    { key: 'startDate', header: 'START', format: (r) => isoDate((r as Record<string, unknown>).startDate) },
    { key: 'dueDate', header: 'END', format: (r) => isoDate((r as Record<string, unknown>).dueDate) },
    { key: 'location', header: 'LOCATION' }
  ],
  comment: <T>(): TableColumn<T>[] => [
    { key: 'message', header: 'MESSAGE', format: (r) => trim((r as Record<string, unknown>).message, 60) },
    { key: 'createOn', header: 'CREATED', format: (r) => isoDay((r as Record<string, unknown>).createOn) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  channel: <T>(): TableColumn<T>[] => [
    { key: 'name', header: 'NAME' },
    { key: 'topic', header: 'TOPIC', format: (r) => trim((r as Record<string, unknown>).topic, 60) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  channelMessage: <T>(): TableColumn<T>[] => [
    {
      key: 'message',
      header: 'MESSAGE',
      format: (r) => {
        const m = (r as Record<string, unknown>).message
        if (m == null) return '(empty)'
        if (typeof m === 'string') return trim(m, 80)
        // MarkupContent ref — the actual content is stored as a blob and
        // can be retrieved with `huly channel get <id> --markdown` (per
        // message, the platformClient.fetchMarkup path is used internally).
        if (typeof m === 'object' && Object.keys(m as object).length === 0) return '(blob, use get --markdown)'
        const content = (m as { content?: unknown }).content
        return trim(typeof content === 'string' ? content : JSON.stringify(m).slice(0, 80), 80)
      }
    },
    { key: 'createOn', header: 'CREATED', format: (r) => isoDay((r as Record<string, unknown>).createOn) },
    { key: '_id', header: '_ID', format: (r) => String((r as Record<string, unknown>)._id).slice(-12) }
  ],
  timeReport: <T>(): TableColumn<T>[] => [
    { key: 'value', header: 'MINUTES' },
    { key: 'description', header: 'DESCRIPTION', format: (r) => trim((r as Record<string, unknown>).description, 50) },
    { key: 'date', header: 'DATE', format: (r) => isoDay((r as Record<string, unknown>).date) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  notification: <T>(): TableColumn<T>[] => [
    { key: 'type', header: 'TYPE' },
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) },
    { key: 'isRead', header: 'READ' },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  activity: <T>(): TableColumn<T>[] => [
    { key: 'message', header: 'MESSAGE', format: (r) => trim((r as Record<string, unknown>).message, 80) },
    { key: 'createOn', header: 'CREATED', format: (r) => isoDay((r as Record<string, unknown>).createOn) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  approval: <T>(): TableColumn<T>[] => [
    { key: 'status', header: 'STATUS' },
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) },
    { key: 'createOn', header: 'CREATED', format: (r) => isoDay((r as Record<string, unknown>).createOn) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  component: <T>(): TableColumn<T>[] => [
    { key: 'label', header: 'LABEL' },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  milestone: <T>(): TableColumn<T>[] => [
    { key: 'label', header: 'LABEL' },
    { key: 'targetDate', header: 'TARGET', format: (r) => isoDay((r as Record<string, unknown>).targetDate) },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  label: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'LABEL' },
    { key: 'color', header: 'COLOR' },
    { key: '_id', header: '_ID', format: (r) => shortId((r as Record<string, unknown>)._id) }
  ],
  member: <T>(): TableColumn<T>[] => [
    { key: 'name', header: 'NAME' },
    { key: 'role', header: 'ROLE' },
    { key: 'email', header: 'EMAIL' }
  ],
  workspace: <T>(): TableColumn<T>[] => [
    { key: 'name', header: 'NAME' },
    { key: 'url', header: 'URL' },
    { key: 'uuid', header: 'UUID', format: (r) => trim((r as Record<string, unknown>).uuid, 12) + '…' },
    { key: 'mode', header: 'MODE' }
  ]
}