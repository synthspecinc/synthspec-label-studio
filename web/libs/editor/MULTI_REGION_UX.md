# Label Studio multi-region UX implementation notes

This note tracks the downstream implementation described by
`docs/etc/label-studio-multi-region-ux-prd.md` and Linear issues TOOL-27 through
TOOL-31.

## TOOL-27 baseline

- Base commit: `7e67bdf1de351051cb0704e075ea37c72c5b4317`
- Working tree at start: clean
- Active editor: `web/libs/editor` in the current Label Studio monorepo
- Production standalone build: from `web/`, run
  `bun run lsf:build`
- Standalone server: from `web/`, run `bun libs/editor/server.mjs`; the build is
  served at `http://localhost:3000`.

### Reproducible pre-change behavior

Use `multiRegionConfig` and `multiRegionTask` from
`web/libs/editor/tests/integration/data/multi_region/workflows.ts`.

1. Select two regions in the Regions panel and invoke Create Relation. The
   global shortcut checks `annotation.highlightedNode`; this is null for a
   multi-selection, so relation target mode does not start.
2. Copy a selection containing a fixture, its text-label rectangle, and the
   relation between them. `Annotation.serializedSelection` includes all region
   result records sharing the selected logical IDs, including per-region
   TextArea records, but excludes relations.
3. Paste the copied JSON. `Annotation.appendResults` gives result records that
   shared an old ID one shared new ID, but the clipboard handler does not select
   the returned live regions. The pasted geometry therefore remains stacked
   over its source and is not immediately movable as an exclusive set.
4. A pre-existing image selection transformer can translate several selected
   transformable shapes using a transparent bounding-box background. Its
   history is frozen for the drag and its bounds are constrained as a set, but
   dragging an arbitrary selected member does not establish the requested
   snapshot-based shared-translation contract.

### Extension-point map

| Concern | Current extension point | Responsibility / test seam |
| --- | --- | --- |
| Selection | `src/stores/RegionStore.js` (`SelectionMap`) and `src/stores/Annotation/Annotation.js` (`selectAreas`, `selectedRegions`) | Stores live area references keyed by ID and supplies exclusive/additive selection actions. |
| Relation mode | `src/stores/Annotation/LinkingModes/RelationMode.js` and `LinkingModes.js` | Holds the pending source and accepts the next linked region. |
| Relation creation | `src/stores/RelationStore.js` | Creates, deduplicates, serializes, and deserializes ordinary pairwise relations. |
| Relation command | `src/stores/AppStore.js` and `src/components/SidePanels/DetailsPanel/RegionItem.tsx` | Binds `region:relation` and the existing Create Relation button. |
| Region clicks | `src/mixins/Regions.js` and `src/mixins/KonvaRegion.js` | Routes canvas/sidebar target clicks into the active linking mode. |
| Clipboard | `src/hooks/useRegionsCopyPaste.ts` | Reads/writes editor JSON on browser copy, cut, and paste events. |
| Logical result serialization / paste | `src/stores/Annotation/Annotation.js` (`serializedSelection`, `appendResults`, `deserializeResults`) | Serializes every result on a logical area and resolves result records into live areas. |
| Rectangle drag | `src/components/ImageView/ImageView.jsx`, `src/components/ImageTransformer/ImageTransformer.jsx`, and rectangle region models | Connects Konva drag events to model geometry and freezes history during transforms. |
| Coordinates and bounds | `src/tags/object/Image/Image.js` and `src/utils/image.js` | Converts canvas/internal coordinates and calculates/fits bounding boxes. |
| Undo / redo | `src/core/TimeTraveller.js` | Tracks `Annotation.trackedState`; `freeze`/`unfreeze` coalesce transient changes into one history item. |
| Notifications | `@humansignal/ui` toast provider in `src/components/App/App.jsx` and existing `useToast` consumers | Existing non-modal feedback style to reuse for command results and blocked mixed selections. |

### Existing regression conventions

- Store/model tests use Bun's Jest-compatible runner under
  `web/libs/editor/src/**/__tests__`, with `AppStore` fixtures for real MST
  references. Relation coverage starts in
  `src/stores/__tests__/RelationStore.test.js`; annotation serialization and
  history coverage starts in `src/stores/Annotation/__tests__`.
- Component tests use Testing Library and Bun under colocated `__tests__`
  directories.
- Browser coverage is Cypress under `web/libs/editor/tests/integration/e2e` and
  uses `@humansignal/frontend-test/helpers/LSF`. Relation conventions are in
  `e2e/relations/image_rectangle_regions.cy.ts`.

### Baseline verification results

These checks were run before any production behavior changed:

- `bun test --dom libs/editor/src/stores/__tests__/RelationStore.test.js
  libs/editor/src/stores/Annotation/__tests__/Annotation.test.js
  libs/editor/src/components/ImageView/__tests__/ImageView.test.jsx` failed in
  the shared Bun preload because the existing local installation could not
  resolve `@testing-library/jest-dom/matchers`; no test body ran (0 passed,
  3 preload errors).
