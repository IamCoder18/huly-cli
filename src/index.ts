#!/usr/bin/env node
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const wsModule = require('ws') as typeof import('ws')

// Suppress Node experimental/deprecation warnings on stderr.
// Node 22+ prints these for things like `localStorage` availability checks.
const proc = process as unknown as { emit: (event: string, ...args: unknown[]) => boolean }
const origEmit = proc.emit
proc.emit = function (this: unknown, event: string, ...args: unknown[]) {
  if (event === 'warning') return false
  return origEmit.call(this, event, ...args)
} as typeof origEmit

// Polyfill `window` for Node.js >= 22 where `sessionStorage` is provided as a
// built-in but `window` is not. The Huly SDK checks `typeof sessionStorage`
// to decide if it is in a browser context and only then reads `window`.
const g = globalThis as unknown as { window?: unknown; WebSocket?: unknown; console?: { log?: (...a: unknown[]) => void } }
if (g.window === undefined) {
  g.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: '' }
  }
}
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = wsModule.WebSocket
}

// Suppress SDK noise that goes to stdout (not stderr, so 2>/dev/null doesn't help).
// The Huly SDK's @hcengineering/client-resources emits these via console.log
// ("Generate new SessionId ...", "Connected to server: ...", "findfull model ...").
// The model-upgrade retry warnings ("no document found, failed to apply model
// transaction, skipping ...") come from ctx.warn() → console.warn.
// Filter all of these to keep CLI output clean.
const sdkNoisePattern = /^(Generate new SessionId|Connected to server:|findfull model|.* measure slow findAll|.*measure slow findAll|Client: onConnect|no document found, failed to apply model transaction)/
type ConsoleFn = (...args: unknown[]) => void
const consoleObj = g.console as { log?: ConsoleFn; warn?: ConsoleFn; info?: ConsoleFn; error?: ConsoleFn }
const wrapConsole = (orig: ConsoleFn | undefined): ConsoleFn => {
  if (orig === undefined) return () => {}
  return function (this: unknown, ...args: unknown[]) {
    const first = args[0]
    if (typeof first === 'string' && sdkNoisePattern.test(first)) return
    return orig.apply(this, args as never)
  }
}
consoleObj.log = wrapConsole(consoleObj.log)
consoleObj.warn = wrapConsole(consoleObj.warn)
consoleObj.info = wrapConsole(consoleObj.info)
consoleObj.error = wrapConsole(consoleObj.error)

import { run } from './cli.js'

run().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})