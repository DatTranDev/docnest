import { describe, expect, it } from 'vitest';
import { EditorModel } from '@ted/editor-core';
describe('snapshot-token save semantics', () => {
  it('a commit of R leaves concurrent R+1 unsaved and undo returns to saved', () => {
    const model = new EditorModel();
    model.replace(0, 0, 'before');
    const pin = model.snapshot();
    model.replace(6, 6, ' after', 0, 'separate');
    model.savedContentToken = pin.contentToken;
    expect(pin.text.slice()).toBe('before');
    expect(model.text.slice()).toBe('before after');
    expect(model.dirty).toBe(true);
    model.undo();
    expect(model.dirty).toBe(false);
  });
});
