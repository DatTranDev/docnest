import type { StateEffectType, Transaction } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { listOrdinal, type EditorModel } from '@ted/editor-core';
import type { ImageUrlCache } from './ImageUrlCache';
interface ViewportStyleSource {
  model: EditorModel;
  imageUrls: ImageUrlCache;
  matches: number[];
  queryLength: number;
  imageAlt: string;
}
const styleMarks = Array.from({ length: 8 }, (_, mask) =>
  Decoration.mark({ class: `style-${mask}` }),
);
const searchMark = Decoration.mark({ class: 'search-match' });
class ImageWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly url: string,
    readonly width: number,
    readonly height: number,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return this.id === other.id && this.alt === other.alt;
  }
  toDOM() {
    const image = document.createElement('img');
    image.className = 'editor-inline-image';
    image.alt = this.alt;
    image.src = this.url;
    image.width = this.width;
    image.height = this.height;
    return image;
  }
  ignoreEvent() {
    return false;
  }
}
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
        source.imageUrls.prune(source.model.images);
        const spans: { from: number; to: number; value: Decoration }[] = [];
        const mark = (from: number, to: number, value: Decoration) => {
          let start = from;
          for (const image of source.model.images.query(from, to)) {
            if (start < image.from) spans.push({ from: start, to: image.from, value });
            start = image.from + 1;
          }
          if (start < to) spans.push({ from: start, to, value });
        };
        let count = 0;
        for (const visible of view.visibleRanges) {
          const firstLine = view.state.doc.lineAt(visible.from).number;
          const lastLine = view.state.doc.lineAt(visible.to).number;
          for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
            const line = view.state.doc.line(lineNumber);
            const p = source.model.formatting.paragraphAt(line.from);
            if (p.table) continue;
            const classes = [
              `align-${p.align}`,
              ...(p.list ? ['editor-list'] : []),
              ...(p.pageBreak ? ['editor-page-break'] : []),
            ];
            const ordinal =
              p.list === 'number'
                ? listOrdinal(source.model.formatting.paragraphs, source.model.text, line.from)
                : 1;
            const css = `text-align:${p.align};padding-left:${(p.indent ?? 0) * 24 + (p.list ? 28 : 0)}px;line-height:${p.lineSpacing ?? 1.15};margin-top:${p.spaceBefore ?? 0}pt;margin-bottom:${p.spaceAfter ?? 0}pt;`;
            if (
              classes.length > 1 ||
              p.align !== 'left' ||
              p.indent ||
              p.lineSpacing ||
              p.spaceBefore ||
              p.spaceAfter
            )
              spans.push({
                from: line.from,
                to: line.from,
                value: Decoration.line({
                  attributes: {
                    class: classes.join(' '),
                    style: css,
                    ...(p.list ? { 'data-marker': p.list === 'bullet' ? '•' : `${ordinal}.` } : {}),
                  },
                }),
              });
          }
          for (const r of source.model.styles.queryRuns(visible.from, visible.to)) {
            if (r.mask) {
              if (++count > 30000) break;
              mark(r.from, r.to, styleMarks[r.mask]!);
            }
          }
          for (const r of source.model.formatting.query(visible.from, visible.to)) {
            const css = [
              r.font ? `font-family:'${r.font}'` : '',
              r.size ? `font-size:${r.size}pt` : '',
              r.color ? `color:${r.color}` : '',
              r.background ? `background-color:${r.background}` : '',
              r.script
                ? `vertical-align:${r.script};font-size:${r.size ? `${r.size * 0.75}pt` : '0.75em'}`
                : '',
            ]
              .filter(Boolean)
              .join(';');
            if (r.strike) {
              for (const mask of source.model.styles.queryRuns(r.from, r.to))
                mark(
                  mask.from,
                  mask.to,
                  Decoration.mark({
                    attributes: {
                      style: `${css};text-decoration-line:line-through${mask.mask & 4 ? ' underline' : ''}`,
                    },
                  }),
                );
            } else mark(r.from, r.to, Decoration.mark({ attributes: { style: css } }));
            if (r.link)
              mark(
                r.from,
                r.to,
                Decoration.mark({
                  tagName: 'a',
                  attributes: {
                    href: r.link,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    class: 'editor-link',
                  },
                }),
              );
          }
          for (const pos of source.matches)
            if (pos < visible.to && pos + source.queryLength > visible.from)
              mark(
                Math.max(pos, visible.from),
                Math.min(pos + source.queryLength, visible.to),
                searchMark,
              );
          for (const image of source.model.images.query(visible.from, visible.to))
            spans.push({
              from: image.from,
              to: image.from + 1,
              value: Decoration.replace({
                widget: new ImageWidget(
                  image.id,
                  source.imageUrls.get(image),
                  image.width,
                  image.height,
                  source.imageAlt,
                ),
              }),
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
