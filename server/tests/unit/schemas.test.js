import { describe, expect, it } from 'vitest';
import {
  HONEYPOT_FIELD,
  classifyIdentifier,
  contactBody,
  contactListQuery,
  createEducationBody,
  experienceBody,
  idParams,
  isHoneypotFilled,
  loginBody,
  profileBody,
  projectBody,
  publicProjectQuery,
  publishBody,
  readBody,
  settingsBody,
  skillBody,
} from '../../src/validators/index.js';

/** Returns `[field, reason]` pairs of a failed result, for compact assertions. */
const issues = (result) => {
  expect(result.ok).toBe(false);
  return result.errors.map((e) => [e.field, e.reason]);
};

/** Returns the normalized value of a passing result. */
const ok = (result) => {
  expect(result.errors).toBeUndefined();
  expect(result.ok).toBe(true);
  return result.value;
};

describe('loginBody', () => {
  it('trims and lowercases the email and keeps the password exactly', () => {
    expect(ok(loginBody({ email: '  Admin@Example.COM ', password: '  Pass word ' }))).toEqual({
      email: 'admin@example.com',
      password: '  Pass word ',
    });
  });

  it('reports every invalid field and unknown keys', () => {
    expect(issues(loginBody({}))).toEqual([
      ['email', 'required'],
      ['password', 'required'],
    ]);
    expect(issues(loginBody({ email: 'nope', password: 'x'.repeat(73), role: 'admin' }))).toEqual([
      ['email', 'invalid_email'],
      ['password', 'too_long'],
      ['role', 'unknown_field'],
    ]);
    expect(issues(loginBody({ email: 5, password: '' }))).toEqual([
      ['email', 'type'],
      ['password', 'required'],
    ]);
  });

  it('measures the password in UTF-8 bytes', () => {
    ok(loginBody({ email: 'a@b.co', password: 'é'.repeat(36) })); // 72 bytes
    expect(issues(loginBody({ email: 'a@b.co', password: 'é'.repeat(36) + 'a' }))).toEqual([['password', 'too_long']]);
  });
});

describe('profileBody', () => {
  const base = { name: ' Jane ', professional_title: 'Developer', email: 'jane@example.com' };

  it('accepts the required fields alone and leaves omitted optional fields out', () => {
    expect(ok(profileBody(base))).toEqual({ name: 'Jane', professional_title: 'Developer', email: 'jane@example.com' });
  });

  it('accepts empty URLs (clearing them) and trims text', () => {
    expect(
      ok(profileBody({ ...base, github_url: '  ', biography: '  Hello  ', linkedin_url: 'https://linkedin.com/in/x' })),
    ).toMatchObject({ github_url: '', biography: 'Hello', linkedin_url: 'https://linkedin.com/in/x' });
  });

  it('rejects missing required fields, bad URLs, long text and unknown keys', () => {
    expect(
      issues(
        profileBody({
          name: '   ',
          biography: 'x'.repeat(5001),
          profile_image_url: 'ftp://example.com/a.png',
          id: 1,
        }),
      ),
    ).toEqual([
      ['name', 'required'],
      ['professional_title', 'required'],
      ['email', 'required'],
      ['biography', 'too_long'],
      ['profile_image_url', 'invalid_url'],
      ['id', 'unknown_field'],
    ]);
  });
});

