# Surveynt property and land artwork expansion

Created 5 October 2026 with the built-in image-generation tool, using the imagegen skill and the user's two supplied images as visual direction. No API/CLI fallback was used. Existing artwork remains unchanged.

Eight full-resolution PNG originals are stored in `assets/property-artwork/`; 960 × 960 WebP copies are stored in `apps/web/public/property-artwork/`. The property-artwork selector maps explicitly recorded types to the matching artwork; it never changes property identity or survey answers. Standard period terraces retain their existing artwork; the new terraced-row image matches a terraced row/street label.

All images depict fictional illustrative scenes. Blue edges are model/cutaway accents, not legal boundaries. Soil textures are not geological evidence. Coastal water is not a flood assessment. Development wireframes are conceptual, not granted planning permission. They must never be inserted into issued reports as photographs, measured models or site evidence.

## System assignment

Create/edit property forms share suggestions from `propertyTypeOptions`, with an explicit artwork key for each. Legacy/custom descriptions are retained, and editing the recorded type updates the property page's artwork automatically without storing a separate image override. No existing property classifications are rewritten.

| Recorded type | Artwork |
| --- | --- |
| Terraced house / period terrace | Existing period terrace |
| Terraced row / street | New terraced row |
| Detached house | Detached |
| Semi-detached house | Semi-detached |
| Bungalow | Bungalow |
| Stone cottage | Cottage |
| Flat / apartment | Apartments |
| Maisonette | Maisonette |
| Office building | Office |
| Industrial warehouse / workshop | Warehouse |
| Commercial / retail premises | Commercial |
| Agricultural / rural land | Rural land |
| Woodland / forestry | Woodland |
| Brownfield / development land / building plot | Development land |
| Coastal / wetland terrain | Coastal wetland |
| Unknown / not recorded | Explicitly generic architectural illustration |

Specific building subtypes take precedence over location descriptors: coastal/woodland cottages stay cottages, coastal apartments stay apartments, and rural detached houses stay detached. Industrial land remains land. Unknown "rural property" does not imply a land classification. Every registered artwork has a corresponding suggested type; mapping and form-render tests cover these assignments.

## Catalogue and exact generation prompts

### terraced-row

![Illustrative terraced-row](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/terraced-row.png>)

Original: `assets/property-artwork/terraced-row.png` · Web: `apps/web/public/property-artwork/terraced-row.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE premium square architectural diorama of a British Victorian terraced row of three houses, with the central home opened in a believable three-floor sectional cutaway revealing furnished rooms, stairs, roof timbers and brick construction. Standalone full scene, not a collage. Match this visual direction precisely: high-fidelity tactile miniature architecture, elevated isometric three-quarter camera, warm natural interior materials, slate tiled roofs and red brick, restrained vivid electric-blue illumination along exposed cutaway edges, white/pale icy-blue background with very faint architectural drafting grid and sketched distant trees. Soft daylight and ambient occlusion, crisp construction details, plausible connected interiors, small landscaped gardens, centred composition with generous 10% margins, entire foundation visible. Palette blue/slate/white with natural materials, professional not sci-fi. No people, text, logos, labels, watermarks, AI symbols, sparkles or starbursts. Illustrative imaginary property, not measured survey geometry. Render a single polished square image suitable for a property-type card.
```

### cottage

![Illustrative cottage](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/cottage.png>)

Original: `assets/property-artwork/cottage.png` · Web: `apps/web/public/property-artwork/cottage.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE single premium square high-fidelity architectural/landscape diorama, not a collage. Elevated isometric three-quarter camera; tactile realistic miniature materials; restrained electric-blue accents tracing sectional edges; pale icy-blue/white background with faint technical drafting grid and ghosted line-drawing vegetation. Natural daylight, refined ambient occlusion, sharp realistic details, generous 10% margins, full isolated model and base visible. Cohesive blue/slate/white architectural brand with natural brick, timber and vegetation. No people, text, logos, watermarks, labels, sparkles or starbursts. Imaginary illustrative scene, not measured property geometry, legal boundaries, geological or flood-risk evidence. Subject: a traditional English stone cottage with two floors, pitched slate roof, brick chimney, cottage garden and stone wall. Open the front-right half as an architectural cutaway revealing cosy furnished rooms, timber stair and visible roof rafters. Retain an intact stone facade on the left. Blue accents on cut planes only, not neon-filled rooms.
```

