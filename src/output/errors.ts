import { C, red, yellow } from './format.js'

export const ExitCode = {
  Ok: 0,
  Generic: 1,
  NotFound: 2,
  Auth: 3,
  Validation: 4,
  RateLimited: 5,
  Conflict: 6,
  Server: 7,
  Ambiguous: 8
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

function printError(code: number, msg: string, hint?: string): void {
  const head = C.fail(`error [${code}]`) + C.muted('  ') + C.emphasis(msg)
  console.error(head)
  if (hint) console.error(C.muted('  ' + hint))
}

export function handleError(err: unknown): never {
  if (err instanceof CliError) {
    printError(err.code, err.message, err.hint)
    process.exit(err.code)
  }

  const anyErr = err as { code?: number | string; message?: string; cause?: unknown }
  const msg = anyErr?.message ?? String(err)

  if (anyErr?.code === 'PLATFORM_ALREADY_EXISTS' || /already exists/i.test(msg)) {
    printError(ExitCode.Conflict, msg, 'hint: resource already exists')
    process.exit(ExitCode.Conflict)
  }
  if (anyErr?.code === 'PLATFORM_NOT_FOUND' || /not found/i.test(msg)) {
    printError(ExitCode.NotFound, msg, 'hint: check the ref or run `huly <resource> list`')
    process.exit(ExitCode.NotFound)
  }
  if (anyErr?.code === 'PLATFORM_UNAUTHORIZED' || anyErr?.code === 401) {
    printError(ExitCode.Auth, msg, codeHints[401])
    process.exit(ExitCode.Auth)
  }
  if (anyErr?.code === 'PLATFORM_FORBIDDEN' || anyErr?.code === 403) {
    printError(ExitCode.Auth, msg, codeHints[403])
    process.exit(ExitCode.Auth)
  }
  if (anyErr?.code === 'PLATFORM_RATE_LIMITED' || anyErr?.code === 429) {
    printError(ExitCode.RateLimited, msg, codeHints[429])
    process.exit(ExitCode.RateLimited)
  }
  if (anyErr?.code === 'PLATFORM_VALIDATION' || anyErr?.code === 400) {
    printError(ExitCode.Validation, msg)
    process.exit(ExitCode.Validation)
  }
  if (typeof anyErr?.code === 'number' && anyErr.code >= 500) {
    printError(ExitCode.Server, msg)
    process.exit(ExitCode.Server)
  }

  printError(ExitCode.Generic, msg, typeof anyErr?.code === 'number' ? codeHints[anyErr.code] : undefined)
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