// Domain errors with a fixed status, code and message (design: "Server Error Classes and Mapping").
//
// Every class sets its own status, code and message, so the Error_Handler never copies text from
// an unknown error into a response (4.8, 4.9, 4.13). `details` entries have the shape
// `{ field, reason, message }`, where `reason` is one of the Validator's fixed tokens.

/** Base class for errors the Error_Handler maps to a known Error_Response. */
export class AppError extends Error {
  /**
   * @param {{ status: number, code: string, message: string, details?: object[], cause?: unknown }} options
   */
  constructor({ status, code, message, details, cause }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** 413: body larger than 102,400 bytes (bodySizeGuard, body-parser `entity.too.large`). Req 4.6. */
export class PayloadTooLargeError extends AppError {
  constructor({ cause } = {}) {
    super({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 100 KB', cause });
  }
}

/** 400: body sent as JSON that cannot be parsed (body-parser `entity.parse.failed`). Req 4.5. */
export class MalformedJsonError extends AppError {
  constructor({ cause } = {}) {
    super({ status: 400, code: 'MALFORMED_JSON', message: 'Request body is not valid JSON', cause });
  }
}

/**
 * 400: any other body-parser client error, such as an unsupported charset or content encoding,
 * or a body whose length does not match Content-Length. The design table does not list these, so
 * this code is a stable addition.
 */
export class InvalidRequestBodyError extends AppError {
  constructor({ cause } = {}) {
    super({ status: 400, code: 'INVALID_REQUEST_BODY', message: 'Request body could not be read', cause });
  }
}

/** 400: a path id is not a positive integer from 1 to 2,147,483,647 written in digits. Req 4.10. */
export class InvalidIdError extends AppError {
  /** @param {{ field?: string, reason?: string }} [options] */
  constructor({ field = 'id', reason = 'invalid_format' } = {}) {
    super({
      status: 400,
      code: 'INVALID_ID',
      message: 'Invalid id',
      details: [{ field, reason, message: 'Id must be a positive integer' }],
    });
  }
}

/** 400: one or more fields failed the Validator. `details` holds one entry per invalid field. Req 4.2. */
export class ValidationError extends AppError {
  /** @param {Array<{ field: string, reason: string, message?: string }>} details */
  constructor(details = []) {
    super({ status: 400, code: 'VALIDATION_ERROR', message: 'Request validation failed', details });
  }
}

/** 401: login with an unknown email or a wrong password (identical for both). Req 5.3. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
  }
}

/** 401: missing, malformed, expired or otherwise invalid token. Req 7.2, 7.3. */
export class UnauthorizedError extends AppError {
  constructor() {
    super({ status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
}

/** 403: the authenticated administrator lacks the required role. Req 7.4. */
export class ForbiddenError extends AppError {
  constructor() {
    super({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission to perform this action' });
  }
}

/**
 * 404: the id, Slug or Project_Identifier refers to no record. Req 4.3.
 * The message is `<Resource> not found`; `resource` must be a fixed name chosen by the caller.
 */
export class NotFoundError extends AppError {
  /** @param {string} [resource] e.g. 'Project', 'Skill' */
  constructor(resource = 'Resource') {
    super({ status: 404, code: 'NOT_FOUND', message: `${resource} not found` });
  }
}

/** 404: no API route matches the method and path. Req 4.4. */
export class RouteNotFoundError extends AppError {
  constructor() {
    super({ status: 404, code: 'ROUTE_NOT_FOUND', message: 'Route not found' });
  }
}

/** 409: a unique field already holds the submitted value. Req 4.7. */
export class ConflictError extends AppError {
  /** @param {string} [field] the conflicting field; omitted when it is not known */
  constructor(field) {
    super({
      status: 409,
      code: 'CONFLICT',
      message: 'A record with this value already exists',
      details:
        field === undefined ? undefined : [{ field, reason: 'duplicate', message: 'This value is already in use' }],
    });
  }
}

/** 429 from the login Rate_Limiter. Req 8.1. */
export class TooManyLoginAttemptsError extends AppError {
  constructor() {
    super({
      status: 429,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Too many login attempts. Please try again later.',
    });
  }
}

/** 429 from the contact Rate_Limiter. Req 8.2. */
export class TooManyContactSubmissionsError extends AppError {
  constructor() {
    super({
      status: 429,
      code: 'TOO_MANY_CONTACT_SUBMISSIONS',
      message: 'Too many messages sent. Please try again later.',
    });
  }
}

/**
 * The Database could not be reached: pool acquire timeout, refused connection, failed health check.
 * Maps to 503 SERVICE_UNAVAILABLE (35.9, 36.9). The message is fixed; the original error is kept
 * only as `cause` so it can be logged after sanitizing.
 */
export class ServiceUnavailableError extends AppError {
  /** @param {{ cause?: unknown }} [options] */
  constructor({ cause } = {}) {
    super({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable', cause });
  }
}

/** 500 for anything that is not a domain error. Never carries the original message. Req 4.8. */
export class InternalError extends AppError {
  constructor() {
    super({ status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
}
