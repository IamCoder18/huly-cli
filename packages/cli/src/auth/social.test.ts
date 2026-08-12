import { describe, expect, it } from 'vitest'
import { normalizeSocialKey } from './social.js'

describe('social identifiers', () => {
  it('prefixes bare values and preserves typed values', () => {
    expect(normalizeSocialKey('alice@example.test')).toBe('email:alice@example.test')
    expect(normalizeSocialKey('octocat', 'github')).toBe('github:octocat')
    expect(normalizeSocialKey('github:octocat')).toBe('github:octocat')
    expect(normalizeSocialKey('')).toBe('')
  })
})
