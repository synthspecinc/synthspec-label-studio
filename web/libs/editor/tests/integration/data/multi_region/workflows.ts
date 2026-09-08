const drawingSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#f8f7f2"/>
    <g stroke="#c8c5bb" stroke-width="1">
      ${Array.from({ length: 24 }, (_, index) => `<path d="M ${index * 50} 0 V 800"/>`).join("")}
      ${Array.from({ length: 16 }, (_, index) => `<path d="M 0 ${index * 50} H 1200"/>`).join("")}
    </g>
    <g fill="none" stroke="#353535" stroke-width="5">
      <path d="M80 90 H1120 V710 H80 Z"/>
      <path d="M80 390 H1120 M600 90 V710"/>
      <path d="M230 90 V390 M930 390 V710"/>
    </g>
    <g fill="#4a90e2" stroke="#1d4f78" stroke-width="3">
      ${Array.from({ length: 12 }, (_, index) => {
        const column = index % 6;
        const row = Math.floor(index / 6);
        return `<rect x="${125 + column * 165}" y="${150 + row * 310}" width="46" height="46" rx="4"/>`;
      }).join("")}
    </g>
    <g font-family="monospace" font-size="28" fill="#222">
      <text x="110" y="270">FIXTURE BANK A — L1</text>
      <text x="110" y="580">FIXTURE BANK B — L2</text>
    </g>
  </svg>
`;

export const MULTI_REGION_DRAWING = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawingSvg)}`;

export const multiRegionConfig = `
  <View>
    <Image name="drawing" value="$image" rotatecontrol="true" />
    <RectangleLabels name="region_type" toName="drawing">
      <Label value="Fixture" background="#4A90E2" />
      <Label value="Text label" background="#F5A623" />
    </RectangleLabels>
    <TextArea name="transcription" toName="drawing" perRegion="true" editable="true" />
    <Relations>
      <Relation value="has_label" />
    </Relations>
  </View>
`;

const rectangleResult = (
  id: string,
  label: "Fixture" | "Text label",
  x: number,
  y: number,
  width: number,
  height: number,
) => ({
  id,
  from_name: "region_type",
  to_name: "drawing",
  source: "$image",
  type: "rectanglelabels",
  origin: "manual",
  value: { x, y, width, height, rotation: 0, rectanglelabels: [label] },
});

const transcriptionResult = (id: string, text: string) => ({
  id,
  from_name: "transcription",
  to_name: "drawing",
  source: "$image",
  type: "textarea",
  origin: "manual",
  value: { text: [text] },
});

const fixtureResults = Array.from({ length: 12 }, (_, index) => {
  const column = index % 6;
  const row = Math.floor(index / 6);
  const id = `fixture-${index + 1}`;

  return [
    rectangleResult(id, "Fixture", 10 + column * 13.75, 18 + row * 38.75, 4, 6),
    transcriptionResult(id, `F-${String(index + 1).padStart(2, "0")}`),
  ];
}).flat();

export const multiRegionResults = [
  ...fixtureResults,
  rectangleResult("label-a", "Text label", 12, 31, 24, 7),
  transcriptionResult("label-a", "FIXTURE BANK A — L1"),
  rectangleResult("label-b", "Text label", 12, 70, 24, 7),
  transcriptionResult("label-b", "FIXTURE BANK B — L2"),
  {
    type: "relation",
    from_id: "fixture-1",
    to_id: "label-a",
    direction: "right",
    labels: ["has_label"],
  },
  {
    type: "relation",
    from_id: "fixture-12",
    to_id: "label-b",
    direction: "right",
    labels: ["has_label"],
  },
];

export const multiRegionTask = {
  id: 27031,
  data: { image: MULTI_REGION_DRAWING },
  annotations: [{ id: 2703101, result: multiRegionResults }],
  predictions: [],
};
