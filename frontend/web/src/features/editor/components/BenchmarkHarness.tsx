'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export function BenchmarkHarness() {
  const router = useRouter();
  useEffect(() => {
    window.harnessNavigate = (href) => router.push(href);
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import('../benchmark/browser').then((module) => {
      cleanup = module.disposeBenchmark;
      if (!disposed) module.initializeBenchmark();
    });
    return () => {
      disposed = true;
      cleanup?.();
      delete window.harnessNavigate;
    };
  }, [router]);
  return (
    <div className="benchmark-surface" style={{ minHeight: '100vh', background: 'white' }}>
      <div id="status" style={{ font: '14px sans-serif' }}>
        Benchmark harness
      </div>
      <div id="editor" style={{ height: 2000, width: 1400 }} />
    </div>
  );
}
