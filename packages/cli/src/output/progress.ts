import ora, { type Ora } from 'ora'

export function shouldShow(opts?: { ci?: boolean; json?: boolean; nonInteractive?: boolean }): boolean {
  if (opts?.ci || opts?.json || opts?.nonInteractive) return false
  if (process.env.CI || process.env.HULY_NONINTERACTIVE === '1') return false
  if (!process.stderr.isTTY) return false
  return true
}

export function spinner(label: string, opts?: { ci?: boolean; json?: boolean; nonInteractive?: boolean }): Ora | null {
  if (!shouldShow(opts)) return null
  return ora({ text: label, stream: process.stderr }).start()
}

export async function withSpinner<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { ci?: boolean; json?: boolean; nonInteractive?: boolean }
): Promise<T> {
  const s = spinner(label, opts)
  try {
    const result = await fn()
    if (s) s.stop()
    return result
  } catch (err) {
    if (s) s.fail((err as Error)?.message ?? String(err))
    throw err
  }
}