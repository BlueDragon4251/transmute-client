import {it,expect} from 'vitest'
import {validateImageSource} from './images'
const svg=(body:string,prefix='')=>new File([prefix+'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">'+body+'</svg>'],'input.svg')
it('refuses stylesheet instructions and obfuscated CSS before SVG decoding',async()=>{
 await expect(validateImageSource(svg('<rect width="10" height="10"/>','<?xml-stylesheet href="/api/settings?PRIVATE_MARKER" type="text/css"?>'))).rejects.toThrow(/Verarbeitungsanweisungen/)
 await expect(validateImageSource(svg('<rect style="fill:u\\72l(/api/settings?PRIVATE_MARKER)"/>'))).rejects.toThrow(/verschleierte/)
 await expect(validateImageSource(svg('<rect style="background-image:image-set(&quot;/api/settings?PRIVATE_MARKER&quot; 1x)"/>'))).rejects.toThrow(/verschleierte/)
 await expect(validateImageSource(svg('<rect fill="url(#local)" style="stroke:black;stroke-width:1"/>'))).resolves.toBeUndefined()
})
