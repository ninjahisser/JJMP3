import { useEffect } from 'react'
import { DialogHost, MenuHost, Toasts } from './components/ui'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { TopProgress } from './components/Activity'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Library } from './pages/Library'
import { Playlists, PlaylistPage } from './pages/Playlists'
import { Player } from './pages/Player'
import { Games } from './pages/Games'
import { Settings } from './pages/Settings'
import { Karaoke } from './pages/Karaoke'
import { Spotify } from './pages/Spotify'
import { HeartBurst } from './components/HeartBurst'
import { useStore } from './store'
import { controls, useNowPlaying } from './playback'

export function App() {
  const page = useStore((s) => s.page)
  const playing = useNowPlaying().playing

  // taskbar thumbnail buttons act on whatever is playing; keep their play/pause icon in step
  useEffect(() => {
    void window.jjmp3.invoke('media:state', playing).catch(() => {})
  }, [playing])
  useEffect(() => {
    const onMedia = (e: Event) => {
      const a = (e as CustomEvent<string>).detail
      if (a === 'toggle') controls.toggle()
      if (a === 'next') controls.next()
      if (a === 'prev') controls.prev()
    }
    window.addEventListener('jjmp3-media', onMedia)
    return () => window.removeEventListener('jjmp3-media', onMedia)
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable], dialog')) return
      if (e.code === 'Space') {
        e.preventDefault()
        controls.toggle()
      }
      if (e.shiftKey && e.key === 'ArrowRight') controls.next()
      if (e.shiftKey && e.key === 'ArrowLeft') controls.prev()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  return (
    <>
      <div className="drag" />
      <TopProgress />
      <div className="app">
        <Sidebar />
        <main>
          <div className="page" key={page.name === 'playlist' ? page.id : page.name}>
            <ErrorBoundary onReset={() => useStore.getState().go({ name: 'library' })}>
              {page.name === 'library' && <Library />}
              {page.name === 'playlists' && <Playlists />}
              {page.name === 'playlist' && <PlaylistPage id={page.id} />}
              {page.name === 'games' && <Games />}
              {page.name === 'settings' && <Settings />}
              {page.name === 'karaoke' && <Karaoke />}
              {page.name === 'spotify' && <Spotify />}
              {page.name === 'player' && <Player />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <PlayerBar />
      <MenuHost />
      <ErrorBoundary onReset={() => useStore.getState().closeDialog()}>
        <DialogHost />
      </ErrorBoundary>
      <Toasts />
      <HeartBurst />
    </>
  )
}