// Tells you when a newer version of the app has been downloaded, and checks for one whenever you come back to the app.
import { useEffect, useState } from 'react'

export function UpdateBanner() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    // A first install also "changes" the controller; only a swap from an older version counts as an update.
    let had = !!sw.controller
    const onChange = () => { if (had) setReady(true); had = true }
    sw.addEventListener('controllerchange', onChange)
    const check = () => { if (document.visibilityState === 'visible') sw.getRegistration().then(r => r?.update()).catch(() => {}) }
    check()
    document.addEventListener('visibilitychange', check)
    const t = window.setInterval(check, 30 * 60 * 1000)
    return () => { sw.removeEventListener('controllerchange', onChange); document.removeEventListener('visibilitychange', check); window.clearInterval(t) }
  }, [])
  if (!ready) return null
  return (
    <div className="update-banner" role="status">
      <span>A new version is ready.</span>
      <button className="primary-btn small" onClick={() => location.reload()}>Reload</button>
      <button className="icon-btn small" aria-label="Dismiss" onClick={() => setReady(false)} style={{ marginLeft: 0 }}>×</button>
    </div>
  )
}
