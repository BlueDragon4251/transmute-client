import { zipSync, strToU8 } from 'fflate'
import { Document as WordDocument, Paragraph, Packer, TextRun } from 'docx'
import pptxgen from 'pptxgenjs'
import * as XLSX from 'xlsx'
import { readZip } from './archives'
import { checkpoint, extension, parseXml, result, xmlEscape, type ConversionOptions, type Result } from './common'
import { textPdf } from './pdf'

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const PRESENT = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'
import { sheetInputs, documentInputs, slideInputs } from './capabilities'
const decoder = new TextDecoder()
const nodes = (doc: Document | Element, ns: string, tag: string) => Array.from(doc.getElementsByTagNameNS(ns, tag))
function odfText(element: Element): string {
  let text = ''
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) text += node.nodeValue || ''
    else if (node.nodeType === 1) {
      const e = node as Element
      if (e.localName === 's') text += ' '.repeat(Math.min(Number(e.getAttributeNS(TEXT, 'c') || 1), 1000))
      else if (e.localName === 'tab') text += '\t'
      else if (e.localName === 'line-break') text += '\n'
      else text += odfText(e)
    }
  }
  return text
}
export async function readOfficeText(file: File): Promise<string[][]> {
  const from = extension(file.name)
  let entries: Record<string, Uint8Array> = {}
  if (!from.startsWith('fo')) entries = readZip(new Uint8Array(await file.arrayBuffer()))
  const xml = (name: string) => {
    if (!entries[name]) throw Error(`Office-Struktur fehlt: ${name}`)
    return parseXml(decoder.decode(entries[name]))
  }
  if (from === 'docx') return [nodes(xml('word/document.xml'), WORD, 'p').map(p => nodes(p, WORD, 't').map(t => t.textContent || '').join(''))]
  if (from === 'pptx') {
    // Relationship order is authoritative; slide file numbers need not match display order.
    const presentation = xml('ppt/presentation.xml'), rels = xml('ppt/_rels/presentation.xml.rels')
    const targets = new Map(Array.from(rels.getElementsByTagName('Relationship')).map(r => [r.getAttribute('Id'), r.getAttribute('Target')]))
    const slides = Array.from(presentation.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId'))
    return slides.map(s => {
      const target = targets.get(s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))
      if (!target || !/^slides\/slide\d+\.xml$/.test(target)) throw Error('Externe/ungewöhnliche Folienbeziehung wird abgelehnt')
      return nodes(xml('ppt/' + target), DRAW, 'p').map(p => nodes(p, DRAW, 't').map(t => t.textContent || '').join(''))
    })
  }
  const doc = from.startsWith('fo') ? parseXml(await file.text()) : xml('content.xml')
  if (slideInputs.includes(from)) return nodes(doc, 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'page').map(p => nodes(p, TEXT, 'p').map(odfText))
  return [Array.from(doc.getElementsByTagName('*')).filter(e => e.namespaceURI === TEXT && ['p', 'h'].includes(e.localName)).map(odfText)]
}

function odf(groups: string[][], presentation: boolean): Result {
  const kind = presentation ? 'presentation' : 'text'
  const paragraphs = (items: string[]) => items.map(p => `<text:p>${xmlEscape(p).replace(/\n/g, '<text:line-break/>').replace(/\t/g, '<text:tab/>').replace(/ {2,}/g, m => `<text:s text:c="${m.length}"/>`)}</text:p>`).join('')
  const body = presentation ? groups.map((items, i) => `<draw:page draw:name="Slide ${i + 1}" draw:style-name="dp1" draw:master-page-name="Default"><draw:frame svg:x="1cm" svg:y="1cm" svg:width="24cm" svg:height="17cm" presentation:class="outline"><draw:text-box>${paragraphs(items)}</draw:text-box></draw:frame></draw:page>`).join('') : paragraphs(groups.flat())
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="${TEXT}" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="${PRESENT}" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.2"><office:automatic-styles><style:style style:name="dp1" style:family="drawing-page"/></office:automatic-styles><office:body><office:${kind}>${body}</office:${kind}></office:body></office:document-content>`
  const mimetype = `application/vnd.oasis.opendocument.${kind}`
  const styles = `<?xml version="1.0"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="21cm" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`
  const manifest = `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`
  return result(zipSync({ mimetype: [strToU8(mimetype), { level: 0 }], 'content.xml': strToU8(content), 'styles.xml': strToU8(styles), 'META-INF/manifest.xml': strToU8(manifest) }), presentation ? 'odp' : 'odt', mimetype)
}

