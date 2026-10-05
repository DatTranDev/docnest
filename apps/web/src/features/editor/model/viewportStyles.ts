import type { StateEffectType, Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import type { EditorModel } from '@ted/editor-core';
interface ViewportStyleSource {
  model: EditorModel;
  matches: number[];
  queryLength: number;
}
const styleMarks = Array.from({ length: 8 }, (_, mask) =>
  Decoration.mark({ class: `style-${mask}` }),
);
const searchMark = Decoration.mark({ class: 'search-match' });
export function viewportStylePlugin(source: ViewportStyleSource, refresh: StateEffectType<void>) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: {
        view: EditorView;
        docChanged: boolean;
        viewportChanged: boolean;
        transactions: readonly Transaction[];
      }) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))
        )
          this.decorations = this.build(u.view);
      }
      build(view: EditorView) {
        const spans: { from: number; to: number; value: Decoration }[] = [];
        let count = 0;
        for (const visible of view.visibleRanges) {
          for (const r of source.model.styles.queryRuns(visible.from, visible.to)) {
            if (r.mask) {
              if (++count > 30000) break;
              spans.push({
                from: r.from,
                to: r.to,
                value: styleMarks[r.mask]!,
              });
            }
          }
          for (const pos of source.matches)
            if (pos < visible.to && pos + source.queryLength > visible.from)
              spans.push({
                from: Math.max(pos, visible.from),
                to: Math.min(pos + source.queryLength, visible.to),
                value: searchMark,
              });
        }
        return Decoration.set(
          spans.map((s) => s.value.range(s.from, s.to)),
          true,
        );
      }
    },
    { decorations: (v) => v.decorations },
  );
}
