import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { interpolate } from "remotion";
import { camera, ease } from "../src/timeline.ts";
import { binary, run } from "./media.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sharp = createRequire(path.resolve(root, "../../package.json"))("sharp");
const framesDir = path.join(root, "out/frames");
const frames = (await readdir(framesDir))
  .filter((name) => /element-\d{3}\.png/.test(name))
  .sort();
if (frames.length !== 450)
  throw new Error("Expected exactly 450 rendered frames");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const openingHash = hash(await readFile(path.join(framesDir, frames[0])));
const closingHash = hash(await readFile(path.join(framesDir, frames[449])));
if (openingHash !== closingHash) throw new Error("Loop endpoints differ");
let minBrightness = 255;
for (let frame = 0; frame < 450; frame++) {
  const stats = await sharp(path.join(framesDir, frames[frame])).stats();
  const brightness =
    stats.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
  minBrightness = Math.min(minBrightness, brightness);
  if (brightness < 10 || stats.channels.slice(0, 3).every((c) => c.stdev < 1))
    throw new Error(`Black or empty frame ${frame}`);
  const axis = (key) =>
    interpolate(
      frame,
      camera.map((k) => k.frame),
      camera.map((k) => k[key]),
      { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  const scale = axis("scale");
  const left = 210 + axis("x") + 750 * (1 - scale);
  const top = 82 + axis("y") + 380 * (1 - scale);
  if (
    left < 0 ||
    left + 1500 * scale > 1920 ||
    top < 0 ||
    top + 765 * scale > 990
  )
    throw new Error(`Camera safe area exceeded at frame ${frame}`);
}
const assets = path.resolve(
  root,
  "../../frontend/web/src/features/local-tools/assets",
);
const media = [];
for (const extension of ["mp4", "webm"]) {
  const file = path.join(assets, `docnivo-demo.${extension}`);
  const metadata = JSON.parse(
    run(binary("ffprobe"), [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]),
  );
  const stream = metadata.streams.find((s) => s.codec_type === "video");
  if (
    Number(metadata.format.duration) !== 15 ||
    Number(stream.nb_read_frames) !== 450 ||
    stream.width !== 1920 ||
    stream.height !== 1080 ||
    stream.r_frame_rate !== "30/1" ||
    metadata.streams.some((s) => s.codec_type === "audio")
  )
    throw new Error(`Invalid ${extension} metadata`);
  for (const [index, seconds] of [
    [1, "0"],
    [2, "14.96"],
  ]) {
    run(binary("ffmpeg"), [
      "-y",
      "-i",
      file,
      "-ss",
      seconds,
      "-frames:v",
      "1",
      "-threads",
      "2",
      "-f",
      "image2",
      "-c:v",
      "png",
      path.join(root, `out/decoded-${extension}-${index}.png`),
    ]);
  }
  const decodedFirst = await sharp(
    path.join(root, `out/decoded-${extension}-1.png`),
  )
    .removeAlpha()
    .raw()
    .toBuffer();
  const decodedLast = await sharp(
    path.join(root, `out/decoded-${extension}-2.png`),
  )
    .removeAlpha()
    .raw()
    .toBuffer();
  let errorSum = 0;
  for (let index = 0; index < decodedFirst.length; index++)
    errorSum += Math.abs(decodedFirst[index] - decodedLast[index]);
  const decodedLoopMeanAbsoluteError = errorSum / decodedFirst.length;
  if (decodedLoopMeanAbsoluteError > 1)
    throw new Error(`Visible codec loop discontinuity in ${extension}`);
  media.push({
    extension,
    codec: stream.codec_name,
    pixelFormat: stream.pix_fmt,
    duration: metadata.format.duration,
    frames: stream.nb_read_frames,
    size: metadata.format.size,
    decodedLoopMeanAbsoluteError,
  });
}
const boundaries = [
  0, 74, 75, 95, 96, 110, 173, 179, 180, 219, 260, 299, 300, 307, 336, 337, 358,
  374, 375, 389, 410, 431, 449,
];
const tiles = [];
for (let index = 0; index < boundaries.length; index++) {
  const frame = boundaries[index];
  const buffer = await sharp(path.join(framesDir, frames[frame]))
    .resize(480, 270)
    .png()
    .toBuffer();
  tiles.push({
    input: buffer,
    left: (index % 4) * 480,
    top: Math.floor(index / 4) * 300,
  });
  const label = Buffer.from(
    `<svg width="480" height="30"><rect width="480" height="30" fill="white"/><text x="12" y="22" font-size="18">Frame ${frame}</text></svg>`,
  );
  tiles.push({
    input: label,
    left: (index % 4) * 480,
    top: Math.floor(index / 4) * 300 + 270,
  });
}
await sharp({
  create: {
    width: 1920,
    height: Math.ceil(boundaries.length / 4) * 300,
    channels: 3,
    background: "#e2e8f0",
  },
})
  .composite(tiles)
  .png()
  .toFile(path.join(root, "out/contact-sheet.png"));
const result = {
  media,
  all450FramesNonblank: true,
  minBrightness,
  loopEndpointsIdentical: true,
  openingHash,
  closingHash,
  cameraSafeAreaAll450Frames: true,
};
await writeFile(
  path.join(root, "out/validation.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
