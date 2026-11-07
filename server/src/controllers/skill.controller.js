// GET/POST /api/skills and PUT/DELETE /api/skills/:id (Requirements 15.1, 15.2, 15.7, 15.8).
import { NotFoundError } from '../utils/errors.js';
import { ok } from '../utils/response.js';

/** @param {{ skillService: ReturnType<import('../services/skillService.js').createSkillService> }} deps */
export function createSkillController({ skillService }) {
  return {
    async list(req, res, next) {
      try {
        return ok(res, await skillService.list());
      } catch (err) {
        return next(err);
      }
    },

    async create(req, res, next) {
      try {
        return ok(res, await skillService.create(req.valid.body), 201);
      } catch (err) {
        return next(err);
      }
    },

    async update(req, res, next) {
      try {
        const skill = await skillService.update(req.valid.params.id, req.valid.body);
        if (!skill) throw new NotFoundError('Skill');
        return ok(res, skill);
      } catch (err) {
        return next(err);
      }
    },

    async remove(req, res, next) {
      try {
        const { id } = req.valid.params;
        if (!(await skillService.remove(id))) throw new NotFoundError('Skill');
        return ok(res, { id });
      } catch (err) {
        return next(err);
      }
    },
  };
}
