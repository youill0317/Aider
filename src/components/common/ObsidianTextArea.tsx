import { TextAreaComponent } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { useObsidianSetting } from './ObsidianSetting'
import { useDebouncedControlValue } from './useDebouncedControlValue'

type ObsidianTextAreaProps = {
  value: string
  placeholder?: string
  onChange: (value: string) => void | Promise<void>
}

export function ObsidianTextArea({
  value,
  placeholder,
  onChange,
}: ObsidianTextAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setting } = useObsidianSetting()
  const [textAreaComponent, setTextAreaComponent] =
    useState<TextAreaComponent | null>(null)
  const { draft, setDraft, flush } = useDebouncedControlValue({
    value,
    onChange,
  })

  useEffect(() => {
    if (setting) {
      let newTextAreaComponent: TextAreaComponent | null = null
      setting.addTextArea((component) => {
        newTextAreaComponent = component
      })
      setTextAreaComponent(newTextAreaComponent)

      return () => {
        newTextAreaComponent?.inputEl.remove()
      }
    } else if (containerRef.current) {
      const newTextAreaComponent = new TextAreaComponent(containerRef.current)
      setTextAreaComponent(newTextAreaComponent)

      return () => {
        newTextAreaComponent?.inputEl.remove()
      }
    }
  }, [setting])

  useEffect(() => {
    if (!textAreaComponent) return
    textAreaComponent.onChange(setDraft)
    const input = textAreaComponent.inputEl
    input.addEventListener('blur', flush)
    return () => input.removeEventListener('blur', flush)
  }, [flush, setDraft, textAreaComponent])

  useEffect(() => {
    if (!textAreaComponent) return
    textAreaComponent.setPlaceholder(placeholder ?? '')
    if (textAreaComponent.getValue() !== draft) {
      textAreaComponent.setValue(draft)
    }
  }, [draft, placeholder, textAreaComponent])

  return <div ref={containerRef} />
}
