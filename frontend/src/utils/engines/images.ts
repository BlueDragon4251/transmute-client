import { extension, parseXml } from './common'
export async function validateImageSource(file: File): Promise<void> {
  if (extension(file.name) !== 'svg') return
  const doc = parseXml(await file.text())
  if (doc.documentElement.localName !== 'svg') throw Error('Ungültiges SVG')
  const nodes = doc.createTreeWalker(doc, 64) // PROCESSING_INSTRUCTION
  if (nodes.nextNode()) throw Error('SVG-Verarbeitungsanweisungen werden abgelehnt')
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    if (['script','foreignobject','iframe','object','style','animate','animatemotion','animatetransform','set'].includes(element.localName.toLowerCase())) throw Error('Aktiver SVG-Inhalt wird abgelehnt')
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase(), value = attr.value.trim()
      // Reject CSS obfuscation and resource functions before any image decoder.
      if (/\\|\/\*|\*\//.test(value) || /(?:image-set|cross-fade|paint|expression)\s*\(/i.test(value)) throw Error('Aktive oder verschleierte SVG-Ressource wird abgelehnt')
      if (name === 'base' && attr.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && value) throw Error('Externe SVG-Ressource wird abgelehnt')
      if (name.startsWith('on')) throw Error('Aktiver SVG-Inhalt wird abgelehnt')
      if (['href','src'].includes(name) && value && !value.startsWith('#') && !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) throw Error('Externe SVG-Ressource wird abgelehnt')
      for (const match of value.matchAll(/url\(([^)]*)\)/gi)) {
        if (!match[1].trim().replace(/^['"]|['"]$/g,'').startsWith('#')) throw Error('Externe SVG-Ressource wird abgelehnt')
      }
      if (/@import/i.test(value)) throw Error('Externe SVG-Ressource wird abgelehnt')
    }
  }
}

/** Blob URLs are local and revoked; SVG is validated before the decoder sees it. */
export async function loadLocalImage(file:File):Promise<{source:CanvasImageSource;width:number;height:number;close:()=>void}> {
  await validateImageSource(file)
  if(extension(file.name)!=='svg') {
    const bitmap=await createImageBitmap(file)
    return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()}
  }
  const url=URL.createObjectURL(file),image=new Image()
  try {image.src=url;await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw Error('SVG benötigt gültige Abmessungen');return {source:image,width:image.naturalWidth,height:image.naturalHeight,close:()=>URL.revokeObjectURL(url)}}catch(error){URL.revokeObjectURL(url);throw error}
}
