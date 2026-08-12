import { describe, expect, it } from 'vitest'
import { CLASS, SPACE, STATUS_CATEGORIES } from './identifiers.js'

describe('transport identifiers', () => {
  it('contains documented class and space identifiers', () => {
    expect(CLASS.Project).toBe('tracker:class:Project')
    expect(CLASS.Issue).toBe('tracker:class:Issue')
    expect(SPACE.Workspace).toBe('core:space:Workspace')
    expect(SPACE.DocumentRoot).toBe('document:space:Document')
  })

  it('exposes exactly the five status categories', () => {
    expect(STATUS_CATEGORIES).toEqual(['UnStarted', 'ToDo', 'Active', 'Won', 'Lost'])
  })
})
