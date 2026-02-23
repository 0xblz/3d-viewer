# 3D Viewer

Browser-based 3D model viewer at [3d.blaze.design](https://3d.blaze.design). Open and inspect 3D files locally — nothing is uploaded or stored. A project by [blaze.design](https://blaze.design).

## Tech Stack

- **Jekyll** static site — no backend, no database
- **Three.js** (`0.160.0`) via ES module importmap from jsdom CDN
- **PicoCSS** (`v2`) for base styles
- **SCSS** with nesting compiled by Jekyll (`assets/css/style.scss`)
- **Font Awesome** (`6.5.1`) for icons
- **Geist Mono** font from Google Fonts

## Project Structure

```
_layouts/
  default.html         # Base HTML layout with head, meta, OG tags
_includes/
  modals.html          # All dialog modals (open, about, privacy, terms)
assets/
  css/style.scss       # All styles (SCSS with nesting, Jekyll front matter)
  js/viewer.js         # Three.js viewer — all 3D logic lives here
  images/
    logo.svg           # Gradient cube logo (used in header)
    og.png             # OG/social share image
    favicon.png        # Favicon
index.html             # Main viewer page (body_class: viewer)
404.html               # Not-found page
_config.yml            # Jekyll config
AC20-FZK-Haus.ifc      # Default IFC model loaded on boot
```

## Key Conventions

- **No uploads, no server storage.** All file processing happens in the browser via FileReader API.
- **SCSS** goes entirely in `assets/css/style.scss` with `---` front matter at the top. No `_sass/` partials, no `@import`.
- **Body scoping:** The full-screen fixed layout is scoped to `body.viewer` so the 404 page renders normally. Set via `body_class: viewer` in index.html front matter.
- **Per-page robots** are set via `robots:` front matter; the layout defaults to `index, follow`.
- **ES module importmap** in index.html maps Three.js and its addons from jsdom CDN — no build step required.

## Supported Formats

| Format | Loader |
|--------|--------|
| DAE | ColladaLoader |
| OBJ | OBJLoader |
| GLB / GLTF | GLTFLoader |
| STL | STLLoader |
| FBX | FBXLoader |
| IFC | web-ifc-three IFCLoader |
| 3DS | TDSLoader |
| WRL | VRMLLoader |
| PLY | PLYLoader |

## Viewer Features

- Orbit controls (rotate, zoom, pan)
- Auto-rotate toggle
- Wireframe toggle
- Isometric view toggle
- Side / top view presets
- Grid overlay
- Distance measurement (ruler mode)
- Camera target repositioning
- Background color toggle
- Lighting toggle
- PNG export (2048×2048)
- Keyboard shortcuts

## Dev

```
bundle exec jekyll serve
```
