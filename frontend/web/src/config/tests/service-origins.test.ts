import { describe, expect, it } from 'vitest';
import { serviceOrigins } from '../server';

describe('validated service origins', () => {
  it('provides local defaults and normalizes an explicit HTTPS origin', () => {
    expect(serviceOrigins({})).toEqual({
      identity: 'http://127.0.0.1:8081',
      document: 'http://127.0.0.1:8082',
      processing: 'http://127.0.0.1:8083',
    });
    expect(
      serviceOrigins({ DOCUMENT_INTERNAL_ORIGIN: 'https://DOCUMENT.example.test:443/' }).document,
    ).toBe('https://document.example.test');
  });

  it.each([
    'file:///etc/passwd',
    'https://user:secret@document.example.test',
    'http://localhost:8082/api',
    'https://document.example.test/?token=secret',
    'https://document.example.test/#fragment',
    'not-an-origin',
  ])('rejects malformed or credential-bearing configuration: %s', (value) => {
    expect(() => serviceOrigins({ DOCUMENT_INTERNAL_ORIGIN: value })).toThrow();
  });
});
