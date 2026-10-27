# Model manifest

The `.glb` files are **not** in this repo. They are ~452 MB of third-party assets
(Sketchfab free licences plus one Tripo-generated station), which is too large and
not ours to redistribute. Drop them into `models/` next to `index.html` and the app
runs.

Only the **optimised** files are needed — the originals are what they were built
from.

## Required files

| Save as | Ship | Derived from |
|---|---|---|
| `models/star_trek_-_sovereign_class_opt.glb` | Enterprise-E | `star_trek_-_sovereign_class.glb` (13 MB) |
| `models/voyager_ncc_74656_opt.glb` | Voyager | `voyager_ncc_74656.glb` (15 MB) |
| `models/star_trek_-_dderidex_class_warbird_opt.glb` | Dderidex Warbird | `star_trek_-_dderidex_class_warbird.glb` (4.9 MB) |
| `models/star_trek_-_bird_of_prey_enterprise_opt.glb` | Bird of Prey | `star_trek_-_bird_of_prey_enterprise.glb` (8.2 MB) |
| `models/defiant_opt.glb` | Defiant | `uss_defiant_star_trek_zeo.glb` (124 MB) |
| `models/enterprised_opt.glb` | Enterprise-D | `uss_enterprise_d_star_trek_tng.glb` (127 MB) |
| `models/3D.glb` | the station | Tripo export, 2.8 MB |

Each optimised file is used **as stored** — the filenames are hard-coded in the
`FLEET` array in `app.js` and in the station loader. If you rename them, rename the
references too.

## Regenerating the optimised files

```bash
npx --yes @gltf-transform/cli@latest optimize <original>.glb <name>_opt.glb \
  --texture-compress webp --texture-size 1024
```

Defiant went 124 MB → 17 MB, Enterprise-D 127 MB → 11 MB, and the four light hulls
41 MB → 4.2 MB. The optimised files use `EXT_meshopt_compression`, which is why
`index.html` loads `meshopt_decoder.js`; without it the loader fails on them.

## The station

`models/3D.glb` is a Tripo-generated asset normalised to a 2×2×2 cube. The loader
rescales it from its own bounding box, so no Blender pass is needed. If the file is
missing the app logs an error and builds the old docking ring instead, so the scene
still has an anchor.
