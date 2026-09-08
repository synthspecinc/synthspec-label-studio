export const IMAGE_REGION_MIN = 0;
export const IMAGE_REGION_MAX = 100;

export type RegionBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type TranslationDelta = {
  x: number;
  y: number;
};

export const combinedRegionBounds = (regions: Array<{ bboxCoords?: RegionBounds | null }>): RegionBounds | null => {
  let bounds: RegionBounds | null = null;

  for (const region of regions) {
    const regionBounds = region.bboxCoords;
    if (!regionBounds) return null;

    bounds = bounds
      ? {
          left: Math.min(bounds.left, regionBounds.left),
          top: Math.min(bounds.top, regionBounds.top),
          right: Math.max(bounds.right, regionBounds.right),
          bottom: Math.max(bounds.bottom, regionBounds.bottom),
        }
      : { ...regionBounds };
  }

  return bounds;
};

export const clampGroupTranslation = (bounds: RegionBounds, delta: TranslationDelta): TranslationDelta => ({
  x: Math.max(IMAGE_REGION_MIN - bounds.left, Math.min(delta.x, IMAGE_REGION_MAX - bounds.right)),
  y: Math.max(IMAGE_REGION_MIN - bounds.top, Math.min(delta.y, IMAGE_REGION_MAX - bounds.bottom)),
});

export const validateImageRectangleSelection = (regions: any[], object: any) => {
  if (regions.length < 2) return { mode: "single" as const };

  if (regions.some((region) => region.type !== "rectangleregion")) {
    return {
      mode: "blocked" as const,
      message: "Move the selection together only when every selected region is a rectangle.",
    };
  }

  if (regions.some((region) => region.object !== object)) {
    return {
      mode: "blocked" as const,
      message: "Move the selection together only when every selected rectangle is on this image.",
    };
  }

  if (regions.some((region) => region.hidden || region.isReadOnly?.())) {
    return {
      mode: "blocked" as const,
      message: "Hidden or read-only rectangles cannot be moved as part of a selection.",
    };
  }

  const bounds = combinedRegionBounds(regions);
  if (!bounds) {
    return {
      mode: "blocked" as const,
      message: "The selected rectangles cannot be moved together.",
    };
  }

  return { mode: "group" as const, bounds };
};
