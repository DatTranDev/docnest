import { loadFont } from "@remotion/fonts";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { AnimatedCursor, BrowserFrame, CameraRig, Caption } from "./primitives";
import { captions, timing } from "./timeline";

loadFont({
  family: "Inter",
  url: staticFile("Inter-Variable.ttf"),
  weight: "100 900",
});

function Plate({ name, opacity = 1 }: { name: string; opacity?: number }) {
  return (
    <Img
      src={staticFile(`captures/${name}.png`)}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity,
      }}
    />
  );
}
export function WorkspaceReveal() {
  return <Plate name="workspace" />;
}
export function CreateDocument() {
  const frame = useCurrentFrame();
  if (frame < 96) return <Plate name="new-menu" />;
  // Each writing image is an actual captured application state, not recreated UI.
  const step = Math.min(23, Math.max(0, Math.floor((frame - 110) / 2.6)));
  return (
    <>
      <Plate name="new-menu" />
      <Plate
        name={
          frame < 110
            ? "editor-empty"
            : frame >= 174
              ? "written"
              : `write-${String(step).padStart(2, "0")}`
        }
        opacity={interpolate(frame, [96, 104], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
      />
    </>
  );
}
export function Collaboration() {
  const frame = useCurrentFrame();
  return (
    <Plate
      name={
        frame < 194
          ? "written"
          : frame < 220
            ? "collaboration-joined"
            : frame < 280
              ? `collaboration-${Math.min(4, Math.floor((frame - 220) / 12))}`
              : "collaboration-complete"
      }
    />
  );
}
export function Sharing() {
  const frame = useCurrentFrame();
  return (
    <>
      <Plate name="collaboration-complete" />
      <Plate
        name={
          frame < 337
            ? "share-dialog"
            : frame < 358
              ? "share-created"
              : "share-copied"
        }
        opacity={interpolate(frame, [303, 311], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
      />
    </>
  );
}
export function LoopReturn() {
  const frame = useCurrentFrame();
  return (
    <>
      <Plate name="workspace" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: interpolate(frame, [399, 424], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Plate name={frame < 389 ? "share-copied" : "editor-return"} />
      </div>
    </>
  );
}
export function DocnivoLandingDemo() {
  return (
    <AbsoluteFill style={{ background: "#f8fafc" }}>
      <CameraRig>
        <BrowserFrame>
          <Plate name="workspace" />
          <Sequence
            name="Workspace reveal"
            from={timing.workspace[0]}
            durationInFrames={75}
          >
            <WorkspaceReveal />
          </Sequence>
          <Sequence
            name="Create and write"
            from={timing.create[0]}
            durationInFrames={105}
          >
            <GlobalClock start={75}>
              <CreateDocument />
            </GlobalClock>
          </Sequence>
          <Sequence
            name="Real collaboration"
            from={timing.collaboration[0]}
            durationInFrames={120}
          >
            <GlobalClock start={180}>
              <Collaboration />
            </GlobalClock>
          </Sequence>
          <Sequence
            name="Share a viewing link"
            from={timing.sharing[0]}
            durationInFrames={75}
          >
            <GlobalClock start={300}>
              <Sharing />
            </GlobalClock>
          </Sequence>
          <Sequence
            name="Loop return"
            from={timing.return[0]}
            durationInFrames={75}
          >
            <GlobalClock start={375}>
              <LoopReturn />
            </GlobalClock>
          </Sequence>
          <AnimatedCursor />
        </BrowserFrame>
      </CameraRig>
      {captions.map((caption) => (
        <Caption key={caption.from} {...caption} />
      ))}
    </AbsoluteFill>
  );
}

// A nested negative offset keeps scene components on the centralized master clock.
function GlobalClock({
  start,
  children,
}: {
  start: number;
  children: React.ReactNode;
}) {
  return (
    <Sequence from={-start} layout="none">
      {children}
    </Sequence>
  );
}
