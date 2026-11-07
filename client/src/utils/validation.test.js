import { describe, expect, it } from 'vitest';
import {
  CONTACT_FIELD_ORDER,
  EMPLOYMENT_TYPES,
  PROFICIENCY_LEVELS,
  addTag,
  errorsFromDetails,
  firstInvalidField,
  isIsoDate,
  isSlug,
  isValidEmail,
  isValidUrl,
  sanitizeText,
  tagError,
  validateContact,
  validateEducation,
  validateExperience,
  validateLogin,
  validateProfile,
  validateProject,
  validateSettings,
  validateSkill,
} from './validation.js';

const reasonOf = (result, field) => result.details.find((d) => d.field === field)?.reason;
const emoji = (n) => '😀'.repeat(n);

describe('shared definitions', () => {
  it('re-exports the Valid_URL check', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  it('isValidEmail matches the server format and length limit', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.example.org')).toBe(true);
    for (const bad of ['a@b', 'a@.b.co', 'a@b..co', 'a@b.co.', 'a b@c.co', '@b.co', 'a@@b.co', '', 42]) {
      expect(isValidEmail(bad)).toBe(false);
    }
    const domain = '@example.com';
    expect(isValidEmail('a'.repeat(254 - domain.length) + domain)).toBe(true);
    expect(isValidEmail('a'.repeat(255 - domain.length) + domain)).toBe(false);
  });

  it('isIsoDate accepts only real calendar dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2000-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('1900-02-29')).toBe(false);
    expect(isIsoDate('2024-13-01')).toBe(false);
    expect(isIsoDate('2024-04-31')).toBe(false);
    expect(isIsoDate('2024-2-01')).toBe(false);
    expect(isIsoDate(' 2024-02-01')).toBe(false);
  });

  it('isSlug follows the Slug definition', () => {
    expect(isSlug('my-project-2')).toBe(true);
    expect(isSlug('a'.repeat(160))).toBe(true);
    expect(isSlug('a'.repeat(161))).toBe(false);
    for (const bad of ['123', '1-2', 'My-Slug', 'a--b', '-a', 'a-', 'a_b', 'é', '', null]) {
      expect(isSlug(bad)).toBe(false);
    }
  });

  it('sanitizeText removes exactly the disallowed control characters, then trims', () => {
    expect(sanitizeText('\u0000  hi\u0007 there\u007F  ')).toBe('hi there');
    expect(sanitizeText('line1\nline2\tx\r\ny')).toBe('line1\nline2\tx\r\ny');
    expect(sanitizeText('\u0080zero\u200Bwidth')).toBe('\u0080zero\u200Bwidth');
    expect(sanitizeText(5)).toBe(5);
  });

  it('exposes the enumerated values', () => {
    expect(PROFICIENCY_LEVELS).toEqual(['Beginner', 'Intermediate', 'Advanced', 'Expert']);
    expect(EMPLOYMENT_TYPES).toEqual(['Full-time', 'Part-time', 'Internship', 'Contract', 'Freelance', 'Volunteer']);
  });
});

