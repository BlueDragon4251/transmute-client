import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../ThemeContext'
import { api } from '../utils/api'
import { BUILTIN_THEMES } from '../utils/themeRegistry'
export default function ClientSettings() {
  const { t } = useTranslation()
  const {theme,setTheme,customThemes} = useTheme()
  const [status,setStatus] = useState(''),[busy,setBusy] = useState(false)
  async function save(value: string) {
    setBusy(true);setStatus('')
    try {await api.json('/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:value})});setTheme(value);setStatus('Gespeichert')}
    catch(e) {setStatus(e instanceof Error?e.message:'Speichern fehlgeschlagen')}
    finally {setBusy(false)}
  }
  return <div className="mx-auto max-w-3xl p-8 text-text"><h1 className="text-3xl font-bold">{t('menu.settings')}</h1><div className="mt-6 rounded-2xl border border-surface-light bg-surface-dark p-6"><label htmlFor="client-theme" className="block font-semibold">Oberfläche</label><select id="client-theme" disabled={busy} value={theme} onChange={e=>save(e.target.value)} className="mt-3 w-full rounded-xl bg-surface-light p-3">{[...BUILTIN_THEMES.map(t=>({key:t.key,name:t.label})),...customThemes].map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</select><p role="status" className="mt-3 text-sm text-text-muted">{status}</p></div><p className="mt-6 leading-relaxed text-text-muted">Das Theme wird pro Benutzer auf dem Server gespeichert. Quelldateien, Ergebnisse und Konvertierungsverlauf bleiben im Browser-Tab. Die Konvertierungsoptionen werden direkt im Workspace gewählt.</p></div>
}
