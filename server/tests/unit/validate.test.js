import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { validate } from '../../src/middleware/validate.js';
import { idParams, projectBody, publicProjectQuery, settingsBody } from '../../src/validators/index.js';
import { InvalidIdError, ValidationError } from '../../src/utils/errors.js';

/** Runs the middleware on a fake request and returns `{ req, err }`. */
const run = (schemas, reqParts) => {
  const req = { params: {}, query: {}, ...reqParts };
  const next = vi.fn();
  validate(schemas)(req, {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return { req, err: next.mock.calls[0][0] };
};

const validProject = { title: 'P', short_description: 'S', category: 'Web', display_order: 1 };

describe('validate middleware', () => {
  it('stores normalized params, query and body in req.valid', () => {
    const { req, err } = run(
      { params: idParams, query: publicProjectQuery, body: projectBody },
      { params: { id: '12' }, query: { category: ' Web ' }, body: { ...validProject, title: '  P  ' } },
    );
    expect(err).toBeUndefined();
    expect(req.valid.params).toEqual({ id: 12 });
    expect(req.valid.query).toEqual({ category: 'Web' });
    expect(req.valid.body).toMatchObject({ title: 'P', features: [] });
  });

  it('reports only INVALID_ID when the id and the body are both invalid', () => {
    const body = vi.fn();
    const { req, err } = run({ params: idParams, body }, { params: { id: '0' }, body: { nope: 1 } });
    expect(err).toBeInstanceOf(InvalidIdError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_ID');
    expect(err.details).toEqual([expect.objectContaining({ field: 'id', reason: 'out_of_range' })]);
    expect(body).not.toHaveBeenCalled();
    expect(req.valid).toBeUndefined();
  });

  it('collects every query and body error into one VALIDATION_ERROR', () => {
    const { req, err } = run(
      { query: publicProjectQuery, body: projectBody },
      { query: { category: '' }, body: { title: '', short_description: 'S', category: 'Web', display_order: 'x', z: 1 } },
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details.map((d) => [d.field, d.reason])).toEqual([
      ['category', 'required'],
      ['title', 'required'],
      ['display_order', 'type'],
      ['z', 'unknown_field'],
    ]);
    expect(err.details.every((d) => typeof d.message === 'string' && d.message !== '')).toBe(true);
    expect(req.valid).toBeUndefined();
  });

  it('reports a missing body as `body` instead of crashing', () => {
    const { err } = run({ body: projectBody }, { body: undefined });
    expect(err.details).toEqual([expect.objectContaining({ field: 'body', reason: 'required' })]);
  });

  it('reports a Settings body without allowed keys on `body`', () => {
    const { err } = run({ body: settingsBody }, { body: {} });
    expect(err.details).toEqual([expect.objectContaining({ field: 'body', reason: 'required' })]);
  });

  it('works with real Express 5 requests, where req.query is a getter', async () => {
    const app = express();
    app.use(express.json());
    app.put('/items/:id', validate({ params: idParams, query: publicProjectQuery, body: settingsBody }), (req, res) => {
      res.json({ valid: req.valid, rawQuery: req.query });
    });
    app.use((err, req, res, _next) => {
      res.status(err.status ?? 500).json({ code: err.code, details: err.details });
    });

    const good = await request(app).put('/items/5?category=%20Web%20&_=1').send({ site_title: ' Site ' });
    expect(good.status).toBe(200);
    expect(good.body.valid).toEqual({ params: { id: 5 }, query: { category: 'Web' }, body: { site_title: 'Site' } });
    expect(good.body.rawQuery).toEqual({ category: ' Web ', _: '1' });

    const badId = await request(app).put('/items/abc').send({ nope: true });
    expect(badId.status).toBe(400);
    expect(badId.body.code).toBe('INVALID_ID');

    const noBody = await request(app).put('/items/5');
    expect(noBody.status).toBe(400);
    expect(noBody.body.code).toBe('VALIDATION_ERROR');
    expect(noBody.body.details).toEqual([expect.objectContaining({ field: 'body', reason: 'required' })]);
  });
});
