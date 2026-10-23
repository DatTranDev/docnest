import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { binary, run } from "./media.mjs";

const root = path.resolve(import.meta.dirname, "..");
const assets = path.resolve(
  root,
  "../../frontend/web/src/features/local-tools/assets",
);
await mkdir(assets, { recursive: true });
const source = path.join(root, "out/docnivo-demo.mp4");
const sharp = createRequire(path.resolve(root, "../../package.json"))("sharp");
run(binary("ffmpeg"), [
  "-y",
  "-i",
  source,
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  path.join(assets, "docnivo-demo.mp4"),
]);
run(binary("ffmpeg"), [
  "-y",
  "-i",
  source,
  "-an",
  "-c:v",
  "libvpx-vp9",
  "-crf",
  "31",
  "-b:v",
  "0",
  "-row-mt",
  "1",
  "-threads",
  "4",
  path.join(assets, "docnivo-demo.webm"),
]);
await sharp(path.join(root, "out/frames/element-000.png"))
  .webp({ quality: 88 })
  .toFile(path.join(assets, "docnivo-demo-poster.webp"));
for (const name of [
  "docnivo-demo.mp4",
  "docnivo-demo.webm",
  "docnivo-demo-poster.webp",
]) {
  await copyFile(path.join(assets, name), path.join(root, "out", name));
  console.log(`${name}: ${(await stat(path.join(assets, name))).size} bytes`);
}