describe('validateContact', () => {
  const valid = { name: 'Ann', email: 'ann@example.com', subject: 'Hello', message: 'A message long enough' };

  it('sanitizes and trims the four fields and passes the honeypot through unchanged', () => {
    const result = validateContact({
      name: ' \u0000Ann\u0007 ',
      email: '  ann@example.com ',
      subject: '\tHi\n',
      message: '  Line one\nline two  ',
      website: '  x ',
      extra: 'ignored',
    });
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({
      name: 'Ann',
      email: 'ann@example.com',
      subject: 'Hi',
      message: 'Line one\nline two',
      website: '  x ',
    });
  });

  it('reports every empty field as required and focuses name first', () => {
    const result = validateContact({ name: ' ', email: '', subject: '\u0000', message: '' });
    expect(result.valid).toBe(false);
    expect(result.values).toBeNull();
    expect(Object.keys(result.errors)).toEqual(['name', 'email', 'subject', 'message']);
    for (const field of CONTACT_FIELD_ORDER) expect(reasonOf(result, field)).toBe('required');
    expect(result.errors.name).toBe('This field is required');
    expect(firstInvalidField(result.errors, CONTACT_FIELD_ORDER)).toBe('name');
  });

  it('focuses the first invalid field in form order', () => {
    const result = validateContact({ ...valid, email: 'nope', message: 'short' });
    expect(firstInvalidField(result.errors, CONTACT_FIELD_ORDER)).toBe('email');
    expect(result.errors.email).toBe('Must be a valid email address');
    expect(result.errors.message).toBe('Must be at least 10 characters');
  });

  it('counts lengths in code points after sanitizing', () => {
    expect(validateContact({ ...valid, name: emoji(100) }).valid).toBe(true);
    const tooLong = validateContact({ ...valid, name: emoji(101) });
    expect(reasonOf(tooLong, 'name')).toBe('too_long');
    expect(tooLong.errors.name).toBe('Must be at most 100 characters');

    expect(validateContact({ ...valid, subject: 'x'.repeat(150) }).valid).toBe(true);
    expect(reasonOf(validateContact({ ...valid, subject: 'x'.repeat(151) }), 'subject')).toBe('too_long');

    expect(validateContact({ ...valid, message: 'x'.repeat(10) }).valid).toBe(true);
    expect(reasonOf(validateContact({ ...valid, message: 'x'.repeat(9) }), 'message')).toBe('too_short');
    expect(reasonOf(validateContact({ ...valid, message: `${'x'.repeat(9)}\u0001` }), 'message')).toBe('too_short');
    expect(validateContact({ ...valid, message: 'x'.repeat(5000) }).valid).toBe(true);
    expect(reasonOf(validateContact({ ...valid, message: 'x'.repeat(5001) }), 'message')).toBe('too_long');
  });
});

describe('validateLogin', () => {
  it('trims the email and keeps the password unchanged', () => {
    const result = validateLogin({ email: '  Admin@Example.com ', password: '  secret  ' });
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({ email: 'Admin@Example.com', password: '  secret  ' });
  });

  it('requires both fields and a Valid_Email', () => {
    const empty = validateLogin({ email: '', password: '' });
    expect(empty.errors).toEqual({ email: 'This field is required', password: 'This field is required' });
    expect(reasonOf(validateLogin({ email: 'admin@localhost', password: 'x' }), 'email')).toBe('invalid_email');
  });

  it('limits the password to 72 UTF-8 bytes', () => {
    expect(validateLogin({ email: 'a@b.co', password: 'a'.repeat(72) }).valid).toBe(true);
    expect(reasonOf(validateLogin({ email: 'a@b.co', password: 'a'.repeat(73) }), 'password')).toBe('too_long');
    expect(validateLogin({ email: 'a@b.co', password: 'é'.repeat(36) }).valid).toBe(true);
    expect(validateLogin({ email: 'a@b.co', password: `${'é'.repeat(36)}a` }).valid).toBe(false);
    expect(validateLogin({ email: 'a@b.co', password: emoji(18) }).valid).toBe(true);
    expect(validateLogin({ email: 'a@b.co', password: emoji(19) }).valid).toBe(false);
  });

  it('accepts a whitespace-only password because it is not trimmed', () => {
    expect(validateLogin({ email: 'a@b.co', password: '   ' }).valid).toBe(true);
  });
});

