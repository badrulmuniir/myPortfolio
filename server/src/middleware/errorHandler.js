// Error_Handler (Requirements 4.8, 4.9, 4.11, 4.13, 9.9; design: "Server Error Classes and Mapping").
//
// Every error becomes an Error_Response built only from a domain error class, so the response
// never contains a stack trace, SQL text, a Database message or an internal error message. This
// holds in every environment, not only in production, so there is no NODE_ENV branch.
import { describeDbError, sanitizeMessage } from '../db/connectionInfo.js';
import {
  AppError,
  ConflictError,
  InternalError,
  InvalidRequestBodyError,
  MalformedJsonError,
  PayloadTooLargeError,
} from '../utils/errors.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { errorBody } from '../utils/response.js';

/** PostgreSQL unique_violation. */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * Unique constraint or index name → request field (from server/migrations/*.sql).
 * A constraint not listed here gives a 409 without `details`, so its name never leaks.
 */
export const UNIQUE_CONSTRAINT_FIELDS = Object.freeze({
  admins_email_key: 'email',
  projects_slug_key: 'slug',
  technologies_name_lower_key: 'technologies',
  project_technologies_pkey: 'technologies',
  settings_setting_key_key: 'setting_key',
});

/** Error `type` values set by body-parser (used by express.json). */
const BODY_PARSER_TYPES = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
  'parameters.too.many',
  'stream.encoding.set',
  'stream.not.readable',
]);

function statusOf(err) {
  const status = err?.status ?? err?.statusCode;
  return Number.isInteger(status) ? status : undefined;
}

/** Maps a body-parser error to a domain error, or returns null for 5xx body-parser errors. */
function fromBodyParser(err) {
  const status = statusOf(err);
  if (err.type === 'entity.too.large' || status === 413) return new PayloadTooLargeError();
  if (err.type === 'entity.parse.failed') return new MalformedJsonError();
  if (status !== undefined && status >= 400 && status < 500) return new InvalidRequestBodyError();
  return null;
}

function isBodyParserError(err) {
  return typeof err?.type === 'string' && BODY_PARSER_TYPES.has(err.type);
}

function isUniqueViolation(err) {
  return err?.code === PG_UNIQUE_VIOLATION && !(err instanceof AppError);
}

/**
 * Turns any thrown value into the domain error that defines the response.
 * @param {unknown} err
 * @returns {AppError}
 */
export function toAppError(err) {
  if (err instanceof AppError) return err;
  if (isBodyParserError(err)) return fromBodyParser(err) ?? new InternalError();
  if (isUniqueViolation(err)) {
    const field = Object.hasOwn(UNIQUE_CONSTRAINT_FIELDS, err.constraint)
      ? UNIQUE_CONSTRAINT_FIELDS[err.constraint]
      : undefined;
    return new ConflictError(field);
  }
  return new InternalError();
}

function errorMessage(err) {
  if (err instanceof Error) return err.message;
  if (err === null || err === undefined) return String(err);
  return typeof err === 'object' ? (err.message ?? '[non-Error object]') : String(err);
}

/** Request context for logs. `req.path` excludes the query string; bodies are never logged. */
function requestContext(req) {
  return { method: req.method, path: req.path };
}

function logError(logger, err, mapped, req) {
  if (mapped.status === 503) {
    // The ServiceUnavailableError message is generic; its cause holds the sanitized reason.
    logger.error('Service unavailable while handling request', {
      ...requestContext(req),
      message: mapped.message,
      reason: describeDbError(err),
      stack: sanitizeMessage(err?.stack ?? ''),
    });
    return;
  }
  if (mapped.status >= 500) {
    logger.error('Unexpected error while handling request', {
      ...requestContext(req),
      message: sanitizeMessage(errorMessage(err)),
      stack: sanitizeMessage(err?.stack ?? ''),
    });
    return;
  }
  if (isUniqueViolation(err)) {
    logger.warn('Unique constraint violation', { ...requestContext(req), constraint: err.constraint });
  }
}

/**
 * Creates the Error_Handler. Mount it last, after the /api router and the notFound handler.
 * Express recognizes error middleware by its four parameters, so `next` must stay declared.
 * @param {{ logger?: { error: Function, warn: Function } }} [deps]
 */
export function createErrorHandler({ logger = defaultLogger } = {}) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    // A response already started cannot be replaced; Express's default handler closes it.
    if (res.headersSent) return next(err);

    const mapped = toAppError(err);
    logError(logger, err, mapped, req);
    return res.status(mapped.status).json(errorBody(mapped));
  };
}
