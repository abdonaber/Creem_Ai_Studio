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

class Logger {
  private formatLog(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error | any
  ): LogPayload {
    const payload: LogPayload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
    };

    if (error) {
      payload.error = {
        message: error.message || String(error),
        stack: config.isProduction ? undefined : error.stack,
        code: error.code,
      };
    }

    return payload;
  }

  public debug(message: string, context?: Record<string, unknown>) {
    if (!config.isProduction) {
      console.debug(`[DEBUG] ${message}`, context || '');
    }
  }

  public info(message: string, context?: Record<string, unknown>) {
    if (config.isProduction) {
      console.log(JSON.stringify(this.formatLog('info', message, context)));
    } else {
      console.log(`[INFO] ${message}`, context ? JSON.stringify(context) : '');
    }
  }

  public warn(message: string, context?: Record<string, unknown>, error?: any) {
    if (config.isProduction) {
      console.warn(JSON.stringify(this.formatLog('warn', message, context, error)));
    } else {
      console.warn(`[WARN] ${message}`, context || '', error?.message || '');
    }
  }

  public error(message: string, error?: any, context?: Record<string, unknown>) {
    if (config.isProduction) {
      console.error(JSON.stringify(this.formatLog('error', message, context, error)));
    } else {
      console.error(`[ERROR] ${message}`, error?.message || error, context || '');
    }
  }
}

export const logger = new Logger();