describe('validateProject', () => {
  const base = { title: 'Portfolio', short_description: 'A site', category: 'Web', display_order: '3' };

  it('normalizes a minimal project and applies the defaults', () => {
    const result = validateProject({ ...base, title: '  Portfolio  ', uiState: 'ignored' });
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({
      title: 'Portfolio',
      short_description: 'A site',
      full_description: '',
      problem_statement: '',
      objectives: '',
      challenges: '',
      solutions: '',
      category: 'Web',
      image_url: '',
      github_url: '',
      live_demo_url: '',
      display_order: 3,
      features: [],
      technologies: [],
    });
  });

  it('converts display_order from a number-input string to a JSON number', () => {
    const order = (v) => validateProject({ ...base, display_order: v });
    expect(order(' 0 ').values.display_order).toBe(0);
    expect(Object.is(order('-0').values.display_order, 0)).toBe(true);
    expect(order('9999').values.display_order).toBe(9999);
    expect(order('007').values.display_order).toBe(7);
    expect(order(42).values.display_order).toBe(42);
    expect(reasonOf(order(''), 'display_order')).toBe('required');
    expect(reasonOf(order(undefined), 'display_order')).toBe('required');
    expect(reasonOf(order('1.5'), 'display_order')).toBe('type');
    expect(reasonOf(order('1e3'), 'display_order')).toBe('type');
    expect(reasonOf(order('+3'), 'display_order')).toBe('type');
    expect(reasonOf(order('12abc'), 'display_order')).toBe('type');
    expect(reasonOf(order(5.5), 'display_order')).toBe('type');
    expect(reasonOf(order(true), 'display_order')).toBe('type');
    expect(reasonOf(order('-1'), 'display_order')).toBe('out_of_range');
    expect(reasonOf(order('10000'), 'display_order')).toBe('out_of_range');
    expect(order('10000').errors.display_order).toBe('Must be between 0 and 9999');
  });

  it('checks text lengths in code points', () => {
    expect(validateProject({ ...base, title: emoji(150) }).valid).toBe(true);
    expect(reasonOf(validateProject({ ...base, title: emoji(151) }), 'title')).toBe('too_long');
    expect(reasonOf(validateProject({ ...base, short_description: 'x'.repeat(301) }), 'short_description')).toBe(
      'too_long',
    );
    expect(reasonOf(validateProject({ ...base, category: 'x'.repeat(51) }), 'category')).toBe('too_long');
    expect(validateProject({ ...base, solutions: 'x'.repeat(10000) }).valid).toBe(true);
    expect(reasonOf(validateProject({ ...base, solutions: 'x'.repeat(10001) }), 'solutions')).toBe('too_long');
  });

  it('treats a blank slug as not supplied and validates any other slug', () => {
    expect(validateProject({ ...base, slug: '' }).values).not.toHaveProperty('slug');
    expect(validateProject({ ...base, slug: '   ' }).values).not.toHaveProperty('slug');
    expect(validateProject({ ...base, slug: ' my-slug ' }).values.slug).toBe('my-slug');
    expect(validateProject({ ...base, slug: 'a'.repeat(160) }).valid).toBe(true);
    expect(reasonOf(validateProject({ ...base, slug: 'a'.repeat(161) }), 'slug')).toBe('too_long');
    for (const bad of ['My-Slug', '123', 'a--b', '-a', 'a_b']) {
      expect(reasonOf(validateProject({ ...base, slug: bad }), 'slug')).toBe('invalid_format');
    }
  });

  it('validates URL fields and allows empty values', () => {
    expect(validateProject({ ...base, github_url: ' https://github.com/me ' }).values.github_url).toBe(
      'https://github.com/me',
    );
    const bad = validateProject({ ...base, image_url: 'javascript:alert(1)', live_demo_url: 'example.com' });
    expect(bad.errors).toEqual({
      image_url: 'Must be a valid http or https URL',
      live_demo_url: 'Must be a valid http or https URL',
    });
  });

  it('accepts only a boolean is_published', () => {
    expect(validateProject({ ...base, is_published: true }).values.is_published).toBe(true);
    expect(reasonOf(validateProject({ ...base, is_published: 'true' }), 'is_published')).toBe('type');
  });

  it('limits features to 30 items of 1-300 characters, with indexed error keys', () => {
    const items = (n) => Array.from({ length: n }, (_, i) => `Feature ${i}`);
    expect(validateProject({ ...base, features: items(30) }).valid).toBe(true);
    expect(validateProject({ ...base, features: items(31) }).errors).toEqual({
      features: 'Must have at most 30 items',
    });
    const result = validateProject({ ...base, features: [' ok ', '  ', 'x'.repeat(301)] });
    expect(result.errors).toEqual({
      'features[1]': 'This field is required',
      'features[2]': 'Must be at most 300 characters',
    });
  });

  it('rejects case-insensitive duplicate technologies and enforces the limits', () => {
    const dup = validateProject({ ...base, technologies: ['React', 'Node', ' react '] });
    expect(reasonOf(dup, 'technologies[2]')).toBe('duplicate');
    expect(dup.errors['technologies[2]']).toBe('This technology is already listed');

    expect(validateProject({ ...base, technologies: [' React '] }).values.technologies).toEqual(['React']);
    const many = Array.from({ length: 31 }, (_, i) => `T${i}`);
    expect(reasonOf(validateProject({ ...base, technologies: many }), 'technologies')).toBe('too_long');
    expect(reasonOf(validateProject({ ...base, technologies: ['x'.repeat(51)] }), 'technologies[0]')).toBe(
      'too_long',
    );
    expect(reasonOf(validateProject({ ...base, technologies: [''] }), 'technologies[0]')).toBe('required');
  });
});

