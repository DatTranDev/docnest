import {
  FONT_FAMILIES,
  IMAGE_PLACEHOLDER,
  ImageStore,
  RichFormatting,
  StyleTree,
  TEXT_STYLE_PRESETS,
  TextAdapter,
  safeLink,
  type CharacterFormat,
  type FormatRun,
  type ParagraphFormat,
  type PageSettings,
  type PlacedImage,
  type Run,
  type Snapshot,
} from '@ted/editor-core';
import { readDocxArchive } from './docxArchive';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT_WORD = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
function word(element: Element) {
  return element.namespaceURI === WORD || element.namespaceURI === STRICT_WORD;
}
function children(element: Element, name: string) {
  return Array.from(element.children).filter((child) => child.localName === name && word(child));
}
function child(element: Element | undefined, name: string) {
  return element ? children(element, name)[0] : undefined;
}
function attr(element: Element | undefined, name = 'val') {
  return (
    element?.getAttributeNS(WORD, name) ?? element?.getAttributeNS(STRICT_WORD, name) ?? undefined
  );
}
function descendants(element: Element, name: string) {
  return Array.from(element.getElementsByTagNameNS('*', name));
}
function xml(bytes: Uint8Array | undefined): Element | undefined {
  if (!bytes) return undefined;
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('docxInvalid');
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('docxInvalid');
  return parsed.documentElement;
}
interface RunStyle {
  mask: number;
  format: CharacterFormat;
}
function runStyle(properties: Element | undefined, base: RunStyle): RunStyle {
  let mask = base.mask;
  const format = { ...base.format };
  for (const [name, bit] of [
    ['b', 1],
    ['i', 2],
    ['u', 4],
  ] as const) {
    const property = child(properties, name);
    if (property)
      mask = ['0', 'false', 'off', 'none'].includes(attr(property) ?? '')
        ? mask & ~bit
        : mask | bit;
  }
  const fonts = child(properties, 'rFonts');
  const font = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi');
  if (font && FONT_FAMILIES.includes(font as (typeof FONT_FAMILIES)[number]))
    format.font = font as (typeof FONT_FAMILIES)[number];
  const size = Number(attr(child(properties, 'sz'))) / 2;
  if (Number.isInteger(size) && size >= 8 && size <= 72) format.size = size;
  const color = attr(child(properties, 'color'));
  if (color && /^[a-f\d]{6}$/i.test(color)) format.color = '#' + color;
  const fill = attr(child(properties, 'shd'), 'fill');
  if (fill && /^[a-f\d]{6}$/i.test(fill)) format.background = '#' + fill;
  const highlights: Record<string, string> = {
    yellow: '#ffff00',
    green: '#00ff00',
    cyan: '#00ffff',
    magenta: '#ff00ff',
    blue: '#0000ff',
    red: '#ff0000',
    darkBlue: '#000080',
    darkCyan: '#008080',
    darkGreen: '#008000',
    darkMagenta: '#800080',
    darkRed: '#800000',
    darkYellow: '#808000',
    darkGray: '#808080',
    lightGray: '#c0c0c0',
    black: '#000000',
    white: '#ffffff',
  };
  const highlight = attr(child(properties, 'highlight'));
  if (highlight && highlights[highlight]) format.background = highlights[highlight];
  if (highlight === 'none') delete format.background;
  const strike = child(properties, 'strike');
  if (strike) format.strike = !['0', 'false', 'off'].includes(attr(strike) ?? '');
  const script = attr(child(properties, 'vertAlign'));
  if (script)
    format.script = script === 'superscript' ? 'super' : script === 'subscript' ? 'sub' : 'normal';
  if (format.strike === false) delete format.strike;
  if (format.script === 'normal') delete format.script;
  return { mask, format };
}

