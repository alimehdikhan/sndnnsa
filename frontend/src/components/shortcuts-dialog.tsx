import { Dialog } from 'radix-ui'
import { useRef } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { GlyphBadge, KeysGlyph } from '@/components/glyphs'
import { SHORTCUTS } from '@/lib/shortcuts'

/** The keyboard shortcuts sheet (press ?). Loaded on first open. */
export default function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const content = useRef<HTMLDivElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          ref={content}
          tabIndex={-1}
          // Focus the sheet itself, not the close button, so it opens without a focus ring.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            content.current?.focus()
          }}
          className="themed fixed top-1/2 left-1/2 z-50 w-[min(720px,calc(100vw-32px))] outline-none -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-border bg-raised p-6 shadow-popover duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <GlyphBadge glyph={KeysGlyph} />
              <div>
                <Dialog.Title className="text-20 font-semibold text-fg">Keyboard shortcuts</Dialog.Title>
                <Dialog.Description className="mt-1 text-13 text-fg-2">Every change shows instantly; the address bar keeps the view.</Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="press grid size-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-hover hover:text-fg" aria-label="Close">
              <XIcon size={16} weight="bold" />
            </Dialog.Close>
          </div>
          <div className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {SHORTCUTS.map((group) => (
              <section key={group.title} className={group.title === 'Anywhere' ? 'sm:col-span-2' : undefined}>
                <h3 className="label mb-2">{group.title}</h3>
                <dl className="grid gap-2">
                  {group.items.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4">
                      <dt className="text-13 whitespace-nowrap text-fg-2">{item.label}</dt>
                      <dd className="flex shrink-0 gap-1">
                        {item.keys.map((k) => (
                          <kbd
                            key={k}
                            className="num inline-grid h-6 min-w-6 place-items-center rounded-[6px] border border-border-strong bg-control px-1.5 text-12 font-medium text-fg shadow-card"
                          >
                            {k}
                          </kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
