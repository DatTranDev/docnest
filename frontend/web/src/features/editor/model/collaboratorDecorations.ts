import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { Collaborator } from './CollaborationClient';

const COLORS = ['#a63d40', '#225aab', '#8a4a9f', '#0f756a', '#98610d', '#a43771'];

export function collaboratorColor(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return COLORS[(hash >>> 0) % COLORS.length]!;
}

class CursorWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
    readonly avatarUrl: string | null,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'collaborator-cursor';
    marker.style.borderColor = this.color;
    const label = document.createElement('span');
    label.className = 'collaborator-cursor-label';
    label.style.backgroundColor = this.color;
    const face = document.createElement('span');
    face.className = 'collaborator-cursor-face';
    face.textContent =
      this.name
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => Array.from(part)[0]?.toLocaleUpperCase() ?? '')
        .join('') || '?';
    if (this.avatarUrl) {
      const image = document.createElement('img');
      image.src = this.avatarUrl;
      image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      face.append(image);
    }
    const name = document.createElement('span');
    name.className = 'collaborator-cursor-name';
    name.textContent = this.name;
    label.append(face, name);
    marker.append(label);
    return marker;
  }
}

export const setCollaborators = StateEffect.define<Collaborator[]>();

export const collaboratorDecorations = StateField.define<ReturnType<typeof Decoration.set>>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    const update = transaction.effects.find((effect) => effect.is(setCollaborators));
    if (!update) return decorations.map(transaction.changes);
    const builder = new RangeSetBuilder<Decoration>();
    const ranges: { from: number; to: number; decoration: Decoration }[] = [];
    for (const member of update.value) {
      if (member.anchor === null || member.head === null) continue;
      const anchor = Math.min(transaction.newDoc.length, member.anchor);
      const head = Math.min(transaction.newDoc.length, member.head);
      const color = collaboratorColor(member.userId);
      if (anchor !== head)
        ranges.push({
          from: Math.min(anchor, head),
          to: Math.max(anchor, head),
          decoration: Decoration.mark({ attributes: { style: `background-color: ${color}33` } }),
        });
      ranges.push({
        from: head,
        to: head,
        decoration: Decoration.widget({
          widget: new CursorWidget(member.displayName, color, member.avatarUrl),
        }),
      });
    }
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    for (const range of ranges) builder.add(range.from, range.to, range.decoration);
    return builder.finish();
  },
  provide: (field) => EditorView.decorations.from(field),
});
