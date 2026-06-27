#!/usr/bin/env node
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const wsModule = require('ws') as typeof import('ws')

// Polyfill `window` for Node.js >= 22 where `sessionStorage` is provided as a
// built-in but `window` is not. The Huly SDK checks `typeof sessionStorage`
// to decide if it is in a browser context and only then reads `window`.
const g = globalThis as unknown as { window?: unknown; WebSocket?: unknown }
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

import { run } from './cli.js'

run().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})