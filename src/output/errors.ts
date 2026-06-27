import { red, yellow } from './format.js'

export const ExitCode = {
  Ok: 0,
  Generic: 1,
  NotFound: 2,
  Auth: 3,
  Validation: 4,
  RateLimited: 5,
  Conflict: 6,
  Server: 7
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

export class CliError extends Error {
  constructor(
    public readonly code: ExitCodeValue,
    message: string,
    public readonly hint?: string
  ) {
    super(message)
    this.name = 'CliError'
  }
}

const codeHints: Record<number, string> = {
  401: 'hint: authentication required — run `huly login` or set HULY_TOKEN',
  403: 'hint: insufficient permissions for this workspace',
  404: 'hint: check the ref or run `huly <resource> list`',
  409: 'hint: resource already exists or has been modified',
  429: 'hint: rate-limited; retries exhausted'
}

export function handleError(err: unknown): never {
  if (err instanceof CliError) {
    console.error(red(`error: ${err.code === ExitCode.Ok ? 'ok' : err.code}: ${err.message}`))
    if (err.hint) console.error(yellow(err.hint))
    process.exit(err.code)
  }

  const anyErr = err as { code?: number | string; message?: string; cause?: unknown }
  const msg = anyErr?.message ?? String(err)

  if (anyErr?.code === 'PLATFORM_ALREADY_EXISTS' || /already exists/i.test(msg)) {
    console.error(red(`error: 6: ${msg}`))
    console.error(yellow('hint: resource already exists'))
    process.exit(ExitCode.Conflict)
  }
  if (anyErr?.code === 'PLATFORM_NOT_FOUND' || /not found/i.test(msg)) {
    console.error(red(`error: 2: ${msg}`))
    console.error(yellow('hint: check the ref or run `huly <resource> list`'))
    process.exit(ExitCode.NotFound)
  }
  if (anyErr?.code === 'PLATFORM_UNAUTHORIZED' || anyErr?.code === 401) {
    console.error(red(`error: 3: ${msg}`))
    console.error(yellow(codeHints[401]!))
    process.exit(ExitCode.Auth)
  }
  if (anyErr?.code === 'PLATFORM_FORBIDDEN' || anyErr?.code === 403) {
    console.error(red(`error: 3: ${msg}`))
    console.error(yellow(codeHints[403]!))
    process.exit(ExitCode.Auth)
  }
  if (anyErr?.code === 'PLATFORM_RATE_LIMITED' || anyErr?.code === 429) {
    console.error(red(`error: 5: ${msg}`))
    console.error(yellow(codeHints[429]!))
    process.exit(ExitCode.RateLimited)
  }
  if (anyErr?.code === 'PLATFORM_VALIDATION' || anyErr?.code === 400) {
    console.error(red(`error: 4: ${msg}`))
    process.exit(ExitCode.Validation)
  }
  if (typeof anyErr?.code === 'number' && anyErr.code >= 500) {
    console.error(red(`error: 7: ${msg}`))
    process.exit(ExitCode.Server)
  }

  console.error(red(`error: 1: ${msg}`))
  const hint = typeof anyErr?.code === 'number' ? codeHints[anyErr.code] : undefined
  if (hint) console.error(yellow(hint))
  process.exit(ExitCode.Generic)
}

export function retry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; shouldRetry?: (err: unknown) => boolean } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3
  const shouldRetry = opts.shouldRetry ?? ((err: unknown) => {
    const c = (err as { code?: number | string })?.code
    return c === 429 || c === 'PLATFORM_RATE_LIMITED'
  })

  return (async () => {
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastErr = err
        if (attempt < maxAttempts && shouldRetry(err)) {
          const delay = 500 * attempt * attempt
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw lastErr
  })()
}