if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

mockModule("keymaster", () => {
  let scope = "all";
  const keymaster = () => {};
  keymaster.unbind = () => {};
  keymaster.setScope = (nextScope) => {
    scope = nextScope ?? scope;
  };
  keymaster.getScope = () => scope;
  return { __esModule: true, default: keymaster };
});

import "../../../tags/visual/View";
import "../../../tags/object/Image/Image.js";
import "../../../tags/control/RectangleLabels.jsx";
import "../../../tags/control/TextArea/TextArea.jsx";
import "../../../tags/control/Relations.js";
import "../../../tags/control/Relation.js";
import AppStore from "../../AppStore";
import { CREATE_RELATION_MODE } from "../LinkingModes";

const CONFIG = `
  <View>
    <Image name="drawing" value="$image" />
    <RectangleLabels name="region_type" toName="drawing">
      <Label value="Fixture" />
      <Label value="Text label" />
    </RectangleLabels>
    <TextArea name="transcription" toName="drawing" perRegion="true" editable="true" />
    <Relations><Relation value="has_label" /></Relations>
  </View>
`;

const rectangle = (id, label, x, y) => ({
  id,
  from_name: "region_type",
  to_name: "drawing",
  type: "rectanglelabels",
  value: { x, y, width: 10, height: 10, rotation: 0, rectanglelabels: [label] },
});

const transcription = (id, text) => ({
  id,
  from_name: "transcription",
  to_name: "drawing",
  type: "textarea",
  value: { text: [text] },
});

const relation = (fromId, toId, direction = "right", labels = ["has_label"]) => ({
  type: "relation",
  from_id: fromId,
  to_id: toId,
  direction,
  ...(labels ? { labels } : {}),
});

const createAnnotation = (results = []) => {
  const store = AppStore.create(
    {
      config: CONFIG,
      task: { id: 1, data: JSON.stringify({ image: "https://example.com/drawing.png" }) },
      interfaces: ["basic"],
    },
    {
      events: { hasEvent: mock(() => false), invoke: mock() },
      hotkeys: {
        addKey: mock(),
        removeKey: mock(),
        removeNamed: mock(),
        overwriteNamed: mock(),
        unbindAll: mock(),
        setScope: mock(),
      },
      messages: {},
      settings: {},
    },
  );

  store.initializeStore({});
  const annotation = store.annotationStore.addAnnotation({ result: [] });
  store.annotationStore.selectAnnotation(annotation.id);
  annotation.deserializeResults(results);
  annotation.updateObjects();
  annotation.reinitHistory();

  return annotation;
};

const area = (annotation, cleanId) => annotation.regions.find((region) => region.cleanId === cleanId);

