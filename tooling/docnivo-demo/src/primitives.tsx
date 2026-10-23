import type { ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { camera, clicks, cursorPath, ease } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type CameraKeyframe = {
  frame: number;
  scale: number;
  x: number;
  y: number;
  focalPoint: readonly [number, number];
};
export function CameraRig({
  children,
  keyframes = camera,
  easing = ease,
}: {
  children: ReactNode;
  keyframes?: readonly CameraKeyframe[];
  easing?: (progress: number) => number;
}) {
  const frame = useCurrentFrame();
  const frames = keyframes.map((key) => key.frame);
  return (
    <div
      style={{
        position: "absolute",
        left: 210,
        top: 82,
        width: 1500,
        height: 765,
        scale: interpolate(
          frame,
          frames,
          keyframes.map((key) => key.scale),
          { ...clamp, easing },
        ),
        translate: `${interpolate(
          frame,
          frames,
          keyframes.map((key) => key.x),
          { ...clamp, easing },
        )}px ${interpolate(
          frame,
          frames,
          keyframes.map((key) => key.y),
          { ...clamp, easing },
        )}px`,
        transformOrigin: `${interpolate(
          frame,
          frames,
          keyframes.map((key) => key.focalPoint[0]),
          { ...clamp, easing },
        )}px ${interpolate(
          frame,
          frames,
          keyframes.map((key) => key.focalPoint[1]),
          { ...clamp, easing },
        )}px`,
      }}
    >
      {children}
    </div>
  );
}

export function BrowserFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 1500,
        height: 765,
        borderRadius: 14,
        overflow: "hidden",
        background: "#fff",
        boxShadow: "0 24px 64px #0f172a1a",
      }}
    >
      <div
        style={{
          height: 36,
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          gap: 7,
          paddingLeft: 16,
        }}
      >
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#c4ccd8",
            }}
          />
        ))}
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: "Inter",
            fontSize: 12,
            color: "#526176",
          }}
        >
          Docnivo
        </span>
      </div>
      <div style={{ position: "relative", width: 1500, height: 729 }}>
        {children}
      </div>
    </div>
  );
}

export function AnimatedCursor() {
  const frame = useCurrentFrame();
  if (frame < 30 || (frame > 118 && frame < 274) || frame > 397) return null;
  const next = cursorPath.findIndex((key) => key.frame > frame);
  const b = cursorPath[next < 0 ? cursorPath.length - 1 : next];
  const a =
    cursorPath[Math.max(0, next < 0 ? cursorPath.length - 2 : next - 1)];
  const t = interpolate(frame, [a.frame, b.frame], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const arc = a.x === b.x && a.y === b.y ? 0 : Math.sin(t * Math.PI) * 24;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t - arc;
  const click = clicks.find((at) => frame >= at && frame < at + 5);
  return (
    <div
      style={{
        position: "absolute",
        left: (x / 1440) * 1500,
        top: (y / 700) * 729,
        pointerEvents: "none",
        opacity: interpolate(frame, [30, 38, 390, 397], [0, 1, 1, 0], clamp),
      }}
    >
      {click !== undefined ? (
        <div
          style={{
            position: "absolute",
            width: 30,
            height: 30,
            left: -15,
            top: -15,
            border: "2px solid #4056d6",
            borderRadius: "50%",
            opacity: interpolate(frame - click, [0, 5], [0.5, 0]),
            scale: interpolate(frame - click, [0, 5], [0.5, 1.3]),
          }}
        />
      ) : null}
      <svg
        width="25"
        height="32"
        viewBox="0 0 25 32"
        style={{
          filter: "drop-shadow(0 2px 2px #0f172a30)",
          scale: click === undefined ? 1 : 0.91,
        }}
      >
        <path
          d="M2 2L21 19H12L8 28L4 26L8 17L2 20Z"
          fill="#0f172a"
          stroke="white"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function Caption({
  from,
  to,
  text,
}: {
  from: number;
  to: number;
  text: string;
}) {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        top: 990,
        width: "100%",
        textAlign: "center",
        color: "#0f172a",
        fontFamily: "Inter",
        fontWeight: 400,
        fontSize: 46,
        lineHeight: 1.2,
        opacity: interpolate(
          frame,
          [from + 5, from + 15, to - 14, to - 3],
          [0, 1, 1, 0],
          clamp,
        ),
        translate: `0 ${interpolate(frame, [from + 5, from + 18], [8, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px`,
      }}
    >
      {text}
    </div>
  );
}
