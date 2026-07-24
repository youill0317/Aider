import { useCallback, useEffect, useRef, useState } from 'react'

import { runAsyncAction } from '../../utils/async-action'

export const CONTROL_CHANGE_DEBOUNCE_MS = 300

type DebouncedCommit<T> = {
  schedule: (value: T) => void
  flush: () => void
  isPending: () => boolean
}

export function createDebouncedCommit<T>(
  commit: (value: T) => void,
  delayMs = CONTROL_CHANGE_DEBOUNCE_MS,
): DebouncedCommit<T> {
  let pending: { value: T } | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    if (!pending) return
    const { value } = pending
    pending = undefined
    commit(value)
  }

  return {
    schedule(value) {
      pending = { value }
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      timeoutId = setTimeout(flush, delayMs)
    },
    flush,
    isPending: () => pending !== undefined,
  }
}

export function useDebouncedControlValue({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void | Promise<void>
}): {
  draft: string
  setDraft: (value: string) => void
  flush: () => void
} {
  const [draft, setDraftState] = useState(value)
  const [settledVersion, setSettledVersion] = useState(0)
  const draftRef = useRef(value)
  const mountedRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const commitRef = useRef<DebouncedCommit<string> | null>(null)
  if (!commitRef.current) {
    commitRef.current = createDebouncedCommit((nextValue) => {
      void runAsyncAction(() => onChangeRef.current(nextValue)).then(() => {
        if (mountedRef.current) {
          setSettledVersion((version) => version + 1)
        }
      })
    })
  }
  const commit = commitRef.current

  const setDraft = useCallback(
    (nextValue: string) => {
      draftRef.current = nextValue
      setDraftState(nextValue)
      commit.schedule(nextValue)
    },
    [commit],
  )
  const flush = useCallback(() => commit.flush(), [commit])

  useEffect(() => {
    if (commit.isPending() || value === draftRef.current) return
    draftRef.current = value
    setDraftState(value)
  }, [commit, settledVersion, value])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(
    () => () => {
      flush()
    },
    [flush],
  )

  return { draft, setDraft, flush }
}
