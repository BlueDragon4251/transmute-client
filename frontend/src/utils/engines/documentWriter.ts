import { zipSync,strToU8 } from 'fflate'
import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild } from 'docx'
import { result,xmlEscape,type Result } from './common'
import { dataUri,namespaces as ns,type DocumentBlock,type RichDocument,type TextPiece } from './officeModel'

const alignment={left:AlignmentType.LEFT,center:AlignmentType.CENTER,right:AlignmentType.RIGHT,justify:AlignmentType.JUSTIFIED}
const headings=[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3,HeadingLevel.HEADING_4,HeadingLevel.HEADING_5,HeadingLevel.HEADING_6]
export async function documentDocx(model:RichDocument):Promise<Result> {
  function blocks(values:DocumentBlock[]):(Paragraph|Table)[] {
    return values.map(block=>{
      if(block.kind==='image')return new Paragraph({children:[new ImageRun({type:'png',data:block.data,transformation:{width:block.width/0.75,height:block.height/0.75},altText:{title:block.alt,description:block.alt,name:'Embedded image'}})]})
      if(block.kind==='paragraph'){
        const children:ParagraphChild[]=[]
        for(const run of block.runs)for(const [i,line] of run.text.split('\n').entries())children.push(new TextRun({text:line,break:i?1:undefined,bold:run.bold,italics:run.italic,underline:run.underline?{}:undefined,color:run.color,size:run.size?run.size*2:undefined}))
        return new Paragraph({children,alignment:block.align?alignment[block.align]:undefined,heading:block.heading?headings[block.heading-1]:undefined,pageBreakBefore:block.pageBreak,spacing:{after:120}})
      }
      return new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:block.rows.map(row=>new TableRow({children:row.map(cell=>new TableCell({children:blocks(cell.blocks).length?blocks(cell.blocks):[new Paragraph('')],columnSpan:cell.span,shading:cell.fill?{fill:cell.fill}:undefined,borders:{top:{style:BorderStyle.SINGLE,size:4,color:'888888'},bottom:{style:BorderStyle.SINGLE,size:4,color:'888888'},left:{style:BorderStyle.SINGLE,size:4,color:'888888'},right:{style:BorderStyle.SINGLE,size:4,color:'888888'}}}))}))})
    })
  }
  return {blob:await Packer.toBlob(new Document({sections:[{properties:{page:{size:{width:Math.round(model.width*20),height:Math.round(model.height*20)},margin:{top:model.margin*20,bottom:model.margin*20,left:model.margin*20,right:model.margin*20}}},children:blocks(model.blocks)}]})),extension:'docx'}
}
export function documentHtml(model:RichDocument):Result {
  const run=(r:TextPiece)=>`<span style="${r.bold?'font-weight:bold;':''}${r.italic?'font-style:italic;':''}${r.underline?'text-decoration:underline;':''}${r.color?'color:#'+r.color+';':''}${r.size?'font-size:'+r.size+'pt;':''}">${xmlEscape(r.text).replace(/\n/g,'<br>')}</span>`
  function blocks(values:DocumentBlock[]):string {
    return values.map(b=>{
      if(b.kind==='image')return `<img src="${dataUri(b)}" width="${Math.round(b.width/0.75)}" height="${Math.round(b.height/0.75)}" alt="${xmlEscape(b.alt)}">`
      if(b.kind==='table')return '<table>'+b.rows.map(row=>'<tr>'+row.map(c=>`<td colspan="${c.span||1}"${c.fill?` style="background:#${c.fill}"`:''}>${blocks(c.blocks)}</td>`).join('')+'</tr>').join('')+'</table>'
      const tag=b.heading?'h'+b.heading:'p'
      return `<${tag} style="text-align:${b.align||'left'};${b.pageBreak?'break-before:page;':''}">${b.runs.map(run).join('')}</${tag}>`
    }).join('\n')
  }
  return result('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>Converted document</title><style>body{max-width:800px;margin:40px auto;padding:20px;font-family:sans-serif;white-space:pre-wrap}table{border-collapse:collapse;width:100%;white-space:normal}td{border:1px solid #888;padding:8px;vertical-align:top}img{max-width:100%;height:auto}p{margin:0 0 8pt}</style></head><body>'+blocks(model.blocks)+'</body></html>','html','text/html;charset=utf-8')
}
export function documentOdt(model:RichDocument):Result {
  const styles:string[]=[], entries:Record<string,Uint8Array|[Uint8Array,{level:0}]>={mimetype:[strToU8('application/vnd.oasis.opendocument.text'),{level:0}]},manifest:string[]=[]
  let runId=0,paragraphId=0,imageId=0,tableId=0
  const contentRun=(r:TextPiece)=>{
    const id='T'+(++runId)
    styles.push(`<style:style style:name="${id}" style:family="text"><style:text-properties${r.bold?' fo:font-weight="bold"':''}${r.italic?' fo:font-style="italic"':''}${r.underline?' style:text-underline-style="solid" style:text-underline-type="single"':''}${r.color?' fo:color="#'+r.color+'"':''}${r.size?' fo:font-size="'+r.size+'pt"':''}/></style:style>`)
    return `<text:span text:style-name="${id}">${xmlEscape(r.text).replace(/\n/g,'<text:line-break/>').replace(/\t/g,'<text:tab/>').replace(/ {2,}/g,s=>`<text:s text:c="${s.length}"/>`)}</text:span>`
  }
  function blocks(values:DocumentBlock[]):string {
    return values.map(b=>{
      if(b.kind==='image'){
        const path='Pictures/image-'+(++imageId)+'.png';entries[path]=b.data;manifest.push(`<manifest:file-entry manifest:full-path="${path}" manifest:media-type="image/png"/>`)
        return `<text:p><draw:frame draw:name="Image ${imageId}" text:anchor-type="as-char" svg:width="${b.width}pt" svg:height="${b.height}pt"><svg:desc>${xmlEscape(b.alt)}</svg:desc><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`
      }
      if(b.kind==='table')return `<table:table table:name="Table${++tableId}">${b.rows.map(row=>'<table:table-row>'+row.map(c=>{
        const id='C'+(++paragraphId);styles.push(`<style:style style:name="${id}" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #888888" fo:padding="4pt"${c.fill?' fo:background-color="#'+c.fill+'"':''}/></style:style>`)
        return `<table:table-cell table:style-name="${id}"${(c.span||1)>1?' table:number-columns-spanned="'+c.span+'"':''}>${blocks(c.blocks)||'<text:p/>'}</table:table-cell>`+('<table:covered-table-cell/>'.repeat((c.span||1)-1))
      }).join('')+'</table:table-row>').join('')}</table:table>`
      const id='P'+(++paragraphId);styles.push(`<style:style style:name="${id}" style:family="paragraph"><style:paragraph-properties fo:text-align="${b.align||'left'}" fo:margin-bottom="6pt"${b.pageBreak?' fo:break-before="page"':''}/></style:style>`)
      const tag=b.heading?'text:h':'text:p';return `<${tag} text:style-name="${id}"${b.heading?' text:outline-level="'+b.heading+'"':''}>${b.runs.map(contentRun).join('')}</${tag}>`
    }).join('')
  }
  const body=blocks(model.blocks),mimetype='application/vnd.oasis.opendocument.text'
  const declarations=Object.entries(ns).filter(([name])=>name!=='w'&&name!=='a'&&name!=='r').map(([name,url])=>`xmlns:${name}="${url}"`).join(' ')
  entries.mimetype=[strToU8(mimetype),{level:0}]
  entries['content.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><office:document-content ${declarations} office:version="1.2"><office:automatic-styles>${styles.join('')}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`)
  entries['styles.xml']=strToU8(`<?xml version="1.0"?><office:document-styles ${declarations} office:version="1.2"><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${model.width}pt" fo:page-height="${model.height}pt" fo:margin="${model.margin}pt" fo:margin-left="${model.margin}pt"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`)
  entries['META-INF/manifest.xml']=strToU8(`<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>${manifest.join('')}</manifest:manifest>`)
  return result(zipSync(entries),'odt',mimetype)
}
