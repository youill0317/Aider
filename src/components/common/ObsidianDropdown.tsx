import { DropdownComponent } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { runAsyncAction } from '../../utils/async-action'

import { useObsidianSetting } from './ObsidianSetting'

type ObsidianDropdownProps = {
  value: string
  options: Record<string, string>
  onChange: (value: string) => void | Promise<void>
}

export function ObsidianDropdown({
  value,
  options,
  onChange,
}: ObsidianDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setting } = useObsidianSetting()
  const [dropdownComponent, setDropdownComponent] =
    useState<DropdownComponent | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    if (setting) {
      let newDropdownComponent: DropdownComponent | null = null
      setting.addDropdown((component) => {
        newDropdownComponent = component
      })
      setDropdownComponent(newDropdownComponent)

      return () => {
        newDropdownComponent?.selectEl.remove()
      }
    } else if (containerRef.current) {
      const newDropdownComponent = new DropdownComponent(containerRef.current)
      setDropdownComponent(newDropdownComponent)

      return () => {
        newDropdownComponent?.selectEl.remove()
      }
    }
  }, [setting])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!dropdownComponent) return
    dropdownComponent.onChange((nextValue) => {
      void runAsyncAction(() => onChangeRef.current(nextValue)).then(
        (succeeded) => {
          if (!succeeded) dropdownComponent.setValue(valueRef.current)
        },
      )
    })
  }, [dropdownComponent])

  useEffect(() => {
    if (!dropdownComponent) return

    dropdownComponent.selectEl.empty()
    dropdownComponent.addOptions(options)
    dropdownComponent.setValue(value)
  }, [dropdownComponent, options, value])

  return <div ref={containerRef} />
}