### maisonette

![Illustrative maisonette](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/maisonette.png>)

Original: `assets/property-artwork/maisonette.png` · Web: `apps/web/public/property-artwork/maisonette.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE single premium square high-fidelity architectural/landscape diorama, not a collage. Elevated isometric three-quarter camera; tactile realistic miniature materials; restrained electric-blue accents tracing sectional edges; pale icy-blue/white background with faint technical drafting grid and ghosted line-drawing vegetation. Natural daylight, refined ambient occlusion, sharp realistic details, generous 10% margins, full isolated model and base visible. Cohesive blue/slate/white architectural brand with natural brick, timber and vegetation. No people, text, logos, watermarks, labels, sparkles or starbursts. Imaginary illustrative scene, not measured property geometry, legal boundaries, geological or flood-risk evidence. Subject: a believable British two-storey maisonette above a small ground-floor residential flat, separate front entrances and compact rear garden, red brick with white render detailing and pitched slate roof. A sectional cutaway reveals the maisonette's internal stair connecting its own two floors, kitchen, living room, bedrooms and bathroom; distinct ground-floor flat with no implied connection. Blue cut-plane accents. No shop or high-rise.
```

### office

![Illustrative office](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/office.png>)

Original: `assets/property-artwork/office.png` · Web: `apps/web/public/property-artwork/office.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE single premium square high-fidelity architectural/landscape diorama, not a collage. Elevated isometric three-quarter camera; tactile realistic miniature materials; restrained electric-blue accents tracing sectional edges; pale icy-blue/white background with faint technical drafting grid and ghosted line-drawing vegetation. Natural daylight, refined ambient occlusion, sharp realistic details, generous 10% margins, full isolated model and base visible. Cohesive blue/slate/white architectural brand with natural brick, timber and vegetation. No people, text, logos, watermarks, labels, sparkles or starbursts. Imaginary illustrative scene, not measured property geometry, legal boundaries, geological or flood-risk evidence. Subject: a contemporary British three-storey office building, glass and pale stone facade, flat roof with tidy plant enclosure and modest landscaping. Open front-right elevation as a sectional cutaway showing ground-floor reception, upper meeting rooms and open-plan desks, central stair core and realistic structural floor plates. Fine blue cut-plane outlines, professional restrained contemporary architecture.
```

### warehouse

![Illustrative warehouse](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/warehouse.png>)

Original: `assets/property-artwork/warehouse.png` · Web: `apps/web/public/property-artwork/warehouse.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE single premium square high-fidelity architectural/landscape diorama, not a collage. Elevated isometric three-quarter camera; tactile realistic miniature materials; restrained electric-blue accents tracing sectional edges; pale icy-blue/white background with faint technical drafting grid and ghosted line-drawing vegetation. Natural daylight, refined ambient occlusion, sharp realistic details, generous 10% margins, full isolated model and base visible. Cohesive blue/slate/white architectural brand with natural brick, timber and vegetation. No people, text, logos, watermarks, labels, sparkles or starbursts. Imaginary illustrative scene, not measured property geometry, legal boundaries, geological or flood-risk evidence. Subject: a British light-industrial warehouse with steel portal frame, dark slate profiled metal roof, brick/plinth walls, loading door, small attached two-floor office and paved service yard. Sectional cutaway reveals clear-span storage area with safe organized shelving, roof structure and office rooms. No people, trucks or logos. Blue sectional edges and believable industrial construction.
```

