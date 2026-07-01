import WebSocket from 'ws'
import { readEnv, insecureTLS } from '../auth/env.js'
import { accountClient, resolveToken } from '../auth/client.js'
import { readActiveWorkspace } from '../auth/cache.js'
import { CliError, ExitCode } from '../output/errors.js'

interface WsOpts {
  workspace?: string
  binary?: boolean
  noPing?: boolean
  token?: string
  url?: string
}

function parseParams(raw: string | undefined): unknown[] {
  if (raw === undefined || raw === '') return []
  const trimmed = raw.trim()
  if (trimmed.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    throw new CliError(ExitCode.Validation, `invalid --params JSON: ${(e as Error).message}`)
  }
  if (!Array.isArray(parsed)) {
    throw new CliError(ExitCode.Validation, 'params must be a JSON array', 'Huly RPC methods take positional arrays')
  }
  return parsed
}

function deriveWsScheme(endpoint: string): 'ws' | 'wss' {
  if (endpoint.startsWith('wss://')) return 'wss'
  if (endpoint.startsWith('ws://')) return 'ws'
  if (endpoint.startsWith('https://')) return 'wss'
  return 'ws'
}

const PING = 'ping'
const PONG = 'pong!'

export async function wsCommand(method: string, paramsRaw: string | undefined, opts: WsOpts = {}): Promise<void> {
  const env = readEnv()
  const url = (opts.url ?? env.url).replace(/\/$/, '')
  const workspace = opts.workspace ?? env.workspace ?? (await readActiveWorkspace())

  // Parse params up front so errors throw before opening the socket.
  const initialParams = parseParams(paramsRaw)

  let wsLoginEndpoint = url
  let wsToken: string
  let insecure = insecureTLS() || url.startsWith('http://')

  if (workspace !== undefined && workspace !== '') {
    const accountToken = opts.token ?? env.token ?? await resolveToken({ url })
    const ac = await accountClient(url, accountToken)
    const wsLogin = await ac.selectWorkspace(workspace)
    wsLoginEndpoint = wsLogin.endpoint.replace(/\/$/, '')
    wsToken = wsLogin.token
  } else {
    wsToken = opts.token ?? env.token ?? await resolveToken({ url })
  }

  const scheme = deriveWsScheme(wsLoginEndpoint)
  if (wsLoginEndpoint.startsWith('http://')) insecure = true

  const sessionId = Math.random().toString(36).slice(2, 12)
  const host = wsLoginEndpoint.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '')
  const wsUrl = `${scheme}://${host}/_transactor/${wsToken}?sessionId=${sessionId}`
  const wsOpts: WebSocket.ClientOptions = insecure ? { rejectUnauthorized: false } : {}
  const ws = new WebSocket(wsUrl, wsOpts)

  let id = 0
  let helloDone = false
  let settled = false
  const chunks: unknown[] = []

  return await new Promise<void>((resolve, reject) => {
    let pingTimer: NodeJS.Timeout | undefined
    let timeout: NodeJS.Timeout | undefined

    const cleanup = (): void => {
      if (pingTimer) clearInterval(pingTimer)
      if (timeout) clearTimeout(timeout)
      try { ws.close() } catch { /* already closed */ }
    }

    const settle = (fn: () => void, err?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (err !== undefined) reject(err)
      else resolve()
    }

    ws.on('open', () => {
      ws.send(
        JSON.stringify({ method: 'hello', params: [], id: -1, binary: !!opts.binary, compression: false })
      )
      if (!opts.noPing) {
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(PING)
        }, 5000)
      }
    })

    ws.on('error', (e) => settle(() => { /* no-op */ }, new Error(`ws error: ${e.message}`)))

    ws.on('close', (code, reasonBuf) => {
      if (settled) return
      const reason = reasonBuf?.toString?.() ?? ''
      const msg = reason !== '' ? reason : `socket closed (code=${code}) before response`
      settle(() => { /* no-op */ }, new Error(`ws closed unexpectedly: ${msg}`))
    })

    const done = (err?: Error): void => {
      settle(() => { /* no-op */ }, err)
    }

    ws.on('message', (data) => {
      const text = data.toString()
      if (text === PING) { ws.send(PONG); return }
      if (text === PONG) return

      let m: { id?: number; result?: unknown; error?: unknown; chunk?: { index: number; final: boolean } }
      try { m = JSON.parse(text) } catch { return }

      if (m.id === -1 && m.result === 'hello' && !helloDone) {
        helloDone = true
        const reqId = ++id
        ws.send(
          JSON.stringify({
            method, params: initialParams, meta: {}, id: reqId, time: Date.now(), binary: !!opts.binary
          })
        )
        return
      }

      if (m.id !== undefined && m.id >= 0) {
        if (m.error) {
          console.error('error:', JSON.stringify(m.error))
          done(new CliError(ExitCode.Server, `ws rpc error: ${JSON.stringify(m.error)}`))
          return
        }
        if (m.chunk) {
          chunks[m.chunk.index] = m.result
          if (m.chunk.final) {
            console.log(JSON.stringify(chunks.flat(), null, 2))
            done()
            return
          }
          return
        }
        const result = m.result as { value?: unknown[]; total?: number } | unknown
        if (result && typeof result === 'object' && 'value' in (result as Record<string, unknown>)) {
          const r = result as { value: unknown[]; total?: number }
          console.log(JSON.stringify({ total: r.total ?? r.value.length, value: r.value }, null, 2))
        } else {
          console.log(JSON.stringify(result, null, 2))
        }
        done()
        return
      }
    })

    timeout = setTimeout(() => done(new Error('timeout')), 60000)
  })
}
