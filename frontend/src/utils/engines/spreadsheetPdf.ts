import * as XLSX from 'xlsx'
import { PDFDocument } from 'pdf-lib'
import { checkpoint,result,type ConversionOptions,type Result } from './common'
import { colorValue,type TableCellModel,type DocumentBlock } from './officeModel'
import { richDocumentPdf } from './richPdf'
export async function spreadsheetPdf(book:XLSX.WorkBook,options:ConversionOptions={}):Promise<Result>{
 const output=await PDFDocument.create(),warnings=['PDF exportiert angezeigte Zellwerte; Formeln werden nicht neu berechnet. Diagramme und vollständige Excel-Drucklayouts werden nicht übernommen.']
 let totalCells=0
 for(const [index,name] of book.SheetNames.entries()){
  checkpoint(options,20+index/book.SheetNames.length*65,'Tabellenblatt als PDF setzen')
  const sheet=book.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1')
  if(![range.s.r,range.s.c,range.e.r,range.e.c].every(v=>Number.isSafeInteger(v)&&v>=0)||range.e.r<range.s.r||range.e.c<range.s.c)throw Error('Ungültiger Tabellenbereich')
  const rows=range.e.r-range.s.r+1,columns=range.e.c-range.s.c+1
  totalCells+=rows*columns
  if(totalCells>100000||rows>10000||columns>256)throw Error('Tabellen-PDF überschreitet 100000 Zellen / 10000 Zeilen / 256 Spalten')
  if(sheet['!merges']?.length)warnings.push('Verbundene Tabellenzellen werden im PDF-Raster vereinfacht.')
  if(sheet['!cols']?.some(c=>c?.hidden)||sheet['!rows']?.some(r=>r?.hidden))warnings.push('Ausgeblendete Zeilen/Spalten werden im PDF mit ausgegeben.')
  // Wide worksheets are split into column bands, rather than shrinking the
  // entire sheet until it becomes unreadable or truncating the final columns.
  for(let start=range.s.c;start<=range.e.c;start+=8){
   const end=Math.min(range.e.c,start+7),table:TableCellModel[][]=[]
   for(let row=range.s.r;row<=range.e.r;row++){
    const cells:TableCellModel[]=[{blocks:[{kind:'paragraph',runs:[{text:String(row+1),size:9,color:'666666'}]}],fill:'F0F2F5'}]
    for(let column=start;column<=end;column++){
     const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})] as XLSX.CellObject|undefined
     const displayed=cell?XLSX.utils.format_cell(cell)??'':''
     if(cell?.f && cell.v===undefined)warnings.push('Formel ohne gespeicherten Ergebniswert wird als leer ausgegeben.')
     const style=cell?.s as {fgColor?:{rgb?:string};fill?:{fgColor?:{rgb?:string}};font?:{bold?:boolean;italic?:boolean;color?:{rgb?:string}}}|undefined
     const fill=colorValue(style?.fgColor?.rgb||style?.fill?.fgColor?.rgb||'')
     cells.push({blocks:[{kind:'paragraph',runs:[{text:displayed,size:9,bold:style?.font?.bold,italic:style?.font?.italic,color:colorValue(style?.font?.color?.rgb||'')}]}],fill})
    }
    table.push(cells)
   }
   const header:TableCellModel[]=[{blocks:[{kind:'paragraph',runs:[{text:'#',bold:true,size:9}]}],fill:'DDE5EF'}]
   for(let column=start;column<=end;column++)header.push({blocks:[{kind:'paragraph',runs:[{text:XLSX.utils.encode_col(column),bold:true,size:9}]}],fill:'DDE5EF'})
   table.unshift(header)
   const title=name+(columns>8?` · ${XLSX.utils.encode_col(start)}–${XLSX.utils.encode_col(end)}`:'')
   const blocks:DocumentBlock[]=[{kind:'paragraph',heading:2,runs:[{text:title,bold:true,size:16}]},{kind:'table',rows:table}]
   const converted=await richDocumentPdf({blocks,width:841.89,height:595.28,margin:32,warnings:[]},options),pdf=await PDFDocument.load(await converted.blob.arrayBuffer())
   for(const page of await output.copyPages(pdf,pdf.getPageIndices()))output.addPage(page)
  }
 }
 return {...result(await output.save(),'pdf','application/pdf'),warnings:[...new Set(warnings)]}
}
