import { ChangeSet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { decodeNative, EditorModel, encodeNative, StyleTree, TextAdapter } from '@ted/editor-core';
import { EditorController } from '../model/EditorController';
type Memory = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
declare global {
  interface Window {
    bench?: typeof bench;
    gc?: () => void;
  }
  interface Performance {
    memory?: Memory;
  }
}
let controller: EditorController | null = null,
  raw: Uint8Array | null = null;
const longTasks: number[] = [];
let observer: PerformanceObserver | null = null;
const paint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const bench = {
  async prepare(file: string) {
    raw = new Uint8Array(await (await fetch(`/benchmarks/${file}`)).arrayBuffer());
    return raw.length;
  },
  async empty() {
    controller?.destroy();
    controller = new EditorController(
      new EditorModel(),
      document.getElementById('editor')!,
      () => {},
    );
    await paint();
  },
  async open() {
    if (!raw) throw new Error('prepare first');
    controller?.destroy();
    const start = performance.now(),
      s = await decodeNative(raw),
      m = EditorModel.loaded(s);
    controller = new EditorController(m, document.getElementById('editor')!, () => {});
    while (controller.replica.ackRevision !== m.localRevision)
      await new Promise((r) => setTimeout(r, 0));
    await paint();
    return performance.now() - start;
  },
  async input(index: number) {
    const c = controller!,
      before = c.model.localRevision,
      start = performance.now();
    c.view.dispatch({
      changes: { from: 0, to: 1, insert: index % 2 === 0 ? 'y' : 'x' },
      userEvent: 'input.type',
    });
    await paint();
    if (c.model.localRevision === before) throw new Error('Benchmark input was rejected');
    return performance.now() - start;
  },
  async scroll(index: number) {
    const c = controller!,
      start = performance.now();
    c.view.dispatch({
      effects: EditorView.scrollIntoView(index % 2 ? 0 : c.model.text.length, { y: 'center' }),
    });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return performance.now() - start;
  },
  async search() {
    const c = controller!,
      start = performance.now();
    await c.replica.search('line12345');
    return performance.now() - start;
  },
  async serialize() {
    const c = controller!,
      start = performance.now();
    const bytes = await c.replica.snapshot(c.model);
    return { ms: performance.now() - start, bytes: bytes.length };
  },
  async undoRedo(index: number) {
    const c = controller!,
      start = performance.now();
    if (index % 2) c.redo();
    else c.undo();
    await paint();
    return performance.now() - start;
  },
  async seededStyles(runs: number) {
    const c = controller!,
      n = c.model.text.length,
      length = Math.floor(n / runs),
      pieces = Array.from({ length: runs }, (_, i) => ({
        length: i === runs - 1 ? n - length * i : length,
        mask: (i * 1664525 + 42) % 8,
      }));
    const m = new EditorModel(c.model.text, StyleTree.fromRuns(pieces));
    controller?.destroy();
    controller = new EditorController(m, document.getElementById('editor')!, () => {});
    raw = await encodeNative(m.snapshot());
    await paint();
  },
  metrics() {
    const c = controller!,
      runs = [...c.model.styles.leaves()].reduce(
        (n, leaf) =>
          n +
          (leaf.leaf?.kind === 'runs'
            ? leaf.leaf.runs.length
            : leaf.leaf?.kind === 'dense'
              ? leaf.length
              : 1),
        0,
      );
    return {
      utf8Bytes: c.model.text.utf8Bytes,
      utf16Length: c.model.text.length,
      lines: c.model.text.lines,
      runs,
      domLines: document.querySelectorAll('.cm-line').length,
      domStyleSpans: document.querySelectorAll('[class^="style-"]').length,
      longTasks: [...longTasks],
      heap: performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          }
        : null,
      historyBytes: c.model.historyBytes,
      workerQueueBytes: c.replica.queueBytes,
      styleNodes: [...c.model.styles.leaves()].length,
    };
  },
  gc() {
    window.gc?.();
  },
  async copyText() {
    return controller!.model.text.slice();
  },
  directInput() {
    const c = controller!,
      start = performance.now();
    const changes = ChangeSet.of({ from: 0, insert: 'x' }, c.model.text.length);
    c.model.change(changes, c.model.selection);
    return performance.now() - start;
  },
  textAdapter: TextAdapter,
};
export function initializeBenchmark(): void {
  longTasks.length = 0;
  observer?.disconnect();
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: true });
  }
  window.bench = bench;
}

export function disposeBenchmark(): void {
  controller?.destroy();
  controller = null;
  raw = null;
  observer?.disconnect();
  observer = null;
  delete window.bench;
}
