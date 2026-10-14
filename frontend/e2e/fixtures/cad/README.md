# CAD regression data

- `cube.step`, `cube.iges`, `assembly.brep`: fixtures from
  https://github.com/kovacsv/occt-import-js at tree
  `41e470890ae0f9dc69ac50ffd5fc73e03576f4eb`, respectively
  `test/testfiles/simple-basic-cube/cube.stp`,
  `test/testfiles/cube-10x10mm/Cube 10x10.igs`,
  `test/testfiles/cax-if-brep/as1_pe_203.brep`.
  Upstream LGPL-2.1 notices are copied with the engine.
- `entities.dwg`: `test/test-data/2000/entities-2d.dwg` from
  https://github.com/mlightcad/libredwg-web at tree
  `d0b7c53d55a923f323256d19a310af7bc0137245`.
  Its GPL-3.0 license is in `frontend/engine-sources/LICENSE-LibreDWG.txt`.

Tests import all three solid formats, validate exported triangles with Three.js,
parse real DWG->DXF bytes independently, and validate raster/PDF/text outputs.
No fixture is uploaded to a conversion service.
