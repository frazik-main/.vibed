import { describe, expect, it } from 'vitest'
import prompt from './prompt.cjs'

describe('cli prompt', () => {
  it('keeps the agent inside the copied source folder', () => {
    const text = prompt.taskPrompt('add a dark mode toggle', true)
    expect(text).toContain('./source')
    expect(text).toContain('source/index.html')
    expect(text).toContain('Do not create files anywhere else')
  })

  it('carries the change request through', () => {
    const text = prompt.taskPrompt('make the counter bigger', false)
    expect(text).toContain('make the counter bigger')
    expect(text).toContain('Create the app source in ./source')
  })

  it('tells the JSON path to reply with JSON only', () => {
    expect(prompt.SYSTEM_PROMPT).toContain('Reply with JSON only')
    expect(prompt.SYSTEM_PROMPT).toContain('"index.html" is required')
  })
})
