import { describe, expect, it } from 'vitest';
import {
  EMPLOYMENT_TYPES,
  PROFICIENCY_LEVELS,
  REASONS,
  bool,
  digits,
  email,
  int,
  isoDate,
  isValidEmail,
  isValidUrl,
  joinPath,
  list,
  map,
  nullable,
  object,
  oneOf,
  optional,
  password,
  refine,
  str,
  url,
} from '../../src/validators/rules.js';
import { isValidEmail as envIsValidEmail } from '../../src/config/env.js';

/** Returns `[field, reason]` pairs of a failed result, for compact assertions. */
const issues = (result) => {
  expect(result.ok).toBe(false);
  return result.errors.map((e) => [e.field, e.reason]);
};
const reasonOf = (result) => issues(result)[0][1];

describe('result shape', () => {
  it('every error has field, a fixed reason token and a readable message', () => {
    const tokens = Object.values(REASONS);
    const result = object({ a: str({ min: 1 }), b: int({ min: 0 }) })({ b: 'x', c: 1 });
    expect(result.ok).toBe(false);
    for (const e of result.errors) {
      expect(Object.keys(e).sort()).toEqual(['field', 'message', 'reason']);
      expect(tokens).toContain(e.reason);
      expect(typeof e.message).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('joins paths for nested keys and list indexes', () => {
    expect(joinPath('', 'a')).toBe('a');
    expect(joinPath('a', 'b')).toBe('a.b');
    expect(joinPath('a', '[2]')).toBe('a[2]');
    expect(joinPath('a', '')).toBe('a');
  });
});

describe('str', () => {
  const rule = str({ min: 1, max: 5 });

  it('trims and returns the trimmed value', () => {
    expect(rule('  abc  ')).toEqual({ ok: true, value: 'abc' });
  });

  it('counts code points, so astral characters count once', () => {
    expect(rule('😀😀😀😀😀').ok).toBe(true); // 10 UTF-16 units, 5 code points
    expect(reasonOf(rule('😀😀😀😀😀😀'))).toBe('too_long');
  });

  it('measures length after trimming', () => {
    expect(rule('   12345   ').ok).toBe(true);
    expect(reasonOf(rule('123456'))).toBe('too_long');
  });

  it('treats a whitespace-only value as empty', () => {
    expect(reasonOf(rule('   '))).toBe('required');
    expect(str({ max: 5 })('   ')).toEqual({ ok: true, value: '' });
  });

  it('reports too_short for non-empty values under min', () => {
    expect(reasonOf(str({ min: 10 })('short'))).toBe('too_short');
    expect(str({ min: 10 })('0123456789').ok).toBe(true);
  });

  it('rejects missing and non-string values', () => {
    expect(reasonOf(rule(undefined))).toBe('required');
    expect(reasonOf(rule(null))).toBe('required');
    expect(reasonOf(rule(5))).toBe('type');
    expect(reasonOf(rule(['a']))).toBe('type');
  });

  it('accepts an omitted value when required is false', () => {
    const opt = str({ min: 1, max: 5, required: false });
    expect(opt(undefined)).toEqual({ ok: true, value: undefined });
    expect(reasonOf(opt('  '))).toBe('required');
  });

  it('uses the given path as the field', () => {
    expect(rule(5, 'name').errors[0].field).toBe('name');
  });
});

describe('int', () => {
  const rule = int({ min: 0, max: 9999 });

  it.each([0, 1, 9999])('accepts %j', (v) => expect(rule(v)).toEqual({ ok: true, value: v }));

  it.each([-1, 10000])('rejects %j as out_of_range', (v) => expect(reasonOf(rule(v))).toBe('out_of_range'));

  it.each(['5', 5.5, Number.NaN, Number.POSITIVE_INFINITY, true, {}])('rejects %j as type', (v) =>
    expect(reasonOf(rule(v))).toBe('type'),
  );

  it('rejects missing values', () => {
    expect(reasonOf(rule(undefined))).toBe('required');
    expect(reasonOf(rule(null))).toBe('required');
  });
});

describe('digits', () => {
  const rule = digits({ min: 1, max: 2147483647 });

  it('converts digit strings to numbers', () => {
    expect(rule('42')).toEqual({ ok: true, value: 42 });
    expect(rule('2147483647')).toEqual({ ok: true, value: 2147483647 });
  });

  it('rejects non-digit strings, out-of-range values and non-strings', () => {
    expect(reasonOf(rule('4a'))).toBe('invalid_format');
    expect(reasonOf(rule(' 4'))).toBe('invalid_format');
    expect(reasonOf(rule('-1'))).toBe('invalid_format');
    expect(reasonOf(rule('0'))).toBe('out_of_range');
    expect(reasonOf(rule('2147483648'))).toBe('out_of_range');
    expect(reasonOf(rule(4))).toBe('type');
  });
});

describe('bool', () => {
  it('accepts only JSON booleans', () => {
    expect(bool()(true)).toEqual({ ok: true, value: true });
    expect(bool()(false)).toEqual({ ok: true, value: false });
    expect(reasonOf(bool()('true'))).toBe('type');
    expect(reasonOf(bool()(1))).toBe('type');
    expect(reasonOf(bool()(undefined))).toBe('required');
  });
});

describe('oneOf', () => {
  const level = oneOf(PROFICIENCY_LEVELS);

  it('accepts exact members only', () => {
    expect(level('Expert')).toEqual({ ok: true, value: 'Expert' });
    expect(reasonOf(level('expert'))).toBe('invalid_value');
    expect(reasonOf(level(' Expert'))).toBe('invalid_value');
    expect(reasonOf(level(''))).toBe('invalid_value');
    expect(reasonOf(level(undefined))).toBe('required');
  });

  it('accepts the empty string when it is listed', () => {
    expect(oneOf(['', ...PROFICIENCY_LEVELS])('').ok).toBe(true);
  });

  it('exports the Employment_Type values', () => {
    expect(EMPLOYMENT_TYPES).toEqual(['Full-time', 'Part-time', 'Internship', 'Contract', 'Freelance', 'Volunteer']);
    expect(reasonOf(oneOf(EMPLOYMENT_TYPES)('Full time'))).toBe('invalid_value');
  });
});

describe('url', () => {
  const required = url();
  const opt = url({ required: false });
  const prefix = 'https://example.com/';

  it.each(['http://example.com', 'https://sub.example.org/path?q=1#x', 'HTTPS://EXAMPLE.COM'])('accepts %s', (v) =>
    expect(required(v).ok).toBe(true),
  );

  it.each(['javascript:alert(1)', 'ftp://example.com', 'mailto:a@b.co', 'file:///etc/passwd', 'http://', 'example.com', '/relative'])(
    'rejects %s',
    (v) => expect(required(v).ok).toBe(false),
  );

  it('trims before checking', () => {
    expect(required('  https://example.com  ')).toEqual({ ok: true, value: 'https://example.com' });
  });

  it('accepts 2048 characters and rejects 2049', () => {
    const at = prefix + 'a'.repeat(2048 - prefix.length);
    expect(at.length).toBe(2048);
    expect(required(at).ok).toBe(true);
    expect(reasonOf(required(`${at}a`))).toBe('too_long');
  });

  it('allows empty only when optional or allowEmpty', () => {
    expect(reasonOf(required(''))).toBe('required');
    expect(opt('   ')).toEqual({ ok: true, value: '' });
    expect(opt(undefined)).toEqual({ ok: true, value: undefined });
    expect(url({ allowEmpty: true })('')).toEqual({ ok: true, value: '' });
    expect(reasonOf(url({ allowEmpty: true })(undefined))).toBe('required');
    expect(reasonOf(opt('nope'))).toBe('invalid_url');
    expect(reasonOf(opt(42))).toBe('type');
  });

  it('isValidUrl follows the Valid_URL definition', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl(' https://example.com')).toBe(true); // URL parsing strips the spaces
    expect(isValidUrl('ws://example.com')).toBe(false);
    expect(isValidUrl(null)).toBe(false);
  });
});

describe('email', () => {
  const rule = email();

  it('accepts valid emails and trims them', () => {
    expect(rule('  first.last+tag@sub.example.org ')).toEqual({ ok: true, value: 'first.last+tag@sub.example.org' });
  });

  it('lowercases only when asked', () => {
    expect(rule('Admin@Example.COM').value).toBe('Admin@Example.COM');
    expect(email({ lowercase: true })(' Admin@Example.COM ').value).toBe('admin@example.com');
  });

  it.each(['a@b', 'a@.b.co', 'a@b..co', 'a@b.co.', 'a b@c.co', 'a@b@c.co', '@b.co', 'a@'])('rejects %s', (v) =>
    expect(reasonOf(rule(v))).toBe('invalid_email'),
  );

  it('accepts 254 characters and rejects 255', () => {
    expect(rule(`${'a'.repeat(242)}@example.com`).ok).toBe(true);
    expect(reasonOf(rule(`${'a'.repeat(243)}@example.com`))).toBe('too_long');
  });

  it('rejects missing, empty and non-string values', () => {
    expect(reasonOf(rule(undefined))).toBe('required');
    expect(reasonOf(rule('  '))).toBe('required');
    expect(reasonOf(rule(1))).toBe('type');
  });

  it('shares its definition with the configuration loader', () => {
    expect(envIsValidEmail).toBe(isValidEmail);
  });
});

describe('isoDate', () => {
  const rule = isoDate();

  it.each(['2024-02-29', '2000-02-29', '2023-12-31', '1999-01-01'])('accepts %s', (v) =>
    expect(rule(v)).toEqual({ ok: true, value: v }),
  );

  it.each(['2023-02-29', '1900-02-29', '2024-13-01', '2024-00-10', '2024-04-31', '2024-1-01', '2024/01/01', '20240101', '2024-01-01T00:00:00Z'])(
    'rejects %s',
    (v) => expect(reasonOf(rule(v))).toBe('invalid_format'),
  );

  it('trims and rejects missing or non-string values', () => {
    expect(rule(' 2024-01-31 ').value).toBe('2024-01-31');
    expect(reasonOf(rule(''))).toBe('required');
    expect(reasonOf(rule(undefined))).toBe('required');
    expect(reasonOf(rule(20240101))).toBe('type');
  });
});

describe('password', () => {
  const rule = password();

  it('never trims', () => {
    expect(rule('  secret  ')).toEqual({ ok: true, value: '  secret  ' });
    expect(rule(' ')).toEqual({ ok: true, value: ' ' });
  });

  it('accepts one character', () => {
    expect(rule('x').ok).toBe(true);
  });

  it('limits UTF-8 bytes, not characters', () => {
    expect(rule('€'.repeat(24)).ok).toBe(true); // 72 bytes
    expect(reasonOf(rule(`${'€'.repeat(24)}a`))).toBe('too_long'); // 73 bytes
    expect(rule('😀'.repeat(18)).ok).toBe(true); // 72 bytes
    expect(reasonOf(rule('😀'.repeat(19)))).toBe('too_long');
    expect(rule('a'.repeat(72)).ok).toBe(true);
    expect(reasonOf(rule('a'.repeat(73)))).toBe('too_long');
  });

  it('rejects empty, missing and non-string values', () => {
    expect(reasonOf(rule(''))).toBe('required');
    expect(reasonOf(rule(undefined))).toBe('required');
    expect(reasonOf(rule(12345))).toBe('type');
  });
});

describe('optional and nullable', () => {
  it('optional yields undefined or a default for omitted values only', () => {
    expect(optional(str())(undefined)).toEqual({ ok: true, value: undefined });
    expect(optional(str(), { default: '' })(undefined)).toEqual({ ok: true, value: '' });
    expect(reasonOf(optional(str())(null))).toBe('required');
  });

  it('optional list defaults are fresh copies', () => {
    const rule = optional(list(str()), { default: [] });
    const a = rule(undefined).value;
    a.push('x');
    expect(rule(undefined).value).toEqual([]);
  });

  it('nullable accepts null and, with emptyAsNull, an empty string', () => {
    const endDate = nullable(isoDate(), { emptyAsNull: true });
    expect(endDate(null)).toEqual({ ok: true, value: null });
    expect(endDate('  ')).toEqual({ ok: true, value: null });
    expect(endDate('2024-01-01')).toEqual({ ok: true, value: '2024-01-01' });
    expect(reasonOf(endDate('2024-02-30'))).toBe('invalid_format');
    expect(reasonOf(nullable(isoDate())(''))).toBe('required');
  });

  it('map transforms only passing values', () => {
    const isRead = map(oneOf(['true', 'false']), (v) => v === 'true');
    expect(isRead('true')).toEqual({ ok: true, value: true });
    expect(isRead('false')).toEqual({ ok: true, value: false });
    expect(reasonOf(isRead('yes'))).toBe('invalid_value');
  });
});

describe('list', () => {
  const features = list(str({ min: 1, max: 5 }), { max: 3 });

  it('validates and trims every item', () => {
    expect(features([' a ', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(features([])).toEqual({ ok: true, value: [] });
  });

  it('collects every item error with indexed paths', () => {
    expect(issues(features(['ok', '  ', 7], 'features'))).toEqual([
      ['features[1]', 'required'],
      ['features[2]', 'type'],
    ]);
  });

  it('reports a list over max as one error on the list', () => {
    expect(issues(features(['a', 'b', 'c', 'd'], 'features'))).toEqual([['features', 'too_long']]);
  });

  it('rejects non-arrays', () => {
    expect(reasonOf(features('a'))).toBe('type');
    expect(reasonOf(features({ 0: 'a' }))).toBe('type');
    expect(reasonOf(features(undefined))).toBe('required');
  });

  it('reports later case-insensitive duplicates when unique is given', () => {
    const techs = list(str({ min: 1, max: 50 }), { max: 30, unique: (v) => v.toLowerCase() });
    expect(issues(techs(['React', ' react ', 'Node', 'REACT'], 'technologies'))).toEqual([
      ['technologies[1]', 'duplicate'],
      ['technologies[3]', 'duplicate'],
    ]);
    expect(techs(['React', 'Node']).ok).toBe(true);
  });
});

describe('object', () => {
  const link = object({ label: str({ min: 1, max: 50 }), url: url() });
  const settings = object({
    site_title: optional(str({ min: 1, max: 100 })),
    social_links: optional(list(link, { max: 10 })),
    meta: optional(object({ depth: object({ value: int({ min: 0 }) }) })),
  });

  it('returns only shape keys and omits undefined values', () => {
    expect(settings({ site_title: ' Site ' })).toEqual({ ok: true, value: { site_title: 'Site' } });
  });

  it('collects errors from every field', () => {
    const body = object({ name: str({ min: 1, max: 5 }), order: int({ min: 0 }), email: email() });
    expect(issues(body({ name: 'toolong', order: '1' }))).toEqual([
      ['name', 'too_long'],
      ['order', 'type'],
      ['email', 'required'],
    ]);
  });

  it('rejects unknown keys at every nesting level with full paths', () => {
    const result = settings({
      extra: 1,
      social_links: [{ label: 'Blog', url: 'https://blog.example.com', icon: 'x' }],
      meta: { depth: { value: 1, deeper: true }, other: 2 },
    });
    expect(issues(result)).toEqual(
      expect.arrayContaining([
        ['extra', 'unknown_field'],
        ['social_links[0].icon', 'unknown_field'],
        ['meta.depth.deeper', 'unknown_field'],
        ['meta.other', 'unknown_field'],
      ]),
    );
    expect(result.errors).toHaveLength(4);
  });

  it('reports nested field errors with list-of-object paths', () => {
    const result = settings({ social_links: [{ label: 'A', url: 'https://a.example' }, { label: '', url: 'ftp://x.y' }] });
    expect(issues(result)).toEqual([
      ['social_links[1].label', 'required'],
      ['social_links[1].url', 'invalid_url'],
    ]);
  });

  it('treats __proto__ and inherited keys safely', () => {
    const parsed = JSON.parse('{"site_title":"x","__proto__":{"polluted":true}}');
    expect(issues(settings(parsed))).toEqual([['__proto__', 'unknown_field']]);
    expect({}.polluted).toBeUndefined();
    const inherited = Object.create({ site_title: 'from prototype' });
    expect(reasonOf(settings(inherited))).toBe('type');
  });

  it('drops unknown keys silently with unknown: strip', () => {
    const contact = object({ name: str({ min: 1 }) }, { unknown: 'strip' });
    expect(contact({ name: 'Ann', extra: 'x' })).toEqual({ ok: true, value: { name: 'Ann' } });
  });

  it('rejects non-objects', () => {
    expect(reasonOf(link([]))).toBe('type');
    expect(reasonOf(link('x'))).toBe('type');
    expect(reasonOf(link(null))).toBe('required');
    expect(reasonOf(link(undefined))).toBe('required');
  });
});

describe('refine', () => {
  const experience = refine(
    object({ start_date: isoDate(), end_date: optional(nullable(isoDate(), { emptyAsNull: true })) }),
    (v) => (v.end_date && v.end_date < v.start_date ? [{ field: 'end_date', reason: 'before_start' }] : null),
  );

  it('passes when the cross-field check passes', () => {
    expect(experience({ start_date: '2024-01-01', end_date: '2024-01-01' }).ok).toBe(true);
    expect(experience({ start_date: '2024-01-01', end_date: '' })).toEqual({
      ok: true,
      value: { start_date: '2024-01-01', end_date: null },
    });
  });

  it('reports cross-field errors relative to the path, with a default message', () => {
    const result = experience({ start_date: '2024-02-01', end_date: '2024-01-31' }, 'body');
    expect(issues(result)).toEqual([['body.end_date', 'before_start']]);
    expect(result.errors[0].message).toMatch(/\S/);
  });

  it('skips the check when the base schema fails', () => {
    let calls = 0;
    const rule = refine(object({ a: int() }), () => {
      calls += 1;
      return [{ field: 'a', reason: 'invalid_value' }];
    });
    expect(issues(rule({ a: 'x' }))).toEqual([['a', 'type']]);
    expect(calls).toBe(0);
  });

  it('works on non-object rules with an empty field', () => {
    const even = refine(int(), (v) => (v % 2 === 0 ? null : [{ field: '', reason: 'invalid_value', message: 'Must be even' }]));
    expect(even(2).ok).toBe(true);
    expect(even(3, 'n').errors).toEqual([{ field: 'n', reason: 'invalid_value', message: 'Must be even' }]);
  });
});
