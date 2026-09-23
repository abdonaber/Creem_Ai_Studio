import { config } from '../config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogPayload {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'refreshtoken',
  'secret',
  'jwt',
  'jwtsecret',
  'apikey',
  'authorization',
  'clientsecret',
  'stripekkey',
  'stripewebhooksecret',
  'creditcard',
  'cardnumber',
  'cvv',
]);

function sanitizeData(data: any, depth = 0): any {
  if (depth > 4 || !data) return data;

  if (typeof data === 'string') {
    // Redact bearer tokens or jwt-like strings in plain messages
    return data.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]');
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item, depth + 1));
  }

  if (typeof data === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lower) || lower.includes('secret') || lower.includes('password') || lower.includes('token')) {
        clean[key] = '[REDACTED]';
      } else {
        clean[key] = sanitizeData(val, depth + 1);
      }
    }
    return clean;
  }

  return data;
}

class Logger {
  private formatLog(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error | any
  ): LogPayload {
    const sanitizedContext = context ? sanitizeData(context) : undefined;
    const sanitizedMessage = typeof message === 'string' ? sanitizeData(message) : message;

    const payload: LogPayload = {
      level,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
      context: sanitizedContext,
    };

    if (error) {
      payload.error = {
        message: sanitizeData(error.message || String(error)),
        stack: config.isProduction ? undefined : error.stack,
        code: error.code,
      };
    }

    return payload;
  }

  public debug(message: string, context?: Record<string, unknown>) {
    if (!config.isProduction) {
      console.debug(`[DEBUG] ${sanitizeData(message)}`, context ? sanitizeData(context) : '');
    }
  }

  public info(message: string, context?: Record<string, unknown>) {
    if (config.isProduction) {
      console.log(JSON.stringify(this.formatLog('info', message, context)));
    } else {
      console.log(`[INFO] ${sanitizeData(message)}`, context ? JSON.stringify(sanitizeData(context)) : '');
    }
  }

  public warn(message: string, context?: Record<string, unknown>, error?: any) {
    if (config.isProduction) {
      console.warn(JSON.stringify(this.formatLog('warn', message, context, error)));
    } else {
      console.warn(`[WARN] ${sanitizeData(message)}`, context ? sanitizeData(context) : '', error?.message || '');
    }
  }

  public error(message: string, error?: any, context?: Record<string, unknown>) {
    if (config.isProduction) {
      console.error(JSON.stringify(this.formatLog('error', message, context, error)));
    } else {
      console.error(`[ERROR] ${sanitizeData(message)}`, error?.message || error, context ? sanitizeData(context) : '');
    }
  }
}

export const logger = new Logger();
