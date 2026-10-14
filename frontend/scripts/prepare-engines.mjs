import { cp, mkdir, copyFile } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const src = (p) => new URL('node_modules/' + p, root)
const out = (p) => new URL('public/engines/' + p, root)
await mkdir(out(''), { recursive: true })
await mkdir(out('ffmpeg'), { recursive: true })
await cp(src('@ffmpeg/ffmpeg/dist/esm/'), out('ffmpeg/'), { recursive: true })
await copyFile(src('@ffmpeg/core/dist/esm/ffmpeg-core.js'), out('ffmpeg-core.js'))
await copyFile(src('@ffmpeg/core/dist/esm/ffmpeg-core.wasm'), out('ffmpeg-core.wasm'))
await copyFile(src('fonteditor-core/woff2/woff2.wasm'), out('woff2.wasm'))
await copyFile(src('pdfjs-dist/build/pdf.worker.min.mjs'), out('pdf.worker.min.mjs'))
await cp(src('pdfjs-dist/cmaps/'), out('cmaps/'), { recursive: true })
await cp(src('pdfjs-dist/standard_fonts/'), out('standard_fonts/'), { recursive: true })
await cp(src('pdfjs-dist/wasm/'), out('pdf-wasm/'), { recursive: true })
// Preserve dependency license notices alongside the locally distributed assets.
const licensePackages = ['pdf-lib','@pdf-lib/fontkit','pdfjs-dist','xlsx','docx','pptxgenjs','three','fonteditor-core','fflate','js-yaml','@ffmpeg/ffmpeg','tesseract.js','tesseract.js-core','@tesseract.js-data/eng','@tesseract.js-data/deu','occt-import-js','@mlightcad/libredwg-web','dxf-parser','zetajs']
const { readdir, readFile, writeFile } = await import('node:fs/promises')
await mkdir(out('licenses/'),{recursive:true})
for(const name of licensePackages) {
  const directory=src(name+'/')
  for(const filename of await readdir(directory)) if(/^(license|copying|notice)/i.test(filename)) {
    const content=await readFile(new URL(filename,directory)).catch(()=>null)
    if(content)await writeFile(out('licenses/'+name.replaceAll('/','-')+'-'+filename),content)
  }
}

await mkdir(out('ocr/languages/'),{recursive:true})
await copyFile(src('tesseract.js/dist/worker.min.js'),out('ocr/worker.min.js'))
for(const filename of await readdir(src('tesseract.js-core/')))if(/lstm\.wasm(?:\.js)?$/.test(filename))await copyFile(src('tesseract.js-core/'+filename),out('ocr/'+filename))
for(const language of ['eng','deu'])await copyFile(src('@tesseract.js-data/'+language+'/4.0.0_best_int/'+language+'.traineddata.gz'),out('ocr/languages/'+language+'.traineddata.gz'))
await mkdir(out('cad/'),{recursive:true})
await copyFile(src('occt-import-js/dist/occt-import-js.js'),out('cad/occt-import-js.js'))
await copyFile(src('occt-import-js/dist/occt-import-js.wasm'),out('cad/occt-import-js.wasm'))
await cp(src('@mlightcad/libredwg-web/dist/'),out('cad/dwg/dist/'),{recursive:true})
await cp(src('@mlightcad/libredwg-web/wasm/'),out('cad/dwg/wasm/'),{recursive:true})
await copyFile(new URL('engine-sources/cad-worker.js',root),out('cad-worker.js'))

await copyFile(new URL('engine-sources/LICENSE-LibreDWG.txt',root),out('licenses/LICENSE-LibreDWG.txt'))
await copyFile(src('occt-import-js/dist/license.occt.txt'),out('licenses/LICENSE-OpenCascade.txt'))
await import('./prepare-office.mjs')
await cp(new URL('engine-sources/office/',root),out('office/'),{recursive:true})
await copyFile(src('zetajs/source/zeta.js'),out('office/zeta.js'))

for(const name of await readdir(new URL('engine-sources/',root)))if(/^(LICENSE|COPYING)/.test(name))await copyFile(new URL('engine-sources/'+name,root),out('licenses/'+name))