describe('settingsBody', () => {
  it('accepts a partial update and trims labels', () => {
    expect(ok(settingsBody({ social_links: [{ label: ' Blog ', url: 'https://blog.example.com' }] }))).toEqual({
      social_links: [{ label: 'Blog', url: 'https://blog.example.com' }],
    });
    expect(ok(settingsBody({ footer_text: '' }))).toEqual({ footer_text: '' });
  });

  it('rejects a body with no allowed key on the body itself', () => {
    expect(issues(settingsBody({}))).toEqual([['', 'required']]);
  });

  it('rejects unknown keys at the top level and inside Social_Links', () => {
    expect(
      issues(
        settingsBody({
          site_title: 'Ok',
          theme: 'dark',
          social_links: [{ label: 'X', url: 'https://x.com', icon: 'x.svg' }],
        }),
      ),
    ).toEqual([
      ['social_links[0].icon', 'unknown_field'],
      ['theme', 'unknown_field'],
    ]);
  });

  it('checks every key rule, including wrong types', () => {
    expect(
      issues(
        settingsBody({
          site_title: ' ',
          hero_introduction: 'x'.repeat(501),
          footer_text: 42,
          social_links: [{ label: '', url: 'nope' }],
        }),
      ),
    ).toEqual([
      ['site_title', 'required'],
      ['hero_introduction', 'too_long'],
      ['footer_text', 'type'],
      ['social_links[0].label', 'required'],
      ['social_links[0].url', 'invalid_url'],
    ]);
    expect(issues(settingsBody({ social_links: 'https://x.com' }))).toEqual([['social_links', 'type']]);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, url: 'https://x.com' }));
    expect(issues(settingsBody({ social_links: eleven }))).toEqual([['social_links', 'too_long']]);
  });
});

describe('publicProjectQuery', () => {
  it('accepts no category or a trimmed category, and ignores unknown parameters', () => {
    expect(ok(publicProjectQuery({}))).toEqual({});
    expect(ok(publicProjectQuery({ category: ' Web ', _: '123' }))).toEqual({ category: 'Web' });
  });

  it('rejects an empty, whitespace-only, too long or repeated category', () => {
    expect(issues(publicProjectQuery({ category: '' }))).toEqual([['category', 'required']]);
    expect(issues(publicProjectQuery({ category: '   ' }))).toEqual([['category', 'required']]);
    expect(issues(publicProjectQuery({ category: 'x'.repeat(51) }))).toEqual([['category', 'too_long']]);
    expect(issues(publicProjectQuery({ category: ['a', 'b'] }))).toEqual([['category', 'type']]);
  });
});

describe('projectBody', () => {
  const minimal = { title: ' My Project ', short_description: 'Short', category: 'Web', display_order: 0 };

  it('fills omitted text, URL and list fields and leaves slug and is_published out', () => {
    expect(ok(projectBody(minimal))).toEqual({
      title: 'My Project',
      short_description: 'Short',
      full_description: '',
      problem_statement: '',
      objectives: '',
      challenges: '',
      solutions: '',
      category: 'Web',
      image_url: '',
      github_url: '',
      live_demo_url: '',
      display_order: 0,
      features: [],
      technologies: [],
    });
  });

  it('treats an empty slug as not supplied and accepts a valid slug', () => {
    expect(ok(projectBody({ ...minimal, slug: '  ' }))).not.toHaveProperty('slug');
    expect(ok(projectBody({ ...minimal, slug: 'my-project-2', is_published: true }))).toMatchObject({
      slug: 'my-project-2',
      is_published: true,
    });
  });

  it('rejects slugs that do not match the Slug format', () => {
    for (const slug of ['My-Project', 'a--b', '-a', '2024', 'a_b']) {
      expect(issues(projectBody({ ...minimal, slug }))).toEqual([['slug', 'invalid_format']]);
    }
    expect(issues(projectBody({ ...minimal, slug: 'a'.repeat(161) }))).toEqual([['slug', 'too_long']]);
    expect(issues(projectBody({ ...minimal, slug: 7 }))).toEqual([['slug', 'type']]);
  });

  it('rejects case-insensitive duplicate technologies on each later entry', () => {
    expect(
      issues(projectBody({ ...minimal, technologies: ['React', ' react ', 'Node.js', 'REACT', 'node.JS'] })),
    ).toEqual([
      ['technologies[1]', 'duplicate'],
      ['technologies[3]', 'duplicate'],
      ['technologies[4]', 'duplicate'],
    ]);
  });

  it('reports every invalid field with its path', () => {
    expect(
      issues(
        projectBody({
          title: '',
          short_description: 'x'.repeat(301),
          category: 'Web',
          display_order: '1',
          is_published: 'true',
          github_url: 'not a url',
          features: ['ok', '  '],
          technologies: ['x'.repeat(51)],
          views: 3,
        }),
      ),
    ).toEqual([
      ['title', 'required'],
      ['short_description', 'too_long'],
      ['github_url', 'invalid_url'],
      ['display_order', 'type'],
      ['is_published', 'type'],
      ['features[1]', 'required'],
      ['technologies[0]', 'too_long'],
      ['views', 'unknown_field'],
    ]);
    expect(issues(projectBody({ ...minimal, display_order: 10000 }))).toEqual([['display_order', 'out_of_range']]);
    expect(issues(projectBody({ ...minimal, features: Array(31).fill('f') }))).toEqual([['features', 'too_long']]);
  });
});

