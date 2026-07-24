import { ToggleComponent } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { runAsyncAction } from '../../utils/async-action'

import { useObsidianSetting } from './ObsidianSetting'

type ObsidianToggleProps = {
  value: boolean
  onChange: (value: boolean) => void | Promise<void>
  ariaLabel?: string
}

export function ObsidianToggle({
  value,
  onChange,
  ariaLabel,
}: ObsidianToggleProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setting } = useObsidianSetting()
  const [toggleComponent, setToggleComponent] =
    useState<ToggleComponent | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    if (setting) {
      let newToggleComponent: ToggleComponent | null = null
      setting.addToggle((component) => {
        newToggleComponent = component
      })
      setToggleComponent(newToggleComponent)

      return () => {
        newToggleComponent?.toggleEl.remove()
      }
    } else if (containerRef.current) {
      const newToggleComponent = new ToggleComponent(containerRef.current)
      setToggleComponent(newToggleComponent)

      return () => {
        newToggleComponent?.toggleEl.remove()
      }
    }
  }, [setting])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!toggleComponent) return
    toggleComponent.onChange((nextValue) => {
      void runAsyncAction(() => onChangeRef.current(nextValue)).then(
        (succeeded) => {
          if (!succeeded) toggleComponent.setValue(valueRef.current)
        },
      )
    })
  }, [toggleComponent])

  useEffect(() => {
    if (!toggleComponent) return
    toggleComponent.setValue(value)
  }, [toggleComponent, value])

  useEffect(() => {
    if (!toggleComponent) return
    if (ariaLabel) {
      toggleComponent.toggleEl.setAttribute('aria-label', ariaLabel)
    } else {
      toggleComponent.toggleEl.removeAttribute('aria-label')
    }
  }, [ariaLabel, toggleComponent])

  return <div ref={containerRef} style={{ display: 'contents' }} />
}
