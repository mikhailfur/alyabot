import * as fs from 'fs';
import * as path from 'path';
import * as Sentry from '@sentry/node';

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

export class Logger {
  private logDir: string;
  private logLevel: LogLevel;
  private logToFile: boolean;
  private logToConsole: boolean;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.logLevel = (process.env.LOG_LEVEL as any) || LogLevel.INFO;
    this.logToFile = process.env.LOG_TO_FILE !== 'false';
    this.logToConsole = process.env.LOG_TO_CONSOLE !== 'false';

    if (this.logToFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] ${message}${dataStr}`;
  }

  private writeLog(level: LogLevel, levelName: string, message: string, data?: any): void {
    if (level < this.logLevel) return;

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
      data
    };

    const formattedMessage = this.formatMessage(levelName, message, data);

    if (this.logToConsole) {
      const colors: Record<string, string> = {
        DEBUG: '\x1b[36m',
        INFO: '\x1b[32m',
        WARN: '\x1b[33m',
        ERROR: '\x1b[31m',
        RESET: '\x1b[0m'
      };
      
      const color = colors[levelName] || colors.RESET;
      console.log(`${color}${formattedMessage}${colors.RESET}`);
    }

    if (this.logToFile) {
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logDir, `${today}.log`);
      const errorLogFile = path.join(this.logDir, `${today}-error.log`);

      try {
        fs.appendFileSync(logFile, formattedMessage + '\n', 'utf8');
        
        if (level >= LogLevel.ERROR) {
          fs.appendFileSync(errorLogFile, formattedMessage + '\n', 'utf8');
        }
      } catch (error) {
        console.error('Ошибка при записи в лог файл:', error);
      }
    }
  }

  debug(message: string, data?: any): void {
    this.writeLog(LogLevel.DEBUG, 'DEBUG', message, data);
  }

  info(message: string, data?: any): void {
    this.writeLog(LogLevel.INFO, 'INFO', message, data);
  }

  warn(message: string, data?: any): void {
    this.writeLog(LogLevel.WARN, 'WARN', message, data);
    
    Sentry.captureMessage(message, {
      level: 'warning',
      contexts: data ? { custom: data } : undefined
    });
  }

  error(message: string, error?: any, data?: any): void {
    const errorData = error ? {
      ...data,
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
        errno: error.errno
      }
    } : data;
    this.writeLog(LogLevel.ERROR, 'ERROR', message, errorData);

    if (error) {
      Sentry.withScope((scope: Sentry.Scope) => {
        if (data) {
          Object.keys(data).forEach(key => {
            scope.setContext(key, data[key]);
          });
        }
        scope.setTag('log_message', message);
        scope.setLevel('error');
        Sentry.captureException(error);
      });
    } else if (message) {
      Sentry.captureMessage(message, {
        level: 'error',
        contexts: data ? { custom: data } : undefined
      });
    }
  }

  userAction(userId: number, action: string, data?: any): void {
    this.info(`[USER ${userId}] ${action}`, data);
  }

  adminAction(adminId: number, action: string, data?: any): void {
    this.info(`[ADMIN ${adminId}] ${action}`, data);
  }

  databaseAction(action: string, data?: any): void {
    this.debug(`[DATABASE] ${action}`, data);
  }

  apiAction(service: string, action: string, data?: any): void {
    this.debug(`[API ${service}] ${action}`, data);
  }
}

export const logger = new Logger();

