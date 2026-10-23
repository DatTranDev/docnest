'use client';
import { useEffect, useRef, useState } from 'react';
import { useToolsCopy } from '../model/copy';

const webm = new URL('../assets/docnivo-demo.webm', import.meta.url).href;
const mp4 = new URL('../assets/docnivo-demo.mp4', import.meta.url).href;
const poster = new URL('../assets/docnivo-demo-poster.webp', import.meta.url).href;

export function ProductDemo({
  editorUrl,
  standalone = false,
}: {
  editorUrl: string;
  standalone?: boolean;
}) {
  const copy = useToolsCopy();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadVideo, setLoadVideo] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const webmUrl = standalone ? `./assets/${webm.split('/').pop()}` : webm;
  const mp4Url = standalone ? `./assets/${mp4.split('/').pop()}` : mp4;
  const posterUrl = standalone ? `./assets/${poster.split('/').pop()}` : poster;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    let visible = false;
    const update = () => {
      const automatic =
        !motion.matches &&
        !connection?.saveData &&
        !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
      setAutoplay(automatic);
      if (visible && automatic) setLoadVideo(true);
      if (!automatic || !visible) video.pause();
      else if (!video.dataset.pausedByUser) void video.play().catch(() => {});
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        visible = entry.isIntersecting;
        update();
      },
      { threshold: 0.15 },
    );
    observer.observe(video);
    motion.addEventListener('change', update);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', update);
    };
  }, []);
  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.dataset.pausedByUser = 'true';
      video.pause();
      return;
    }
    delete video.dataset.pausedByUser;
    if (loadVideo) {
      if (failed) video.load();
      void video.play().catch(() => {});
    }
    setLoadVideo(true);
    setFailed(false);
    // Sources are attached by React before the next media load.
    setAutoplay(true);
  }
  useEffect(() => {
    if (loadVideo && autoplay) void videoRef.current?.play().catch(() => {});
  }, [loadVideo, autoplay]);
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
      <div className="intro-demo-player">
        <video
          ref={videoRef}
          autoPlay={autoplay && loadVideo}
          muted
          loop
          playsInline
          preload={loadVideo ? 'metadata' : 'none'}
          poster={posterUrl}
          width={1920}
          height={1080}
          aria-label={copy.videoHeading}
          aria-describedby="product-demo-description"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => {
            setFailed(true);
            setPlaying(false);
          }}
        >
          {loadVideo && (
            <>
              <source src={webmUrl} type="video/webm" />
              <source src={mp4Url} type="video/mp4" />
            </>
          )}
          <p>
            {copy.videoFallback} <a href={mp4Url}>{copy.downloadDemo}</a>
          </p>
        </video>
        <button
          type="button"
          className="intro-demo-playback"
          onClick={togglePlayback}
          aria-label={playing ? copy.pauseDemo : copy.playDemo}
        >
          {playing ? copy.pauseDemo : copy.playDemo}
        </button>
      </div>
      {failed && (
        <p role="status">
          {copy.videoFallback} <a href={mp4Url}>{copy.downloadDemo}</a>
        </p>
      )}
      <details className="intro-demo-transcript">
        <summary>{copy.videoTranscript}</summary>
        <p>{copy.videoSteps}</p>
      </details>
    </section>
  );
}
