import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import { useStore } from '../store'

export function Button({
  children,
  icon,
  onClick,
  variant,
  small,
  disabled,
  title,
  type = 'button',
  className = ''
}: {
  children?: ReactNode
  icon?: string
  onClick?: (e: React.MouseEvent) => void
  variant?: 'ghost' | 'danger'
  small?: boolean
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  className?: string
}) {
  const cls = ['btn', variant === 'ghost' && 'ghost', variant === 'danger' && 'ghost danger', small && 'small', className].filter(Boolean).join(' ')
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} size={small ? 15 : 17} />}
      {children}
    </button>
  )
}

export function IconButton({ icon, onClick, title, on, className = '' }: { icon: string; onClick?: (e: React.MouseEvent) => void; title?: string; on?: boolean; className?: string }) {
  return (
    <button type="button" className={`icon-btn ${on ? 'on' : ''} ${className}`} onClick={onClick} title={title}>
      <Icon name={icon} />
    </button>
  )
}

export const Dot = ({ kind }: { kind?: 'on' | 'busy' }) => <span className={`dot ${kind || ''}`} />

/** Modal dialog on paper. Rendered by <DialogHost>, opened with useStore().openDialog(...). */
export function Dialog({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <h3>{title}</h3>
      {children}
      {actions && <div className="actions end">{actions}</div>}
    </>
  )
}

export function DialogHost() {
  const node = useStore((s) => s.dialog)
  const close = useStore((s) => s.closeDialog)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (node && !d.open) d.showModal()
    if (!node && d.open) d.close()
  }, [node])
  return (
    <dialog ref={ref} onClose={close} onCancel={close}>
      {node}
    </dialog>
  )
}

export function MenuHost() {
  const menu = useStore((s) => s.menu)
  const close = useStore((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', off), 0)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', key)
    }
  }, [menu, close])
  useEffect(() => {
    // keep the menu on screen
    const el = ref.current
    if (!el || !menu) return
    const r = el.getBoundingClientRect()
    el.style.left = `${Math.max(12, Math.min(menu.x - r.width, innerWidth - r.width - 12))}px`
    el.style.top = `${Math.max(12, Math.min(menu.y, innerHeight - r.height - 12))}px`
  }, [menu])
  if (!menu) return null
  return (
    <div className="menu" ref={ref} style={{ left: menu.x, top: menu.y }}>
      {menu.items.map((it, i) =>
        it.separator ? (
          <hr key={i} />
        ) : it.heading ? (
          <div key={i} className="lbl">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              close()
              it.onClick?.()
            }}
          >
            {it.icon && <Icon name={it.icon} />}
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function Signal({ rssi }: { rssi: number }) {
  const n = rssi > -55 ? 4 : rssi > -67 ? 3 : rssi > -78 ? 2 : 1
  return (
    <span className="signal">
      {[4, 7, 10, 13].map((h, i) => (
        <i key={i} className={i < n ? 'on' : ''} style={{ height: h }} />
      ))}
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}