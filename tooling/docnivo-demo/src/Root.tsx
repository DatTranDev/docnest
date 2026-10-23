import { Composition } from "remotion";
import { DocnivoLandingDemo } from "./DocnivoLandingDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DocnivoLandingDemo"
        component={DocnivoLandingDemo}
        durationInFrames={450}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
