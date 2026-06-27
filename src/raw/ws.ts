import WebSocket from 'ws'
import { readEnv, insecureTLS, isHttp } from '../auth/env.js'
import { resolveToken } from '../auth/client.js'

interface WsOpts {
  workspace?: string
  binary?: boolean
  noPing?: boolean
  token?: string
  url?: string
}

function parseParams(raw?: string): unknown[] | Record<string, unknown> | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  const parsed = JSON.parse(trimmed)
  if (Array.isArray(parsed)) return parsed
  if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
  return [parsed]
}

export async function wsCommand(method: string, paramsRaw: string | undefined, opts: WsOpts = {}): Promise<void> {
  const env = readEnv()
  const url = (opts.url ?? env.url).replace(/\/$/, '')
  const token = opts.token ?? env.token ?? await resolveToken(opts)

  const scheme = isHttp() ? 'ws' : 'wss'
  const insecure = insecureTLS()
  const sessionId = Math.random().toString(36).slice(2, 12)
  const wsUrl = `${scheme}://${url.replace(/^https?:\/\//, '')}/_transactor/${token}?sessionId=${sessionId}`
  const wsOpts: WebSocket.ClientOptions = insecure ? { rejectUnauthorized: false } : {}
  const ws = new WebSocket(wsUrl, wsOpts)

  let id = 0
  let helloDone = false
  let pingTimer: NodeJS.Timeout | undefined
  const chunks: unknown[] = []

  return await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      ws.send(
        JSON.stringify({ method: 'hello', params: [], id: -1, binary: !!opts.binary, compression: false })
      )
      if (!opts.noPing) {
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 5000)
      }
    })

    ws.on('error', (e) => {
      if (pingTimer) clearInterval(pingTimer)
      reject(new Error(`ws error: ${e.message}`))
    })

    ws.on('close', () => {
      if (pingTimer) clearInterval(pingTimer)
    })

    const done = () => {
      if (pingTimer) clearInterval(pingTimer)
      ws.close()
      resolve()
    }

    ws.on('message', (data) => {
      const text = data.toString()
      if (text === 'ping') { ws.send('pong'); return }
      if (text === 'pong') return

      let m: { id?: number; result?: unknown; error?: unknown; chunk?: { index: number; final: boolean } }
      try { m = JSON.parse(text) } catch { return }

      if (m.id === -1 && m.result === 'hello' && !helloDone) {
        helloDone = true
        const params = parseParams(paramsRaw) ?? []
        const reqId = ++id
        ws.send(
          JSON.stringify({
            method, params, meta: {}, id: reqId, time: Date.now(), binary: !!opts.binary
          })
        )
        return
      }

      if (m.id !== undefined && m.id >= 0) {
        if (m.error) { console.error('error:', JSON.stringify(m.error)); return done() }
        if (m.chunk) {
          chunks[m.chunk.index] = m.result
          if (m.chunk.final) { console.log(JSON.stringify(chunks.flat(), null, 2)); return done() }
          return
        }
        const result = m.result as { value?: unknown[]; total?: number } | unknown
        if (result && typeof result === 'object' && 'value' in (result as Record<string, unknown>)) {
          const r = result as { value: unknown[]; total?: number }
          console.log(JSON.stringify({ total: r.total ?? r.value.length, value: r.value }, null, 2))
        } else {
          console.log(JSON.stringify(result, null, 2))
        }
        return done()
      }
    })

    setTimeout(() => {
      if (pingTimer) clearInterval(pingTimer)
      ws.close()
      reject(new Error('timeout'))
    }, 60000)
  })
}