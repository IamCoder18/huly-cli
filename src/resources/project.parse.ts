import { CliError, ExitCode } from '../output/errors.js'

export function parseSet(items: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const item of items) {
    const eq = item.indexOf('=')
    if (eq < 0) {
      throw new CliError(ExitCode.Validation, `invalid --set entry (expected key=value): ${item}`)
    }
    const k = item.slice(0, eq).trim()
    let v: unknown = item.slice(eq + 1).trim()
    if (v === 'true') v = true
    else if (v === 'false') v = false
    else if (/^-?\d+(\.\d+)?$/.test(String(v))) v = Number(v)
    // `field=null` is an explicit clear (deferred to updateDoc as null ops).
    out[k] = v
  }
  return out
}
