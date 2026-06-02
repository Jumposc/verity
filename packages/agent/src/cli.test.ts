import { describe, expect, test } from 'vitest';
import { parseArgs } from './cli';

describe('parseArgs', () => {
  test('parses figma target and url', () => {
    const opts = parseArgs(['--figma-file', 'abc', '--node', '1:2', '--url', 'http://localhost:3000']);
    expect(opts.figma).toEqual({ fileKey: 'abc', nodeId: '1:2' });
    expect(opts.url).toBe('http://localhost:3000');
    expect(opts.scenario).toBeUndefined();
  });

  test('parses viewport WxH into scenario', () => {
    const opts = parseArgs(['--figma-file', 'abc', '--node', '1:2', '--url', 'http://x', '--viewport', '1440x900']);
    expect(opts.scenario?.viewport).toEqual({ width: 1440, height: 900 });
  });

  test('throws when url is missing', () => {
    expect(() => parseArgs(['--figma-file', 'abc', '--node', '1:2'])).toThrow(/url/i);
  });

  test('throws when figma file is missing', () => {
    expect(() => parseArgs(['--node', '1:2', '--url', 'http://x'])).toThrow(/figma-file/i);
  });

  test('throws on malformed viewport', () => {
    expect(() =>
      parseArgs(['--figma-file', 'a', '--node', '1:2', '--url', 'http://x', '--viewport', 'wide']),
    ).toThrow(/viewport/i);
  });
});
