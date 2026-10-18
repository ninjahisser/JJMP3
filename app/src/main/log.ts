import { appendFileSync } from 'node:fs'
import { LOG_FILE } from './paths'

export function log(...parts: unknown[]): void {
  const line = parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()}  ${line}\n`)
  } catch {
    // logging must never take the app down
  }
}
