import path from "node:path";
import { mkdir } from "node:fs/promises";
import { binary, run } from "./media.mjs";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
await mkdir(path.join(root, "out"), { recursive: true });
// Separate browser rendering from encoding to keep peak memory bounded.
console.log("Rendering 450 lossless frames with one Chromium worker");
run(process.execPath, [
  path.join(root, "node_modules/@remotion/cli/remotion-cli.js"),
  "render",
  "DocnivoLandingDemo",
  "out/frames",
  "--sequence",
  "--image-format=png",
  "--concurrency=1",
]);
console.log("Encoding 15-second H.264 with two encoder threads");
run(binary("ffmpeg"), [
  "-y",
  "-framerate",
  "30",
  "-start_number",
  "0",
  "-i",
  path.join(root, "out/frames/element-%03d.png"),
  "-frames:v",
  "450",
  "-an",
  "-c:v",
  "libx264",
  "-threads",
  "2",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  path.join(root, "out/docnivo-demo.mp4"),
]);
await import("./export.mjs");
