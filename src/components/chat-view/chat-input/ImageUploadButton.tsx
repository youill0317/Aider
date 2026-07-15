import { ImageIcon } from 'lucide-react'
import { useRef } from 'react'

export function ImageUploadButton({
  onUpload,
}: {
  onUpload: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) {
      onUpload(files)
    }
    event.target.value = ''
  }

  return (
    <>
      <button
        type="button"
        className="clickable-icon smtcmp-chat-attach-button"
        aria-label="Attach images"
        onClick={() => inputRef.current?.click()}
      >
        <ImageIcon size={16} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        hidden
      />
    </>
  )
}
