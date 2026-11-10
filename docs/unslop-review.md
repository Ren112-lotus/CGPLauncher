# UI refinement with unslop

Method: [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), licensed under CC BY 4.0.

## Direction

- Product: find, play, and maintain CGP's games.
- Character: quiet, precise, centered on the work.
- World: a game library and its editing desk.
- Moments: existing game artwork and thumbnails carry the color.
- Signature: a short blue selection line, shared between launcher and catalog manager.

The user confirmed this direction. Square corners, the real logo, the main section order, and existing features are retained.

## Audit

The catalog manager had blue surface gradients, colored placeholder artwork, independently colored icons, repeated rounded panels, dense bold labels, persistent helper copy, and oversized navigation rows. Its thumbnail appeared too late in the first screen. The launcher already had a coherent rectangular structure but still used blue-tinted surfaces, heavy title weights, large rows, and a different visual rhythm from the manager.

## Nine passes

1. Spacing: use 4px increments, 40px fields, compact 56px artwork rows, 16–32px page spacing, and consistent label alignment. The rows contain a thumbnail and two text lines, so they are taller than plain navigation items.
2. Color: use a graphite neutral ramp. Keep the CGP blue for selection and focus, neutral primary actions, and muted semantic status marks.
3. Icons: retain Lucide, normalize action icons and stroke weight, and remove decorative section icons from the manager. Missing artwork gets a neutral fallback.
4. Copy: remove redundant explanations, author-not-set labels, and breadcrumb repetition. Keep operational feedback, upload limits, and accessible field names.
5. Type: use the existing Windows font stack, primarily weights 400 and 500, with size and text role establishing hierarchy. Retain authored game titles and content verbatim.
6. Layout: retain sidebar, editor/hero, actions, and section order. Give the manager's thumbnail a 280px preview, remove enclosing panel boxes, and keep the mobile form in one column.
7. Details: keep all controls rectangular. Differentiate hover, selection, disabled, dirty, and keyboard focus states. Enable Save when the draft has changed.
8. Visuals: use the actual game artwork. No generated images or decorative filler were introduced.
9. Motion: keep sidebar transform/opacity feedback and loading indicators. Remove animated layout dimensions and retain reduced-motion support.

## Validation

Launcher: existing Node tests, real Electron game/maximize checks, CSS generation, and Windows packaging.
Manager: TypeScript checks, local API integration tests, browser search/selection/dirty-state checks, desktop inspection, and 390px form bounds. Production catalog records are compared before and after publication; UI testing writes only to the local preview database.
