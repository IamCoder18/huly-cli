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