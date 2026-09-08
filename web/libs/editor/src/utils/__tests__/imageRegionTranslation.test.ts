import {
  clampGroupTranslation,
  combinedRegionBounds,
  validateImageRectangleSelection,
} from "../imageRegionTranslation";

describe("image rectangle group translation (TOOL-30)", () => {
  const bounds = { left: 10, top: 20, right: 80, bottom: 90 };

  it("combines member bounds without changing their geometry", () => {
    expect(
      combinedRegionBounds([
        { bboxCoords: { left: 10, top: 20, right: 30, bottom: 40 } },
        { bboxCoords: { left: 50, top: 60, right: 80, bottom: 90 } },
      ]),
    ).toEqual(bounds);
  });

  it.each([
    [
      { x: -50, y: 0 },
      { x: -10, y: 0 },
    ],
    [
      { x: 0, y: -50 },
      { x: 0, y: -20 },
    ],
    [
      { x: 50, y: 0 },
      { x: 20, y: 0 },
    ],
    [
      { x: 0, y: 50 },
      { x: 0, y: 10 },
    ],
  ])("clamps a shared delta at every image boundary", (requested, expected) => {
    expect(clampGroupTranslation(bounds, requested)).toEqual(expected);
  });

  it("blocks mixed geometry and cross-canvas selections before movement", () => {
    const object = {};
    const rectangle = {
      type: "rectangleregion",
      object,
      bboxCoords: { left: 10, top: 10, right: 20, bottom: 20 },
      isReadOnly: () => false,
    };
    const ellipse = { ...rectangle, type: "ellipseregion" };
    const otherCanvas = { ...rectangle, object: {} };

    expect(validateImageRectangleSelection([rectangle, ellipse], object).mode).toBe("blocked");
    expect(validateImageRectangleSelection([rectangle, otherCanvas], object).mode).toBe("blocked");
  });

  it("allows editable visible rectangles on one image", () => {
    const object = {};
    const regions = [
      {
        type: "rectangleregion",
        object,
        bboxCoords: { left: 10, top: 10, right: 20, bottom: 20 },
        isReadOnly: () => false,
      },
      {
        type: "rectangleregion",
        object,
        bboxCoords: { left: 30, top: 30, right: 40, bottom: 40 },
        isReadOnly: () => false,
      },
    ];

    expect(validateImageRectangleSelection(regions, object)).toEqual({
      mode: "group",
      bounds: { left: 10, top: 10, right: 40, bottom: 40 },
    });
  });
});
