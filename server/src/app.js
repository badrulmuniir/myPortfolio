// Express application factory (design: "Entry and App Factory", "Request Pipeline").
//
// Dependencies are passed in, so tests can inject a fake or failing `db`, a fake clock and a
// low-cost hasher. `clock` and `hasher` are forwarded to the routers. When `hasher` is not
// given, the auth service uses the production hasher (bcrypt cost 12).
import express from 'express';
import { bodySizeGuard, jsonBody } from './middleware/bodySizeGuard.js';
import { createCors } from './middleware/cors.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { createApiRouter } from './routes/index.js';
import { logger as defaultLogger } from './utils/logger.js';

/**
 * @param {{ config: ReturnType<import('./config/env.js').loadAppConfig>,
 *   db: ReturnType<import('./db/pool.js').createDb>, clock?: { now: () => number | Date },
 *   logger?: object, hasher?: unknown,
 *   loginLimiter?: ReturnType<typeof import('./utils/rateLimiter.js').createLoginLimiter>,
 *   contactLimiter?: ReturnType<typeof import('./utils/rateLimiter.js').createContactLimiter> }} deps
 *   `loginLimiter` and `contactLimiter` are optional; by default each app gets its own, driven
 *   by `clock`.
 * @returns {import('express').Express}
 */
export function createApp({ config, db, clock, logger = defaultLogger, hasher, loginLimiter, contactLimiter } = {}) {
  if (!config) throw new TypeError('createApp requires config');
  if (!db) throw new TypeError('createApp requires db');

  const app = express();
  app.disable('x-powered-by');
  // TRUST_PROXY=true trusts exactly one reverse-proxy hop, so req.ip is the forwarded client
  // address and a client cannot spoof it with extra X-Forwarded-For entries. Otherwise req.ip
  // is the socket address and X-Forwarded-For is ignored (8.5, 8.6, 9.3).
  app.set('trust proxy', config.trustProxy === true ? 1 : false);

  // Pipeline: securityHeaders → cors → bodySizeGuard → express.json → /api router (ending in
  // notFound) → errorHandler. securityHeaders runs before cors so the preflight 204 gets the
  // headers; the body checks run before the router so 413 and 400 MALFORMED_JSON come before
  // path id and field validation (4.12).
  app.use(securityHeaders);
  app.use(createCors({ origins: config.frontendOrigins }));
  app.use(bodySizeGuard);
  app.use(jsonBody);
  app.use('/api', createApiRouter({ config, db, clock, logger, hasher, loginLimiter, contactLimiter }));
  app.use(createErrorHandler({ logger }));

  return app;
}
