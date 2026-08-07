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
})