export async function officeConvert(file: File, to: string, options: ConversionOptions = {}): Promise<Result> {
  const from = extension(file.name)
  checkpoint(options, 10, 'Office-Datei lokal lesen')
  if (sheetInputs.includes(from) || ['csv', 'tsv'].includes(from) && ['xlsx', 'ods', 'xls', 'html', 'pdf'].includes(to)) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, WTF: false })
    if (!workbook.SheetNames.length) throw Error('Keine Tabellenblätter vorhanden')
    if (to === 'xls' && Object.values(workbook.Sheets).some(sheet => Object.entries(sheet).some(([key, cell]) => !key.startsWith('!') && cell && cell.f))) throw Error('XLS-Ausgabe kann Formeln nicht erhalten. XLSX oder ODS auswählen.')
    if (['xlsx', 'ods', 'xls'].includes(to)) return result(XLSX.write(workbook, { bookType: to as XLSX.BookType, type: 'array', compression: true }) as ArrayBuffer, to)
    const sheets = workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }) as unknown[][] }))
    if (to === 'json') return result(JSON.stringify(sheets, null, 2), 'json', 'application/json')
    if (to === 'html') return result('<!doctype html><meta charset="utf-8">' + sheets.map(s => `<h2>${xmlEscape(s.name)}</h2><table>${s.rows.map(r => '<tr>' + r.map(v => `<td>${xmlEscape(String(v))}</td>`).join('') + '</tr>').join('')}</table>`).join(''), 'html', 'text/html')
    if (to === 'pdf') return textPdf(sheets.map(s => s.name + '\n' + s.rows.map(r => r.join(' | ')).join('\n')).join('\n\n'), options)
    return result(to === 'txt' ? sheets.map(s => s.name + '\n' + s.rows.map(r => r.join('\t')).join('\n')).join('\n\n') : XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]], { FS: to === 'tsv' ? '\t' : ',' }), to, 'text/plain;charset=utf-8')
  }
  let groups: string[][]
  if (documentInputs.includes(from) || slideInputs.includes(from)) groups = await readOfficeText(file)
  else if (from === 'html') {
    // XML parser never activates HTML or loads resources. Text-only import.
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html')
    doc.querySelectorAll('script,style,iframe,object').forEach(e => e.remove())
    groups = [(doc.body.textContent || '').split('\n')]
  } else groups = [(await file.text()).replace(/\r/g, '').split('\n')]
  if (!groups.length || !groups.some(g => g.some(Boolean))) throw Error('Kein lesbarer Office-Text vorhanden')
  checkpoint(options, 60, 'Inhalt neu setzen')
  const text = groups.map(g => g.join('\n')).join('\n\n')
  if (to === 'txt') return result(text, 'txt', 'text/plain;charset=utf-8')
  if (to === 'html') return result('<!doctype html><meta charset="utf-8">' + groups.map(g => '<section>' + g.map(p => `<p>${xmlEscape(p)}</p>`).join('') + '</section>').join(''), 'html', 'text/html')
  if (to === 'pdf') return textPdf(text, options)
  if (to === 'odt' || to === 'odp') return odf(groups, to === 'odp')
  if (to === 'docx') return { blob: await Packer.toBlob(new WordDocument({ sections: [{ children: groups.flat().map(p => new Paragraph({ children: [new TextRun(p)] })) }] })), extension: 'docx' }
  if (to === 'pptx') {
    const deck = new pptxgen(); deck.layout = 'LAYOUT_WIDE'
    for (const group of groups) {
      // Split long content into several readable slides instead of silently clipping.
      const lines = group.flatMap(s => s.match(/.{1,90}/gu) || [''])
      for (let i = 0; i < lines.length; i += 15) deck.addSlide().addText(lines.slice(i, i + 15).join('\n'), { x: 0.5, y: 0.5, w: 12.3, h: 6.5, fontSize: 20, breakLine: false })
    }
    return { blob: await deck.write({ outputType: 'blob' }) as Blob, extension: 'pptx' }
  }
  throw Error('Nicht unterstütztes Office-Ziel')
}
