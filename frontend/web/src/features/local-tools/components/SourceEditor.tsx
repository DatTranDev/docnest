'use client';
import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { languageSupport } from '../model/syntax';
import { SOURCE_LIMIT } from '../model/json';
export interface SourceHandle {
  replace: (value: string) => void;
  wrap: (before: string, after?: string, placeholder?: string) => void;
  prefix: (value: string) => void;
  undo: () => void;
  redo: () => void;
  focus: () => void;
  scrollDOM: HTMLElement;
  lineTop: (line: number) => number;
}
export function SourceEditor({
  initial,
  language,
  label,
  onChange,
  onLimit,
  handleRef,
}: {
  initial: string;
  language: string;
  label: string;
  onChange: (value: string) => void;
  onLimit: () => void;
  handleRef: React.RefObject<SourceHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const compartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onLimit });
  useEffect(() => {
    callbacks.current = { onChange, onLimit };
  }, [onChange, onLimit]);
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          indentOnInput(),
          syntaxHighlighting(classHighlighter),
          compartment.current.of([]),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.transactionFilter.of((transaction) => {
            if (transaction.newDoc.length > SOURCE_LIMIT) {
              queueMicrotask(() => callbacks.current.onLimit());
              return [];
            }
            return transaction;
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    handleRef.current = {
      scrollDOM: editor.scrollDOM,
      lineTop: (line) => {
        const position = editor.state.doc.line(
          Math.max(1, Math.min(line, editor.state.doc.lines)),
        ).from;
        return editor.lineBlockAt(position).top + editor.documentPadding.top;
      },
      replace: (value) => {
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: value },
          selection: { anchor: 0 },
          userEvent: 'input',
        });
        editor.focus();
      },
      wrap: (before, after = '', placeholder = '') => {
        const selection = editor.state.selection.main,
          text = editor.state.sliceDoc(selection.from, selection.to) || placeholder;
        editor.dispatch({
          changes: { from: selection.from, to: selection.to, insert: before + text + after },
          selection: {
            anchor: selection.from + before.length,
            head: selection.from + before.length + text.length,
          },
          userEvent: 'input',
        });
        editor.focus();
      },
      prefix: (prefix) => {
        const selection = editor.state.selection.main,
          from = editor.state.doc.lineAt(selection.from).from;
        const text = editor.state.sliceDoc(from, selection.to).replace(/^/gm, prefix);
        editor.dispatch({ changes: { from, to: selection.to, insert: text }, userEvent: 'input' });
        editor.focus();
      },
      undo: () => {
        undo(editor);
        editor.focus();
      },
      redo: () => {
        redo(editor);
        editor.focus();
      },
      focus: () => editor.focus(),
    };
    return () => {
      handleRef.current = null;
      view.current = null;
      editor.destroy();
    };
    // Initial content is only the seed; commands preserve the mounted editor's history.
  }, [handleRef, initial]);
  useEffect(() => {
    view.current?.dispatch({
      effects: compartment.current.reconfigure(languageSupport(language) ?? []),
    });
  }, [language]);
  useEffect(() => {
    view.current?.contentDOM.setAttribute('aria-label', label);
  }, [label]);
  return <div className="source-editor" ref={host} />;
}