describe("multi-region relations (TOOL-28)", () => {
  it("creates one directed relation per captured source in one undoable operation", () => {
    const annotation = createAnnotation([
      rectangle("fixture-1", "Fixture", 5, 5),
      rectangle("fixture-2", "Fixture", 25, 5),
      rectangle("label-1", "Text label", 50, 5),
    ]);
    const sources = [area(annotation, "fixture-1"), area(annotation, "fixture-2")];
    const target = area(annotation, "label-1");

    annotation.selectAreas(sources);
    annotation.startLinkingMode(CREATE_RELATION_MODE, sources);
    const result = annotation.addLinkedRegion(target);
    annotation.stopLinkingMode();

    expect(result).toMatchObject({ created: 2, skipped: 0, sourceCount: 2, isBulk: true });
    expect(annotation.relationStore.serialize()).toEqual([
      relation("fixture-1", "label-1", "right", null),
      relation("fixture-2", "label-1", "right", null),
    ]);
    expect(annotation.selectedRegions.map((region) => region.cleanId)).toEqual(["fixture-1", "fixture-2"]);
    expect(annotation.history.undoIdx).toBe(1);

    annotation.undo();
    expect(annotation.relationStore.size).toBe(0);
    annotation.redo();
    expect(annotation.relationStore.size).toBe(2);
  });

  it("skips a self endpoint and an exact duplicate while creating missing relations", () => {
    const annotation = createAnnotation([
      rectangle("fixture-1", "Fixture", 5, 5),
      rectangle("fixture-2", "Fixture", 25, 5),
      rectangle("label-1", "Text label", 50, 5),
      relation("fixture-1", "label-1"),
    ]);
    const sources = [area(annotation, "fixture-1"), area(annotation, "fixture-2"), area(annotation, "label-1")];

    annotation.startLinkingMode(CREATE_RELATION_MODE, sources);
    const result = annotation.addLinkedRegion(area(annotation, "label-1"));
    annotation.stopLinkingMode();

    expect(result).toMatchObject({ created: 1, skipped: 2 });
    expect(annotation.relationStore.serialize()).toEqual([
      relation("fixture-1", "label-1"),
      relation("fixture-2", "label-1", "right", null),
    ]);
  });

  it("captures source IDs and Escape-style cancellation changes no annotation data", () => {
    const annotation = createAnnotation([
      rectangle("fixture-1", "Fixture", 5, 5),
      rectangle("fixture-2", "Fixture", 25, 5),
      rectangle("label-1", "Text label", 50, 5),
    ]);
    const sources = [area(annotation, "fixture-1"), area(annotation, "fixture-2")];
    const before = annotation.serializeAnnotation();

    annotation.startLinkingMode(CREATE_RELATION_MODE, sources);
    annotation.unselectAll();
    expect(annotation.currentLinkingMode.sourceRegionIds).toEqual(sources.map((region) => region.id));
    annotation.stopLinkingMode();

    expect(annotation.serializeAnnotation()).toEqual(before);
    expect(annotation.history.undoIdx).toBe(0);
  });

  it("preserves the single-source relation workflow", () => {
    const annotation = createAnnotation([
      rectangle("fixture-1", "Fixture", 5, 5),
      rectangle("label-1", "Text label", 50, 5),
    ]);

    annotation.startLinkingMode(CREATE_RELATION_MODE, area(annotation, "fixture-1"));
    const result = annotation.addLinkedRegion(area(annotation, "label-1"));
    annotation.stopLinkingMode();

    expect(result).toMatchObject({ created: 1, skipped: 0, sourceCount: 1, isBulk: false });
    expect(annotation.relationStore.serialize()).toEqual([relation("fixture-1", "label-1", "right", null)]);
  });
});

describe("logical region paste (TOOL-29)", () => {
  const initialResults = [
    rectangle("fixture-1", "Fixture", 5, 5),
    transcription("fixture-1", "F-01"),
    rectangle("label-1", "Text label", 40, 5),
    transcription("label-1", "BANK A"),
    rectangle("external-1", "Text label", 75, 5),
    relation("fixture-1", "label-1", "left"),
    relation("fixture-1", "external-1"),
  ];

  it("copies complete logical regions and only their remapped internal relation", () => {
    const annotation = createAnnotation(initialResults);
    const sources = [area(annotation, "fixture-1"), area(annotation, "label-1")];
    annotation.selectAreas(sources);

    const copied = annotation.serializedSelection;
    expect(copied.filter((result) => result.id === "fixture-1")).toHaveLength(2);
    expect(copied.filter((result) => result.id === "label-1")).toHaveLength(2);
    expect(copied.filter((result) => result.type === "relation")).toEqual([relation("fixture-1", "label-1", "left")]);

    const pasted = annotation.appendResults(copied);
    annotation.selectAreas(pasted);

    expect(pasted).toHaveLength(2);
    expect(new Set(pasted.map((region) => region.cleanId)).size).toBe(2);
    expect(pasted.every((region) => !["fixture-1", "label-1"].includes(region.cleanId))).toBe(true);
    expect(pasted.map((region) => region.results.length)).toEqual([2, 2]);
    expect(annotation.selectedRegions).toEqual(pasted);

    const serializedRelations = annotation.relationStore.serialize();
    const pastedIds = new Set(pasted.map((region) => region.cleanId));
    const clonedRelation = serializedRelations.find(
      (result) => pastedIds.has(result.from_id) && pastedIds.has(result.to_id),
    );

    expect(clonedRelation).toMatchObject({ direction: "left", labels: ["has_label"] });
    expect(serializedRelations).toHaveLength(3);
    expect(serializedRelations.filter((result) => result.to_id === "external-1")).toHaveLength(1);
    expect(annotation.history.undoIdx).toBe(1);

    annotation.undo();
    expect(annotation.regions).toHaveLength(3);
    expect(annotation.relationStore.size).toBe(2);
    annotation.redo();
    expect(annotation.regions).toHaveLength(5);
    expect(annotation.relationStore.size).toBe(3);
  });

  it("repeated paste creates fresh IDs and selects only the newest live set", () => {
    const annotation = createAnnotation(initialResults);
    annotation.selectAreas([area(annotation, "fixture-1"), area(annotation, "label-1")]);
    const copied = annotation.serializedSelection;

    const first = annotation.appendResults(copied);
    annotation.selectAreas(first);
    const second = annotation.appendResults(copied);
    annotation.selectAreas(second);

    const firstIds = new Set(first.map((region) => region.cleanId));
    const secondIds = new Set(second.map((region) => region.cleanId));
    expect([...secondIds].every((id) => !firstIds.has(id))).toBe(true);
    expect(annotation.selectedRegions).toEqual(second);
    expect(annotation.regions).toHaveLength(7);
    expect(annotation.relationStore.size).toBe(4);
  });

  it("keeps the single-region multi-record paste behavior", () => {
    const annotation = createAnnotation(initialResults);
    annotation.selectAreas([area(annotation, "fixture-1")]);

    const copied = annotation.serializedSelection;
    const pasted = annotation.appendResults(copied);
    annotation.selectAreas(pasted);

    expect(copied.filter((result) => result.type === "relation")).toHaveLength(0);
    expect(pasted).toHaveLength(1);
    expect(pasted[0].results).toHaveLength(2);
    expect(new Set(pasted[0].results.map((result) => result.area.cleanId))).toEqual(new Set([pasted[0].cleanId]));
  });
});

