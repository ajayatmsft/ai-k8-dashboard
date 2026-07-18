/*
 * Tiny event-based toast — showToast() from anywhere, <Toasts /> mounted once
 * in the Shell.
 */
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface Toast { msg: string; kind: 'ok' | 'err' }

export function showToast(msg: string, kind: 'ok' | 'err' = 'ok') {
  window.dispatchEvent(new CustomEvent<Toast>('app-toast', { detail: { msg, kind } }))
}

export function Toasts() {
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onToast = (e: Event) => {
      setToast((e as CustomEvent<Toast>).detail)
      clearTimeout(timer)
      timer = setTimeout(() => setToast(null), 3500)
    }
    window.addEventListener('app-toast', onToast)
    return () => { window.removeEventListener('app-toast', onToast); clearTimeout(timer) }
  }, [])

  if (!toast) return null
  return (
    <div className={cn(
      'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-[13px] shadow-xl',
      toast.kind === 'ok' ? 'border-good/40 bg-surface text-good' : 'border-critical/40 bg-surface text-critical',
    )}>
      {toast.msg}
    </div>
  )
}
