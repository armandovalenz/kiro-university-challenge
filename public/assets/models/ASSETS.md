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

## Licensing rules (see `.kiro/skills/fps3d-assets/SKILL.md`)

- **Poly Haven** assets → CC0, no attribution required.
- **Poly Pizza** assets → often CC-BY; record the exact `polypizza_attribution`
  credit here. Prefer `licence="CC0"` filtered results to avoid attribution.
- Do **not** commit any model whose license you cannot name.
- Paid AI generators (Hyper3D Rodin, Hunyuan3D) are **not used** in this project.
