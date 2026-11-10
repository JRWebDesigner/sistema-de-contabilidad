'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ModalProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  page?: string
  title?: string
  description?: string
  className?: string
}

export default function Modal({ open, onClose, children, page, title, description, className = '' }: ModalProps) {
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) return null

  const headingId = `${page ?? 'modal'}-modal-title`.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className={`modal-dialog ${className} p-6`.trim()} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        {(page || title || description) && (
          <div className="modal-header">
            <div>
              {page && <p className="eyebrow">{page}</p>}
              {title && <h2 id={headingId}>{title}</h2>}
              {description && <p className="muted">{description}</p>}
            </div>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar modal">
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </section>
    </div>
  )
}
