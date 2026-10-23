import { RenderInternals } from "@remotion/renderer";
import { spawnSync } from "node:child_process";

export function binary(type) {
  return RenderInternals.getExecutablePath({
    type,
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
  });
}
export function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr?.slice(-2000)}`);
  return result.stdout;
}
