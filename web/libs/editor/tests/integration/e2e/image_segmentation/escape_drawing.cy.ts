import { ImageView, Labels, LabelStudio } from "@humansignal/frontend-test/helpers/LSF";
import { escapeDrawingConfig, escapeDrawingTask } from "../../data/multi_region/workflows";

const initialize = () => {
  LabelStudio.params().config(escapeDrawingConfig).task(structuredClone(escapeDrawingTask)).init();
  LabelStudio.waitForImageReady();
};

const expectSelectedTool = (controlName: string) => {
  cy.window().then((win) => {
    const image = win.Htx.annotationStore.selected.names.get("drawing");
    const tool = image.getToolsManager().findSelectedTool();

    if (controlName === "move") expect(tool.toolName).to.equal("MoveTool");
    else expect(tool.control?.name).to.equal(controlName);
  });
};

const expectEmptyAnnotation = () => {
  LabelStudio.serialize().then((results) => expect(results).to.deep.equal([]));
  cy.window().then((win) => {
    const annotation = win.Htx.annotationStore.selected;
    expect(annotation.regions).to.have.length(0);
    expect(annotation.history.canUndo).to.be.false;
  });
};

describe("Escape drawing cancellation (TOOL-32)", () => {
  it("cancels idle, rectangle, and polygon drawing and preserves input focus ownership", () => {
    initialize();

    Labels.select("Fixture box");
    expectSelectedTool("fixture_box");
    cy.get("body").type("{esc}");
    expectSelectedTool("move");
    ImageView.clickAtRelative(0.45, 0.25);
    expectEmptyAnnotation();

    cy.get(".lsf-label")
      .contains("Fixture box")
      .closest(".lsf-label")
      .click()
      .click()
      .should("have.class", "lsf-label_selected");
    expectSelectedTool("fixture_box");
    ImageView.drawingArea.then(($area) => {
      const bounds = $area[0].getBoundingClientRect();
      const startX = bounds.width * 0.35;
      const startY = bounds.height * 0.35;
      cy.wrap($area)
        .trigger("mousedown", startX, startY, { eventConstructor: "MouseEvent", button: 0, buttons: 1 })
        .trigger("mousemove", startX + 100, startY + 70, {
          eventConstructor: "MouseEvent",
          button: 0,
          buttons: 1,
        });
      cy.window().then((win) => {
        const image = win.Htx.annotationStore.selected.names.get("drawing");
        expect(image.drawingRegion).not.to.be.null;
      });
      cy.get("body").type("{esc}");
      cy.wrap($area).trigger("mouseup", startX + 100, startY + 70, {
        eventConstructor: "MouseEvent",
        button: 0,
        buttons: 0,
      });
    });
    expectSelectedTool("move");
    expectEmptyAnnotation();

    Labels.select("Fixture boundary");
    expectSelectedTool("fixture_boundary");
    ImageView.drawPolygonRelative(
      [
        [0.25, 0.25],
        [0.4, 0.25],
        [0.4, 0.4],
      ],
      false,
    );
    cy.window().then((win) => expect(win.Htx.annotationStore.selected.hasIncompleteRegions).to.be.true);
    cy.get("body").type("{esc}{esc}");
    expectSelectedTool("move");
    expectEmptyAnnotation();
    cy.screenshot("tool-32/escape-cancelled-polygon");

    Labels.select("Fixture box");
    expectSelectedTool("fixture_box");
    cy.get('[data-testid="textarea-input"]').focus().type("draft note{esc}");
    expectSelectedTool("fixture_box");
    cy.get('[data-testid="textarea-input"]').should("have.value", "draft note");
  });
});

declare global {
  interface Window {
    Htx: any;
  }
}
