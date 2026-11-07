// API_Server entry file (Requirement 1.6): load configuration, create the app, start the listener.
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { ConfigError, loadAppConfig } from './config/env.js';
import { sanitizeMessage } from './db/connectionInfo.js';
import { createDb } from './db/pool.js';
import { startServer } from './db/startupCheck.js';
import { logger as defaultLogger } from './utils/logger.js';

export const ENV_FILE_PATH = fileURLToPath(new URL('../.env', import.meta.url));

/** Loads server/.env when it exists. Variables already set in the environment take precedence. */
export function loadEnvFile(path = ENV_FILE_PATH) {
  if (existsSync(path)) dotenv.config({ path, quiet: true });
}

/**
 * @param {{ env?: Record<string, string | undefined>, logger?: object, exit?: (code: number) => void,
 *   createDbFn?: typeof createDb, start?: typeof startServer }} [options]
 * @returns {Promise<import('node:http').Server | null>}
 */
export async function main({
  env = process.env,
  logger = defaultLogger,
  exit = (code) => process.exit(code),
  createDbFn = createDb,
  start = startServer,
} = {}) {
  let config;
  try {
    config = loadAppConfig(env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // The ConfigError message holds variable names and fixed reasons only, never values.
    logger.error(err.message);
    exit(1);
    return null;
  }

  const db = createDbFn(config.db, { logger });
  const app = createApp({ config, db, logger });
  return start(app, { db, port: config.port, logger, exit });
}

/**
 * Logs unhandled promise rejections and keeps the process running (Requirement 1.8).
 * The reason is sanitized so no connection string reaches the log.
 * @param {{ logger?: object, proc?: { on: Function } }} [options]
 * @returns {(reason: unknown) => void} the registered listener
 */
export function registerProcessHandlers({ logger = defaultLogger, proc = process } = {}) {
  const onUnhandledRejection = (reason) => {
    let message;
    try {
      message = reason instanceof Error ? reason.message : String(reason);
    } catch {
      message = '[unprintable rejection reason]';
    }
    logger.error('Unhandled promise rejection', {
      message: sanitizeMessage(message),
      stack: sanitizeMessage(reason instanceof Error ? (reason.stack ?? '') : ''),
    });
  };
  proc.on('unhandledRejection', onUnhandledRejection);
  return onUnhandledRejection;
}

function isEntryFile() {
  if (!process.argv[1]) return false;
  try {
    const self = fileURLToPath(import.meta.url);
    const entry = realpathSync(process.argv[1]);
    return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry;
  } catch {
    return false;
  }
}

if (isEntryFile()) {
  loadEnvFile();
  registerProcessHandlers();
  main().catch((err) => {
    defaultLogger.error('API server failed to start', { reason: sanitizeMessage(err?.message ?? err) });
    process.exit(1);
  });
}