/** Read inert XML into canonical text and allowlisted styles, never into the live DOM. */
export async function importDocx(bytes: Uint8Array): Promise<Snapshot> {
  const files = readDocxArchive(bytes);
  const document = xml(files['word/document.xml']);
  const body = child(document, 'body');
  if (!body) throw new Error('docxInvalid');
  // Reject content that would disappear or change its meaning in the canonical editor.
  if (
    [
      'altChunk',
      'object',
      'del',
      'ins',
      'sdt',
      'fldSimple',
      'footnoteReference',
      'endnoteReference',
      'sym',
      'txbxContent',
    ].some((name) => descendants(body, name).length)
  )
    throw new Error('docxUnsupported');
  const stylesXml = xml(files['word/styles.xml']);
  const styles = new Map(
    stylesXml
      ? children(stylesXml, 'style').map((style) => [attr(style, 'styleId') ?? '', style])
      : [],
  );
  const defaults = runStyle(child(child(child(stylesXml, 'docDefaults'), 'rPrDefault'), 'rPr'), {
    mask: 0,
    format: {},
  });
  function inherited(id: string | undefined, seen = new Set<string>()): RunStyle {
    if (!id || !styles.has(id)) return defaults;
    if (seen.has(id) || seen.size > 32) throw new Error('docxInvalid');
    seen.add(id);
    const style = styles.get(id)!;
    const base = inherited(attr(child(style, 'basedOn')), seen);
    const heading = /heading\s*([1-6])/i.exec(attr(child(style, 'name')) ?? id);
    const preset = heading
      ? TEXT_STYLE_PRESETS[`heading${heading[1]}` as keyof typeof TEXT_STYLE_PRESETS]
      : undefined;
    return runStyle(
      child(style, 'rPr'),
      preset
        ? {
            mask: preset.mask,
            format: { font: preset.font, size: preset.size, color: preset.color },
          }
        : base,
    );
  }
  const relationships = new Map<string, { target: string; external: boolean }>();
  const rels = xml(files['word/_rels/document.xml.rels']);
  for (const rel of Array.from(rels?.children ?? []))
    relationships.set(rel.getAttribute('Id') ?? '', {
      target: rel.getAttribute('Target') ?? '',
      external: rel.getAttribute('TargetMode') === 'External',
    });
  const numbering = xml(files['word/numbering.xml']);
  const paragraphs: ParagraphFormat[] = [],
    runs: FormatRun[] = [],
    masks: Run[] = [],
    images: PlacedImage[] = [],
    pieces: string[] = [];
  let length = 0,
    paragraphCount = 0;
  function append(text: string, style: RunStyle) {
    if (!text) return;
    if (length + text.length > 200000) throw new Error('docxLimit');
    const from = length;
    pieces.push(text);
    length += text.length;
    const last = masks.at(-1);
    if (last?.mask === style.mask) last.length += text.length;
    else masks.push({ length: text.length, mask: style.mask });
    if (Object.keys(style.format).length) runs.push({ ...style.format, from, to: length });
  }
  async function inline(element: Element, base: RunStyle) {
    for (const node of Array.from(element.children)) {
      if (!word(node)) continue;
      if (node.localName === 'r') {
        const styleId = attr(child(child(node, 'rPr'), 'rStyle'));
        const style = runStyle(
          child(node, 'rPr'),
          styleId ? runStyle(child(styles.get(styleId), 'rPr'), base) : base,
        );
        for (const content of Array.from(node.children)) {
          if (!word(content)) continue;
          if (content.localName === 't') append(content.textContent ?? '', style);
          else if (content.localName === 'tab') append('\t', style);
          else if (content.localName === 'br' || content.localName === 'cr') {
            if (attr(content, 'type') === 'page') throw new Error('docxUnsupported');
            append('\n', style);
          } else if (content.localName === 'drawing') {
            const blips = descendants(content, 'blip');
            if (blips.length !== 1 || !descendants(content, 'inline').length)
              throw new Error('docxUnsupported');
            const relationship = Array.from(blips[0]!.attributes).find(
              (attribute) => attribute.localName === 'embed',
            )?.value;
            const reference = relationships.get(relationship ?? '');
            if (!reference || reference.external || !/^media\/[^/]+$/.test(reference.target))
              throw new Error('docxUnsupported');
            const data = files['word/' + reference.target];
            if (!data || data.length > 2 * 1024 * 1024 || images.length >= 100)
              throw new Error('docxLimit');
            const mime = data[0] === 137 ? 'image/png' : data[0] === 255 ? 'image/jpeg' : null;
            if (!mime) throw new Error('docxUnsupported');
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(data)], { type: mime }),
            );
            const { width, height } = bitmap;
            bitmap.close();
            let encoded = '';
            for (let offset = 0; offset < data.length; offset += 32766)
              encoded += btoa(String.fromCharCode(...data.subarray(offset, offset + 32766)));
            images.push({
              id: crypto.randomUUID(),
              from: length,
              width,
              height,
              mime,
              data: encoded,
            });
            append(IMAGE_PLACEHOLDER, style);
          } else if (!['rPr', 'lastRenderedPageBreak'].includes(content.localName))
            throw new Error('docxUnsupported');
        }
      } else if (node.localName === 'hyperlink') {
        const id = Array.from(node.attributes).find(
          (attribute) => attribute.localName === 'id',
        )?.value;
        const ref = relationships.get(id ?? '');
        await inline(
          node,
          ref?.external && safeLink(ref.target)
            ? { ...base, format: { ...base.format, link: ref.target } }
            : base,
        );
      } else if (!['pPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr'].includes(node.localName))
        throw new Error('docxUnsupported');
    }
  }
  async function paragraph(element: Element, table?: { id: string; columns: number }) {
    if (++paragraphCount > 2000) throw new Error('docxLimit');
    if (paragraphCount > 1) append('\n', defaults);
    const from = length,
      properties = child(element, 'pPr');
    const id = attr(child(properties, 'pStyle'));
    const align = attr(child(properties, 'jc'));
    const p: ParagraphFormat = {
      from,
      align:
        align === 'center' || align === 'right' ? align : align === 'both' ? 'justify' : 'left',
      ...(table ? { table } : {}),
    };
    const indent = Number(attr(child(properties, 'ind'), 'left'));
    if (indent > 0) p.indent = Math.min(8, Math.round(indent / 360));
    const spacing = child(properties, 'spacing');
    for (const [attribute, key] of [
      ['before', 'spaceBefore'],
      ['after', 'spaceAfter'],
    ] as const) {
      const value = Number(attr(spacing, attribute));
      if (value > 0) p[key] = Math.min(72, Math.round(value / 20));
    }
    const line = Number(attr(spacing, 'line')) / 240;
    if ([1, 1.15, 1.5, 2, 2.5, 3].includes(line)) p.lineSpacing = line;
    const pageBreak = child(properties, 'pageBreakBefore');
    if (pageBreak && !['0', 'false', 'off'].includes(attr(pageBreak) ?? '')) p.pageBreak = true;
    const numProperties = child(properties, 'numPr');
    const numId = attr(child(numProperties, 'numId'));
    if (numId && numId !== '0' && numbering) {
      const num = children(numbering, 'num').find((item) => attr(item, 'numId') === numId);
      const abstractId = attr(child(num, 'abstractNumId'));
      const definition = children(numbering, 'abstractNum').find(
        (item) => attr(item, 'abstractNumId') === abstractId,
      );
      const level =
        definition &&
        children(definition, 'lvl').find(
          (item) => attr(item, 'ilvl') === (attr(child(numProperties, 'ilvl')) ?? '0'),
        );
      p.list = attr(child(level, 'numFmt')) === 'bullet' ? 'bullet' : 'number';
    }
    if (p.align !== 'left' || Object.keys(p).length > 2) paragraphs.push(p);
    await inline(element, inherited(id));
  }
  for (const block of Array.from(body.children)) {
    if (!word(block)) throw new Error('docxUnsupported');
    if (block.localName === 'p') await paragraph(block);
    else if (block.localName === 'tbl') {
      const rows = children(block, 'tr'),
        first = rows[0];
      const columns = first ? children(first, 'tc').length : 0;
      if (!columns || columns > 12) throw new Error('docxUnsupported');
      const table = { id: crypto.randomUUID(), columns };
      const start = length;
      if (rows.length * columns > 1000) throw new Error('docxLimit');
      for (const row of rows) {
        const cells = children(row, 'tc');
        if (cells.length !== columns) throw new Error('docxUnsupported');
        for (const cell of cells) {
          const ps = children(cell, 'p');
          if (
            ps.length !== 1 ||
            children(cell, 'tbl').length ||
            descendants(cell, 'gridSpan').length ||
            descendants(cell, 'vMerge').length ||
            descendants(cell, 'br').length ||
            descendants(cell, 'cr').length
          )
            throw new Error('docxUnsupported');
          await paragraph(ps[0]!, table);
        }
      }
      if (length - start > 20000) throw new Error('docxLimit');
    } else if (block.localName !== 'sectPr') throw new Error('docxUnsupported');
  }
  const text = TextAdapter.from(pieces.join(''));
  const page: PageSettings = {};
  for (const kind of ['header', 'footer'] as const) {
    const references = descendants(body, kind + 'Reference');
    if (references.length > 1) throw new Error('docxUnsupported');
    if (!references.length) continue;
    const id = Array.from(references[0]!.attributes).find(
      (attribute) => attribute.localName === 'id',
    )?.value;
    const ref = relationships.get(id ?? '');
    if (!ref || ref.external || !/^(header|footer)[^/]*\.xml$/.test(ref.target))
      throw new Error('docxUnsupported');
    const part = xml(files['word/' + ref.target]);
    if (!part || descendants(part, 'drawing').length || descendants(part, 'tbl').length)
      throw new Error('docxUnsupported');
    const fields = descendants(part, 'fldSimple').map((field) => attr(field, 'instr')?.trim());
    if (fields.some((field) => field !== 'PAGE') || descendants(part, 'instrText').length)
      throw new Error('docxUnsupported');
    if (fields.includes('PAGE')) page.pageNumbers = true;
    page[kind] = children(part, 'p')
      .map((p) =>
        descendants(p, 't')
          .map((node) => node.textContent ?? '')
          .join(''),
      )
      .join(' ');
  }
  const formatting = RichFormatting.parse({ runs, paragraphs, page }, text, true, true);
  return {
    text,
    styles: StyleTree.fromRuns(masks),
    formatting,
    images: ImageStore.parse({ images }, text),
    contentToken: crypto.randomUUID(),
    localRevision: 0,
    preferredExportEol: 'LF',
    exportBom: false,
  };
}
