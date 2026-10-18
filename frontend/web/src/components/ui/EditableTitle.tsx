'use client';

import { useEffect, useRef, useState } from 'react';

export function EditableTitle({
  title,
  label,
  level = 1,
  editable,
  onRename,
}: {
  title: string;
  label: string;
  level?: 1 | 2;
  editable: boolean;
  onRename: (title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canceled = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(title);
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    if (canceled.current) {
      canceled.current = false;
      return;
    }
    const next = draft.trim();
    if (!next || next === title) {
      setDraft(title);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(next);
      setEditing(false);
    } catch {
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const content =
    editing && editable ? (
      <input
        ref={input}
        className="editable-title-input"
        aria-label={label}
        value={draft}
        maxLength={120}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            canceled.current = true;
            setDraft(title);
            setEditing(false);
          }
        }}
      />
    ) : editable ? (
      <button
        type="button"
        className="editable-title-trigger"
        aria-label={`${label}: ${title}`}
        title={`${label}: ${title}`}
        onDoubleClick={startEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            startEditing();
          }
        }}
      >
        {title}
      </button>
    ) : (
      title
    );

  return level === 1 ? <h1>{content}</h1> : <h2>{content}</h2>;
}
