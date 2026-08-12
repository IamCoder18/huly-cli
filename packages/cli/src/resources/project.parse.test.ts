import { describe, expect, it } from 'vitest'
import { parseSet } from './project.parse.js'
import { CliError, ExitCode } from '../output/errors.js'

describe('parseSet', () => {
  it('parses simple string values', () => {
    expect(parseSet(['name=foo'])).toEqual({ name: 'foo' })
  })

  it('coerces booleans before numbers', () => {
    expect(parseSet(['archived=true', 'private=false'])).toEqual({ archived: true, private: false })
  })

  it('coerces numeric values', () => {
    expect(parseSet(['rank=42', 'ratio=-3.14'])).toEqual({ rank: 42, ratio: -3.14 })
  })

  it('coerces explicit null before booleans/numbers (CLI-10)', () => {
    expect(parseSet(['description=null', 'rank=null'])).toEqual({ description: null, rank: null })
  })

  it('keeps arbitrary strings as strings', () => {
    expect(parseSet(['label=hello world', 'note=a:b:c'])).toEqual({ label: 'hello world', note: 'a:b:c' })
  })

  it('trims whitespace around keys and values', () => {
    expect(parseSet(['  key  =  value  '])).toEqual({ key: 'value' })
  })

  it('throws Validation on entries missing `=`', () => {
    expect(() => parseSet(['no-equals-here'])).toThrow(CliError)
    try {
      parseSet(['no-equals-here'])
    } catch (e) {
      expect(e).toBeInstanceOf(CliError)
      expect((e as CliError).code).toBe(ExitCode.Validation)
      expect((e as Error).message).toMatch(/expected key=value/)
    }
  })

  it('parses multiple entries into a single record', () => {
    const out = parseSet(['a=1', 'b=2', 'c=hello'])
    expect(out).toEqual({ a: 1, b: 2, c: 'hello' })
  })

  it('returns an empty record for an empty input list', () => {
    expect(parseSet([])).toEqual({})
  })
})
