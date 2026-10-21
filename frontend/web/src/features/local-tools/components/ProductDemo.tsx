'use client';
import { useToolsCopy } from '../model/copy';

const video = new URL('../assets/product-demo.webm', import.meta.url).href;
const poster = new URL('../assets/product-demo-poster.png', import.meta.url).href;

export function ProductDemo({ editorUrl }: { editorUrl: string }) {
  const copy = useToolsCopy();
  return (
    <section id="demo" className="intro-product-demo" aria-labelledby="product-demo-title">
      <div className="intro-product-demo-heading">
        <div>
          <h2 id="product-demo-title">{copy.videoHeading}</h2>
          <p id="product-demo-description">{copy.videoDescription}</p>
        </div>
        <a className="intro-account-action" href={editorUrl}>
          {copy.tryEditor}
        </a>
      </div>
      <video
        controls
        playsInline
        preload="none"
        poster={poster}
        width={1280}
        height={900}
        aria-label={copy.videoHeading}
        aria-describedby="product-demo-description"
      >
        <source src={video} type="video/webm" />
        <p>
          {copy.videoFallback} <a href={video}>{copy.downloadDemo}</a>
        </p>
      </video>
      <details className="intro-demo-transcript">
        <summary>{copy.videoTranscript}</summary>
        <p>{copy.videoSteps}</p>
      </details>
    </section>
  );
}
