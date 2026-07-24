import { TextComponent } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { useObsidianSetting } from './ObsidianSetting'
import { useDebouncedControlValue } from './useDebouncedControlValue'

type ObsidianTextInputProps = {
  value: string
  placeholder?: string
  onChange: (value: string) => void | Promise<void>
  type?: 'text' | 'number'
}

export function ObsidianTextInput({
  value,
  placeholder,
  onChange,
  type,
}: ObsidianTextInputProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setting } = useObsidianSetting()
  const [textComponent, setTextComponent] = useState<TextComponent | null>(null)
  const { draft, setDraft, flush } = useDebouncedControlValue({
    value,
    onChange,
  })

  useEffect(() => {
    if (setting) {
      let newTextComponent: TextComponent | null = null
      setting.addText((component) => {
        newTextComponent = component
      })
      setTextComponent(newTextComponent)

      return () => {
        newTextComponent?.inputEl.remove()
      }
    } else if (containerRef.current) {
      const newTextComponent = new TextComponent(containerRef.current)
      setTextComponent(newTextComponent)

      return () => {
        newTextComponent?.inputEl.remove()
      }
    }
  }, [setting])

  useEffect(() => {
    if (!textComponent) return
    textComponent.onChange(setDraft)
    const input = textComponent.inputEl
    input.addEventListener('blur', flush)
    return () => input.removeEventListener('blur', flush)
  }, [flush, setDraft, textComponent])

  useEffect(() => {
    if (!textComponent) return
    if (textComponent.getValue() !== draft) {
      textComponent.setValue(draft)
    }
    textComponent.setPlaceholder(placeholder ?? '')
    textComponent.inputEl.type = type ?? 'text'
  }, [draft, placeholder, textComponent, type])

  return <div ref={containerRef} />
}