describe("selected rectangle group movement (TOOL-30)", () => {
  for (const zoom of [1, 2.5]) {
    it(`preserves one image-space delta at zoom ${zoom}`, async () => {
      const annotation = createAnnotation([
        rectangle("fixture-1", "Fixture", 5, 10),
        rectangle("label-1", "Text label", 35, 30),
      ]);
      const regions = [area(annotation, "fixture-1"), area(annotation, "label-1")];
      const before = regions.map(({ x, y }) => ({ x, y }));
      const anchor = regions[0];

      annotation.selectAreas(regions);
      anchor.object.setZoom(zoom);
      annotation.startGroupTranslation(anchor);
      annotation.previewGroupTranslation(anchor, {
        x: anchor.object.internalToCanvasX(anchor.x + 7),
        y: anchor.object.internalToCanvasY(anchor.y + 4),
      });
      annotation.commitGroupTranslation(anchor);
      await new Promise((resolve) => setTimeout(resolve, 0));

      regions.forEach((region, index) => {
        expect(region.x - before[index].x).toBeCloseTo(7);
        expect(region.y - before[index].y).toBeCloseTo(4);
      });
      expect(annotation.history.undoIdx).toBe(1);
    });
  }

  it("moves a pasted set by one shared delta while originals remain fixed and history stays ordered", async () => {
    const annotation = createAnnotation([
      rectangle("fixture-1", "Fixture", 5, 10),
      transcription("fixture-1", "F-01"),
      rectangle("label-1", "Text label", 35, 30),
      transcription("label-1", "BANK A"),
      relation("fixture-1", "label-1"),
    ]);
    const originals = [area(annotation, "fixture-1"), area(annotation, "label-1")];
    const originalGeometry = originals.map(({ x, y, width, height, rotation }) => ({ x, y, width, height, rotation }));

    annotation.selectAreas(originals);
    const copied = annotation.serializedSelection;
    const pasted = annotation.appendResults(copied);
    annotation.selectAreas(pasted);

    const pastedBefore = pasted.map(({ x, y, width, height, rotation }) => ({ x, y, width, height, rotation }));
    const pastedIds = new Set(pasted.map((region) => region.cleanId));
    const anchor = pasted[0];
    expect(annotation.startGroupTranslation(anchor)).toMatchObject({ mode: "group", count: 2 });
    expect(annotation.startGroupTranslation(pasted[1])).toMatchObject({
      mode: "group",
      count: 2,
      anchorId: anchor.id,
    });
    expect(annotation.commitGroupTranslation(pasted[1])).toBe(false);
    expect(annotation.isGroupTranslating).toBe(true);
    annotation.previewGroupTranslation(anchor, {
      x: anchor.object.internalToCanvasX(anchor.x + 12),
      y: anchor.object.internalToCanvasY(anchor.y + 8),
    });
    annotation.commitGroupTranslation(anchor);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(annotation.history.isFrozen).toBe(false);

    pasted.forEach((region, index) => {
      expect(region.x).toBeCloseTo(pastedBefore[index].x + 12);
      expect(region.y).toBeCloseTo(pastedBefore[index].y + 8);
      expect(region.width).toBe(pastedBefore[index].width);
      expect(region.height).toBe(pastedBefore[index].height);
      expect(region.rotation).toBe(pastedBefore[index].rotation);
    });
    originals.forEach((region, index) => {
      expect({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        rotation: region.rotation,
      }).toEqual(originalGeometry[index]);
    });
    expect(annotation.history.undoIdx).toBe(2);

    annotation.undo();
    const restoredPaste = annotation.regions.filter((region) => pastedIds.has(region.cleanId));
    restoredPaste.forEach((region, index) => {
      expect(region.x).toBeCloseTo(pastedBefore[index].x);
      expect(region.y).toBeCloseTo(pastedBefore[index].y);
    });
    annotation.undo();
    expect(annotation.regions).toHaveLength(2);
    expect(annotation.relationStore.size).toBe(1);
    annotation.redo();
    annotation.redo();
    expect(annotation.regions).toHaveLength(4);
    expect(annotation.relationStore.size).toBe(2);
    const movedAfterRedo = annotation.regions.filter((region) => pastedIds.has(region.cleanId));
    expect(movedAfterRedo).toHaveLength(2);
    movedAfterRedo.forEach((region, index) => {
      expect(region.x).toBeCloseTo(pastedBefore[index].x + 12);
      expect(region.y).toBeCloseTo(pastedBefore[index].y + 8);
    });
  });

  it("clamps the selected set as a whole without changing relative spacing", async () => {
    const annotation = createAnnotation([
      rectangle("fixture-1", "Fixture", 5, 10),
      rectangle("label-1", "Text label", 70, 80),
    ]);
    const regions = [area(annotation, "fixture-1"), area(annotation, "label-1")];
    annotation.selectAreas(regions);
    const initialOffset = { x: regions[1].x - regions[0].x, y: regions[1].y - regions[0].y };
    const anchor = regions[0];

    annotation.startGroupTranslation(anchor);
    const delta = annotation.previewGroupTranslation(anchor, {
      x: anchor.object.internalToCanvasX(anchor.x + 50),
      y: anchor.object.internalToCanvasY(anchor.y + 50),
    });
    annotation.commitGroupTranslation();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(delta).toEqual({ x: 20, y: 10 });
    expect(regions[1].x - regions[0].x).toBe(initialOffset.x);
    expect(regions[1].y - regions[0].y).toBe(initialOffset.y);
    expect(regions[1].x + regions[1].width).toBe(100);
    expect(regions[1].y + regions[1].height).toBe(100);
  });

  it("cancels without changing model geometry or history", () => {
    const annotation = createAnnotation([
      rectangle("fixture-1", "Fixture", 5, 10),
      rectangle("label-1", "Text label", 35, 30),
    ]);
    const regions = [area(annotation, "fixture-1"), area(annotation, "label-1")];
    annotation.selectAreas(regions);
    const before = regions.map(({ x, y }) => ({ x, y }));
    const anchor = regions[0];

    annotation.startGroupTranslation(anchor);
    annotation.previewGroupTranslation(anchor, {
      x: anchor.object.internalToCanvasX(anchor.x + 12),
      y: anchor.object.internalToCanvasY(anchor.y + 8),
    });
    annotation.cancelGroupTranslation();

    expect(regions.map(({ x, y }) => ({ x, y }))).toEqual(before);
    expect(annotation.history.undoIdx).toBe(0);
  });
});