describe('validateSkill', () => {
  const base = { name: 'React', category: 'Frontend', display_order: '1' };

  it('fills omitted optional fields with empty strings', () => {
    expect(validateSkill(base).values).toEqual({
      name: 'React',
      category: 'Frontend',
      proficiency_level: '',
      icon_url: '',
      display_order: 1,
    });
  });

  it('accepts only exact Proficiency_Level values', () => {
    for (const level of ['', ...PROFICIENCY_LEVELS]) {
      expect(validateSkill({ ...base, proficiency_level: level }).valid).toBe(true);
    }
    const bad = validateSkill({ ...base, proficiency_level: 'beginner' });
    expect(reasonOf(bad, 'proficiency_level')).toBe('invalid_value');
    expect(bad.errors.proficiency_level).toBe('Must be one of: Beginner, Intermediate, Advanced, Expert');
  });

  it('checks the name, category and icon URL', () => {
    const result = validateSkill({ ...base, name: 'x'.repeat(51), category: ' ', icon_url: 'ftp://x.com/i.png' });
    expect(result.details.map((d) => [d.field, d.reason])).toEqual([
      ['name', 'too_long'],
      ['category', 'required'],
      ['icon_url', 'invalid_url'],
    ]);
  });
});

describe('validateExperience', () => {
  const base = {
    job_title: 'Developer',
    company_name: 'Acme',
    employment_type: 'Full-time',
    start_date: '2022-03-01',
    end_date: '',
    description: '',
    responsibilities: [],
  };

  it('turns an empty end date into null', () => {
    const result = validateExperience(base);
    expect(result.valid).toBe(true);
    expect(result.values.end_date).toBeNull();
    expect(validateExperience({ ...base, end_date: null }).values.end_date).toBeNull();
  });

  it('keeps omitted optional fields out of the values', () => {
    const { end_date, description, responsibilities, ...required } = base;
    expect(validateExperience(required).values).toEqual({
      job_title: 'Developer',
      company_name: 'Acme',
      employment_type: 'Full-time',
      start_date: '2022-03-01',
    });
  });

  it('requires the end date to be on or after the start date', () => {
    expect(validateExperience({ ...base, end_date: '2022-03-01' }).valid).toBe(true);
    const before = validateExperience({ ...base, end_date: '2022-02-28' });
    expect(reasonOf(before, 'end_date')).toBe('before_start');
    expect(before.errors.end_date).toBe('End date must not be before the start date');
  });

  it('accepts only real dates, including leap days', () => {
    expect(validateExperience({ ...base, start_date: '2024-02-29' }).valid).toBe(true);
    expect(reasonOf(validateExperience({ ...base, start_date: '2023-02-29' }), 'start_date')).toBe('invalid_format');
    expect(reasonOf(validateExperience({ ...base, end_date: '2024-2-1' }), 'end_date')).toBe('invalid_format');
    expect(reasonOf(validateExperience({ ...base, start_date: '' }), 'start_date')).toBe('required');
  });

  it('accepts only exact Employment_Type values', () => {
    for (const type of EMPLOYMENT_TYPES) {
      expect(validateExperience({ ...base, employment_type: type }).valid).toBe(true);
    }
    expect(reasonOf(validateExperience({ ...base, employment_type: 'full-time' }), 'employment_type')).toBe(
      'invalid_value',
    );
  });

  it('limits responsibilities to 20 items of 1-300 characters', () => {
    const items = (n) => Array.from({ length: n }, (_, i) => ` Item ${i} `);
    expect(validateExperience({ ...base, responsibilities: items(20) }).values.responsibilities[0]).toBe('Item 0');
    expect(reasonOf(validateExperience({ ...base, responsibilities: items(21) }), 'responsibilities')).toBe(
      'too_long',
    );
    expect(
      reasonOf(validateExperience({ ...base, responsibilities: ['ok', 'x'.repeat(301)] }), 'responsibilities[1]'),
    ).toBe('too_long');
  });
});

