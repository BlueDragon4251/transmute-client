import { useTranslation } from 'react-i18next'
export default function Footer() {
  const { t } = useTranslation()
  return <footer className="border-t border-surface-light px-4 py-3 text-center text-xs text-text-muted"><span>{t('app.name')} · Client Only</span><span className="mx-3">·</span><a href="https://github.com/BlueDragon4251/transmute-client" target="_blank" rel="noopener noreferrer" className="hover:text-text" aria-label="GitHub">Source</a></footer>
}
