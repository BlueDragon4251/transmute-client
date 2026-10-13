import { PDFDocument,rgb,degrees,type PDFFont,type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { asset,checkpoint,result,type ConversionOptions,type Result } from './common'
import { type TextPiece,type DocumentBlock,type RichDocument } from './officeModel'
const files={regular:'DejaVuSans.ttf',bold:'DejaVuSans-Bold.ttf'}
type FontKey=keyof typeof files
type Segment=TextPiece & {width:number;font:PDFFont;size:number}
type Line={parts:Segment[];width:number;height:number}
const sourceFonts=new Map<FontKey,Promise<ArrayBuffer>>()
export async function richDocumentPdf(model:RichDocument,options:ConversionOptions={}):Promise<Result> {
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit)
  const fonts=new Map<FontKey,PDFFont>(),supported=new Map<FontKey,Set<number>>()
  async function font(style:TextPiece):Promise<PDFFont>{
    const key:FontKey=style.bold?'bold':'regular'
    if(!fonts.has(key)){
      let source=sourceFonts.get(key)
      if(!source){source=fetch(asset('fonts/'+files[key])).then(r=>{if(!r.ok)throw Error('Lokale PDF-Schrift fehlt');return r.arrayBuffer()}).catch(e=>{sourceFonts.delete(key);throw e});sourceFonts.set(key,source)}
      const embedded=await pdf.embedFont(await source,{subset:true});fonts.set(key,embedded);supported.set(key,new Set(embedded.getCharacterSet()))
    }
    for(const c of style.text)if(!/[\r\n\t]/.test(c)&&!supported.get(key)!.has(c.codePointAt(0)!))throw Error('Zeichen nicht in der lokalen PDF-Schrift vorhanden')
    return fonts.get(key)!
  }
  async function lines(runs:TextPiece[],width:number,defaultSize=11):Promise<Line[]>{
    const out:Line[]=[];let line:Line={parts:[],width:0,height:defaultSize*1.4}
    const flush=()=>{out.push(line);line={parts:[],width:0,height:defaultSize*1.4}}
    for(const run of runs){const f=await font(run),size=run.size||defaultSize
      const add=(text:string)=>{const w=f.widthOfTextAtSize(text,size);line.parts.push({...run,text,font:f,size,width:w});line.width+=w;line.height=Math.max(line.height,size*1.4)}
      for(const token of run.text.replace(/\r/g,'').replace(/\t/g,'    ').split(/(\n|[ ]+)/)){
        if(!token)continue;if(token==='\n'){flush();continue}
        const tokenWidth=f.widthOfTextAtSize(token,size)
        if(tokenWidth<=width){if(line.width+tokenWidth>width && line.parts.length)flush();add(token)}
        else for(const c of token){if(line.width+f.widthOfTextAtSize(c,size)>width&&line.parts.length)flush();add(c)}
      }
    }
    if(line.parts.length||!out.length)flush()
    return out
  }
  const color=(hex?:string)=>hex&&/^[0-9a-f]{6}$/i.test(hex)?rgb(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255):rgb(0,0,0)
  let page:PDFPage=pdf.addPage([model.width,model.height]),y=model.height-model.margin
  const newPage=()=>{page=pdf.addPage([model.width,model.height]);y=model.height-model.margin}
  function drawLine(line:Line,x:number,top:number,width:number,align='left'){
    let at=x+(align==='center'?(width-line.width)/2:align==='right'?width-line.width:0)
    for(const part of line.parts){const baseline=top-part.size
      page.drawText(part.text,{x:at,y:baseline,size:part.size,font:part.font,color:color(part.color),ySkew:part.italic?degrees(12):undefined})
      if(part.underline)page.drawLine({start:{x:at,y:baseline-1.5},end:{x:at+part.width,y:baseline-1.5},thickness:Math.max(0.5,part.size/16),color:color(part.color)})
      at+=part.width
    }
  }
  const width=model.width-model.margin*2,usable=model.height-model.margin*2
  async function blocks(values:DocumentBlock[]):Promise<void>{
    for(const block of values){options.signal?.throwIfAborted()
      if(block.kind==='paragraph'){
        if(block.pageBreak && y<model.height-model.margin)newPage()
        const formatted=await lines(block.runs,width,block.heading?[24,20,17,15,13,12][block.heading-1]:11)
        for(const line of formatted){if(y-line.height<model.margin)newPage();drawLine(line,model.margin,y,width,block.align);y-=line.height}
        y-=6
      }else if(block.kind==='image'){
        const image=await pdf.embedPng(block.data),scale=Math.min(1,width/block.width,usable/block.height),w=block.width*scale,h=block.height*scale
        if(y-h<model.margin)newPage();page.drawImage(image,{x:model.margin,y:y-h,width:w,height:h});y-=h+8
      }else{
        const columns=Math.max(...block.rows.map(row=>row.reduce((n,c)=>n+(c.span||1),0))),columnWidth=width/columns
        for(const row of block.rows){
          const cells=await Promise.all(row.map(async cell=>{
            if(cell.blocks.some(b=>b.kind!=='paragraph'))throw Error('PDF-Tabellen mit eingebetteten Bildern/Untertabellen derzeit nicht unterstützt')
            const formatted:Line[]=[];for(const p of cell.blocks)if(p.kind==='paragraph')formatted.push(...await lines(p.runs,columnWidth*(cell.span||1)-10,p.heading?16:10))
            return {cell,formatted}
          }))
          let offset=0
          while(cells.some(c=>offset<c.formatted.length)||offset===0){
            // Continue oversized text rows onto new pages without clipping.
            if(y-model.margin<28)newPage()
            let count=0,height=10
            while(cells.some(c=>offset+count<c.formatted.length)){
              const next=Math.max(...cells.map(c=>c.formatted[offset+count]?.height||0))
              if(height+next>y-model.margin && count)break
              if(height+next>usable)throw Error('Tabellenschrift größer als die PDF-Seite')
              height+=next;count++
            }
            count=Math.max(count,1);height=Math.max(height,24)
            if(y-height<model.margin)newPage()
            let x=model.margin
            for(const {cell,formatted} of cells){const w=columnWidth*(cell.span||1)
              page.drawRectangle({x,y:y-height,width:w,height,borderWidth:0.5,borderColor:rgb(0.5,0.5,0.5),...(cell.fill?{color:color(cell.fill)}:{})})
              let top=y-5;for(const line of formatted.slice(offset,offset+count)){drawLine(line,x+5,top,w-10);top-=line.height}x+=w
            }
            y-=height;offset+=count
            if(cells.some(c=>offset<c.formatted.length))newPage()
          }
        }
        y-=8
      }
    }
  }
  for(const [i,block] of model.blocks.entries()){checkpoint(options,20+i/model.blocks.length*65,'Office-PDF setzen');await blocks([block])}
  checkpoint(options,95,'Office-PDF speichern')
  return result(await pdf.save(),'pdf','application/pdf')
}
