# Math Man — Quiz Visual-Aid Images

Per-question **visual aids** for the Einstein quiz. Each file is a diagram or
photo for one **science** topic, shown above the choices when a matching
question appears (math questions have no image; images are strictly optional).

These are **Wikimedia Commons educational visual aids**, each under **CC0 /
Public Domain / CC-BY / CC-BY-SA**. Attribution is also shown **in-product**:
QuizModal renders a small muted caption (`<Artist> / <license> (Wikimedia
Commons)`) under each image card, so CC-BY / CC-BY-SA credit is satisfied where
the image is used. Unlike the Namco Pac-Man audio in `../../audio/` (demo /
non-commercial only), these are freely licensed and safe to ship with this
project; honor each license's attribution/share-alike terms if you reuse them
elsewhere.

- Source of truth for the mapping is **`images-manifest.json`** (topic →
  `{ file, license, licenseCode, artist, sourceUrl, commonsTitle, description,
  bytes }`), produced by `scripts/curate-question-images.mjs`.
- Each question record stores only the bare `image.file`; the UI builds the
  runtime path `assets/questions/images/<file>` (see
  `QUESTION_IMAGE_BASE_PATH` in `src/config.js`).
- A missing or broken image never blocks the quiz: `QuizModal` hides the whole
  image card on load error and the question still works text-only (graceful
  fallback — `.kiro/steering/tech.md`).

> This table is generated **from `images-manifest.json`**. If you add, remove,
> or re-license an image, update the manifest and regenerate this table so the
> two stay in sync.

## Images

