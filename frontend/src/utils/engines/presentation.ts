import pptxgen from 'pptxgenjs'
import { zipSync,strToU8 } from 'fflate'
import { PDFDocument,rgb,degrees } from 'pdf-lib'
import { checkpoint,extension,result,xmlEscape,type ConversionOptions,type Result } from './common'
import { attribute as attr,child,positiveCount,boundedTableRows,colorValue,dataUri,elements,embeddedImage,lengthPoints,localPart,namespaces as ns,packageEntries,packageXml,relationships,type EmbeddedImage,type ParagraphBlock,type TextPiece,type TableBlock } from './officeModel'
import { richDocumentPdf } from './richPdf'
const P='http://schemas.openxmlformats.org/presentationml/2006/main',PRESENT='urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'
type Box={x:number;y:number;width:number;height:number;rotation?:number;flipV?:boolean}
type Shape=Box & ({kind:'text';paragraphs:ParagraphBlock[];fill?:string}|{kind:'image';image:EmbeddedImage}|{kind:'table';table:TableBlock}|{kind:'shape';shape:'rect'|'ellipse'|'line';fill?:string;line?:string})
type Slide={shapes:Shape[];background?:string}
export type RichPresentation={width:number;height:number;slides:Slide[];warnings:string[]}
const align=(value:string):ParagraphBlock['align']=>value==='ctr'||value==='center'?'center':value==='r'||value==='right'?'right':value==='just'||value==='justify'?'justify':'left'
export async function readRichPresentation(file:File,options:ConversionOptions={}):Promise<RichPresentation>{
 const {entries,flat}=await packageEntries(file),model:RichPresentation={width:960,height:540,slides:[],warnings:[]}
 const warn=(text:string)=>{if(!model.warnings.includes(text))model.warnings.push(text)}
 if(extension(file.name)==='pptx'){
  const presentation=packageXml(entries,'ppt/presentation.xml'),size=elements(presentation,P,'sldSz')[0]
  model.width=Number(size?.getAttribute('cx'))/12700||960;model.height=Number(size?.getAttribute('cy'))/12700||540
  const rels=relationships(entries,'ppt/presentation.xml'),theme=entries['ppt/theme/theme1.xml']?packageXml(entries,'ppt/theme/theme1.xml'):undefined,colors=new Map<string,string>()
  for(const c of theme?elements(theme,ns.a,'clrScheme')[0]?.children||[]:[]) {const first=c.firstElementChild,value=colorValue(first?.getAttribute('val')||first?.getAttribute('lastClr')||'');if(value)colors.set(c.localName,value)}
  function fill(element:Element|undefined):string|undefined {if(!element)return undefined;const rgb=elements(element,ns.a,'srgbClr')[0];if(rgb)return colorValue(rgb.getAttribute('val')||'');const scheme=elements(element,ns.a,'schemeClr')[0];return scheme?colors.get(scheme.getAttribute('val')||''):undefined}
  function box(shape:Element,layout?:Document):Box{
   let transform:Element|undefined=elements(shape,ns.a,'xfrm')[0]
   if(!transform){const placeholder=elements(shape,P,'ph')[0],id=placeholder?.getAttribute('idx')||'',type=placeholder?.getAttribute('type')||''
    const fallback=layout&&elements(layout,P,'sp').find(s=>{const p=elements(s,P,'ph')[0];return p&&(p.getAttribute('idx')||'')===id&&(p.getAttribute('type')||'')===type});transform=fallback?elements(fallback,ns.a,'xfrm')[0]:undefined
   }
   const off=child(transform,ns.a,'off'),extent=child(transform,ns.a,'ext')
   return {x:Number(off?.getAttribute('x'))/12700||0,y:Number(off?.getAttribute('y'))/12700||0,width:extent?.hasAttribute('cx')?Number(extent.getAttribute('cx'))/12700:model.width,height:extent?.hasAttribute('cy')?Number(extent.getAttribute('cy'))/12700:model.height,rotation:Number(transform?.getAttribute('rot'))/60000||0,flipV:(transform?.getAttribute('flipV')==='1')!==(transform?.getAttribute('flipH')==='1')}
  }
  function paragraphs(parent:Element):ParagraphBlock[]{
   return elements(parent,ns.a,'p').map(p=>{
    const props=child(p,ns.a,'pPr'),defaults=child(props,ns.a,'defRPr'),runs:TextPiece[]=[]
    const base={bold:defaults?.getAttribute('b')==='1',italic:defaults?.getAttribute('i')==='1',underline:!!defaults?.getAttribute('u')&&defaults.getAttribute('u')!=='none',size:Number(defaults?.getAttribute('sz'))/100||18,color:fill(defaults)}
    if(child(props,ns.a,'buChar'))runs.push({text:child(props,ns.a,'buChar')?.getAttribute('char')+' ',...base})
    if(child(props,ns.a,'buAutoNum')){runs.push({text:'• ',...base});warn('Automatische Foliennummerierung wird mit Markierungen vereinfacht.')}
    for(const run of Array.from(p.children)){
     if(run.localName==='br'){runs.push({text:'\n',...base});continue}
     if(!['r','fld'].includes(run.localName))continue
     const r=child(run,ns.a,'rPr'),text=elements(run,ns.a,'t').map(t=>t.textContent||'').join('')
     runs.push({...base,text,bold:r?.hasAttribute('b')?r.getAttribute('b')==='1':base.bold,italic:r?.hasAttribute('i')?r.getAttribute('i')==='1':base.italic,underline:r?.hasAttribute('u')?r.getAttribute('u')!=='none':base.underline,size:Number(r?.getAttribute('sz'))/100||base.size,color:fill(r)||base.color})
    }
    return {kind:'paragraph',runs,align:align(props?.getAttribute('algn')||'')}
   })
  }
  const ids=elements(presentation,P,'sldId')
  for(const [index,id] of ids.entries()){
   checkpoint(options,10+index/Math.max(ids.length,1)*35,'Folien lokal lesen')
   const path=rels.get(attr(id,ns.r,'id'));if(!path||!entries[path])throw Error('PPTX-Folienbeziehung fehlt')
   const xml=packageXml(entries,path),relations=relationships(entries,path),layoutPath=Array.from(relations.values()).find(v=>v.includes('/slideLayouts/')),layout=layoutPath&&entries[layoutPath]?packageXml(entries,layoutPath):undefined
   const slide:Slide={shapes:[],background:fill(elements(xml,P,'bg')[0])},tree=elements(xml,P,'spTree')[0]
   if(!tree)throw Error('PPTX-Folieninhalt fehlt')
   for(const shape of Array.from(tree.children)){
    const bounds=box(shape,layout)
    if(shape.localName==='sp'){
     const properties=child(shape,P,'spPr'),geometry=elements(shape,ns.a,'prstGeom')[0]?.getAttribute('prst')||'rect',text=paragraphs(shape)
     if(text.some(p=>p.runs.length))slide.shapes.push({...bounds,kind:'text',paragraphs:text,fill:fill(child(properties,ns.a,'solidFill'))})
     else if(['rect','ellipse','line'].includes(geometry))slide.shapes.push({...bounds,kind:'shape',shape:geometry as 'rect',fill:fill(child(properties,ns.a,'solidFill')),line:fill(child(properties,ns.a,'ln'))})
     else warn('Nicht unterstützte Office-Formen werden ausgelassen.')
    }else if(shape.localName==='pic'){
     const blip=elements(shape,ns.a,'blip')[0],target=relations.get(attr(blip,ns.r,'embed'))
     if(!target)throw Error('Externes oder fehlendes PPTX-Bild wird abgelehnt')
     if(elements(shape,ns.a,'srcRect').some(e=>Array.from(e.attributes).some(a=>Number(a.value)!==0)))warn('Bildbeschnitt wird vereinfacht; das gesamte Bild wird übernommen.')
     slide.shapes.push({...bounds,kind:'image',image:await embeddedImage(entries[target],bounds.width,bounds.height,elements(shape,P,'cNvPr')[0]?.getAttribute('descr')||'')})
    }else if(shape.localName==='graphicFrame'){
     // Graphic frames use p:xfrm, not a:xfrm.
     const transform=child(shape,P,'xfrm'),off=child(transform,ns.a,'off'),extent=child(transform,ns.a,'ext')
     const frame={x:Number(off?.getAttribute('x'))/12700||0,y:Number(off?.getAttribute('y'))/12700||0,width:Number(extent?.getAttribute('cx'))/12700||bounds.width,height:Number(extent?.getAttribute('cy'))/12700||bounds.height}
     const table=elements(shape,ns.a,'tbl')[0]
     if(table){const rows=elements(table,ns.a,'tr').map(tr=>Array.from(tr.children).filter(e=>e.localName==='tc').map(tc=>({blocks:paragraphs(tc),span:positiveCount(tc.getAttribute('gridSpan')||''),fill:fill(child(tc,ns.a,'tcPr'))})))
      boundedTableRows(rows);slide.shapes.push({...frame,kind:'table',table:{kind:'table',rows}})
     }else warn('Diagramme, SmartArt und eingebettete Office-Objekte werden nicht übernommen.')
    }else if(shape.localName==='grpSp')warn('Gruppierte Folienobjekte werden derzeit nicht übernommen.')
   }
   if(elements(xml,P,'timing').length)warn('Animationen und Übergänge werden nicht übernommen.')
   model.slides.push(slide)
  }
 }else{
  const xml=flat||packageXml(entries,'content.xml'),styleXml=entries['styles.xml']?packageXml(entries,'styles.xml'):undefined,styles=new Map<string,Element>()
  for(const doc of [styleXml,xml])if(doc)for(const s of elements(doc,ns.style,'style'))styles.set(attr(s,ns.style,'name'),s)
  const layout=elements(styleXml||xml,ns.style,'page-layout-properties')[0]
  model.width=lengthPoints(attr(layout||undefined,ns.fo,'page-width'))||960;model.height=lengthPoints(attr(layout||undefined,ns.fo,'page-height'))||540
  function textStyle(name:string,seen=new Set<string>()):Omit<TextPiece,'text'>{
   if(!name||seen.has(name))return {};seen.add(name);const s=styles.get(name),properties=child(s,ns.style,'text-properties')
   const base=textStyle(attr(s,ns.style,'parent-style-name'),seen),color=colorValue(attr(properties,ns.fo,'color')),size=lengthPoints(attr(properties,ns.fo,'font-size'))
   return {...base,...(attr(properties,ns.fo,'font-weight')?{bold:attr(properties,ns.fo,'font-weight')==='bold'}:{}),...(attr(properties,ns.fo,'font-style')?{italic:attr(properties,ns.fo,'font-style')==='italic'}:{}),...(attr(properties,ns.style,'text-underline-style')?{underline:attr(properties,ns.style,'text-underline-style')!=='none'}:{}),...(color?{color}:{}),...(size?{size}:{})}
  }
  function paragraphs(parent:Element):ParagraphBlock[]{return elements(parent,ns.text,'p').map(p=>{
   const name=attr(p,ns.text,'style-name'),props=child(styles.get(name),ns.style,'paragraph-properties'),runs:TextPiece[]=[]
   function walk(node:Node,style:Omit<TextPiece,'text'>){if(node.nodeType===3){if(node.textContent)runs.push({...style,text:node.textContent});return}if(node.nodeType!==1)return;const e=node as Element
    if(e.localName==='line-break'){runs.push({...style,text:'\n'});return}if(e.localName==='s'){runs.push({...style,text:' '.repeat(Math.min(Number(attr(e,ns.text,'c'))||1,1000))});return}if(e.localName==='tab'){runs.push({...style,text:'\t'});return}
    const merged={...style,...textStyle(attr(e,ns.text,'style-name'))};for(const child of Array.from(e.childNodes))walk(child,merged)
   }
   for(const node of Array.from(p.childNodes))walk(node,textStyle(name))
   return {kind:'paragraph',runs,align:align(attr(props,ns.fo,'text-align'))}
  })}
  for(const [index,page] of elements(xml,ns.draw,'page').entries()){
   checkpoint(options,10+index*2,'ODP-Folie lokal lesen');const slide:Slide={shapes:[]}
   const pageStyle=child(styles.get(attr(page,ns.draw,'style-name')),ns.style,'drawing-page-properties');slide.background=colorValue(attr(pageStyle,ns.draw,'fill-color'))
   for(const shape of Array.from(page.children)){
    const bounds:Box={x:lengthPoints(attr(shape,ns.svg,'x'))||0,y:lengthPoints(attr(shape,ns.svg,'y'))||0,width:lengthPoints(attr(shape,ns.svg,'width'))||model.width,height:lengthPoints(attr(shape,ns.svg,'height'))||model.height}
    if(shape.localName==='line'){const x1=lengthPoints(attr(shape,ns.svg,'x1'))||0,y1=lengthPoints(attr(shape,ns.svg,'y1'))||0,x2=lengthPoints(attr(shape,ns.svg,'x2'))||0,y2=lengthPoints(attr(shape,ns.svg,'y2'))||0;Object.assign(bounds,{x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1),flipV:(x2<x1)!==(y2<y1)})}
    if(attr(shape,ns.draw,'transform'))warn('ODP-Transformationen werden vereinfacht.')
    const image=child(shape,ns.draw,'image'),textBox=child(shape,ns.draw,'text-box'),table=elements(shape,ns.table,'table')[0]
    if(image){const href=attr(image,ns.xlink,'href'),binary=elements(image,ns.office,'binary-data')[0]?.textContent?.replace(/\s/g,''),bytes=href?entries[localPart('content.xml',href)]:binary?Uint8Array.from(atob(binary),c=>c.charCodeAt(0)):undefined
     slide.shapes.push({...bounds,kind:'image',image:await embeddedImage(bytes,bounds.width,bounds.height,elements(shape,ns.svg,'desc')[0]?.textContent||'')})
    }else if(table){slide.shapes.push({...bounds,kind:'table',table:{kind:'table',rows:elements(table,ns.table,'table-row').map(tr=>Array.from(tr.children).filter(c=>c.localName==='table-cell').map(tc=>({blocks:paragraphs(tc),span:positiveCount(attr(tc,ns.table,'number-columns-spanned')),fill:colorValue(attr(child(styles.get(attr(tc,ns.table,'style-name')),ns.style,'table-cell-properties'),ns.fo,'background-color'))})))}})
    }else if(textBox){const properties=child(styles.get(attr(shape,ns.draw,'style-name')),ns.style,'graphic-properties');slide.shapes.push({...bounds,kind:'text',paragraphs:paragraphs(textBox),fill:colorValue(attr(properties,ns.draw,'fill-color'))})}
    else if(['rect','ellipse','line'].includes(shape.localName)){const props=child(styles.get(attr(shape,ns.draw,'style-name')),ns.style,'graphic-properties');slide.shapes.push({...bounds,kind:'shape',shape:shape.localName as 'rect',fill:colorValue(attr(props,ns.draw,'fill-color')),line:colorValue(attr(props,ns.svg,'stroke-color'))})}
    else if(!['notes'].includes(shape.localName))warn('Nicht unterstützte ODP-Objekte werden ausgelassen.')
   }
   model.slides.push(slide)
  }
 }
 if(!model.slides.length)throw Error('Keine lesbaren Folien vorhanden')
 if(model.width<100||model.height<100||model.width>3000||model.height>3000)throw Error('Folienformat außerhalb unterstützter Grenzen')
 for(const slide of model.slides)for(const shape of slide.shapes){const line=shape.kind==='shape'&&shape.shape==='line';if(![shape.x,shape.y,shape.width,shape.height,shape.rotation||0].every(Number.isFinite)||shape.width<0||shape.height<0||(!line&&(!shape.width||!shape.height))||(line&&!shape.width&&!shape.height))throw Error('Ungültige Folienobjekt-Abmessungen');if(shape.kind==='table')boundedTableRows(shape.table.rows)}
 warn('Schriftfamilien, Master-Elemente, Animationen und komplexe Layoutdetails können abweichen.')
 return model
}
export async function presentationPptx(model:RichPresentation,options:ConversionOptions={}):Promise<Result>{
 const deck=new pptxgen();deck.defineLayout({name:'SOURCE',width:model.width/72,height:model.height/72});deck.layout='SOURCE'
 for(const [index,source] of model.slides.entries()){
  checkpoint(options,50+index/model.slides.length*40,'PPTX-Folie schreiben');const slide=deck.addSlide();if(source.background)slide.background={color:source.background}
  for(const shape of source.shapes){const bounds={x:shape.x/72,y:shape.y/72,w:shape.width/72,h:shape.height/72,rotate:shape.rotation||0,flipV:shape.flipV}
   if(shape.kind==='image')slide.addImage({...bounds,data:dataUri(shape.image),altText:shape.image.alt})
   else if(shape.kind==='text'){
    const runs: pptxgen.TextProps[]=[]
    for(const [i,p] of shape.paragraphs.entries())for(const [j,r] of p.runs.entries())runs.push({text:r.text,options:{bold:r.bold,italic:r.italic,underline:r.underline?{style:'sng'}:undefined,color:r.color,fontSize:r.size||18,breakLine:i>0&&j===0,align:p.align==='justify'?'justify':p.align}})
    slide.addText(runs,{...bounds,margin:0,valign:'top',fontSize:18,...(shape.fill?{fill:{color:shape.fill}}:{})})
   }else if(shape.kind==='shape')slide.addShape(shape.shape==='ellipse'?deck.ShapeType.ellipse:shape.shape==='line'?deck.ShapeType.line:deck.ShapeType.rect,{...bounds,fill:{color:shape.fill||'FFFFFF',transparency:shape.fill?0:100},line:{color:shape.line||shape.fill||'000000',transparency:shape.line?0:100}})
   else{
    const rows=shape.table.rows.map(row=>row.map(cell=>({text:cell.blocks.filter(b=>b.kind==='paragraph').flatMap((p,i)=>p.runs.map((r,j)=>({text:r.text,options:{bold:r.bold,italic:r.italic,color:r.color,fontSize:r.size||12,breakLine:i>0&&j===0}}))),options:{colSpan:cell.span,fill:cell.fill?{color:cell.fill}:undefined}})))
    slide.addTable(rows,{...bounds,fontSize:12,margin:0.05,border:{type:'solid',pt:0.5,color:'888888'}})
   }
  }
 }
 return {blob:await deck.write({outputType:'blob'}) as Blob,extension:'pptx'}
}
export function presentationOdp(model:RichPresentation):Result{
 const mimetype='application/vnd.oasis.opendocument.presentation',entries:Record<string,Uint8Array|[Uint8Array,{level:0}]>={mimetype:[strToU8(mimetype),{level:0}]},styles:string[]=[],images:string[]=[]
 let id=0,imageId=0
 function paragraph(p:ParagraphBlock):string{
  const name='P'+(++id);styles.push(`<style:style style:name="${name}" style:family="paragraph"><style:paragraph-properties fo:text-align="${p.align||'left'}"/></style:style>`)
  return `<text:p text:style-name="${name}">${p.runs.map(r=>{const key='T'+(++id);styles.push(`<style:style style:name="${key}" style:family="text"><style:text-properties fo:font-size="${r.size||18}pt"${r.bold?' fo:font-weight="bold"':''}${r.italic?' fo:font-style="italic"':''}${r.underline?' style:text-underline-style="solid"':''}${r.color?' fo:color="#'+r.color+'"':''}/></style:style>`);return `<text:span text:style-name="${key}">${xmlEscape(r.text).replace(/\n/g,'<text:line-break/>').replace(/\t/g,'<text:tab/>').replace(/ {2,}/g,s=>`<text:s text:c="${s.length}"/>`)}</text:span>`}).join('')}</text:p>`
 }
 const pages=model.slides.map((slide,index)=>{
  const pageStyle='D'+(++id);styles.push(`<style:style style:name="${pageStyle}" style:family="drawing-page"><style:drawing-page-properties${slide.background?' draw:fill="solid" draw:fill-color="#'+slide.background+'"':''}/></style:style>`)
  const objects=slide.shapes.map(shape=>{
   if(shape.rotation)model.warnings.push('Rotationen werden im ODP-Export vereinfacht.')
   const box=`svg:x="${shape.x}pt" svg:y="${shape.y}pt" svg:width="${shape.width}pt" svg:height="${shape.height}pt"`,key='G'+(++id)
   if(shape.kind==='image'){const path='Pictures/image-'+(++imageId)+'.png';entries[path]=shape.image.data;images.push(`<manifest:file-entry manifest:full-path="${path}" manifest:media-type="image/png"/>`);return `<draw:frame draw:name="Image${imageId}" ${box}><svg:desc>${xmlEscape(shape.image.alt)}</svg:desc><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`}
   if(shape.kind==='text'){styles.push(`<style:style style:name="${key}" style:family="graphic"><style:graphic-properties${shape.fill?' draw:fill="solid" draw:fill-color="#'+shape.fill+'"':''}/></style:style>`);return `<draw:frame draw:name="Text${id}" draw:style-name="${key}" ${box}><draw:text-box>${shape.paragraphs.map(paragraph).join('')}</draw:text-box></draw:frame>`}
   if(shape.kind==='shape'){styles.push(`<style:style style:name="${key}" style:family="graphic"><style:graphic-properties draw:fill="${shape.fill?'solid':'none'}"${shape.fill?' draw:fill-color="#'+shape.fill+'"':''}${shape.line?' draw:stroke="solid" svg:stroke-color="#'+shape.line+'"':' draw:stroke="none"'}/></style:style>`);return `<draw:${shape.shape} draw:name="Shape${id}" draw:style-name="${key}" ${shape.shape==='line'?`svg:x1="${shape.x}pt" svg:y1="${shape.y+(shape.flipV?shape.height:0)}pt" svg:x2="${shape.x+shape.width}pt" svg:y2="${shape.y+(shape.flipV?0:shape.height)}pt"`:box}/>`}
   return `<draw:frame draw:name="Table${id}" ${box}><table:table table:name="Table${id}">${shape.table.rows.map(row=>'<table:table-row>'+row.map(cell=>{const key='C'+(++id);styles.push(`<style:style style:name="${key}" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #888888"${cell.fill?' fo:background-color="#'+cell.fill+'"':''}/></style:style>`);return `<table:table-cell table:style-name="${key}"${(cell.span||1)>1?' table:number-columns-spanned="'+cell.span+'"':''}>${cell.blocks.filter(b=>b.kind==='paragraph').map(paragraph).join('')}</table:table-cell>`+'<table:covered-table-cell/>'.repeat((cell.span||1)-1)}).join('')+'</table:table-row>').join('')}</table:table></draw:frame>`
  }).join('')
  return `<draw:page draw:name="Slide ${index+1}" draw:style-name="${pageStyle}" draw:master-page-name="Default">${objects}</draw:page>`
 }).join('')
 const declarations=Object.entries(ns).filter(([name])=>!['w','a','r'].includes(name)).map(([name,url])=>`xmlns:${name}="${url}"`).join(' ')+` xmlns:presentation="${PRESENT}"`
 entries['content.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><office:document-content ${declarations} office:version="1.2"><office:automatic-styles>${styles.join('')}</office:automatic-styles><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`)
 entries['styles.xml']=strToU8(`<?xml version="1.0"?><office:document-styles ${declarations} office:version="1.2"><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${model.width}pt" fo:page-height="${model.height}pt"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`)
 entries['META-INF/manifest.xml']=strToU8(`<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>${images.join('')}</manifest:manifest>`)
 return result(zipSync(entries),'odp',mimetype)
}
export async function presentationPdf(model:RichPresentation,options:ConversionOptions={}):Promise<Result>{
 const pdf=await PDFDocument.create()
 const color=(hex:string)=>rgb(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255)
 for(const [index,slide] of model.slides.entries()){
  checkpoint(options,50+index/model.slides.length*40,'Folien-PDF lokal setzen');const page=pdf.addPage([model.width,model.height])
  if(slide.background)page.drawRectangle({x:0,y:0,width:model.width,height:model.height,color:color(slide.background)})
  for(const shape of slide.shapes){const y=model.height-shape.y-shape.height
   if(shape.rotation)model.warnings.push('Rotationen im Folien-PDF werden vereinfacht.')
   if(shape.kind==='image')page.drawImage(await pdf.embedPng(shape.image.data),{x:shape.x,y,width:shape.width,height:shape.height})
   else if(shape.kind==='shape'){
    if(shape.shape==='ellipse')page.drawEllipse({x:shape.x+shape.width/2,y:y+shape.height/2,xScale:shape.width/2,yScale:shape.height/2,...(shape.fill?{color:color(shape.fill)}:{}),...(shape.line?{borderColor:color(shape.line),borderWidth:1}:{})})
    else if(shape.shape==='line')page.drawLine({start:{x:shape.x,y:y+(shape.flipV?0:shape.height)},end:{x:shape.x+shape.width,y:y+(shape.flipV?shape.height:0)},thickness:1,color:color(shape.line||'000000')})
    else page.drawRectangle({x:shape.x,y,width:shape.width,height:shape.height,...(shape.fill?{color:color(shape.fill)}:{}),...(shape.line?{borderColor:color(shape.line),borderWidth:1}:{})})
   }else{
    if(shape.kind==='text'&&shape.fill)page.drawRectangle({x:shape.x,y,width:shape.width,height:shape.height,color:color(shape.fill)})
    const width=Math.max(shape.width,100),height=Math.max(shape.height,100)
    const blocks=shape.kind==='text'?shape.paragraphs:[shape.table]
    const rendered=await richDocumentPdf({blocks,width,height,margin:0,warnings:[]},options)
    const source=await PDFDocument.load(await rendered.blob.arrayBuffer())
    if(source.getPageCount()>1)model.warnings.push('Überlaufender Folientext wird am ursprünglichen Textfeld begrenzt.')
    const [embedded]=await pdf.embedPdf(source,[0])
    // Clip to the source object's rectangle, preserving vector text/font objects.
    const { pushGraphicsState,popGraphicsState,rectangle,clip,endPath }=await import('pdf-lib')
    page.pushOperators(pushGraphicsState(),rectangle(shape.x,y,shape.width,shape.height),clip(),endPath())
    page.drawPage(embedded,{x:shape.x,y:model.height-shape.y-height,width,height,rotate:degrees(0)})
    page.pushOperators(popGraphicsState())
   }
  }
 }
 return result(await pdf.save(),'pdf','application/pdf')
}
export async function presentationConvert(file:File,to:string,options:ConversionOptions):Promise<Result>{
 const model=await readRichPresentation(file,options);let output:Result
 if(to==='pptx')output=await presentationPptx(model,options)
 else if(to==='odp')output=presentationOdp(model)
 else if(to==='pdf')output=await presentationPdf(model,options)
 else{
  const blocks=model.slides.map((slide,index)=>({index,paragraphs:slide.shapes.flatMap(s=>s.kind==='text'?s.paragraphs:s.kind==='table'?s.table.rows.flatMap(r=>r.flatMap(c=>c.blocks.filter(b=>b.kind==='paragraph'))):[])}))
  if(to==='txt')output=result(blocks.map(s=>'Slide '+(s.index+1)+'\n'+s.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n')).join('\n\n'),'txt','text/plain;charset=utf-8')
  else if(to==='html'){
   const html=model.slides.map(slide=>`<section style="position:relative;width:${model.width}px;height:${model.height}px;background:#${slide.background||'FFFFFF'}">${slide.shapes.map(s=>{
    const position=`position:absolute;left:${s.x}px;top:${s.y}px;width:${s.width}px;height:${s.height}px;overflow:hidden;`
    if(s.kind==='image')return `<img src="${dataUri(s.image)}" style="${position}" alt="${xmlEscape(s.image.alt)}">`
    if(s.kind==='text')return `<div style="${position}${s.fill?'background:#'+s.fill+';':''}">${s.paragraphs.map(p=>`<p style="margin:0;text-align:${p.align||'left'}">${p.runs.map(r=>`<span style="font-size:${r.size||18}px;${r.bold?'font-weight:bold;':''}${r.italic?'font-style:italic;':''}${r.underline?'text-decoration:underline;':''}color:#${r.color||'000000'}">${xmlEscape(r.text).replace(/\n/g,'<br>')}</span>`).join('')}</p>`).join('')}</div>`
    if(s.kind==='shape'&&s.shape==='line')return `<svg style="position:absolute;left:${s.x}px;top:${s.y}px;width:${Math.max(s.width,1)}px;height:${Math.max(s.height,1)}px;overflow:visible" viewBox="0 0 ${Math.max(s.width,1)} ${Math.max(s.height,1)}"><line x1="0" y1="${s.flipV?s.height:0}" x2="${s.width}" y2="${s.flipV?0:s.height}" stroke="#${s.line||'000000'}"/></svg>`
    if(s.kind==='shape')return `<div style="${position}background:${s.fill?'#'+s.fill:'transparent'};${s.shape==='ellipse'?'border-radius:50%;':''}${s.line?'border:1px solid #'+s.line+';':''}"></div>`
    return `<table style="${position}border-collapse:collapse">${s.table.rows.map(row=>'<tr>'+row.map(c=>`<td colspan="${c.span||1}" style="border:1px solid #888">${c.blocks.filter(b=>b.kind==='paragraph').map(p=>xmlEscape(p.runs.map(r=>r.text).join(''))).join('<br>')}</td>`).join('')+'</tr>').join('')}</table>`
   }).join('')}</section>`).join('\n')
   output=result('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>body{font-family:sans-serif;background:#ddd}section{margin:20px auto;box-shadow:0 2px 12px #888}</style>'+html,'html','text/html;charset=utf-8')
  }else throw Error('Nicht unterstütztes Folien-Ziel')
 }
 return {...output,warnings:[...new Set(model.warnings)]}
}
