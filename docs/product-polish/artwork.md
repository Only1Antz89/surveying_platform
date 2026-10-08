# Surveynt architectural artwork

Generated with the built-in image-generation tool using the supplied period-house illustration as a style reference. These are generic illustrations, never photographs, measured models, title plans, survey findings or property evidence. No RICS form/template content was changed.

## Production assets

All variants are optimised square 960-pixel WebP files in `apps/web/public/property-artwork`. The original period terrace remains `apps/web/public/surveynt-architecture.webp`. Source PNGs are retained in Codex's generated-image folder; the application references only workspace assets.

- [detached](../../apps/web/public/property-artwork/detached.webp)
- [semi-detached](../../apps/web/public/property-artwork/semi-detached.webp)
- [bungalow](../../apps/web/public/property-artwork/bungalow.webp)
- [apartments](../../apps/web/public/property-artwork/apartments.webp)
- [commercial](../../apps/web/public/property-artwork/commercial.webp)
- [rural-land](../../apps/web/public/property-artwork/rural-land.webp)

Selection uses only the existing property-type text, with explicit semi-detached, bungalow, flat, commercial and land precedence. Unrecognised types receive a generic illustration rather than an inferred classification. Artwork is separate from property evidence and cannot mutate identity, coordinates, observations or boundaries.

## Prompt set

Each subject was generated separately with this common brief:

> Use case: stylized-concept. Asset type: square architectural illustration for Surveynt property software. Input image is a STYLE REFERENCE ONLY, not an edit target. Create ONE standalone high-fidelity illustration of the subject below. Match the reference's refined isometric architectural dollhouse render, pale ice-blue technical drafting background, fine faint non-legible construction guide lines, realistic warm materials, restrained bright-blue section-edge accents, soft daylight shadows and crisp professional detail. Entire subject visible and centred with breathing room, square composition, consistent viewpoint and scale, exceptionally polished. No text, labels, logos, people, sparkles, wands or watermarks. This is generic illustrative architecture/land, not a measured model, title plan or property-specific evidence. Do not include multiple panels or contact sheet.

### detached

A two-storey detached British brick house with pitched slate roof, garden, a small drive, and carefully arranged cutaway rooms showing the stair, living space, kitchen and bedrooms.

### semi-detached

A pair of two-storey British 1930s semi-detached houses. One side remains exterior to make the shared party wall clear; the other is an elegant cutaway showing rooms and roof structure. Small front gardens.

### bungalow

A single-storey British bungalow with a modest pitched tiled roof, roof structure visible in a limited cutaway, accessible living rooms, garden and a small drive. Clearly single storey, not a two-storey house.

### apartments

A modern four-storey British apartment building with brick and slate-white facade, distinct self-contained flats and a shared stair shown in a precise cutaway. No luxury tower or skyscraper.

### commercial

A low-rise British commercial premises with a modest glazed office front, two-storey office area and a single-storey light-industrial workshop bay. Cutaway reveals meeting space, offices and workshop, no brand signs.

### rural-land

A compact isometric English rural land parcel vignette: gently rolling pasture, a cultivated field, hedgerows, a few trees, a small stream and a modest farm outbuilding. A neat sectional base revealing neutral soil strata, without inventing geology data. No glowing legal boundary, no cadastral measurements.


## Verification

Artwork selection has unit coverage including unknown types and semi-detached precedence. The local property overview displays its image and caveat, with keyboard Arrow/Home tab navigation. Phone and desktop checks are separate from production stakeholder acceptance. The image prompt is a generation instruction, not a factual certification of physical construction, absence of marks or depicted soil strata.
