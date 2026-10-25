// Every colour theme of the app. A theme is a palette in light or dark; the colours are CSS variables.
export type Mode = 'light' | 'dark'

export interface Colors {
  paper: string
  'paper-2': string
  sheet: string
  ink: string
  'ink-2': string
  'ink-3': string
  rule: string
  'rule-2': string
  accent: string
  ok: string
  'ink-hover': string
}

export interface ThemeDef {
  palette: string
  mode: Mode
  name: string
  colors: Colors | null // null = the stylesheet's own colours (Paper, light)
}

const c = (paper: string, p2: string, sheet: string, ink: string, i2: string, i3: string, rule: string, rule2: string, accent: string, ok: string, hover: string): Colors => ({
  paper, 'paper-2': p2, sheet, ink, 'ink-2': i2, 'ink-3': i3, rule, 'rule-2': rule2, accent, ok, 'ink-hover': hover
})

export const THEMES: ThemeDef[] = [
  { palette: 'green', mode: 'light', name: 'Sage', colors: c('#eef2ea', '#e3eadc', '#f6f9f3', '#1d2a21', '#4a5d4f', '#7d8f81', '#d2dccd', '#dfe7da', '#c4562f', '#3f7d58', '#2e4034') },
  { palette: 'paper', mode: 'light', name: 'Paper', colors: null },
  { palette: 'slate', mode: 'light', name: 'Slate', colors: c('#edf0f4', '#e1e6ed', '#f6f8fa', '#1c2430', '#4b586a', '#7e8b9c', '#d3dae3', '#e0e5ec', '#c4472b', '#3f7d58', '#2c3848') },
  { palette: 'rose', mode: 'light', name: 'Rose', colors: c('#f6ecee', '#efdfe3', '#fbf5f6', '#2d1d22', '#66474f', '#98777f', '#e3cfd4', '#ecdde1', '#c2415d', '#3f7d58', '#44292f') },
  { palette: 'sky', mode: 'light', name: 'Sky', colors: c('#ecf2f7', '#dde8f1', '#f5f9fc', '#172636', '#435a70', '#7790a5', '#cfdce8', '#dae6ef', '#d0632a', '#3f7d58', '#263b50') },
  { palette: 'lavender', mode: 'light', name: 'Lavender', colors: c('#f0edf6', '#e5e0ef', '#f8f6fb', '#231d33', '#54496b', '#877c9c', '#dad3e8', '#e5e0ef', '#c24a7a', '#3f7d58', '#35294d') },

  { palette: 'green', mode: 'dark', name: 'Forest', colors: c('#161d18', '#1e2822', '#1a221d', '#e6eee8', '#b3c2b7', '#81938a', '#2f3d34', '#263028', '#e2764f', '#8bbf9a', '#cfdcd2') },
  { palette: 'paper', mode: 'dark', name: 'Cocoa', colors: c('#1c1b18', '#26241f', '#21201c', '#ede7db', '#bdb5a6', '#8a8375', '#3a372f', '#2e2c26', '#e2643f', '#86ad86', '#d8d1c3') },
  { palette: 'slate', mode: 'dark', name: 'Dusk', colors: c('#171b22', '#1f252e', '#1b2029', '#e5e9f0', '#b2bccb', '#828fa1', '#2f3744', '#262d38', '#e2764f', '#8bbf9a', '#cdd6e3') },
  { palette: 'midnight', mode: 'dark', name: 'Midnight', colors: c('#0d1220', '#151c2e', '#111829', '#e4eaf6', '#aab5cc', '#7482a0', '#26304a', '#1d2640', '#ef7d57', '#8bbf9a', '#cbd5ea') },
  { palette: 'amoled', mode: 'dark', name: 'Black', colors: c('#000000', '#111111', '#0a0a0a', '#f2f2f2', '#b4b4b4', '#808080', '#262626', '#1a1a1a', '#ff7a4d', '#8bbf9a', '#dcdcdc') },
  { palette: 'plum', mode: 'dark', name: 'Plum', colors: c('#1c1420', '#261b2c', '#211826', '#efe4f2', '#c3b0c9', '#927f9b', '#3b2c43', '#2f2336', '#f0709a', '#8bbf9a', '#dccbe0') },
  { palette: 'ember', mode: 'dark', name: 'Ember', colors: c('#1d1612', '#281e18', '#231a15', '#f3e6d8', '#c7b29c', '#947f6a', '#3f3027', '#31251e', '#f08a3c', '#9bbf86', '#dfcdb9') }
]

export const findTheme = (palette: string, mode: string): ThemeDef =>
  THEMES.find((t) => t.palette === palette && t.mode === mode) ?? THEMES.find((t) => t.palette === palette) ?? THEMES[0]