describe('publishBody and readBody', () => {
  it('require a JSON boolean', () => {
    expect(ok(publishBody({ is_published: false }))).toEqual({ is_published: false });
    expect(issues(publishBody({}))).toEqual([['is_published', 'required']]);
    expect(issues(publishBody({ is_published: 'true' }))).toEqual([['is_published', 'type']]);
    expect(ok(readBody({ is_read: true }))).toEqual({ is_read: true });
    expect(issues(readBody({ is_read: 'false' }))).toEqual([['is_read', 'type']]);
    expect(issues(readBody({ is_read: true, name: 'x' }))).toEqual([['name', 'unknown_field']]);
  });
});

describe('skillBody', () => {
  it('defaults omitted optional fields to empty', () => {
    expect(ok(skillBody({ name: ' React ', category: 'Frontend Development', display_order: 2 }))).toEqual({
      name: 'React',
      category: 'Frontend Development',
      proficiency_level: '',
      icon_url: '',
      display_order: 2,
    });
  });

  it('rejects invalid values', () => {
    expect(
      issues(
        skillBody({ name: 'x'.repeat(51), category: '', proficiency_level: 'expert', icon_url: 'x', display_order: 1.5 }),
      ),
    ).toEqual([
      ['name', 'too_long'],
      ['category', 'required'],
      ['proficiency_level', 'invalid_value'],
      ['icon_url', 'invalid_url'],
      ['display_order', 'type'],
    ]);
  });
});

describe('experienceBody', () => {
  const base = { job_title: 'Dev', company_name: 'Acme', employment_type: 'Full-time', start_date: '2024-01-15' };

  it('leaves omitted optional fields out and normalizes an empty end date to null', () => {
    expect(ok(experienceBody(base))).toEqual(base);
    expect(ok(experienceBody({ ...base, end_date: '' }))).toEqual({ ...base, end_date: null });
    expect(ok(experienceBody({ ...base, end_date: '2024-01-15', responsibilities: [' a ', 'b'] }))).toMatchObject({
      end_date: '2024-01-15',
      responsibilities: ['a', 'b'],
    });
  });

  it('rejects an end date before the start date on end_date', () => {
    expect(issues(experienceBody({ ...base, end_date: '2024-01-14' }))).toEqual([['end_date', 'before_start']]);
  });

  it('rejects invalid fields', () => {
    expect(
      issues(
        experienceBody({
          job_title: 'Dev',
          company_name: '',
          employment_type: 'full-time',
          start_date: '2023-02-30',
          end_date: 'soon',
          responsibilities: Array(21).fill('r'),
        }),
      ),
    ).toEqual([
      ['company_name', 'required'],
      ['employment_type', 'invalid_value'],
      ['start_date', 'invalid_format'],
      ['end_date', 'invalid_format'],
      ['responsibilities', 'too_long'],
    ]);
    expect(issues(experienceBody({ ...base, responsibilities: ['ok', 3, ' '] }))).toEqual([
      ['responsibilities[1]', 'type'],
      ['responsibilities[2]', 'required'],
    ]);
  });
});

