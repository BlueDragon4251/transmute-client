import { extension } from './common'
import { attribute as attr, blockText, child, colorValue, elements, embeddedImage, lengthPoints, namespaces as ns, packageEntries, packageXml, relationships, localPart, type TextStyle, type ParagraphBlock, type DocumentBlock, type RichDocument, type TableCellModel } from './officeModel'

const boolean = (e: Element | undefined) => e ? !['0','false','off','none'].includes(attr(e,ns.w,'val')) : undefined
const align = (s: string): ParagraphBlock['align'] => ['center','right','justify'].includes(s) ? s as ParagraphBlock['align'] : s==='both' ? 'justify' : 'left'
function wordStyle(properties: Element | undefined): TextStyle {
  const style: TextStyle={}
  for(const [tag,key] of [['b','bold'],['i','italic'],['u','underline']] as const) {const value=boolean(child(properties,ns.w,tag));if(value!==undefined)style[key]=value}
  const color=colorValue(attr(child(properties,ns.w,'color'),ns.w,'val'));if(color)style.color=color
  const size=Number(attr(child(properties,ns.w,'sz'),ns.w,'val'))/2;if(size>0 && size<=200)style.size=size
  return style
}
export async function readRichDocument(file: File): Promise<RichDocument> {
  const {entries,flat}=await packageEntries(file)
  const model: RichDocument={blocks:[],width:595.28,height:841.89,margin:50,warnings:[]}
  const warn=(message:string)=>{if(!model.warnings.includes(message))model.warnings.push(message)}
  if(extension(file.name)==='docx') {
    const xml=packageXml(entries,'word/document.xml'), rels=relationships(entries,'word/document.xml')
    const styles=entries['word/styles.xml'] ? packageXml(entries,'word/styles.xml') : undefined
    const map=new Map(elements(styles || xml,ns.w,'style').map(s=>[attr(s,ns.w,'styleId'),s]))
    const defaultRun=wordStyle(styles ? elements(styles,ns.w,'rPrDefault')[0]?.firstElementChild || undefined : undefined)
    function inherited(id:string,seen=new Set<string>()): TextStyle {
      if(!id||seen.has(id))return {};seen.add(id);const s=map.get(id)
      return {...inherited(attr(child(s,ns.w,'basedOn'),ns.w,'val'),seen),...wordStyle(child(s,ns.w,'rPr'))}
    }
    const section=elements(xml,ns.w,'sectPr').slice(-1)[0], size=child(section,ns.w,'pgSz'), margin=child(section,ns.w,'pgMar')
    model.width=Number(attr(size,ns.w,'w'))/20||model.width;model.height=Number(attr(size,ns.w,'h'))/20||model.height
    model.margin=Number(attr(margin,ns.w,'left'))/20||model.margin
    const numbering=entries['word/numbering.xml']?packageXml(entries,'word/numbering.xml'):undefined
    const counts=new Map<string,number>()
    function listPrefix(pPr:Element|undefined):string {
      const n=child(pPr,ns.w,'numPr');if(!n)return ''
      const id=attr(child(n,ns.w,'numId'),ns.w,'val'),level=attr(child(n,ns.w,'ilvl'),ns.w,'val')||'0'
      const num=numbering && elements(numbering,ns.w,'num').find(e=>attr(e,ns.w,'numId')===id)
      const abstractId=attr(child(num||undefined,ns.w,'abstractNumId'),ns.w,'val')
      const definition=numbering && elements(numbering,ns.w,'abstractNum').find(e=>attr(e,ns.w,'abstractNumId')===abstractId)
      const lvl=definition && elements(definition,ns.w,'lvl').find(e=>attr(e,ns.w,'ilvl')===level)
      if(attr(child(lvl||undefined,ns.w,'numFmt'),ns.w,'val')==='bullet')return '• '
      const key=id+':'+level,value=(counts.get(key) ?? Number(attr(child(lvl||undefined,ns.w,'start'),ns.w,'val') || '1')-1)+1;counts.set(key,value)
      return value+'. '
    }
    async function parseBlocks(parent:Element,depth=0):Promise<DocumentBlock[]> {
      if(depth>12)throw Error('Office-Tabellen zu tief verschachtelt')
      const blocks:DocumentBlock[]=[]
      for(const e of Array.from(parent.children)) {
        if(e.namespaceURI!==ns.w)continue
        if(e.localName==='p') {
          const props=child(e,ns.w,'pPr'),styleId=attr(child(props,ns.w,'pStyle'),ns.w,'val')
          const heading=/^Heading([1-6])$/i.exec(styleId), paragraph:ParagraphBlock={kind:'paragraph',runs:[],align:align(attr(child(props,ns.w,'jc'),ns.w,'val')),heading:heading?Number(heading[1]):undefined,pageBreak:boolean(child(props,ns.w,'pageBreakBefore'))}
          const prefix=listPrefix(props);if(prefix)paragraph.runs.push({text:prefix})
          const base={...defaultRun,...inherited(styleId)}
          const images:DocumentBlock[]=[]
          for(const run of elements(e,ns.w,'r')) {
            const rPr=child(run,ns.w,'rPr'),style={...base,...inherited(attr(child(rPr,ns.w,'rStyle'),ns.w,'val')),...wordStyle(rPr)}
            let text=''
            for(const part of Array.from(run.children)) {
              if(part.localName==='t')text+=part.textContent||''
              else if(part.localName==='tab')text+='\t'
              else if(part.localName==='br'||part.localName==='cr') {if(attr(part,ns.w,'type')==='page')paragraph.pageBreak=true;else text+='\n'}
            }
            if(text)paragraph.runs.push({...style,text})
            for(const blip of elements(run,ns.a,'blip')) {
              const id=attr(blip,ns.r,'embed'),target=rels.get(id)
              if(!target)throw Error('Externes oder fehlendes DOCX-Bild wird abgelehnt')
              const extent=Array.from(run.getElementsByTagName('*')).find(n=>n.localName==='extent')
              const info=Array.from(run.getElementsByTagName('*')).find(n=>n.localName==='docPr')
              images.push(await embeddedImage(entries[target],Number(extent?.getAttribute('cx'))/12700||undefined,Number(extent?.getAttribute('cy'))/12700||undefined,info?.getAttribute('descr')||''))
            }
          }
          if(paragraph.runs.length||!images.length)blocks.push(paragraph)
          blocks.push(...images)
          if(elements(e,ns.w,'hyperlink').length)warn('Hyperlinks werden als Text übernommen; Zielverknüpfungen werden entfernt.')
          if(elements(e,ns.w,'drawing').some(d=>Array.from(d.getElementsByTagName('*')).some(n=>n.localName==='anchor')))warn('Schwebende Bilder werden in den Textfluss übernommen.')
        } else if(e.localName==='tbl') {
          const rows:TableCellModel[][]=[]
          for(const tr of Array.from(e.children).filter(x=>x.localName==='tr')) {
            const row:TableCellModel[]=[]
            for(const tc of Array.from(tr.children).filter(x=>x.localName==='tc')) {
              const properties=child(tc,ns.w,'tcPr'),span=Number(attr(child(properties,ns.w,'gridSpan'),ns.w,'val'))||1
              if(child(properties,ns.w,'vMerge'))warn('Vertikal verbundene Tabellenzellen werden vereinfacht.')
              row.push({blocks:await parseBlocks(tc,depth+1),span:Math.min(span,100),fill:colorValue(attr(child(properties,ns.w,'shd'),ns.w,'fill'))})
            }
            if(row.length)rows.push(row)
          }
          if(rows.length)blocks.push({kind:'table',rows})
        } else if(e.localName==='sdt'||e.localName==='sdtContent') blocks.push(...await parseBlocks(child(e,ns.w,'sdtContent')||e,depth+1))
      }
      return blocks
    }
    const body=elements(xml,ns.w,'body')[0];if(!body)throw Error('DOCX-Dokumentkörper fehlt')
    model.blocks=await parseBlocks(body)
    if(entries['word/header1.xml']||entries['word/footer1.xml'])warn('Kopf-/Fußzeilen werden nicht übernommen.')
    if(entries['word/footnotes.xml']||entries['word/endnotes.xml'])warn('Fuß-/Endnoten werden nicht übernommen.')
    if(elements(xml,ns.w,'pict').length||elements(xml,ns.a,'graphicData').some(e=>!elements(e,ns.a,'blip').length && !Array.from(e.getElementsByTagName('*')).some(n=>n.localName==='blip')))warn('Office-Zeichnungen, Diagramme und Formeln können nicht vollständig übernommen werden.')
  } else {
    const xml=flat||packageXml(entries,'content.xml'), styleXml=entries['styles.xml']?packageXml(entries,'styles.xml'):undefined
    const styleMap=new Map<string,Element>()
    for(const doc of [styleXml,xml])if(doc)for(const s of elements(doc,ns.style,'style'))styleMap.set(attr(s,ns.style,'name'),s)
    function inherited(id:string,seen=new Set<string>()):TextStyle {
      if(!id||seen.has(id))return {};seen.add(id);const s=styleMap.get(id),props=child(s,ns.style,'text-properties')
      const output={...inherited(attr(s,ns.style,'parent-style-name'),seen)}
      const weight=attr(props,ns.fo,'font-weight');if(weight)output.bold=weight==='bold'||Number(weight)>=600
      const italic=attr(props,ns.fo,'font-style');if(italic)output.italic=italic==='italic'
      const underline=attr(props,ns.style,'text-underline-style');if(underline)output.underline=underline!=='none'
      const color=colorValue(attr(props,ns.fo,'color'));if(color)output.color=color
      const size=lengthPoints(attr(props,ns.fo,'font-size'));if(size&&size<=200)output.size=size
      return output
    }
    const layout=styleXml&&elements(styleXml,ns.style,'page-layout-properties')[0]
    model.width=lengthPoints(attr(layout||undefined,ns.fo,'page-width'))||model.width;model.height=lengthPoints(attr(layout||undefined,ns.fo,'page-height'))||model.height;model.margin=lengthPoints(attr(layout||undefined,ns.fo,'margin-left'))||model.margin
    async function parseBlocks(parent:Element,depth=0):Promise<DocumentBlock[]> {
      if(depth>12)throw Error('Office-Struktur zu tief verschachtelt')
      const blocks:DocumentBlock[]=[]
      for(const e of Array.from(parent.children)) {
        if(e.namespaceURI===ns.text && ['p','h'].includes(e.localName)) {
          const styleName=attr(e,ns.text,'style-name'),style=styleMap.get(styleName),props=child(style,ns.style,'paragraph-properties')
          const p:ParagraphBlock={kind:'paragraph',runs:[],align:align(attr(props,ns.fo,'text-align')),heading:e.localName==='h'?Math.min(Number(attr(e,ns.text,'outline-level'))||1,6):undefined,pageBreak:attr(props,ns.fo,'break-before')==='page'}
          const images:DocumentBlock[]=[]
          async function runs(node:Node,base:TextStyle):Promise<void> {
            if(node.nodeType===3){if(node.textContent)p.runs.push({...base,text:node.textContent});return}
            if(node.nodeType!==1)return;const el=node as Element
            if(el.namespaceURI===ns.draw&&el.localName==='frame') {const image=child(el,ns.draw,'image');if(image){let bytes:Uint8Array|undefined;const href=attr(image,ns.xlink,'href');if(href)bytes=entries[localPart('content.xml',href)];else{const binary=elements(image,ns.office,'binary-data')[0]?.textContent?.replace(/\s/g,'');if(binary)bytes=Uint8Array.from(atob(binary),c=>c.charCodeAt(0))}images.push(await embeddedImage(bytes,lengthPoints(attr(el,ns.svg,'width')),lengthPoints(attr(el,ns.svg,'height')),elements(el,ns.svg,'desc')[0]?.textContent||''));}return}
            if(el.namespaceURI===ns.text&&['s','tab','line-break'].includes(el.localName)){p.runs.push({...base,text:el.localName==='s'?' '.repeat(Math.min(Number(attr(el,ns.text,'c'))||1,1000)):el.localName==='tab'?'\t':'\n'});return}
            const style={...base,...inherited(attr(el,ns.text,'style-name'))};for(const c of Array.from(el.childNodes))await runs(c,style)
          }
          for(const node of Array.from(e.childNodes))await runs(node,inherited(styleName))
          if(p.runs.length||!images.length)blocks.push(p);blocks.push(...images)
        } else if(e.namespaceURI===ns.table&&e.localName==='table') {
          const rows:TableCellModel[][]=[]
          for(const tr of elements(e,ns.table,'table-row').filter(r=>{let p=r.parentElement;while(p&&p!==e){if(p.namespaceURI===ns.table&&p.localName==='table')return false;p=p.parentElement}return p===e})) {
            const row:TableCellModel[]=[]
            for(const tc of Array.from(tr.children).filter(c=>c.localName==='table-cell')) {
              const cells=Math.min(Number(attr(tc,ns.table,'number-columns-repeated'))||1,100),span=Math.min(Number(attr(tc,ns.table,'number-columns-spanned'))||1,100)
              if(attr(tc,ns.table,'number-rows-spanned'))warn('Vertikal verbundene Tabellenzellen werden vereinfacht.')
              const properties=child(styleMap.get(attr(tc,ns.table,'style-name')),ns.style,'table-cell-properties')
              const cell:TableCellModel={blocks:await parseBlocks(tc,depth+1),span,fill:colorValue(attr(properties,ns.fo,'background-color'))};for(let i=0;i<cells;i++)row.push(cell)
            }
            const repeat=Math.min(Number(attr(tr,ns.table,'number-rows-repeated'))||1,1000);for(let i=0;i<repeat;i++)if(row.length)rows.push(row)
          }
          if(rows.length)blocks.push({kind:'table',rows})
        } else if(e.namespaceURI===ns.text && ['section','list','list-item'].includes(e.localName)) {
          const children=await parseBlocks(e,depth+1)
          if(e.localName==='list-item'){const p=children.find(b=>b.kind==='paragraph');if(p?.kind==='paragraph')p.runs.unshift({text:'• '});warn('Listen werden mit sichtbaren Markierungen übernommen; komplexe Nummerierung wird vereinfacht.')}
          blocks.push(...children)
        }
      }
      return blocks
    }
    const body=elements(xml,ns.office,'text')[0];if(!body)throw Error('ODT-Dokumentkörper fehlt')
    model.blocks=await parseBlocks(body)
    if(elements(xml,ns.draw,'object').length)warn('Eingebettete Office-Objekte werden nicht übernommen.')
  }
  if(!model.blocks.length)throw Error('Kein unterstützter Office-Inhalt vorhanden')
  if(model.width<100||model.height<100||model.width>2000||model.height>2000)throw Error('Office-Seitenformat außerhalb unterstützter Grenzen')
  model.margin=Math.max(10,Math.min(model.margin,model.width/4))
  // Force traversal now so malformed deeply nested models fail before export.
  blockText(model.blocks)
  return model
}
