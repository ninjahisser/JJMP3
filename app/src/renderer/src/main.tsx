import { createRoot } from 'react-dom/client'
import { App } from './App'
import { boot } from './store'
import './styles.css'

// Fonts are bundled; wait for the display face so titles never flash in a fallback
const fonts = Promise.all([
  document.fonts.load("400 64px 'Instrument Serif'"),
  document.fonts.load("italic 400 38px 'Instrument Serif'"),
  document.fonts.load("400 14px 'Inter'")
]).catch(() => [])

Promise.all([boot(), fonts]).then(() => createRoot(document.getElementById('root')!).render(<App />))