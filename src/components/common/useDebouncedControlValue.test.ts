import * as fs from 'fs'
import * as path from 'path'

import {
  CONTROL_CHANGE_DEBOUNCE_MS,
  createDebouncedCommit,
} from './useDebouncedControlValue'

describe('createDebouncedCommit', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('commits only the latest draft after 300ms', () => {
    const commit = jest.fn()
    const debounced = createDebouncedCommit(commit)

    debounced.schedule('a')
    jest.advanceTimersByTime(CONTROL_CHANGE_DEBOUNCE_MS - 1)
    debounced.schedule('ab')
    jest.advanceTimersByTime(CONTROL_CHANGE_DEBOUNCE_MS)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('ab')
  })

  it('flushes the pending draft immediately without a later duplicate', () => {
    const commit = jest.fn()
    const debounced = createDebouncedCommit(commit)
    debounced.schedule('draft')

    debounced.flush()
    jest.advanceTimersByTime(CONTROL_CHANGE_DEBOUNCE_MS)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('draft')
    expect(debounced.isPending()).toBe(false)
  })

  it('resynchronizes a settled save from the controlled value', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/components/common/useDebouncedControlValue.ts',
      ),
      'utf8',
    )

    expect(source).toContain('setSettledVersion((version) => version + 1)')
    expect(source).toContain(
      'if (commit.isPending() || value === draftRef.current) return',
    )
    expect(source).toContain('draftRef.current = value')
  })
})
