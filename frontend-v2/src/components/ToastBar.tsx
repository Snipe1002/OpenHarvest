/**
 * ToastBar — top-right transient error message bar. Shows whatever is in
 * `useGarden().toast` and auto-clears after 4 seconds.
 *
 * Lives outside `<Viewer>` (plain DOM, no R3F). One per app.
 */
import { useEffect } from 'react'
import { useGarden } from '../store/garden'

export default function ToastBar() {
  const toast = useGarden((s) => s.toast)
  const setToast = useGarden((s) => s.setToast)

  useEffect(() => {
    if (!toast) return
    const handle = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(handle)
  }, [toast, setToast])

  if (!toast) return null

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        zIndex: 12,
        padding: '8px 12px',
        background: '#3a1a1a',
        border: '1px solid #6a2a2a',
        borderRadius: 4,
        color: '#f5b5b5',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        maxWidth: 320,
      }}
      role="alert"
    >
      {toast}
    </div>
  )
}
