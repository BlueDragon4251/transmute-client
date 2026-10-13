import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { checkpoint, extension, result, type ConversionOptions, type Result } from './common'
function validateGltf(json: unknown) {
  const gltf = json as { buffers?: { uri?: string }[]; images?: { uri?: string }[]; extensionsUsed?: string[] }
  if (gltf.extensionsUsed?.some(s => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(s))) throw Error('Komprimierte GLTF-Erweiterung nicht unterstützt')
  for (const value of [...gltf.buffers || [], ...gltf.images || []]) if (value.uri && !/^data:[a-zA-Z0-9/+.-]+;base64,/.test(value.uri)) throw Error('GLTF benötigt eingebettete Ressourcen. Externe Dateien/URLs werden niemals geladen.')
}
export async function meshConvertAdvanced(file: File, to: string, options: ConversionOptions): Promise<Result> {
  checkpoint(options, 10, '3D-Geometrie lokal lesen')
  const from = extension(file.name), scene = new THREE.Scene()
  if (from === 'gltf' || from === 'glb') {
    const bytes = await file.arrayBuffer()
    if (from === 'gltf') validateGltf(JSON.parse(new TextDecoder().decode(bytes)))
    else {
      const view = new DataView(bytes)
      if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw Error('Ungültiges GLB')
      const length = view.getUint32(12, true)
      if (20 + length > bytes.byteLength) throw Error('Ungültige GLB-JSON-Länge')
      validateGltf(JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))))
    }
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(url => { if (!url.startsWith('data:') && !url.startsWith('blob:')) throw Error('Externe 3D-Ressource blockiert'); return url })
    const gltf = await new GLTFLoader(manager).parseAsync(from === 'gltf' ? new TextDecoder().decode(bytes) : bytes, '')
    scene.add(gltf.scene)
  } else if (from === 'obj') scene.add(new OBJLoader().parse(await file.text()))
  else {
    const bytes = await file.arrayBuffer()
    const geometry = from === 'ply' ? new PLYLoader().parse(bytes) : new STLLoader().parse(bytes)
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()))
  }
  let triangles = 0
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      const g = obj.geometry, positions = g.getAttribute('position')
      if (positions) {
        for (let i = 0; i < positions.array.length; i++) if (!Number.isFinite(positions.array[i])) throw Error('3D-Datei enthält ungültige Koordinaten')
        triangles += (g.index?.count || positions.count) / 3
      }
    }
  })
  if (!triangles || triangles > 2_000_000) throw Error('Keine Mesh-Flächen oder mehr als 2 Millionen Dreiecke')
  checkpoint(options, 60, '3D-Geometrie lokal schreiben')
  try {
    if (to === 'obj') return result(new OBJExporter().parse(scene), 'obj', 'text/plain')
    if (to === 'stl') return result(new STLExporter().parse(scene, { binary: true }).buffer as ArrayBuffer, 'stl')
    if (to === 'ply') return result(new PLYExporter().parse(scene, () => {}, { binary: true }) as ArrayBuffer, 'ply')
    const exported = await new GLTFExporter().parseAsync(scene, { binary: to === 'glb', onlyVisible: false })
    return result(exported instanceof ArrayBuffer ? exported : JSON.stringify(exported), to, to === 'glb' ? 'model/gltf-binary' : 'model/gltf+json')
  } finally {
    scene.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); const materials = Array.isArray(obj.material) ? obj.material : [obj.material]; materials.forEach(m => { for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose(); m.dispose() }) } })
  }
}
