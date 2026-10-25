import { THEMES, type ThemeDef } from '@shared/themes'
import { applyTheme, call, useStore } from '../store'

const swatch = (t: ThemeDef) => t.colors ?? { paper: '#f1ede4', ink: '#1b1a17', accent: '#c4562f', 'ink-3': '#8a8375' }

function Group({ title, mode }: { title: string; mode: 'light' | 'dark' }) {
  const { theme, palette } = useStore((s) => s.snap)
  return (
    <>
      <div className="eyebrow">{title}</div>
      <div className="theme-grid">
        {THEMES.filter((t) => t.mode === mode).map((t) => {
          const c = swatch(t)
          const on = theme === t.mode && palette === t.palette
          return (
            <button
              key={`${t.palette}-${t.mode}`}
              className={`theme-card ${on ? 'on' : ''}`}
              role="radio"
              aria-checked={on}
              onClick={() => {
                applyTheme(t.mode, t.palette)
                void call('appearance:set', t.palette, t.mode)
              }}
            >
              <span className="theme-preview" style={{ background: c.paper, color: c.ink }}>
                <i style={{ background: c.ink }} />
                <i style={{ background: c['ink-3'], width: '60%' }} />
                <b style={{ background: c.accent }} />
              </span>
              <span>{t.name}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

export function Settings() {
  return (
    <>
      <div className="head">
        <div>
          <h2>Settings</h2>
        </div>
      </div>
      <div className="card wide" role="radiogroup" aria-label="Theme">
        <h3>Theme</h3>
        <Group title="Light" mode="light" />
        <Group title="Dark" mode="dark" />
      </div>
    </>
  )
}