describe('validateEducation', () => {
  const now = () => Date.UTC(2025, 5, 1);
  const base = { institution: 'Uni', qualification: 'BSc', start_year: '2020', end_year: '' };

  it('converts years to numbers and fills defaults', () => {
    const result = validateEducation(base, { now });
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({
      institution: 'Uni',
      qualification: 'BSc',
      field_of_study: '',
      start_year: 2020,
      end_year: null,
      description: '',
    });
  });

  it('accepts years from 1950 to the current UTC year + 10', () => {
    const start = (v) => validateEducation({ ...base, start_year: v }, { now });
    expect(start('1950').valid).toBe(true);
    expect(start(2035).valid).toBe(true);
    expect(reasonOf(start('1949'), 'start_year')).toBe('out_of_range');
    expect(reasonOf(start('2036'), 'start_year')).toBe('out_of_range');
    expect(start('2036').errors.start_year).toBe('Must be between 1950 and 2035');
    expect(reasonOf(start('2020.5'), 'start_year')).toBe('type');
    expect(reasonOf(start(''), 'start_year')).toBe('required');
    expect(reasonOf(validateEducation({ ...base, end_year: '2036' }, { now }), 'end_year')).toBe('out_of_range');
  });

  it('uses the UTC year of now, given as a function, Date or timestamp', () => {
    const lateDec = Date.UTC(2025, 11, 31, 23, 30);
    expect(validateEducation({ ...base, start_year: 2036 }, { now: lateDec }).valid).toBe(false);
    expect(validateEducation({ ...base, start_year: 2036 }, { now: new Date(Date.UTC(2026, 0, 1)) }).valid).toBe(true);
    expect(validateEducation({ ...base, start_year: 2035 }, { now: () => new Date(lateDec) }).valid).toBe(true);
  });

  it('requires the end year to be on or after the start year', () => {
    expect(validateEducation({ ...base, end_year: '2020' }, { now }).values.end_year).toBe(2020);
    expect(validateEducation({ ...base, end_year: null }, { now }).values.end_year).toBeNull();
    const before = validateEducation({ ...base, end_year: '2019' }, { now });
    expect(reasonOf(before, 'end_year')).toBe('before_start');
    expect(before.errors.end_year).toBe('End year must not be before the start year');
  });

  it('checks the text fields', () => {
    const result = validateEducation(
      { ...base, institution: '', qualification: 'x'.repeat(151), field_of_study: 'x'.repeat(151) },
      { now },
    );
    expect(Object.keys(result.errors)).toEqual(['institution', 'qualification', 'field_of_study']);
  });
});

describe('validateProfile', () => {
  const base = { name: 'Ann', professional_title: 'Developer', email: 'ann@example.com' };

  it('requires name, professional_title and email and leaves omitted fields out', () => {
    expect(validateProfile(base).values).toEqual(base);
    expect(Object.keys(validateProfile({}).errors)).toEqual(['name', 'professional_title', 'email']);
  });

  it('allows empty URLs and rejects invalid ones', () => {
    expect(validateProfile({ ...base, github_url: '' }).values.github_url).toBe('');
    expect(reasonOf(validateProfile({ ...base, linkedin_url: 'linkedin.com/in/ann' }), 'linkedin_url')).toBe(
      'invalid_url',
    );
    expect(reasonOf(validateProfile({ ...base, biography: 'x'.repeat(5001) }), 'biography')).toBe('too_long');
  });
});

