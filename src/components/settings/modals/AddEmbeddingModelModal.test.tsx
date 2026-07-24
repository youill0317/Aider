const mockButtons = new Map<
  string,
  { onClick: () => Promise<void> | void; disabled?: boolean }
>()
const mockGetEmbedding = jest.fn<
  Promise<number[]>,
  [string, string, { dimensions?: number; signal?: AbortSignal }]
>()

jest.mock('react', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    ...React,
    useEffect: jest.fn((effect: () => undefined | (() => undefined)) =>
      effect(),
    ),
    useRef: jest.fn((value: unknown) => ({ current: value })),
    useState: jest.fn((initial: unknown) => {
      const value =
        typeof initial === 'function' ? (initial as () => unknown)() : initial
      if (
        value &&
        typeof value === 'object' &&
        'providerId' in value &&
        'model' in value
      ) {
        return [
          { ...value, id: 'embedding-model', model: 'embedding-api-model' },
          jest.fn(),
        ]
      }
      return [value, jest.fn()]
    }),
  }
})

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
}))

jest.mock('../../../core/llm/manager', () => ({
  getProviderClient: () => ({ getEmbedding: mockGetEmbedding }),
}))

jest.mock('../../common/ReactModal', () => ({
  ReactModal: class {
    Component: React.ComponentType<unknown>
    props: unknown

    constructor({
      Component,
      props,
    }: {
      Component: React.ComponentType<unknown>
      props: unknown
    }) {
      this.Component = Component
      this.props = props
    }
  },
}))

jest.mock('../../common/ObsidianButton', () => ({
  ObsidianButton: (props: {
    text: string
    onClick: () => Promise<void> | void
    disabled?: boolean
  }) => {
    mockButtons.set(props.text, props)
    return null
  },
}))

jest.mock('../../common/ObsidianDropdown', () => ({
  ObsidianDropdown: () => null,
}))

jest.mock('../../common/ObsidianSetting', () => ({
  ObsidianSetting: ({ children }: { children?: React.ReactNode }) => children,
}))

jest.mock('../../common/ObsidianTextInput', () => ({
  ObsidianTextInput: () => null,
}))

jest.mock('../../modals/ConfirmModal', () => ({
  ConfirmModal: class {},
}))

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AddEmbeddingModelModal } from './AddEmbeddingModelModal'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderModal() {
  const settings = {
    providers: [{ id: 'provider', type: 'openai' }],
    embeddingModels: [],
  }
  const setSettings = jest.fn(
    async (update: (current: typeof settings) => typeof settings) => {
      Object.assign(settings, update(settings))
    },
  )
  const plugin = { app: {}, settings, setSettings }
  const onClose = jest.fn()
  const modal = new AddEmbeddingModelModal(
    {} as never,
    plugin as never,
  ) as unknown as {
    Component: React.ComponentType<{
      plugin: typeof plugin
      onClose: () => void
    }>
  }

  renderToStaticMarkup(<modal.Component plugin={plugin} onClose={onClose} />)
  return { onClose, setSettings }
}

describe('AddEmbeddingModelModal async submission', () => {
  beforeEach(() => {
    mockButtons.clear()
    mockGetEmbedding.mockReset()
  })

  it('starts only one request when Add is clicked twice', async () => {
    const embedding = deferred<number[]>()
    mockGetEmbedding.mockReturnValue(embedding.promise)
    const { setSettings } = renderModal()
    const add = mockButtons.get('Add')

    const first = add?.onClick()
    const second = add?.onClick()
    embedding.resolve(Array<number>(384).fill(0))

    await Promise.all([first, second])
    expect(mockGetEmbedding).toHaveBeenCalledTimes(1)
    expect(setSettings).toHaveBeenCalledTimes(1)
  })

  it('aborts on cancel and ignores a late embedding result', async () => {
    const embedding = deferred<number[]>()
    mockGetEmbedding.mockReturnValue(embedding.promise)
    const { onClose, setSettings } = renderModal()

    const submit = mockButtons.get('Add')?.onClick()
    mockButtons.get('Cancel')?.onClick()
    const signal = mockGetEmbedding.mock.calls[0][2].signal
    embedding.resolve(Array<number>(384).fill(0))
    await submit

    expect(signal?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setSettings).not.toHaveBeenCalled()
  })
})
