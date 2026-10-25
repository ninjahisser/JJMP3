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
  fonts?: { serif?: string; sans?: string; mono?: string } // wilder themes bring their own type
  shape?: 'block' | 'brutal' | 'pixel' | 'bevel' // no rounding; brutal adds hard outlines and shadows, pixel crisp images, bevel Win95 buttons
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
,

  // ---- the wild ones ----
  { palette: 'mint', mode: 'light', name: 'Mint', colors: c('#e8f7ef', '#d6f0e2', '#f3fbf7', '#0f3524', '#2f6b4d', '#6aa387', '#bfe5d0', '#d3eddf', '#e8590c', '#1f9d63', '#175a3d') },
  { palette: 'bubblegum', mode: 'light', name: 'Bubblegum', colors: c('#ffe3f1', '#ffd0e8', '#fff1f8', '#4a1233', '#8c2f66', '#c46a9a', '#ffc2de', '#ffd6ea', '#00a6c8', '#1f9d63', '#6a1c4b') },
  { palette: 'sunny', mode: 'light', name: 'Lemonade', colors: c('#fff7c2', '#ffee94', '#fffbe0', '#3a2f00', '#7a6400', '#ad9a2b', '#f2e07a', '#f7e993', '#e8590c', '#3f9d3f', '#5a4a00') },
  { palette: 'barbie', mode: 'light', name: 'Dreamhouse', colors: c('#ff9ccf', '#ff7fbf', '#ffc2e2', '#4a0a2e', '#8a1c5c', '#b34283', '#ff6cb4', '#ff86c2', '#7a00d6', '#007a5e', '#650a3e'), fonts: { serif: '"Segoe Script", "Brush Script MT", cursive' } },
  { palette: 'vapor', mode: 'light', name: 'Vaporwave', colors: c('#f2d9ff', '#e6c2ff', '#fbeaff', '#2d1670', '#5b3fa8', '#9a82d6', '#d7b4f5', '#e5c9fb', '#ff4fa3', '#00b8a9', '#3f2790'), fonts: { serif: '"Trebuchet MS", sans-serif' } },
  { palette: 'gameboy', mode: 'light', name: 'Game Boy', colors: c('#9bbc0f', '#8bac0f', '#b2cf2b', '#0f380f', '#306230', '#4a7a2a', '#7a9a0c', '#88a80e', '#0f380f', '#306230', '#0a290a'), fonts: { serif: '"Courier New", monospace', sans: '"Courier New", monospace', mono: '"Courier New", monospace' } },
  { palette: 'newspaper', mode: 'light', name: 'Newsprint', colors: c('#f4f1ea', '#e9e5da', '#fbfaf6', '#111111', '#3a3a3a', '#767676', '#cfcabb', '#ddd9cc', '#b00020', '#2e6b3a', '#000000'), fonts: { serif: 'Georgia, "Times New Roman", serif' } },
  { palette: 'solarl', mode: 'light', name: 'Solar Light', colors: c('#fdf6e3', '#eee8d5', '#fffbed', '#586e75', '#657b83', '#93a1a1', '#e3dcc4', '#eee8d5', '#cb4b16', '#859900', '#073642') },
  { palette: 'clown', mode: 'light', name: 'Clown', colors: c('#fff200', '#ffe000', '#fff9a8', '#1a1aff', '#d6006f', '#ff6a00', '#ff9d00', '#ffd000', '#ff0033', '#00a550', '#0000b8'), fonts: { serif: '"Comic Sans MS", "Chalkboard SE", cursive', sans: '"Comic Sans MS", "Chalkboard SE", cursive' } },
  { palette: 'win95', mode: 'light', name: 'Windows 95', colors: c('#c0c0c0', '#b0b0b0', '#dfdfdf', '#000000', '#202020', '#5a5a5a', '#808080', '#a0a0a0', '#000080', '#008000', '#000000'), fonts: { serif: 'Tahoma, "MS Sans Serif", sans-serif', sans: 'Tahoma, "MS Sans Serif", sans-serif' } },
  { palette: 'scroll', mode: 'light', name: 'Old Scroll', colors: c('#ead9a8', '#dec78a', '#f2e6bf', '#3b2a14', '#6b4f2a', '#9a8052', '#cdb678', '#d8c48c', '#8b1a1a', '#3f6b2a', '#24190b'), fonts: { serif: 'Papyrus, "Palatino Linotype", serif', sans: 'Papyrus, "Palatino Linotype", serif' } },

  { palette: 'synthwave', mode: 'dark', name: 'Synthwave', colors: c('#1a0b2e', '#26104a', '#210f3d', '#f8e1ff', '#d3a7f5', '#9468c9', '#4a1f80', '#381768', '#ff2e97', '#00f0ff', '#ffffff') },
  { palette: 'terminal', mode: 'dark', name: 'Terminal', colors: c('#020a02', '#071a07', '#041204', '#33ff66', '#22cc4f', '#168a37', '#0f4a1f', '#0a3315', '#ffd000', '#33ff66', '#8affa8'), fonts: { serif: '"JetBrains Mono", Consolas, monospace', sans: '"JetBrains Mono", Consolas, monospace', mono: '"JetBrains Mono", Consolas, monospace' } },
  { palette: 'amber', mode: 'dark', name: 'Amber CRT', colors: c('#120a00', '#1f1200', '#180e00', '#ffb000', '#d98f00', '#8f5e00', '#4d3000', '#382300', '#ff6a00', '#ffd24d', '#ffd47a'), fonts: { serif: '"JetBrains Mono", Consolas, monospace', sans: '"JetBrains Mono", Consolas, monospace' } },
  { palette: 'cyber', mode: 'dark', name: 'Cyberpunk', colors: c('#0b0b14', '#14142a', '#0f0f1f', '#fcee0a', '#c9bd08', '#7d7608', '#2a2a55', '#1e1e40', '#ff003c', '#00f0ff', '#fff76a'), fonts: { serif: 'Impact, "Arial Narrow", sans-serif' } },
  { palette: 'dracula', mode: 'dark', name: 'Dracula', colors: c('#282a36', '#343746', '#2e303e', '#f8f8f2', '#d6d6d0', '#6272a4', '#44475a', '#3a3d4d', '#ff79c6', '#50fa7b', '#ffffff') },
  { palette: 'nord', mode: 'dark', name: 'Nord', colors: c('#2e3440', '#3b4252', '#353c4a', '#eceff4', '#d8dee9', '#81a1c1', '#4c566a', '#434c5e', '#bf616a', '#a3be8c', '#ffffff') },
  { palette: 'ocean', mode: 'dark', name: 'Deep Sea', colors: c('#031926', '#082a3c', '#06202f', '#d8f3f5', '#9fd3d8', '#5fa0a8', '#124559', '#0d3447', '#ff7f50', '#5ee0c0', '#ffffff') },
  { palette: 'lava', mode: 'dark', name: 'Lava', colors: c('#1a0505', '#2b0a07', '#220706', '#ffe3d0', '#ffb892', '#c5694a', '#5a1a0d', '#431209', '#ff4500', '#ffb300', '#fff0e6') },
  { palette: 'halloween', mode: 'dark', name: 'Halloween', colors: c('#14091f', '#1f0f30', '#190c28', '#ff9d2e', '#d97d12', '#8f5a1f', '#3d1f5c', '#2e174a', '#9b5de5', '#7bd34a', '#ffc470'), fonts: { serif: '"Chiller", "Segoe Script", cursive' } },
  { palette: 'solard', mode: 'dark', name: 'Solar Dark', colors: c('#002b36', '#073642', '#04323d', '#93a1a1', '#839496', '#586e75', '#0f4a58', '#0b3f4b', '#dc322f', '#859900', '#eee8d5') },
  { palette: 'toxic', mode: 'dark', name: 'Toxic', colors: c('#0a0f00', '#141f00', '#0f1700', '#c6ff00', '#9ed100', '#6a8c00', '#2d4000', '#213000', '#ff00c8', '#c6ff00', '#e6ff7a'), fonts: { serif: 'Impact, "Arial Narrow", sans-serif' } },
  { palette: 'vampire', mode: 'dark', name: 'Vampire', colors: c('#12070a', '#1f0c11', '#190a0e', '#f2dede', '#cfa9a9', '#8f6262', '#4a1219', '#380d13', '#d0021b', '#9bbf86', '#ffffff'), fonts: { serif: 'Georgia, "Times New Roman", serif' } },
  { palette: 'blueprint', mode: 'dark', name: 'Blueprint', colors: c('#0b3a82', '#0f4797', '#0d4090', '#e6f0ff', '#bcd4ff', '#86aef0', '#2a62b8', '#2155a5', '#ffd54a', '#9be28a', '#ffffff'), fonts: { serif: '"JetBrains Mono", Consolas, monospace', sans: '"JetBrains Mono", Consolas, monospace' } },
  { palette: 'void', mode: 'dark', name: 'The Void', colors: c('#050505', '#0b0b0b', '#080808', '#e8e8e8', '#9a9a9a', '#5c5c5c', '#1d1d1d', '#141414', '#ffffff', '#9a9a9a', '#ffffff') },

  // ---- designer themes: square, loud, high contrast ----
  { palette: 'brutal', mode: 'light', name: 'Brutalist', colors: c('#ffffff', '#ffe600', '#ffffff', '#000000', '#000000', '#333333', '#000000', '#000000', '#ff3b00', '#009a00', '#000000'), fonts: { serif: '"Arial Black", Impact, sans-serif', sans: 'Arial, Helvetica, sans-serif' } },
  { palette: 'neopop', mode: 'light', name: 'Neo Pop', colors: c('#fff1d6', '#ffc9e3', '#ffffff', '#111111', '#222222', '#555555', '#111111', '#111111', '#ff5c8a', '#00a878', '#000000'), fonts: { serif: '"Trebuchet MS", sans-serif', sans: '"Trebuchet MS", sans-serif' } },
  { palette: 'pixel', mode: 'light', name: 'Pixel Art', colors: c('#fcfcfc', '#bcbcbc', '#ffffff', '#000000', '#3c3c3c', '#6c6c6c', '#000000', '#7c7c7c', '#e40058', '#00a800', '#000000'), fonts: { serif: '"Lucida Console", Consolas, monospace', sans: '"Lucida Console", Consolas, monospace', mono: '"Lucida Console", Consolas, monospace' } },
  { palette: 'sweetie', mode: 'dark', name: 'Pixel Night', colors: c('#1a1c2c', '#333c57', '#262b44', '#f4f4f4', '#94b0c2', '#566c86', '#566c86', '#333c57', '#ef7d57', '#a7f070', '#ffffff'), fonts: { serif: '"Lucida Console", Consolas, monospace', sans: '"Lucida Console", Consolas, monospace', mono: '"Lucida Console", Consolas, monospace' } },
  { palette: 'hidark', mode: 'dark', name: 'High Contrast', colors: c('#000000', '#1a1a1a', '#000000', '#ffffff', '#ffffff', '#dddddd', '#ffffff', '#ffffff', '#ffff00', '#00ff00', '#ffff00') },
  { palette: 'hilight', mode: 'light', name: 'High Contrast Light', colors: c('#ffffff', '#e6e6e6', '#ffffff', '#000000', '#000000', '#222222', '#000000', '#000000', '#0000ff', '#006400', '#0000ff') },
  { palette: 'bauhaus', mode: 'light', name: 'Bauhaus', colors: c('#f4efe1', '#ffd400', '#ffffff', '#111111', '#111111', '#444444', '#111111', '#111111', '#e10600', '#0044cc', '#e10600'), fonts: { serif: '"Century Gothic", "Trebuchet MS", sans-serif', sans: '"Century Gothic", "Trebuchet MS", sans-serif' } },
  { palette: 'mondrian', mode: 'light', name: 'Mondrian', colors: c('#fafafa', '#ffd800', '#ffffff', '#000000', '#000000', '#444444', '#000000', '#000000', '#e10600', '#0033a0', '#0033a0') },
  { palette: 'brutaldark', mode: 'dark', name: 'Brutalist Night', colors: c('#111111', '#2a2a2a', '#111111', '#ffffff', '#ffffff', '#bbbbbb', '#ffffff', '#ffffff', '#ffe600', '#00e676', '#ffe600'), fonts: { serif: '"Arial Black", Impact, sans-serif', sans: 'Arial, Helvetica, sans-serif' } }
]

const SHAPES: Record<string, ThemeDef['shape']> = {
  brutal: 'brutal', neopop: 'brutal', brutaldark: 'brutal', bauhaus: 'brutal', mondrian: 'brutal', toxic: 'brutal',
  pixel: 'pixel', sweetie: 'pixel', gameboy: 'pixel',
  hidark: 'block', hilight: 'block', terminal: 'block', amber: 'block', cyber: 'block', blueprint: 'block', void: 'block', newspaper: 'block',
  win95: 'bevel'
}
for (const t of THEMES) t.shape ??= SHAPES[t.palette]

export const findTheme = (palette: string, mode: string): ThemeDef =>
  THEMES.find((t) => t.palette === palette && t.mode === mode) ?? THEMES.find((t) => t.palette === palette) ?? THEMES[0]