describe('createEducationBody', () => {
  // Injected clock: 2025-06-01 UTC, so Y + 10 = 2035.
  const educationBody = createEducationBody({ clock: { now: () => Date.UTC(2025, 5, 1) } });
  const base = { institution: 'Uni', qualification: 'BSc', start_year: 2019 };

  it('fills omitted fields with empty values and null end year', () => {
    expect(ok(educationBody(base))).toEqual({ ...base, field_of_study: '', description: '', end_year: null });
    expect(ok(educationBody({ ...base, end_year: '' }))).toMatchObject({ end_year: null });
    expect(ok(educationBody({ ...base, end_year: 2019 }))).toMatchObject({ end_year: 2019 });
    expect(ok(educationBody({ ...base, start_year: 2035, end_year: 2035 }))).toMatchObject({ end_year: 2035 });
  });

  it('checks the end year bounds against the start year and the injected clock', () => {
    expect(issues(educationBody({ ...base, end_year: 2018 }))).toEqual([['end_year', 'before_start']]);
    expect(issues(educationBody({ ...base, end_year: 2036 }))).toEqual([['end_year', 'out_of_range']]);
    expect(issues(educationBody({ ...base, end_year: '2020' }))).toEqual([['end_year', 'type']]);
    expect(issues(educationBody({ ...base, end_year: 2020.5 }))).toEqual([['end_year', 'type']]);
  });

  it('checks the start year range and text fields', () => {
    expect(issues(educationBody({ ...base, start_year: 1949 }))).toEqual([['start_year', 'out_of_range']]);
    expect(issues(educationBody({ ...base, start_year: 2036 }))).toEqual([['start_year', 'out_of_range']]);
    expect(
      issues(educationBody({ institution: '', qualification: 'x'.repeat(151), field_of_study: 'x'.repeat(151) })),
    ).toEqual([
      ['institution', 'required'],
      ['qualification', 'too_long'],
      ['field_of_study', 'too_long'],
      ['start_year', 'required'],
    ]);
  });

  it('reads the clock on every call', () => {
    let now = Date.UTC(2025, 0, 1);
    const schema = createEducationBody({ clock: { now: () => now } });
    expect(issues(schema({ ...base, end_year: 2036 }))).toEqual([['end_year', 'out_of_range']]);
    now = new Date(Date.UTC(2026, 0, 1));
    expect(ok(schema({ ...base, end_year: 2036 }))).toMatchObject({ end_year: 2036 });
  });
});

describe('contactBody', () => {
  const valid = { name: 'Ann', email: 'ann@example.com', subject: 'Hello', message: 'A message long enough' };

  it('sanitizes the four fields, strips unknown keys and passes the honeypot through', () => {
    const value = ok(
      contactBody({
        name: '\u0000 Ann\u0007 ',
        email: ' ann@example.com\u007F',
        subject: 'Hel\u001Flo',
        message: '  Line one\r\n\tLine two  ',
        id: 99,
        is_read: true,
        created_at: '2020-01-01',
        [HONEYPOT_FIELD]: '',
      }),
    );
    expect(value).toEqual({
      name: 'Ann',
      email: 'ann@example.com',
      subject: 'Hello',
      message: 'Line one\r\n\tLine two',
      website: '',
    });
  });

  it('counts lengths after sanitizing, in code points', () => {
    expect(issues(contactBody({ ...valid, message: '123456789\u0000\u0001' }))).toEqual([['message', 'too_short']]);
    ok(contactBody({ ...valid, message: '😀'.repeat(10) }));
    expect(issues(contactBody({ ...valid, name: '\u0000\u0001  ' }))).toEqual([['name', 'required']]);
  });

  it('reports every invalid field, and a non-object body', () => {
    expect(issues(contactBody({ email: 'bad', subject: 'x'.repeat(151), message: 5 }))).toEqual([
      ['name', 'required'],
      ['email', 'invalid_email'],
      ['subject', 'too_long'],
      ['message', 'type'],
    ]);
    expect(issues(contactBody(['a']))).toEqual([['', 'type']]);
    expect(issues(contactBody(undefined))).toEqual([['', 'required']]);
  });

  it('detects a filled honeypot', () => {
    expect(isHoneypotFilled({ website: ' ' })).toBe(true);
    expect(isHoneypotFilled({ website: 'spam' })).toBe(true);
    expect(isHoneypotFilled({ website: 0 })).toBe(true);
    expect(isHoneypotFilled({ website: '' })).toBe(false);
    expect(isHoneypotFilled({ website: null })).toBe(false);
    expect(isHoneypotFilled({})).toBe(false);
    expect(isHoneypotFilled('website=x')).toBe(false);
  });
});

