# 3D Model Assets (`public/assets/models/`)

Web-ready 3D models for Math Man's first-person 3D mode. All models are stored
as **`.glb`** (glTF 2.0 binary) so Three.js can load them directly via
`GLTFLoader`. Keep models low-poly and reuse materials — this is a browser game.

> Generated/imported via the `fps3d-asset-forge` agent (Blender MCP). Every file
> below must record its **source**, **license**, and **attribution** (if any).
> Prefer **CC0** (no attribution). If **CC-BY**, the credit line is mandatory.

## Manifest

| File | Source | Prompt / Asset ID | License | Attribution | Notes |
|------|--------|-------------------|---------|-------------|-------|
| `ghost_red.glb` | Hand-built in Blender via Blender MCP (primitives: UV sphere body sculpted into a dome + scalloped skirt, plus sphere eyes/pupils) | N/A — procedurally modeled, not from an external library | Project-original asset (creator-made geometry); no third-party license applies | None required | 406 verts, 3 material slots (red body, white eyes, black pupils). Solid color materials only, no textures. Low-poly, ~24.8 KB GLB. Represents one Einstein-ghost color (red); duplicate + recolor material for pink/cyan/orange variants per `config.js` ghost colors. |
| `cherry.glb` | Hand-built in Blender via Blender MCP (primitives: two UV spheres for the cherry bodies, two thin cylinders for stems angled to a shared point, a scaled cone for the leaf); bodies UV-unwrapped (smart project) and textured with `images/textures/cherry_skin_01.png` | N/A — procedurally modeled, not from an external library. Texture source: Draw Things (local Stable Diffusion), logged in `images/ASSETS.md` | Project-original asset (creator-made geometry + locally generated texture); no third-party license applies | None required | 260 verts, 3 material slots (textured red body, solid green stem, solid green leaf). Low-poly, ~122 KB GLB (texture embedded). Fruit prop for the FP3D collectible/bonus-fruit marker; not yet wired into a config key. |
| `banana.glb` | Hand-built in Blender via Blender MCP (a 3-point Bezier curve with a tapered bevel profile converted to mesh for the curved body, plus a small cone for the stem tip); body UV-unwrapped (smart project) and textured with `images/textures/banana_peel_01.png` | N/A — procedurally modeled, not from an external library. Texture source: Draw Things (local Stable Diffusion), logged in `images/ASSETS.md` | Project-original asset (creator-made geometry + locally generated texture); no third-party license applies | None required | 364 verts, 2 material slots (textured yellow body, solid dark stem tip). Low-poly, ~124 KB GLB (texture embedded). Fruit prop for the FP3D collectible/bonus-fruit marker; not yet wired into a config key. |
| `orange.glb` | Hand-built in Blender via Blender MCP (primitives: a UV sphere flattened on the Z axis for the peel, a small cylinder stem, a scaled cone leaf); peel UV-unwrapped (smart project) and textured with `images/textures/orange_rind_01.png` | N/A — procedurally modeled, not from an external library. Texture source: Draw Things (local Stable Diffusion), logged in `images/ASSETS.md` | Project-original asset (creator-made geometry + locally generated texture); no third-party license applies | None required | 204 verts, 3 material slots (textured orange peel, solid green stem, solid green leaf). Low-poly, ~128 KB GLB (texture embedded). Fruit prop for the FP3D collectible/bonus-fruit marker; not yet wired into a config key. |

## Licensing rules (see `.kiro/skills/fps3d-assets/SKILL.md`)

- **Poly Haven** assets → CC0, no attribution required.
- **Poly Pizza** assets → often CC-BY; record the exact `polypizza_attribution`
  credit here. Prefer `licence="CC0"` filtered results to avoid attribution.
- Do **not** commit any model whose license you cannot name.
- Paid AI generators (Hyper3D Rodin, Hunyuan3D) are **not used** in this project.
