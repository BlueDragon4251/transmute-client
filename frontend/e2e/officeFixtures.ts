import { Document,Paragraph,TextRun,ImageRun,Table,TableRow,TableCell,Packer,HeadingLevel,AlignmentType,PageBreak } from 'docx'
import { readFileSync } from 'node:fs'
const marker='RICH_PRIVATE_OFFICE'
const png=Buffer.from(JSON.parse(readFileSync('e2e/fixtures/images.json','utf8')).png,'base64')
export async function richDocumentFixture(){
 return new Uint8Array(await Packer.toBuffer(new Document({sections:[{children:[
  new Paragraph({text:marker,heading:HeadingLevel.HEADING_1,alignment:AlignmentType.CENTER}),
  new Paragraph({children:[new TextRun({text:'Bold red',bold:true,color:'CC1122',size:32}),new TextRun({text:' italic',italics:true}),new TextRun({text:' underlined',underline:{}})]}),
  new Paragraph({children:[new ImageRun({type:'png',data:png,transformation:{width:100,height:50},altText:{title:'Local image',description:'image marker',name:'image'}})]}),
  new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('Table A')],shading:{fill:'E0E0E0'}}),new TableCell({children:[new Paragraph('Table B'),new Paragraph({children:[new ImageRun({type:'png',data:png,transformation:{width:60,height:30},altText:{title:'Cell image',description:'table image',name:'cell-image'}})]})]})]}),new TableRow({children:[new TableCell({children:[new Paragraph('Spanning cell')],columnSpan:2})]})]}),
  new Paragraph({text:'After page break',pageBreakBefore:true}),
  new Paragraph({children:[new TextRun('Before internal page break'),new PageBreak(),new TextRun('After internal page break')]}),
 ]}]})))
}
