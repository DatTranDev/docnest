import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  ExternalHyperlink,
  Header,
  Footer,
  PageNumber,
  AlignmentType,
  LevelFormat,
  Packer,
} from 'docx';
import type { Snapshot } from '@ted/editor-core';
import { documentLines } from './documentExport';
export async function exportLocalDocx(snapshot: Snapshot, title: string): Promise<Uint8Array> {
  const lines = documentLines(snapshot);
  const paragraphs = lines.map(
    ({ paragraph, runs }) =>
      new Paragraph({
        alignment: paragraph.align === 'justify' ? AlignmentType.JUSTIFIED : paragraph.align,
        indent: { left: (paragraph.indent ?? 0) * 360 },
        spacing: {
          before: (paragraph.spaceBefore ?? 0) * 20,
          after: (paragraph.spaceAfter ?? 0) * 20,
          line: Math.round((paragraph.lineSpacing ?? 1.15) * 240),
        },
        pageBreakBefore: paragraph.pageBreak,
        numbering: paragraph.list ? { reference: paragraph.list, level: 0 } : undefined,
        children: runs.map(({ text, mask, format, image }) => {
          if (image)
            return new ImageRun({
              type: image.mime === 'image/png' ? 'png' : 'jpg',
              data: Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0)),
              transformation: {
                width: Math.min(image.width, 600),
                height: image.height * Math.min(1, 600 / image.width),
              },
            });
          const run = new TextRun({
            text,
            bold: !!(mask & 1),
            italics: !!(mask & 2),
            underline: mask & 4 ? {} : undefined,
            strike: format.strike,
            font: format.font,
            size: format.size ? format.size * 2 : undefined,
            color: format.color?.slice(1),
            shading: format.background ? { fill: format.background.slice(1) } : undefined,
            superScript: format.script === 'super',
            subScript: format.script === 'sub',
          });
          return format.link ? new ExternalHyperlink({ link: format.link, children: [run] }) : run;
        }),
      }),
  );
  const children: (Paragraph | Table)[] = [];
  for (let i = 0; i < lines.length;) {
    const table = lines[i]!.paragraph.table;
    if (!table) {
      children.push(paragraphs[i++]!);
      continue;
    }
    const rows: TableRow[] = [];
    while (i < lines.length && lines[i]!.paragraph.table?.id === table.id) {
      const cells: TableCell[] = [];
      for (let col = 0; col < table.columns && lines[i]?.paragraph.table?.id === table.id; col++)
        cells.push(new TableCell({ children: [paragraphs[i++]!] }));
      rows.push(new TableRow({ children: cells }));
    }
    children.push(new Table({ rows }));
  }
  const page = snapshot.formatting?.page;
  const file = new Document({
    creator: 'docsnest',
    title,
    numbering: {
      config: [
        {
          reference: 'bullet',
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT },
          ],
        },
        {
          reference: 'number',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        headers: page?.header
          ? { default: new Header({ children: [new Paragraph(page.header)] }) }
          : undefined,
        footers:
          page?.footer || page?.pageNumbers
            ? {
                default: new Footer({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun(page.footer ?? ''),
                        ...(page.pageNumbers
                          ? [new TextRun({ children: [' ', PageNumber.CURRENT] })]
                          : []),
                      ],
                    }),
                  ],
                }),
              }
            : undefined,
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(file));
}
