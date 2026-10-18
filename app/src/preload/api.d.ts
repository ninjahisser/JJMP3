import type { Jjmp3Api } from './index'

declare global {
  interface Window {
    jjmp3: Jjmp3Api
  }
}