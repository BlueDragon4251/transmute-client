/* UNO integration based on the MIT-licensed allotropia/zetajs convertpdf example. */
Module.zetajs.then(zetajs=>{
 const css=zetajs.uno.com.sun.star,context=zetajs.getUnoComponentContext(),desktop=css.frame.Desktop.create(context),port=zetajs.mainPort
 const bean=(Name,Value)=>new css.beans.PropertyValue({Name,Value})
 const interaction=zetajs.unoObject([css.task.XInteractionHandler],{handle:request=>{for(const continuation of request.getContinuations()){const abort=continuation.queryInterface(zetajs.type.interface(css.task.XInteractionAbort));if(abort){abort.select();break}}}})
 const short=value=>new zetajs.Any(zetajs.type.short,value)
 // Fail closed: both document loading and the global security configuration disable macros/updates.
 const configuration=css.configuration.ReadWriteAccess.create(context,'en-US')
 configuration.getByHierarchicalName('/org.openoffice.Office.Common/Security/Scripting').setPropertyValue('MacroSecurityLevel',new zetajs.Any(zetajs.type.long,3))
 configuration.commitChanges()
 port.onmessage=event=>{
  const {cmd,id,from,to}=event.data;if(cmd!=='convert')return
  let document
  try{
   document=desktop.loadComponentFromURL('file://'+from,'_blank',0,[bean('Hidden',true),bean('ReadOnly',true),bean('Silent',true),bean('InteractionHandler',interaction),bean('MacroExecutionMode',short(0)),bean('UpdateDocMode',short(0))])
   if(!document)throw Error('Office-Datei kann nicht geöffnet werden')
   const kind=document.supportsService('com.sun.star.text.TextDocument')?'writer':document.supportsService('com.sun.star.sheet.SpreadsheetDocument')?'calc':document.supportsService('com.sun.star.presentation.PresentationDocument')?'impress':undefined
   if(!kind)throw Error('Nicht unterstützte Office-Dokumentart')
   const filters={writer:{doc:'MS Word 97',rtf:'Rich Text Format',docx:'Office Open XML Text',odt:'writer8',pdf:'writer_pdf_Export',html:'HTML (StarWriter)',txt:'Text (encoded)'},calc:{xlsx:'Calc MS Excel 2007 XML',ods:'calc8',xls:'MS Excel 97',pdf:'calc_pdf_Export',html:'HTML (StarCalc)',csv:'Text - txt - csv (StarCalc)',tsv:'Text - txt - csv (StarCalc)',txt:'Text - txt - csv (StarCalc)'},impress:{ppt:'MS PowerPoint 97',pptx:'Impress MS PowerPoint 2007 XML',odp:'impress8',pdf:'impress_pdf_Export'}}
   const filter=filters[kind][to];if(!filter)throw Error('LibreOffice bietet dieses Ausgabeformat für die Dokumentart nicht an')
   const properties=[bean('Overwrite',true),bean('FilterName',filter)]
   if(kind==='writer'&&to==='txt')properties.push(bean('FilterOptions','UTF8,LF'))
   if(kind==='calc'&&['csv','tsv','txt'].includes(to))properties.push(bean('FilterOptions',`${to==='csv'?44:9},34,76,1`))
   document.storeToURL('file:///tmp/transmute-output',properties)
   document.close(true);document=undefined
   port.postMessage({cmd:'converted',id,from})
  }catch(error){let message='Office-Konvertierung fehlgeschlagen';try{const exception=zetajs.catchUnoException(error);message=exception.Message||message}catch{message=error instanceof Error?error.message:message}try{document?.close(true)}catch{}port.postMessage({cmd:'failed',id,from,error:message})}
 }
 port.postMessage({cmd:'ready'})
}).catch(()=>{Module.uno_mainPort.postMessage({cmd:'failed',error:'Makro-Sicherheitskonfiguration fehlgeschlagen'})})
