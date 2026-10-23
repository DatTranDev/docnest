import { Easing } from "remotion";

export const timing = {
  workspace: [0, 75],
  create: [75, 180],
  collaboration: [180, 300],
  sharing: [300, 375],
  return: [375, 450],
} as const;
export const ease = Easing.bezier(0.65, 0, 0.35, 1);
export const camera = [
  { frame: 0, scale: 1, x: 0, y: 0, focalPoint: [750, 380] },
  { frame: 74, scale: 1.1, x: 36, y: 10, focalPoint: [750, 380] },
  { frame: 98, scale: 1.2, x: 0, y: 20, focalPoint: [750, 380] },
  { frame: 180, scale: 1.2, x: 0, y: 20, focalPoint: [750, 380] },
  { frame: 205, scale: 1.2, x: -20, y: 20, focalPoint: [750, 380] },
  { frame: 279, scale: 1.2, x: -20, y: 20, focalPoint: [750, 380] },
  { frame: 300, scale: 1.16, x: -22, y: 10, focalPoint: [750, 380] },
  { frame: 323, scale: 1.1, x: 0, y: 0, focalPoint: [750, 380] },
  { frame: 375, scale: 1.1, x: 0, y: 0, focalPoint: [750, 380] },
  { frame: 405, scale: 1.04, x: 0, y: 0, focalPoint: [750, 380] },
  { frame: 431, scale: 1, x: 0, y: 0, focalPoint: [750, 380] },
  { frame: 449, scale: 1, x: 0, y: 0, focalPoint: [750, 380] },
] as const;
export const captions = [
  { from: 0, to: 75, text: "A space for your ideas." },
  { from: 75, to: 180, text: "Create without friction." },
  { from: 180, to: 300, text: "Better, together." },
  { from: 300, to: 375, text: "Share in seconds." },
] as const;

// Points are measured in the original 1440 × 700 application viewport.
export const cursorPath = [
  { frame: 0, x: 680, y: 410 },
  { frame: 45, x: 680, y: 410 },
  { frame: 62, x: 80, y: 90 },
  { frame: 78, x: 80, y: 90 },
  { frame: 90, x: 109, y: 133 },
  { frame: 96, x: 109, y: 133 },
  { frame: 112, x: 430, y: 260 },
  { frame: 274, x: 430, y: 260 },
  { frame: 294, x: 1260, y: 38 },
  { frame: 306, x: 1260, y: 38 },
  { frame: 325, x: 968, y: 463 },
  { frame: 337, x: 968, y: 463 },
  { frame: 349, x: 1005, y: 548 },
  { frame: 368, x: 1005, y: 548 },
  { frame: 382, x: 1015, y: 67 },
  { frame: 395, x: 1015, y: 67 },
] as const;
export const clicks = [75, 93, 303, 333, 355, 387];
