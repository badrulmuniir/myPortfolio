import { describe, expect, it } from 'vitest';
import { REDACTED, createLogger, redact } from '../../src/utils/logger.js';

function captureSink() {
  const lines = { info: [], warn: [], error: [] };
  return {
    lines,
    sink: {
      info: (l) => lines.info.push(l),
      warn: (l) => lines.warn.push(l),
      error: (l) => lines.error.push(l),
    },
  };
}

describe('redact', () => {
  it('replaces the required keys case-insensitively at every nesting level', () => {
    const input = {
      Password: 'p1',
      user: { password_hash: '$2b$12$abc', profile: { TOKEN: 't1' } },
      headers: { Authorization: 'Bearer xyz', accept: 'json' },
      list: [{ token: 't2' }, 'plain'],
      keep: 'visible',
    };
    expect(redact(input)).toEqual({
      Password: REDACTED,
      user: { password_hash: REDACTED, profile: { TOKEN: REDACTED } },
      headers: { Authorization: REDACTED, accept: 'json' },
      list: [{ token: REDACTED }, 'plain'],
      keep: 'visible',
    });
  });

  it('does not modify the input', () => {
    const input = { password: 'secret' };
    redact(input);
    expect(input.password).toBe('secret');
  });

  it('serializes errors and redacts their own properties', () => {
    const err = Object.assign(new Error('boom'), { code: 'E1', password: 'leak' });
    const out = redact({ err });
    expect(out.err).toMatchObject({ name: 'Error', message: 'boom', code: 'E1', password: REDACTED });
    expect(out.err.stack).toContain('boom');
  });

  it('marks circular references and copies shared objects', () => {
    const shared = { a: 1 };
    const loop = { shared, again: shared };
    loop.self = loop;
    expect(redact(loop)).toEqual({ shared: { a: 1 }, again: { a: 1 }, self: '[Circular]' });
  });
});

describe('createLogger', () => {
  it('writes one line per call with redacted metadata', () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ sink, now: () => new Date('2024-01-02T03:04:05.000Z') });
    log.error('Request failed', { method: 'POST', path: '/api/auth/login', password: 'hunter2hunter2' });
    log.info('started');
    expect(lines.error).toHaveLength(1);
    expect(lines.error[0]).toMatch(/^\[2024-01-02T03:04:05.000Z\] ERROR Request failed \{/);
    expect(lines.error[0]).not.toContain('hunter2hunter2');
    expect(lines.error[0]).toContain(REDACTED);
    expect(lines.info).toEqual(['[2024-01-02T03:04:05.000Z] INFO started']);
  });
});