- `bun run lsf:build` reached Vite but failed while loading
  `vite.config.editor.ts` with an undefined configuration error.
- `bunx tsc -p libs/editor/tsconfig.json --noEmit` selected an incompatible
  TypeScript toolchain from the incomplete install and reported removed
  `baseUrl`/`node10` options plus missing `composite` flags.

The locked web dependencies must be restored before project-result failures can
be distinguished from this baseline environment state.

### Implementation plan

1. TOOL-28: capture source IDs in relation mode, add one model-level batch
   relation action, connect the existing button/hotkey/click paths, retain the
   captured selection, coalesce history, and surface counts with the toast
   pattern.
2. TOOL-29: extend selection serialization to the induced relation subgraph;
   make `appendResults` clone immutably from a complete ID map; resolve and
   exclusively select the created live areas in both paste and duplicate paths.
3. TOOL-30: add a rectangle-only group-translation model primitive and bind it
   to member/transformer dragging with start snapshots, shared bounds, image
   coordinate conversion, and one frozen history transaction.
4. TOOL-31: add integrated regressions, run format/type/unit/Cypress/build
   gates, inspect wire JSON, and capture normal/zoomed browser evidence plus the
   deployable standalone bundle.

## Supported scope and limitations

Shared translation is intentionally limited to editable, visible Rectangle and
RectangleLabels regions on one Image object. Mixed geometry, multiple canvases,
group resize/rotation, persistent groups, alignment/distribution, and cross-task
clipboard behavior remain out of scope. Saved annotations continue to contain
only standard region results and pairwise `type: "relation"` results.

No paste offset was added: clones intentionally retain source coordinates and
appear above their sources through the existing append/z-order behavior. This
keeps paste semantics compatible while the exclusive clone selection makes the
new set immediately movable.

## Completion evidence (TOOL-28 through TOOL-31)

- TOOL-28: the existing relation command captures every valid selected source,
  creates all missing pairwise relations to the clicked target in one frozen
  history transaction, preserves direction/active-label behavior, reports
  created/skipped counts, retains bulk source selection, and cancels on Escape,
  tool changes, and annotation/task changes. The single-source path is retained.
- TOOL-29: clipboard serialization now contains complete logical regions plus
  their induced relation subgraph. Paste creates a complete old-ID/new-ID map
  before deserialization, drops external relations, remaps internal relations,
  resolves fresh live regions, and exclusively selects the newest pasted set.
- TOOL-30: selected editable Rectangle/RectangleLabels regions on one Image use
  an immutable pointer-down geometry snapshot and one clamped image-space
  delta. Re-entrant Konva drag-start events reuse that snapshot/history lock;
  release commits one undo step without changing member spacing or result data.
- TOOL-31: deterministic store and Cypress fixtures cover ten-source bulk
  relation creation, multi-record paste, remapped relations, repeated paste,
  1x/2.5x movement, set-level bounds, mixed-selection rejection, history, and
  wire serialization. The standalone production bundle is in
  `web/dist/libs/editor`.

### Verification run

- `bun test --silent --dom libs/editor/src/utils/__tests__/imageRegionTranslation.test.ts libs/editor/src/stores/Annotation/__tests__/multi-region-workflows.test.js`: 19 passed.
- Existing isolated regressions: RelationStore + ImageView 108 passed;
  RectRegion 37 passed; Annotation 63 passed.
- `bunx biome check <19 changed JS/TS files>`: passed, no fixes required.
- Cypress production run of
  `tests/integration/e2e/multi_region/workflows.cy.ts`: 2 passed, including ten
  relation sources and paste/move/undo/redo serialization.
- `bun run lsf:build`: passed; 10,302 modules transformed.
- Headed Chromium verification against the production bundle confirmed a real
  pointer drag moved all three pasted logical regions by the same nonzero delta,
  left source geometry untouched, and produced three history states (initial,
  paste, move). Two undos and two redos restored those states independently.

Evidence files (kept outside the source diff under `output/playwright`):

- `bulk-relations-10-sources.png`
- `pasted-selection-group-moved.png`
- `multi-region-real-pointer-group-move-success.png`
- `multi-region-annotation-export.json`

### Known baseline/tooling warnings

- The direct editor library TypeScript check is not currently a green monorepo
  gate: it reports the repository's existing unresolved CSS/global and unrelated
  UI type errors. The integration tsconfig also reports its existing missing
  Cypress type-library resolution despite Cypress being installed. Changed
  sources are covered by Biome, model/component regressions, Cypress, and the
  production build.
- Bun/jsdom model tests emit existing MobX out-of-bounds diagnostics and image
  request CORS noise while still exiting successfully.
- The production build emits existing stale Browserslist data, audio decoder
  externalization, and large-chunk warnings.
- Port 3000 was occupied by the workspace proxy during verification, so the
  standalone bundle and Cypress base URL used port 3100.
