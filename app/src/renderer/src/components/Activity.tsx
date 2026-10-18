import type { Job } from '@shared/types'
import { useStore } from '../store'

const BUSY: Record<string, string> = {
  resolving: 'Reading link', queued: 'Waiting', matching: 'Finding audio',
  downloading: 'Downloading', converting: 'Converting', artwork: 'Making artwork'
}

interface Now {
  label: string
  name: string
  progress: number | null // null = no measurable progress yet
  more: string
}

/** What the app is busy with right now: imports first, then uploads to the player, then tool downloads. */
function useNow(): Now | null {
  const { jobs, tracks, tools } = useStore((s) => s.snap)
  const active = jobs.filter((j: Job) => j.state in BUSY)
  const sending = tracks.filter((t) => t.uploading != null)
  const queued = tracks.filter((t) => !t.onDevice && !t.deviceOnly && t.uploading == null).length
  if (active.length) {
    const j = active.find((x) => x.state !== 'queued') || active[0]
    const measurable = ['downloading', 'converting', 'artwork'].includes(j.state)
    const rest = active.length - 1
    return { label: BUSY[j.state], name: j.title, progress: measurable ? j.progress : null, more: rest ? `${rest} more waiting` : '' }
  }
  if (sending.length) {
    const t = sending[0]
    return { label: 'Sending to player', name: t.title, progress: t.uploading ?? 0, more: queued ? `${queued} more after this` : '' }
  }
  if (tools.busy) return { label: 'Setting up', name: tools.busy, progress: null, more: '' }
  return null
}

export function TopProgress() {
  const now = useNow()
  if (!now) return null
  return <div className={`top-progress ${now.progress == null ? 'indeterminate' : ''}`} style={{ width: `${Math.round((now.progress ?? 0) * 100)}%` }} />
}

export function Activity() {
  const now = useNow()
  if (!now) return null
  const pct = now.progress == null ? null : Math.round(now.progress * 100)
  return (
    <div className="activity">
      <div className="what">
        <span>{now.label}</span>
        {pct != null && <span className="mono">{pct}%</span>}
      </div>
      <div className="name">{now.name}</div>
      <div className={`line ${pct == null ? 'indeterminate' : ''}`}>
        <i style={pct == null ? undefined : { width: `${pct}%` }} />
      </div>
      {now.more && <div className="more">{now.more}</div>}
    </div>
  )
}