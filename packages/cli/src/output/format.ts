import chalk from 'chalk'
import Table from 'cli-table3'
import stringWidth from 'string-width'

const useColor = !process.env.NO_COLOR && process.stdout.isTTY !== false
const noColor = (s: string): string => s
const c: typeof chalk = useColor ? chalk : (Object.fromEntries(
  Object.keys(chalk).map((k) => [k, noColor])
) as unknown as typeof chalk)

export function dim(s: string): string { return useColor ? chalk.dim(s) : s }
export function bold(s: string): string { return useColor ? chalk.bold(s) : s }
export function italic(s: string): string { return useColor ? chalk.italic(s) : s }
export function red(s: string): string { return useColor ? chalk.red(s) : s }
export function green(s: string): string { return useColor ? chalk.green(s) : s }
export function yellow(s: string): string { return useColor ? chalk.yellow(s) : s }
export function blue(s: string): string { return useColor ? chalk.blue(s) : s }
export function cyan(s: string): string { return useColor ? chalk.cyan(s) : s }
export function gray(s: string): string { return useColor ? chalk.gray(s) : s }
export function magenta(s: string): string { return useColor ? chalk.magenta(s) : s }

export const C = {
  dim, bold, italic, red, green, yellow, blue, cyan, gray, magenta,
  ok: (s: string) => useColor ? chalk.green('✓ ' + s) : '✓ ' + s,
  fail: (s: string) => useColor ? chalk.red('✗ ' + s) : '✗ ' + s,
  warn: (s: string) => useColor ? chalk.yellow('⚠ ' + s) : '⚠ ' + s,
  info: (s: string) => useColor ? chalk.cyan('ℹ ' + s) : 'ℹ ' + s,
  bullet: (s: string) => useColor ? chalk.cyan('● ') + s : '● ' + s,
  arrow: (s: string) => useColor ? chalk.cyan('→ ') + s : '→ ' + s,
  id: (s: string) => useColor ? chalk.gray(s) : s,
  primary: (s: string) => useColor ? chalk.bold.cyan(s) : s,
  emphasis: (s: string) => useColor ? chalk.bold(s) : s,
  muted: (s: string) => useColor ? chalk.gray(s) : s,
  none: () => useColor ? chalk.gray('—') : '—',
  empty: () => useColor ? chalk.gray('(empty)') : '(empty)'
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

export interface TableColumn<T> {
  key: keyof T | string
  header: string
  width?: number
  align?: 'left' | 'right' | 'center'
  format?: (row: T) => string
  color?: (row: T) => string
}

export interface TableOptions {
  title?: string
  footer?: string
  count?: boolean
  noBorder?: boolean
}

const ASCII_CHARS: Record<string, string> = {
  top: '-', 'top-mid': '+', 'top-left': '+', 'top-right': '+',
  bottom: '-', 'bottom-mid': '+', 'bottom-left': '+', 'bottom-right': '+',
  left: '|', 'left-mid': '+', mid: '-', 'mid-mid': '+',
  right: '|', 'right-mid': '+', middle: '|'
}

// Rounded unicode borders. Each char is pre-wrapped in chalk.gray() so the
// table frame renders gray directly — no regex post-processing, so any
// box-drawing chars that legitimately appear inside user-supplied cell
// content (titles, descriptions, etc.) are left untouched. cli-table3 emits
// these chars verbatim; ANSI codes are zero-width so column alignment is
// preserved.
const ROUNDED_CHARS: Record<string, string> = useColor ? {
  top: chalk.gray('─'), 'top-mid': chalk.gray('┬'), 'top-left': chalk.gray('╭'), 'top-right': chalk.gray('╮'),
  bottom: chalk.gray('─'), 'bottom-mid': chalk.gray('┴'), 'bottom-left': chalk.gray('╰'), 'bottom-right': chalk.gray('╯'),
  left: chalk.gray('│'), 'left-mid': chalk.gray('├'), mid: chalk.gray('─'), 'mid-mid': chalk.gray('┼'),
  right: chalk.gray('│'), 'right-mid': chalk.gray('┤'), middle: chalk.gray('│')
} : {
  top: '─', 'top-mid': '┬', 'top-left': '╭', 'top-right': '╮',
  bottom: '─', 'bottom-mid': '┴', 'bottom-left': '╰', 'bottom-right': '╯',
  left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
  right: '│', 'right-mid': '┤', middle: '│'
}

const NO_BORDER_CHARS: Record<string, string> = {
  top: '', 'top-mid': '', 'top-left': '', 'top-right': '',
  bottom: '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
  left: '', 'left-mid': '', mid: '', 'mid-mid': '',
  right: '', 'right-mid': '', middle: ''
}

const SHARP = useColor ? '│' : '|'
const THIN = useColor ? '─' : '-'
const TLCOR = useColor ? '┌' : '+'
const TRCOR = useColor ? '┐' : '+'
const BLCOR = useColor ? '└' : '+'
const BRCOR = useColor ? '┘' : '+'

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

function stripRef(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  const parts = s.split(':')
  return parts[parts.length - 1] ?? s
}

function shortId(id: unknown): string {
  const s = String(id ?? '')
  if (s === '') return ''
  // For ref-style IDs like "tracker:project:TEST" or "space:General",
  // return the last segment for readability. Otherwise return the last 12 chars.
  if (s.includes(':')) return s.split(':').slice(-1)[0] ?? s
  return s.length > 12 ? s.slice(-12) : s
}

function trim(s: unknown, n: number): string {
  return String(s ?? '').slice(0, n)
}

function ellipsize(s: string, w: number): string {
  if (s.length <= w) return s
  if (w <= 1) return s.slice(0, w)
  return s.slice(0, w - 1) + '…'
}

function isoDate(ms: unknown): string {
  if (ms == null) return ''
  return new Date(Number(ms)).toISOString().slice(0, 16).replace('T', ' ')
}

function isoDay(ms: unknown): string {
  if (ms == null) return ''
  return new Date(Number(ms)).toISOString().slice(0, 10)
}

function relTime(ms: number | null | undefined): string {
  if (ms == null) return C.none()
  const now = Date.now()
  const diff = now - Number(ms)
  if (diff < 0) return isoDay(ms)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 604_800_000)}w ago`
  if (diff < 31_536_000_000) return `${Math.floor(diff / 2_592_000_000)}mo ago`
  return `${Math.floor(diff / 31_536_000_000)}y ago`
}

const PRIORITY_COLORS: Record<string, (s: string) => string> = {
  Urgent: (s) => useColor ? chalk.red.bold(s) : s,
  High: (s) => useColor ? chalk.red(s) : s,
  Normal: (s) => useColor ? chalk.yellow(s) : s,
  Low: (s) => useColor ? chalk.gray(s) : s,
  None: (s) => useColor ? chalk.gray(s) : s
}

const STATUS_CATEGORY_COLORS: Record<string, (s: string) => string> = {
  Won: (s) => useColor ? chalk.green(s) : s,
  Lost: (s) => useColor ? chalk.red(s) : s,
  Active: (s) => useColor ? chalk.cyan(s) : s,
  ToDo: (s) => useColor ? chalk.yellow(s) : s,
  UnStarted: (s) => useColor ? chalk.gray(s) : s
}

function colorizeStatus(s: string): string {
  if (!s) return C.none()
  const stripped = stripRef(s)
  for (const [cat, fn] of Object.entries(STATUS_CATEGORY_COLORS)) {
    if (cat.toLowerCase() === stripped.toLowerCase()) return fn(stripped)
  }
  return stripped
}

const STATUS_BADGE: Record<string, { color: (s: string) => string; glyph: string }> = {
  todo:      { color: chalk.bgYellow.black, glyph: '○' },
  active:    { color: chalk.bgCyan.black,   glyph: '●' },
  won:       { color: chalk.bgGreen.black,  glyph: '✓' },
  lost:      { color: chalk.bgRed.white,    glyph: '✗' },
  unstarted: { color: chalk.bgWhite.gray,   glyph: '◌' }
}

export function statusBadge(s: string): string {
  if (!s) return C.none()
  const stripped = stripRef(s)
  const style = STATUS_BADGE[stripped.toLowerCase()]
  if (!style) return stripped
  if (!useColor) return `${style.glyph} ${stripped}`
  return style.color(` ${style.glyph} ${stripped} `)
}

function colorizePriority(s: string): string {
  if (!s) return C.none()
  const stripped = stripRef(s)
  for (const [pri, fn] of Object.entries(PRIORITY_COLORS)) {
    if (pri.toLowerCase() === stripped.toLowerCase()) return fn(stripped)
  }
  return stripped
}

const STATUS_GLYPH: Record<string, string> = {
  Won: '✓',
  Lost: '✗',
  Active: '●',
  ToDo: '○',
  UnStarted: '◌'
}

function statusGlyph(s: string): string {
  if (!s) return C.muted('—')
  const stripped = stripRef(s)
  for (const [cat, glyph] of Object.entries(STATUS_GLYPH)) {
    if (cat.toLowerCase() === stripped.toLowerCase()) return glyph
  }
  return '·'
}

const PRIORITY_GLYPH: Record<string, string> = {
  Urgent: '↑↑↑',
  High: '↑↑',
  Normal: '↑',
  Low: '↓',
  None: '·'
}

function priorityGlyph(s: string): string {
  if (!s) return C.muted('—')
  const stripped = stripRef(s)
  for (const [pri, glyph] of Object.entries(PRIORITY_GLYPH)) {
    if (pri.toLowerCase() === stripped.toLowerCase()) return glyph
  }
  return '·'
}

export function table<T extends Record<string, unknown>>(
  rows: T[],
  columns: TableColumn<T>[],
  opts: TableOptions = {}
): void {
  if (rows.length === 0) {
    const msg = '(no results)'
    if (opts.title !== undefined) {
      console.log()
      const accent = useColor ? chalk.bold.cyan('◆ ') : '◆ '
      console.log('  ' + accent + (useColor ? chalk.bold(opts.title) : opts.title))
    }
    console.log(dim('  ' + msg))
    return
  }

  const cells: string[][] = rows.map((row) =>
    columns.map((col) => {
      try {
        const v = col.format
          ? col.format(row)
          : row[col.key as string] == null ? '' : String(row[col.key as string])
        return col.color ? (col.color(row) ?? v) : v
      } catch {
        return ''
      }
    })
  )

  // Column widths: honor explicit `width` as a floor, grow to fit the widest
  // cell (ANSI/emoji-aware via string-width), and cap at 40 to keep any one
  // column from dominating the table. cli-table3's colWidths includes padding.
  const MAX_COL_WIDTH = 40
  const colWidths: Array<number | null> = columns.map((c, i) => {
    let maxLen = stringWidth(c.header)
    for (const row of cells) {
      const len = stringWidth(row[i] ?? '')
      if (len > maxLen) maxLen = len
    }
    const target = c.width !== undefined ? Math.max(c.width, maxLen) : maxLen
    const capped = Math.min(target, MAX_COL_WIDTH)
    return capped + 2
  })
  const colAligns = columns.map((c) => c.align ?? 'left')

  const t = new Table({
    head: columns.map((c) => useColor ? chalk.bold.cyan(c.header) : c.header),
    colWidths,
    colAligns,
    wordWrap: true,
    wrapOnWordBoundary: true,
    style: { head: [], border: [] },
    chars: opts.noBorder === true
      ? NO_BORDER_CHARS
      : (!useColor ? ASCII_CHARS : ROUNDED_CHARS)
  })

  for (const row of cells) {
    t.push(row)
  }

  const out: string[] = []
  if (opts.title !== undefined) {
    const accent = useColor ? chalk.bold.cyan('◆ ') : '◆ '
    out.push('  ' + accent + (useColor ? chalk.bold(opts.title) : opts.title))
  }
  out.push(t.toString())
  if (opts.count === true) {
    const countText = `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`
    out.push(C.muted('  ' + countText))
  }
  if (opts.footer !== undefined) {
    out.push(C.muted('  ' + opts.footer))
  }
  console.log(out.join('\n'))
}

export function kv(rows: Array<[string, string | undefined | null]>, opts: { title?: string } = {}): void {
  if (rows.length === 0) return
  if (opts.title !== undefined) {
    console.log(C.emphasis(opts.title))
  }
  const w = Math.max(...rows.map(([k]) => k.length))
  for (const [k, v] of rows) {
    const value = v == null || v === '' ? C.none() : v
    console.log(`  ${C.muted(k.padEnd(w))}  ${value}`)
  }
}

export function panel(title: string, lines: string[]): void {
  const titleLen = stripAnsi(title).length
  const maxLen = Math.max(titleLen, ...lines.map((l) => stripAnsi(l).length))
  const width = Math.min(maxLen + 4, 100)
  const top = '  ' + TLCOR + THIN.repeat(width) + TRCOR
  const bottom = '  ' + BLCOR + THIN.repeat(width) + BRCOR
  const titleLine = '  ' + SHARP + ' ' + C.emphasis(title.padEnd(width - 2)) + ' ' + SHARP
  console.log(top)
  console.log(titleLine)
  for (const line of lines) {
    const padded = line.padEnd(width - 2)
    console.log('  ' + SHARP + ' ' + padded + ' ' + SHARP)
  }
  console.log(bottom)
}

export function header(title: string, opts: { subtitle?: string; accent?: string } = {}): void {
  const accent = opts.accent !== undefined ? ` ${C.dim('·')} ${opts.accent}` : ''
  console.log()
  console.log(C.primary('━'.repeat(3) + ' ' + title) + accent)
  if (opts.subtitle !== undefined) {
    console.log(C.muted('  ' + opts.subtitle))
  }
  console.log()
}

export function section(title: string): void {
  console.log()
  console.log(C.emphasis(title))
  console.log(C.muted('─'.repeat(Math.max(8, title.length + 2))))
}

export function fail(msg: string): void { console.log(C.fail(msg)) }
export function warn(msg: string): void { console.log(C.warn(msg)) }
export function info(msg: string): void { console.log(C.info(msg)) }

/**
 * Normalize a Ref<Doc> (or anything that might be a Ref) into a plain
 * string suitable for console output and JSON serialization. Replaces
 * ~25 `as unknown as string` casts scattered across the resources.
 */
export function refString(ref: unknown): string {
  return String(ref ?? '')
}

/**
 * Normalize an array of Refs to strings. Empty / null entries become
 * empty strings so .includes checks behave predictably.
 */
export function refStrings(refs: ReadonlyArray<unknown> | null | undefined): string[] {
  if (refs === null || refs === undefined) return []
  return refs.map((r) => String(r ?? ''))
}

export function shouldJson(opts: { json?: boolean; ci?: boolean }): boolean {
  return Boolean(opts.json || opts.ci || process.env.CI)
}

export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export { shortId, trim, stripRef, isoDate, isoDay, relTime, colorizeStatus, colorizePriority, statusGlyph, priorityGlyph }

export function success(kind: string, name: string, id?: string): void {
  const line = C.ok(kind) + C.muted('  ') + C.emphasis(name) + (id != null ? C.muted('  ') + C.id(`(${id})`) : '')
  console.log(line)
}

export function updated(kind: string, id: string): void {
  const line = C.info(kind) + C.muted('  ') + C.id(`(${id})`)
  console.log(line)
}

export function removed(kind: string, name: string, id?: string): void {
  const line = C.fail(kind) + C.muted('  ') + C.emphasis(name) + (id != null ? C.muted('  ') + C.id(`(${id})`) : '')
  console.log(line)
}

export function bulkRemoved(deleted: number, skipped: number, kind = 'items'): void {
  if (deleted === 0 && skipped === 0) {
    console.log(C.muted(`  (nothing to delete)`))
    return
  }
  const parts: string[] = []
  if (deleted > 0) parts.push(C.ok(`${deleted} ${kind} deleted`))
  if (skipped > 0) parts.push(C.warn(`${skipped} skipped`))
  console.log('  ' + parts.join(C.muted(' · ')))
}

export const COLUMNS = {
  idShort: <T>(): TableColumn<T>[] => [
    { key: '_id', header: '_ID', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  issue: <T>(): TableColumn<T>[] => [
    { key: 'identifier', header: 'ID', width: 14, align: 'left', format: (r) => {
      const v = (r as Record<string, unknown>).identifier
      if (v != null && v !== '') return C.emphasis(String(v))
      // Fall back to a short id when the project sequence hasn't been assigned
      // (e.g. legacy issues, or issues created via raw tx without an increment)
      const id = (r as Record<string, unknown>)._id
      if (id != null && id !== '') return C.muted('#' + shortId(id))
      return C.muted('—')
    } },
    { key: 'title', header: 'TITLE', format: (r) => {
      const t = trim((r as Record<string, unknown>).title, 80)
      return t || C.muted('(untitled)')
    } },
    { key: 'status', header: 'STATUS', format: (r) => statusBadge(String((r as Record<string, unknown>).status ?? '')) },
    { key: 'priority', header: 'PRIORITY', width: 11, align: 'center', format: (r) => {
      const p = (r as Record<string, unknown>).priority
      return priorityGlyph(String(p ?? ''))
    } },
    { key: 'updatedOn', header: 'UPDATED', width: 11, align: 'right', format: (r) => relTime((r as Record<string, unknown>).modifiedOn as number | null) }
  ],
  issueTemplate: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => {
      const t = trim((r as Record<string, unknown>).title, 80)
      return t || C.muted('(untitled)')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  project: <T>(): TableColumn<T>[] => [
    { key: 'identifier', header: 'ID', width: 8, align: 'left', format: (r) => {
      const v = (r as Record<string, unknown>).identifier
      return v != null && v !== '' ? C.emphasis(String(v)) : C.muted('—')
    } },
    { key: 'name', header: 'NAME', format: (r) => trim((r as Record<string, unknown>).name, 60) || C.muted('(no name)') },
    { key: 'description', header: 'DESCRIPTION', format: (r) => {
      const d = String((r as Record<string, unknown>).description ?? '').trim()
      if (!d) return C.muted('—')
      return trim(d, 50)
    } },
    { key: 'archived', header: 'STATE', width: 8, align: 'center', format: (r) => {
      const a = (r as Record<string, unknown>).archived
      return a ? C.red('archived') : C.green('active')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  card: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => {
      const t = trim((r as Record<string, unknown>).title, 80)
      return t || C.muted('(untitled)')
    } },
    { key: 'status', header: 'STATUS', format: (r) => {
      const s = (r as Record<string, unknown>).status
      return s != null && s !== '' ? colorizeStatus(String(s)) : C.muted('—')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  task: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 80) || C.muted('(untitled)') },
    { key: 'status', header: 'STATUS', format: (r) => {
      const s = (r as Record<string, unknown>).status
      return s != null && s !== '' ? colorizeStatus(String(s)) : C.muted('—')
    } },
    { key: 'assignee', header: 'ASSIGNEE', format: (r) => {
      const a = (r as Record<string, unknown>).assignee
      return a != null && a !== '' ? String(a) : C.muted('unassigned')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  document: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 80) || C.muted('(untitled)') },
    { key: 'modifiedOn', header: 'UPDATED', width: 12, format: (r) => relTime((r as Record<string, unknown>).modifiedOn as number | null) },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  event: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) || C.muted('(untitled)') },
    { key: 'startDate', header: 'START', width: 17, format: (r) => {
      const s = (r as Record<string, unknown>).startDate
      return s != null ? isoDate(s) : C.muted('—')
    } },
    { key: 'dueDate', header: 'END', width: 17, format: (r) => {
      const e = (r as Record<string, unknown>).dueDate
      return e != null ? isoDate(e) : C.muted('—')
    } },
    { key: 'location', header: 'LOCATION', format: (r) => {
      const l = (r as Record<string, unknown>).location
      return l != null && l !== '' ? String(l) : C.muted('—')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  comment: <T>(): TableColumn<T>[] => [
    { key: 'message', header: 'MESSAGE', format: (r) => {
      const m = (r as Record<string, unknown>).message
      if (m == null) return C.muted('(empty)')
      if (typeof m === 'string') return trim(m, 80)
      if (typeof m === 'object' && Object.keys(m as object).length === 0) return C.muted('(empty — use `huly comment get <id>`)')
      const content = (m as { content?: unknown }).content
      return trim(typeof content === 'string' ? content : '', 80) || C.muted('(no content)')
    } },
    { key: 'createdOn', header: 'CREATED', width: 12, format: (r) => relTime((r as Record<string, unknown>).createdOn as number | null) },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  channel: <T>(): TableColumn<T>[] => [
    { key: 'name', header: 'NAME', format: (r) => {
      const n = (r as Record<string, unknown>).name
      return n != null && n !== '' ? '# ' + String(n) : C.muted('(no name)')
    } },
    { key: 'topic', header: 'TOPIC', format: (r) => {
      const t = (r as Record<string, unknown>).topic
      return t != null && t !== '' ? trim(t, 60) : C.muted('—')
    } },
    { key: 'members', header: 'MEMBERS', width: 8, align: 'right', format: (r) => {
      const m = (r as Record<string, unknown>).members
      return m != null ? String(Array.isArray(m) ? m.length : 0) : C.muted('0')
    } },
    { key: 'archived', header: 'STATE', width: 10, align: 'center', format: (r) => {
      const a = (r as Record<string, unknown>).archived
      return a ? C.red('archived') : C.green('active')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  channelMessage: <T>(): TableColumn<T>[] => [
    {
      key: 'message',
      header: 'MESSAGE',
      format: (r) => {
        const m = (r as Record<string, unknown>).message
        if (m == null) return C.muted('(empty)')
        if (typeof m === 'string') return trim(m, 80)
        if (typeof m === 'object' && Object.keys(m as object).length === 0) return C.muted('(empty — use `huly channel get <id>`)')
        const content = (m as { content?: unknown }).content
        return trim(typeof content === 'string' ? content : '', 80) || C.muted('(no content)')
      }
    },
    { key: 'createdOn', header: 'CREATED', width: 12, format: (r) => relTime((r as Record<string, unknown>).createdOn as number | null) },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  timeReport: <T>(): TableColumn<T>[] => [
    { key: 'hours', header: 'HOURS', width: 8, align: 'right', format: (r) => {
      const v = Number((r as Record<string, unknown>).value)
      return Number.isFinite(v) ? v.toFixed(2) : C.muted('—')
    } },
    { key: 'minutes', header: 'MIN', width: 6, align: 'right', format: (r) => {
      const v = Number((r as Record<string, unknown>).value)
      return Number.isFinite(v) ? String(Math.round(v * 60)) : C.muted('—')
    } },
    { key: 'description', header: 'DESCRIPTION', format: (r) => {
      const d = String((r as Record<string, unknown>).description ?? '').trim()
      return d || C.muted('(no description)')
    } },
    { key: 'date', header: 'DATE', width: 12, format: (r) => {
      const d = (r as Record<string, unknown>).date
      return d != null ? isoDay(d) : C.muted('—')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  notification: <T>(): TableColumn<T>[] => [
    { key: 'type', header: 'TYPE', width: 16 },
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) || C.muted('(untitled)') },
    { key: 'isRead', header: 'READ', width: 6, align: 'center', format: (r) => {
      const r2 = (r as Record<string, unknown>).isRead
      return r2 ? C.gray('●') : C.green('○')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  activity: <T>(): TableColumn<T>[] => [
    { key: 'message', header: 'MESSAGE', format: (r) => trim((r as Record<string, unknown>).message, 80) || C.muted('(no message)') },
    { key: 'createdOn', header: 'CREATED', width: 12, format: (r) => relTime((r as Record<string, unknown>).createdOn as number | null) },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  approval: <T>(): TableColumn<T>[] => [
    { key: 'status', header: 'STATUS', format: (r) => colorizeStatus(String((r as Record<string, unknown>).status ?? '')) },
    { key: 'title', header: 'TITLE', format: (r) => trim((r as Record<string, unknown>).title, 60) || C.muted('(untitled)') },
    { key: 'createdOn', header: 'CREATED', width: 12, format: (r) => relTime((r as Record<string, unknown>).createdOn as number | null) },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  component: <T>(): TableColumn<T>[] => [
    { key: 'label', header: 'LABEL', format: (r) => {
      const l = (r as Record<string, unknown>).label
      return l != null && l !== '' ? C.emphasis(String(l)) : C.muted('(no label)')
    } },
    { key: 'description', header: 'DESCRIPTION', format: (r) => {
      const d = String((r as Record<string, unknown>).description ?? '').trim()
      return d || C.muted('—')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  milestone: <T>(): TableColumn<T>[] => [
    { key: 'label', header: 'LABEL', format: (r) => {
      const l = (r as Record<string, unknown>).label
      return l != null && l !== '' ? C.emphasis(String(l)) : C.muted('(no label)')
    } },
    { key: 'targetDate', header: 'TARGET', width: 12, format: (r) => {
      const t = (r as Record<string, unknown>).targetDate
      if (t == null) return C.muted('—')
      const days = Math.ceil((Number(t) - Date.now()) / 86_400_000)
      const label = isoDay(t)
      return days >= 0 ? `${label} ${C.muted('(' + days + 'd)')}` : `${label} ${C.red('(overdue)')}`
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  label: <T>(): TableColumn<T>[] => [
    { key: 'title', header: 'LABEL', format: (r) => {
      const t = (r as Record<string, unknown>).title
      return t != null && t !== '' ? C.emphasis(String(t)) : C.muted('(no label)')
    } },
    { key: 'color', header: 'COLOR', width: 8, format: (r) => {
      const c2 = (r as Record<string, unknown>).color
      return c2 != null && c2 !== '' ? `● ${c2}` : C.muted('—')
    } },
    { key: '_id', header: '_ID', width: 12, align: 'right', format: (r) => C.id(shortId((r as Record<string, unknown>)._id)) }
  ],
  member: <T>(): TableColumn<T>[] => [
    { key: 'name', header: 'NAME', format: (r) => trim((r as Record<string, unknown>).name, 50) || C.muted('(unknown)') },
    { key: 'role', header: 'ROLE', width: 12, format: (r) => {
      const role = (r as Record<string, unknown>).role
      return role != null ? C.emphasis(String(role)) : C.muted('—')
    } },
    { key: 'email', header: 'EMAIL', format: (r) => {
      const e = (r as Record<string, unknown>).email
      return e != null && e !== '' ? String(e) : C.muted('—')
    } }
  ],
  workspace: <T>(): TableColumn<T>[] => [
    { key: 'name', header: 'NAME', format: (r) => C.emphasis(String((r as Record<string, unknown>).name ?? '')) },
    { key: 'url', header: 'URL', format: (r) => String((r as Record<string, unknown>).url ?? '') },
    { key: 'uuid', header: 'UUID', width: 14, format: (r) => C.id(trim((r as Record<string, unknown>).uuid, 12) + '…') },
    { key: 'mode', header: 'MODE', width: 10, align: 'center', format: (r) => {
      const m = String((r as Record<string, unknown>).mode ?? 'unknown')
      return m === 'active' ? C.green('● active') : m === 'pending-deletion' ? C.red('● pending-deletion') : m === 'deleted' ? C.muted('● deleted') : m
    } },
    { key: 'lastVisit', header: 'LAST VISIT', width: 14, format: (r) => relTime((r as Record<string, unknown>).lastVisit as number | null) }
  ]
}
