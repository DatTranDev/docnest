import { RichFormatting, listOrdinal, type Snapshot } from '@ted/editor-core';
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
export function documentLines(snapshot: Snapshot) {
  if (snapshot.text.length > 200_000 || snapshot.text.lines > 2_000)
    throw new Error('OFFICE_LIMIT');
  if (
    (snapshot.images?.images ?? []).reduce((sum, image) => sum + image.width * image.height, 0) >
    16_777_216
  )
    throw new Error('OFFICE_LIMIT');
  const formatting = snapshot.formatting ?? new RichFormatting();
  return Array.from({ length: snapshot.text.lines }, (_, index) => {
    const line = snapshot.text.text.line(index + 1),
      points = new Set([line.from, line.to]);
    for (const run of snapshot.styles.queryRuns(line.from, line.to)) {
      points.add(run.from);
      points.add(run.to);
    }
    for (const run of formatting.query(line.from, line.to)) {
      points.add(run.from);
      points.add(run.to);
    }
    for (const image of snapshot.images?.query(line.from, line.to) ?? []) {
      points.add(image.from);
      points.add(image.from + 1);
    }
    const boundaries = [...points].sort((a, b) => a - b);
    return {
      paragraph: formatting.paragraphAt(line.from),
      ordinal: listOrdinal(formatting.paragraphs, snapshot.text, line.from),
      runs: boundaries.slice(0, -1).map((from, i) => ({
        text: snapshot.text.slice(from, boundaries[i + 1]),
        mask: snapshot.styles.maskAt(from),
        format: formatting.at(from),
        image: snapshot.images?.at(from),
      })),
    };
  });
}
export function richHtml(snapshot: Snapshot): string {
  const lines = documentLines(snapshot);
  const paragraphs = lines.map(({ paragraph, runs, ordinal }) => {
    const style = `text-align:${paragraph.align};margin-top:${paragraph.spaceBefore ?? 0}pt;margin-bottom:${paragraph.spaceAfter ?? 0}pt;line-height:${paragraph.lineSpacing ?? 1.15};padding-left:${(paragraph.indent ?? 0) * 24}px;${paragraph.pageBreak ? 'break-before:page;' : ''}`;
    const contents =
      runs
        .map(({ text, mask, format, image }) => {
          if (image)
            return `<img src="data:${image.mime};base64,${image.data}" alt="" width="${image.width}" height="${image.height}" style="max-width:100%;height:auto">`;
          const decorations = [mask & 4 ? 'underline' : '', format.strike ? 'line-through' : '']
            .filter(Boolean)
            .join(' ');
          const css = `${mask & 1 ? 'font-weight:700;' : ''}${mask & 2 ? 'font-style:italic;' : ''}${decorations ? `text-decoration:${decorations};` : ''}${format.font ? `font-family:${format.font};` : ''}${format.size ? `font-size:${format.size}pt;` : ''}${format.color ? `color:${format.color};` : ''}${format.background ? `background:${format.background};` : ''}${format.script ? `vertical-align:${format.script === 'normal' ? 'baseline' : format.script};` : ''}`;
          const span = `<span style="${css}">${escapeHtml(text)}</span>`;
          return format.link
            ? `<a href="${escapeHtml(format.link)}" rel="noopener noreferrer">${span}</a>`
            : span;
        })
        .join('') || '<br>';
    return `<p style="${style}">${paragraph.list ? (paragraph.list === 'bullet' ? '• ' : `${ordinal}. `) : ''}${contents}</p>`;
  });
  const blocks: string[] = [];
  for (let i = 0; i < lines.length;) {
    const table = lines[i]!.paragraph.table;
    if (!table) {
      blocks.push(paragraphs[i++]!);
      continue;
    }
    const rows: string[] = [];
    while (i < lines.length && lines[i]!.paragraph.table?.id === table.id) {
      const cells: string[] = [];
      for (
        let column = 0;
        column < table.columns && lines[i]?.paragraph.table?.id === table.id;
        column++
      )
        cells.push(`<td>${paragraphs[i++]}</td>`);
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    blocks.push(`<table><tbody>${rows.join('')}</tbody></table>`);
  }
  const page = snapshot.formatting?.page;
  return `${page?.header ? `<header>${escapeHtml(page.header)}</header>` : ''}${blocks.join('')}${page?.footer ? `<footer>${escapeHtml(page.footer)}</footer>` : ''}`;
}
export function htmlFile(body: string, title: string, language: string): string {
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{max-width:800px;margin:40px auto;padding:0 24px;color:#202124;font:16px/1.65 Arial,sans-serif}p{white-space:pre-wrap}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #b8c2cf;padding:8px}pre{white-space:pre-wrap;background:#edf2f8;padding:18px;border-radius:8px}code{font-family:Consolas,monospace}.tok-keyword,.tok-bool,.tok-atom{color:#6b3fc5}.tok-string,.tok-string2{color:#19703c}.tok-number{color:#af5012}.tok-typeName,.tok-propertyName{color:#075e9b}.tok-comment{color:#697782;font-style:italic}blockquote{border-left:3px solid #1a73e8;padding-left:18px}header,footer{color:#5f6368;font-size:12px}a{color:#0b57d0}@page{size:A4;margin:20mm}@media print{body{margin:0;padding:0;max-width:none}pre,table{break-inside:avoid}}</style></head><body>${body}</body></html>`;
}
export async function printHtml(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.title = 'docsnest print';
  frame.className = 'local-print-frame';
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  const view = frame.contentWindow;
  if (!view) {
    frame.remove();
    throw new Error('PRINT_UNAVAILABLE');
  }
  await view.document.fonts.ready;
  await Promise.all(Array.from(view.document.images, (image) => image.decode().catch(() => {})));
  view.addEventListener('afterprint', () => frame.remove(), { once: true });
  view.focus();
  view.print();
  // Some mobile browsers do not emit afterprint.
  setTimeout(() => frame.remove(), 60_000);
}
