import { extension, parseXml } from './common'
export async function validateImageSource(file: File): Promise<void> {
  if (extension(file.name) !== 'svg') return
  const doc = parseXml(await file.text())
  if (doc.documentElement.localName !== 'svg') throw Error('Ungültiges SVG')
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    if (['script','foreignobject','iframe','object','style'].includes(element.localName.toLowerCase())) throw Error('Aktiver SVG-Inhalt wird abgelehnt')
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase(), value = attr.value.trim()
      if (name.startsWith('on')) throw Error('Aktiver SVG-Inhalt wird abgelehnt')
      if (['href','src'].includes(name) && value && !value.startsWith('#') && !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) throw Error('Externe SVG-Ressource wird abgelehnt')
      for (const match of value.matchAll(/url\(([^)]*)\)/gi)) {
        if (!match[1].trim().replace(/^['"]|['"]$/g,'').startsWith('#')) throw Error('Externe SVG-Ressource wird abgelehnt')
      }
      if (/@import/i.test(value)) throw Error('Externe SVG-Ressource wird abgelehnt')
    }
  }
}