### woodland

![Illustrative woodland](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/woodland.png>)

Original: `assets/property-artwork/woodland.png` · Web: `apps/web/public/property-artwork/woodland.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE single premium square high-fidelity architectural/landscape diorama, not a collage. Elevated isometric three-quarter camera; tactile realistic miniature materials; restrained electric-blue accents tracing sectional edges; pale icy-blue/white background with faint technical drafting grid and ghosted line-drawing vegetation. Natural daylight, refined ambient occlusion, sharp realistic details, generous 10% margins, full isolated model and base visible. Cohesive blue/slate/white architectural brand with natural brick, timber and vegetation. No people, text, logos, watermarks, labels, sparkles or starbursts. Imaginary illustrative scene, not measured property geometry, legal boundaries, geological or flood-risk evidence. Subject: a small English mixed woodland parcel as a square raised terrain block, mature oaks and birches, varied understory, a winding footpath and gentle stream, natural clearings. Exposed sides show neutral illustrative earth texture, not a scientific stratigraphy claim. Thin blue accent around the model's cut perimeter only, not a legal boundary, woodland leaves richly detailed and softly sunlit. No farm house, buildings or livestock.
```

### development-land

![Illustrative development-land](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/development-land.png>)

Original: `assets/property-artwork/development-land.png` · Web: `apps/web/public/property-artwork/development-land.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE single premium square high-fidelity architectural/landscape diorama, not a collage. Elevated isometric three-quarter camera; tactile realistic miniature materials; restrained electric-blue accents tracing sectional edges; pale icy-blue/white background with faint technical drafting grid and ghosted line-drawing vegetation. Natural daylight, refined ambient occlusion, sharp realistic details, generous 10% margins, full isolated model and base visible. Cohesive blue/slate/white architectural brand with natural brick, timber and vegetation. No people, text, logos, watermarks, labels, sparkles or starbursts. Imaginary illustrative scene, not measured property geometry, legal boundaries, geological or flood-risk evidence. Subject: a British brownfield redevelopment site as a square raised terrain diorama. Show a disused low brick workshop shell, remnants of concrete slab, rough grass and scrub, a small access track and a modest edge of street pavement. One corner displays a restrained translucent blue wireframe indicative massing concept above the vacant plot, clearly conceptual-looking with no planning stamp or implied approval. No construction workers, heavy machinery or finished housing. Exposed base with generic soil texture, not contamination or ground-risk evidence.
```

### coastal-wetland

![Illustrative coastal-wetland](</Users/anthonyosei/Documents/Clifton Surveyors/surveying_platform/assets/property-artwork/coastal-wetland.png>)

Original: `assets/property-artwork/coastal-wetland.png` · Web: `apps/web/public/property-artwork/coastal-wetland.webp`

```text
Use case: stylized-concept. Asset: Surveynt UK property-platform illustration. Create ONE single premium square high-fidelity architectural/landscape diorama, not a collage. Elevated isometric three-quarter camera; tactile realistic miniature materials; restrained electric-blue accents tracing sectional edges; pale icy-blue/white background with faint technical drafting grid and ghosted line-drawing vegetation. Natural daylight, refined ambient occlusion, sharp realistic details, generous 10% margins, full isolated model and base visible. Cohesive blue/slate/white architectural brand with natural brick, timber and vegetation. No people, text, logos, watermarks, labels, sparkles or starbursts. Imaginary illustrative scene, not measured property geometry, legal boundaries, geological or flood-risk evidence. Subject: a British coastal marsh landscape as a square raised terrain diorama: sinuous tidal creek, reeds and saltmarsh grass, small sandy dune ridge with marram grass, distant edge of calm blue water, one simple footpath. Natural landscape with no buildings, flood zones, hazard symbols, annotations or risk claims. Fine blue model-cut perimeter and exposed generic soil/sediment-textured sides purely illustrative, luminous soft daylight.
```