| Topic | File | License | Artist | Source (Wikimedia Commons) |
| ----- | ---- | ------- | ------ | -------------------------- |
| adaptations | `adaptations.png` | CC BY 3.0 | Fccardiff | [File:Pincushion cactus plants at the Arizona-Sonora Desert Museum.jpg](https://commons.wikimedia.org/wiki/File:Pincushion_cactus_plants_at_the_Arizona-Sonora_Desert_Museum.jpg) |
| astronomy | `astronomy.png` | CC BY 2.0 | Steve Jurvetson from Los Altos, USA | [File:The Future Physics of Planet Earth (40217810733).jpg](https://commons.wikimedia.org/wiki/File:The_Future_Physics_of_Planet_Earth_(40217810733).jpg) |
| atoms | `atoms.png` | CC BY-SA 3.0 | Zamby | [File:Atomic folding structure illustration.png](https://commons.wikimedia.org/wiki/File:Atomic_folding_structure_illustration.png) |
| body-systems | `body-systems.png` | Public domain | LadyofHats, Mariana Ruiz Villarreal | [File:Circulatory System en.svg](https://commons.wikimedia.org/wiki/File:Circulatory_System_en.svg) |
| cells | `cells.png` | CC0 | Kelvinsong | [File:Animal cell cycle-en.svg](https://commons.wikimedia.org/wiki/File:Animal_cell_cycle-en.svg) |
| chemical-changes | `chemical-changes.png` | Public domain | Barr, William M. (William Miller) | [File:A catechism on the combustion of coal and the prevention of smoke; a practical treatise by William M. Barr.djvu](https://commons.wikimedia.org/wiki/File:A_catechism_on_the_combustion_of_coal_and_the_prevention_of_smoke;_a_practical_treatise_by_William_M._Barr.djvu) |
| climate | `climate.png` | CC BY-SA 3.0 | File:World Köppen Map.png: Original file by Peel, M. C., Finlayson, B. L., and McMahon, T. A. (University of Melbourne). Derivative work: Modifications by user Br-Sc-94, (User talk). Cropping &amp; addition of map legend-color box-to summary info by 2know4power, (User talk). | [File:India and South Asia Köppen climate map with legend.jpg](https://commons.wikimedia.org/wiki/File:India_and_South_Asia_K%C3%B6ppen_climate_map_with_legend.jpg) |
| earth-structure | `earth-structure.png` | CC BY-SA 3.0 | Kelvinsong | [File:Earth poster.svg](https://commons.wikimedia.org/wiki/File:Earth_poster.svg) |
| earth-systems | `earth-systems.png` | CC BY-SA 4.0 | Sémhur (talk) | [File:Rock shelter formation by frost weathering.svg](https://commons.wikimedia.org/wiki/File:Rock_shelter_formation_by_frost_weathering.svg) |
| ecosystems | `ecosystems.png` | CC BY 4.0 | Heymans, J.J., Coll, M., Libralato, S., Morissette, L. and Christensen, V. | [File:Food web of the Venice lagoon.png](https://commons.wikimedia.org/wiki/File:Food_web_of_the_Venice_lagoon.png) |
| food-webs | `food-webs.png` | CC BY-SA 4.0 | Swiggity.Swag.YOLO.Bro | [File:Ecological Pyramid.svg](https://commons.wikimedia.org/wiki/File:Ecological_Pyramid.svg) |
| genetics | `genetics.png` | Public domain | Unknown | [File:DNA-structure-and-bases.png](https://commons.wikimedia.org/wiki/File:DNA-structure-and-bases.png) |
| gravity | `gravity.png` | CC0 | Noleander | [File:Gravity Dam Cross Section Diagram.svg](https://commons.wikimedia.org/wiki/File:Gravity_Dam_Cross_Section_Diagram.svg) |
| heat-transfer | `heat-transfer.png` | CC BY-SA 3.0 | The original uploader was Harroschmeling at German Wikipedia. | [File:Convection-snapshot.png](https://commons.wikimedia.org/wiki/File:Convection-snapshot.png) |
| homeostasis | `homeostasis.png` | CC BY-SA 4.0 | E L Yekutiel | [File:Biological thermoregulation categories, Hebrew.svg](https://commons.wikimedia.org/wiki/File:Biological_thermoregulation_categories,_Hebrew.svg) |
| human-body | `human-body.png` | Public domain | LadyofHats, Jmarchn | [File:Respiratory system complete en.svg](https://commons.wikimedia.org/wiki/File:Respiratory_system_complete_en.svg) |
| kinetic-energy | `kinetic-energy.png` | CC0 | SCHolar44 | [File:Diagram comparing kinetic energy applicable to conventional and high-speed trains.png](https://commons.wikimedia.org/wiki/File:Diagram_comparing_kinetic_energy_applicable_to_conventional_and_high-speed_trains.png) |
| matter | `matter.png` | Public domain | Thomas Andrews | [File:PV diagram of CO2, from "On the Continuity of the Gaseous and Liquid States of Matter".png](https://commons.wikimedia.org/wiki/File:PV_diagram_of_CO2,_from_%22On_the_Continuity_of_the_Gaseous_and_Liquid_States_of_Matter%22.png) |
| mixtures | `mixtures.png` | CC BY-SA 4.0 | Encik Tekateki | [File:Aliran Proses Untuk Pembuatan Insulin.png](https://commons.wikimedia.org/wiki/File:Aliran_Proses_Untuk_Pembuatan_Insulin.png) |
| motion | `motion.png` | Public domain | Sjlegg at English Wikibooks | [File:Distance-time graph example.svg](https://commons.wikimedia.org/wiki/File:Distance-time_graph_example.svg) |
| photosynthesis | `photosynthesis.png` | CC BY-SA 3.0 | Kelvinsong | [File:C4 photosynthesis is less complicated.svg](https://commons.wikimedia.org/wiki/File:C4_photosynthesis_is_less_complicated.svg) |
| plants | `plants.png` | CC BY-SA 4.0 | Nishānt Omm | [File:Leaf Structure-hi.png](https://commons.wikimedia.org/wiki/File:Leaf_Structure-hi.png) |
| plate-tectonics | `plate-tectonics.png` | CC BY 4.0 | domdomegg | [File:Continental-continental constructive plate boundary.svg](https://commons.wikimedia.org/wiki/File:Continental-continental_constructive_plate_boundary.svg) |
| scientific-practice | `scientific-practice.png` | Public domain | Phillipe Rekacewicz | [File:Atmosphere composition diagram-en.svg](https://commons.wikimedia.org/wiki/File:Atmosphere_composition_diagram-en.svg) |
| solar-system | `solar-system.png` | Public domain | Reynolds, James Emslie, John | [File:Diagram illustrating the earth's annual revolution round the sun, and its diurnal rotation on its axis. showing its position (IA dr diagram-illustrating-the-earths-annual-revolution-round-the-sun-and-its-d-3432014).jpg](https://commons.wikimedia.org/wiki/File:Diagram_illustrating_the_earth%27s_annual_revolution_round_the_sun,_and_its_diurnal_rotation_on_its_axis._showing_its_position_(IA_dr_diagram-illustrating-the-earths-annual-revolution-round-the-sun-and-its-d-3432014).jpg) |
| thermal-energy | `thermal-energy.png` | Public domain | Chcastan | [File:Heat conduction.png](https://commons.wikimedia.org/wiki/File:Heat_conduction.png) |
| water-cycle | `water-cycle.png` | CC BY-SA 4.0 | Tttrung | [File:Water cycle diagram-vi.svg](https://commons.wikimedia.org/wiki/File:Water_cycle_diagram-vi.svg) |
| waves | `waves.png` | CC BY 4.0 | BobORourke | [File:Sound Wave - A Major Chord - Ratios Separated.png](https://commons.wikimedia.org/wiki/File:Sound_Wave_-_A_Major_Chord_-_Ratios_Separated.png) |
| weather | `weather.png` | CC BY-SA 4.0 | Franz van Duns | [File:Mercury barometer - Pariser Maasz - Germany - 19th century.jpg](https://commons.wikimedia.org/wiki/File:Mercury_barometer_-_Pariser_Maasz_-_Germany_-_19th_century.jpg) |

## Still-missing topics (no image yet)

Six science topics have no curated image and therefore no `image` field on their
questions — the quiz shows them text-only. `scripts/curate-question-images.mjs`
can resume these:

`forces`, `energy`, `natural-selection`, `chemical-reactions`,
`potential-energy`, `earth-history`.
