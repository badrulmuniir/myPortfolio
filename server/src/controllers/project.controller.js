// Public project reads (Requirements 12.1–12.6, 12.8–12.10, 4.10) and admin project management
// (Requirements 13.1–13.6, 13.17). Handlers read `req.valid`, call one service function and send
// the result; they contain no SQL (1.5).
import { classifyIdentifier } from '../validators/identifier.js';
import { InvalidIdError, NotFoundError } from '../utils/errors.js';
import { ok } from '../utils/response.js';

/** @param {{ projectService: ReturnType<import('../services/projectService.js').createProjectService> }} deps */
export function createProjectController({ projectService }) {
  return {
    async listPublic(req, res, next) {
      try {
        return ok(res, await projectService.listPublic({ category: req.valid.query.category }));
      } catch (err) {
        return next(err);
      }
    },

    /**
     * Digits → id lookup; other valid Slugs → exact Slug lookup; out-of-range digits → 400
     * INVALID_ID (4.10); anything else → 404 without a query. A missing and an unpublished Project
     * get the same 404 body, NotFoundError('Project') (12.5).
     */
    async getPublic(req, res, next) {
      try {
        const identifier = classifyIdentifier(req.params.identifier);
        let project = null;
        if (identifier.kind === 'invalid') throw new InvalidIdError({ field: 'identifier' });
        if (identifier.kind === 'id') project = await projectService.getPublicById(identifier.id);
        if (identifier.kind === 'slug') project = await projectService.getPublicBySlug(identifier.slug);
        if (!project) throw new NotFoundError('Project');
        return ok(res, project);
      } catch (err) {
        return next(err);
      }
    },

    /** GET /api/admin/projects (13.1). */
    async listAdmin(req, res, next) {
      try {
        return ok(res, await projectService.listAdmin());
      } catch (err) {
        return next(err);
      }
    },

    /** GET /api/admin/projects/:id (13.2, 13.17). */
    async getAdmin(req, res, next) {
      try {
        const project = await projectService.getAdmin(req.valid.params.id);
        if (!project) throw new NotFoundError('Project');
        return ok(res, project);
      } catch (err) {
        return next(err);
      }
    },

    /** POST /api/projects → 201 (13.3). The service throws ConflictError for a taken Slug. */
    async create(req, res, next) {
      try {
        return ok(res, await projectService.create(req.valid.body), 201);
      } catch (err) {
        return next(err);
      }
    },

    /** PUT /api/projects/:id (13.4). The service throws NotFoundError or ConflictError. */
    async update(req, res, next) {
      try {
        return ok(res, await projectService.update(req.valid.params.id, req.valid.body));
      } catch (err) {
        return next(err);
      }
    },

    /** PATCH /api/projects/:id/publish (13.5, 13.17). */
    async setPublished(req, res, next) {
      try {
        const project = await projectService.setPublished(req.valid.params.id, req.valid.body.is_published);
        if (!project) throw new NotFoundError('Project');
        return ok(res, project);
      } catch (err) {
        return next(err);
      }
    },

    /** DELETE /api/projects/:id → 200 { id } (13.6, 13.17). */
    async remove(req, res, next) {
      try {
        const { id } = req.valid.params;
        if (!(await projectService.remove(id))) throw new NotFoundError('Project');
        return ok(res, { id });
      } catch (err) {
        return next(err);
      }
    },
  };
}
