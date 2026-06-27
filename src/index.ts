#!/usr/bin/env node
import { run } from './cli.js'

run().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})