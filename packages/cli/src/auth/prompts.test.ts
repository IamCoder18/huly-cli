import { describe, expect, it, vi } from 'vitest'
import inquirer from 'inquirer'
import { pickProject, pickWorkspace } from './prompts.js'

describe('auth prompts', () => {
  it('returns the selected project', async () => {
    const prompt = vi
      .spyOn(inquirer, 'prompt')
      .mockResolvedValue({ project: { _id: '1', name: 'One' } } as never)
    await expect(
      pickProject([{ _id: '1', name: 'One' }], undefined, { forceInteractive: true }),
    ).resolves.toMatchObject({ _id: '1' })
    prompt.mockRestore()
  })

  it('rejects empty workspace lists', async () => {
    await expect(pickWorkspace([], { forceInteractive: true })).rejects.toMatchObject({ code: 2 })
  })
})
