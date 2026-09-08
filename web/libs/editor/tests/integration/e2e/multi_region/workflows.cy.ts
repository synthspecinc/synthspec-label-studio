import { ImageView, LabelStudio, Relations } from "@humansignal/frontend-test/helpers/LSF";
import { multiRegionConfig, multiRegionTask } from "../../data/multi_region/workflows";

const initialize = () => {
  LabelStudio.params().config(multiRegionConfig).task(structuredClone(multiRegionTask)).init();
  LabelStudio.waitForImageReady();
};

const selectRegions = (cleanIds: string[]) => {
  cy.window().then((win) => {
    const annotation = win.Htx.annotationStore.selected;
    const regions = cleanIds.map((cleanId) => annotation.regions.find((region) => region.cleanId === cleanId));

    expect(regions.every(Boolean)).to.be.true;
    annotation.selectAreas(regions);
  });
};

const expectRegionCounts = (regionCount: number, selectedCount: number) => {
  cy.window().then((win) => {
    const annotation = win.Htx.annotationStore.selected;

    expect(annotation.regions).to.have.length(regionCount);
    expect(annotation.selectedRegions).to.have.length(selectedCount);
  });
};

const relationResults = (results: any[]) => results.filter((result) => result.type === "relation");

describe("multi-region editor workflows", () => {
  it("creates ten ordinary relations in one command, retains selection, and supports cancel/undo/redo (TOOL-28)", () => {
    initialize();

    cy.get("#Regions-draggable").click();
    selectRegions(Array.from({ length: 10 }, (_, index) => `fixture-${index + 2}`));
    expectRegionCounts(14, 10);

    Relations.toggleCreationWithHotkey();
    ImageView.clickAtRelative(0.24, 0.345);

    expectRegionCounts(14, 10);
    LabelStudio.serialize().then((results) => {
      expect(relationResults(results)).to.have.length(12);
      const bulkRelations = relationResults(results).filter((result) => result.to_id === "label-a");
      expect(bulkRelations).to.have.length(11);
      expect(new Set(bulkRelations.map((result) => result.from_id)).size).to.equal(11);
    });
    cy.screenshot("multi-region/bulk-relations-10-sources");

    cy.window().then((win) => win.Htx.annotationStore.selected.undo());
    LabelStudio.serialize().then((results) => expect(relationResults(results)).to.have.length(2));
    cy.window().then((win) => win.Htx.annotationStore.selected.redo());
    LabelStudio.serialize().then((results) => expect(relationResults(results)).to.have.length(12));

    Relations.toggleCreationWithHotkey();
    cy.get("body").type("{esc}");
    ImageView.clickAtRelative(0.24, 0.735);
    LabelStudio.serialize().then((results) => expect(relationResults(results)).to.have.length(12));
  });

  it("pastes a logical relation subgraph as the exclusive movable selection (TOOL-29, TOOL-30)", () => {
    initialize();

    cy.get("#Regions-draggable").click();
    selectRegions(["fixture-1", "fixture-12", "label-a"]);
    expectRegionCounts(14, 3);

    cy.window().then((win) => {
      const clipboard = new win.DataTransfer();
      win.dispatchEvent(new win.ClipboardEvent("copy", { clipboardData: clipboard, bubbles: true }));
      win.dispatchEvent(new win.ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true }));
    });

    expectRegionCounts(17, 3);

    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      const cloneIds = annotation.selectedRegions.map((region) => region.cleanId);
      const sourceIds = new Set(["fixture-1", "fixture-12", "label-a"]);

      expect(cloneIds).to.have.length(3);
      expect(cloneIds.every((id) => !sourceIds.has(id))).to.be.true;
      expect(new Set(cloneIds).size).to.equal(3);

      const serialized = annotation.serializeAnnotation();
      cloneIds.forEach((id) => {
        expect(serialized.filter((result) => result.id === id)).to.have.length(2);
      });

      const cloneRelations = relationResults(serialized).filter(
        (result) => cloneIds.includes(result.from_id) || cloneIds.includes(result.to_id),
      );
      expect(cloneRelations).to.have.length(1);
      expect(cloneIds).to.include(cloneRelations[0].from_id);
      expect(cloneIds).to.include(cloneRelations[0].to_id);
      expect(cloneRelations[0]).to.include({ direction: "right" });
      expect(cloneRelations[0].labels).to.deep.equal(["has_label"]);

      win.__MULTI_REGION_CLONE_IDS__ = cloneIds;
      win.__MULTI_REGION_PASTE_UNDO_INDEX__ = annotation.history.undoIdx;
      win.__MULTI_REGION_BEFORE_MOVE__ = Object.fromEntries(
        annotation.regions.map((region) => [region.cleanId, { x: region.x, y: region.y }]),
      );
    });

    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      const anchor = annotation.regions.find((region) => region.cleanId === win.__MULTI_REGION_CLONE_IDS__[0]);
      const shape = anchor.shapeRef;

      expect(annotation.startGroupTranslation(anchor)).to.include({ mode: "group", count: 3 });
      annotation.previewGroupTranslation(anchor, { x: shape.x() + 84, y: shape.y() + 42 });
      annotation.commitGroupTranslation();
    });

    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      const cloneIds = win.__MULTI_REGION_CLONE_IDS__;
      const before = win.__MULTI_REGION_BEFORE_MOVE__;
      const moved = cloneIds.map((id) => annotation.regions.find((region) => region.cleanId === id));
      const deltas = moved.map((region) => ({
        x: region.x - before[region.cleanId].x,
        y: region.y - before[region.cleanId].y,
      }));

      deltas.forEach((delta) => {
        expect(delta.x).to.be.closeTo(deltas[0].x, 0.001);
        expect(delta.y).to.be.closeTo(deltas[0].y, 0.001);
      });
      expect(Math.abs(deltas[0].x) + Math.abs(deltas[0].y)).to.be.greaterThan(0);
      ["fixture-1", "fixture-12", "label-a"].forEach((id) => {
        const original = annotation.regions.find((region) => region.cleanId === id);
        expect({ x: original.x, y: original.y }).to.deep.equal(before[id]);
      });
      expect(annotation.selectedRegions.map((region) => region.cleanId)).to.deep.equal(cloneIds);
    });
    cy.screenshot("multi-region/pasted-selection-group-moved");

    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;

      expect(annotation.history.undoIdx).to.equal(win.__MULTI_REGION_PASTE_UNDO_INDEX__ + 1);
      annotation.undo();
    });
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      const before = win.__MULTI_REGION_BEFORE_MOVE__;
      win.__MULTI_REGION_CLONE_IDS__.forEach((id) => {
        const restored = annotation.regions.find((region) => region.cleanId === id);
        expect({ x: restored.x, y: restored.y }).to.deep.equal(before[id]);
      });
    });
    cy.window().then((win) => win.Htx.annotationStore.selected.undo());
    expectRegionCounts(14, 0);
    LabelStudio.serialize().then((results) => expect(relationResults(results)).to.have.length(2));
    cy.window().then((win) => {
      win.Htx.annotationStore.selected.redo();
      win.Htx.annotationStore.selected.redo();
    });
    expectRegionCounts(17, 0);
    LabelStudio.serialize().then((results) => expect(relationResults(results)).to.have.length(3));
  });
});

declare global {
  interface Window {
    __MULTI_REGION_CLONE_IDS__: string[];
    __MULTI_REGION_PASTE_UNDO_INDEX__: number;
    __MULTI_REGION_BEFORE_MOVE__: Record<string, { x: number; y: number }>;
  }
}
