import { PropsWithChildren, createContext, useContext, useMemo } from 'react'

import type { ToolDispatcher } from '../utils/chat/tool-dispatcher'

export type ToolDispatcherContextType = {
  getToolDispatcher: () => Promise<ToolDispatcher>
}

const ToolDispatcherContext = createContext<ToolDispatcherContextType | null>(
  null,
)

export function ToolDispatcherProvider({
  getToolDispatcher,
  children,
}: PropsWithChildren<{
  getToolDispatcher: () => Promise<ToolDispatcher>
}>) {
  const value = useMemo(() => {
    return { getToolDispatcher }
  }, [getToolDispatcher])

  return (
    <ToolDispatcherContext.Provider value={value}>
      {children}
    </ToolDispatcherContext.Provider>
  )
}

export function useToolDispatcher() {
  const context = useContext(ToolDispatcherContext)
  if (!context) {
    throw new Error(
      'useToolDispatcher must be used within a ToolDispatcherProvider',
    )
  }
  return context
}