describe('contactListQuery', () => {
  it('applies defaults and converts values', () => {
    expect(ok(contactListQuery({}))).toEqual({ page: 1, limit: 20 });
    expect(ok(contactListQuery({ page: '3', limit: '100', is_read: 'false', sort: 'x' }))).toEqual({
      page: 3,
      limit: 100,
      is_read: false,
    });
    expect(ok(contactListQuery({ is_read: 'true' }))).toMatchObject({ is_read: true });
  });

  it('names each invalid parameter', () => {
    expect(issues(contactListQuery({ page: '0', limit: '101', is_read: 'yes' }))).toEqual([
      ['page', 'out_of_range'],
      ['limit', 'out_of_range'],
      ['is_read', 'invalid_value'],
    ]);
    expect(issues(contactListQuery({ page: '-1', limit: '1.5', is_read: 'TRUE' }))).toEqual([
      ['page', 'invalid_format'],
      ['limit', 'invalid_format'],
      ['is_read', 'invalid_value'],
    ]);
    expect(issues(contactListQuery({ page: '', limit: ['1', '2'] }))).toEqual([
      ['page', 'invalid_format'],
      ['limit', 'type'],
    ]);
  });
});

describe('idParams', () => {
  it('accepts ids from 1 to 2147483647 written in digits', () => {
    expect(ok(idParams({ id: '1' }))).toEqual({ id: 1 });
    expect(ok(idParams({ id: '2147483647' }))).toEqual({ id: 2147483647 });
    expect(ok(idParams({ id: '007' }))).toEqual({ id: 7 });
  });

  it('rejects zero, out-of-range values and non-digit forms', () => {
    expect(issues(idParams({ id: '0' }))).toEqual([['id', 'out_of_range']]);
    expect(issues(idParams({ id: '2147483648' }))).toEqual([['id', 'out_of_range']]);
    for (const id of ['-1', '+1', '1.0', ' 1', '1e3', 'abc', '']) {
      expect(issues(idParams({ id }))).toEqual([['id', 'invalid_format']]);
    }
  });
});

describe('classifyIdentifier', () => {
  it.each([
    ['1', { kind: 'id', id: 1 }],
    ['2024', { kind: 'id', id: 2024 }],
    ['007', { kind: 'id', id: 7 }],
    ['2147483647', { kind: 'id', id: 2147483647 }],
    ['0', { kind: 'invalid' }],
    ['2147483648', { kind: 'invalid' }],
    ['99999999999999999999', { kind: 'invalid' }],
    ['my-project', { kind: 'slug', slug: 'my-project' }],
    ['project-2', { kind: 'slug', slug: 'project-2' }],
    ['My-Project', { kind: 'none' }],
    ['my--project', { kind: 'none' }],
    ['-1', { kind: 'none' }],
    [' 1', { kind: 'none' }],
    ['', { kind: 'none' }],
    ['a'.repeat(161), { kind: 'none' }],
    [undefined, { kind: 'none' }],
  ])('classifies %j', (raw, expected) => {
    expect(classifyIdentifier(raw)).toEqual(expected);
  });
});