describe('validateSettings', () => {
  it('requires at least one key, reported on body', () => {
    const result = validateSettings({});
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors)).toEqual(['body']);
  });

  it('validates social links with nested indexed keys', () => {
    const result = validateSettings({ social_links: [{ label: 'GitHub', url: 'https://github.com' }, { label: ' ', url: 'x' }] });
    expect(result.errors).toEqual({
      'social_links[1].label': 'This field is required',
      'social_links[1].url': 'Must be a valid http or https URL',
    });
    const many = Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, url: 'https://example.com' }));
    expect(reasonOf(validateSettings({ social_links: many }), 'social_links')).toBe('too_long');
  });

  it('normalizes the text keys', () => {
    const result = validateSettings({ site_title: ' My site ', hero_introduction: '', footer_text: ' (c) ' });
    expect(result.values).toEqual({ site_title: 'My site', hero_introduction: '', footer_text: '(c)' });
    expect(reasonOf(validateSettings({ site_title: '  ' }), 'site_title')).toBe('required');
  });
});

describe('errorsFromDetails', () => {
  it('keeps the first message per field and the indexed list paths', () => {
    expect(
      errorsFromDetails([
        { field: 'title', reason: 'required', message: 'Title is required' },
        { field: 'title', reason: 'too_long', message: 'second' },
        { field: 'features[2]', reason: 'too_long', message: 'Must be at most 300 characters' },
        { field: 'social_links[0].url', reason: 'invalid_url', message: 'Bad URL' },
      ]),
    ).toEqual({
      title: 'Title is required',
      'features[2]': 'Must be at most 300 characters',
      'social_links[0].url': 'Bad URL',
    });
  });

  it('falls back to the reason message, maps an empty field to body and skips malformed entries', () => {
    expect(
      errorsFromDetails([
        { field: 'slug', reason: 'invalid_format' },
        { field: 'email', reason: 'unknown_reason', message: '  ' },
        { field: '', reason: 'required', message: 'Provide at least one key' },
        null,
        { reason: 'required' },
        'oops',
      ]),
    ).toEqual({ slug: 'Has an invalid format', email: 'Is invalid', body: 'Provide at least one key' });
    expect(errorsFromDetails(undefined)).toEqual({});
    expect(errorsFromDetails({})).toEqual({});
  });

  it('produces the same keys as the client validators for the same problems', () => {
    const client = validateProject({ title: '', short_description: 'x', category: 'c', display_order: 1, features: ['a', ''] });
    expect(errorsFromDetails(client.details)).toEqual(client.errors);
  });
});

describe('firstInvalidField', () => {
  it('returns null when nothing is invalid and the first key without an order', () => {
    expect(firstInvalidField({}, CONTACT_FIELD_ORDER)).toBeNull();
    expect(firstInvalidField({ subject: 'x', email: 'y' })).toBe('subject');
  });
});

describe('addTag', () => {
  it('appends the trimmed name and returns a new list', () => {
    const list = ['React'];
    const next = addTag(list, '  Node.js ');
    expect(next).toEqual(['React', 'Node.js']);
    expect(list).toEqual(['React']);
  });

  it('returns the same list for empty, whitespace-only and non-string names', () => {
    const list = ['React'];
    for (const name of ['', '   ', '\t\n', undefined, null, 5]) expect(addTag(list, name)).toBe(list);
    expect(tagError(list, '  ')).toBe('Enter a technology name');
  });

  it('rejects case-insensitive duplicates', () => {
    const list = ['React', 'PostgreSQL'];
    expect(addTag(list, 'react')).toBe(list);
    expect(addTag(list, ' POSTGRESQL ')).toBe(list);
    expect(tagError(list, 'REACT')).toBe('This technology is already listed');
    expect(addTag(list, 'Reactive')).toEqual(['React', 'PostgreSQL', 'Reactive']);
  });

  it('accepts names up to 50 code points', () => {
    expect(addTag([], emoji(50))).toEqual([emoji(50)]);
    expect(addTag([], emoji(51))).toEqual([]);
    expect(tagError([], 'x'.repeat(51))).toBe('Must be at most 50 characters');
  });

  it('stops at 30 technologies', () => {
    const full = Array.from({ length: 30 }, (_, i) => `T${i}`);
    expect(addTag(full, 'Another')).toBe(full);
    expect(tagError(full, 'Another')).toBe('A project can have at most 30 technologies');
    expect(addTag(full.slice(0, 29), 'Another')).toHaveLength(30);
  });
});
