import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

interface ApiKeyLimit {
  key: string;
  dailyLimit: number;
  used: number;
  remaining: number;
  lastChecked: number;
  isExhausted: boolean;
}

export class ApiLimitMonitor {
  private freeKeyLimits: Map<string, ApiKeyLimit> = new Map();
  private readonly DAILY_LIMIT_PER_KEY = 250;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(private freeApiKeys: string[]) {
    for (const key of freeApiKeys) {
      this.freeKeyLimits.set(key, {
        key,
        dailyLimit: this.DAILY_LIMIT_PER_KEY,
        used: 0,
        remaining: this.DAILY_LIMIT_PER_KEY,
        lastChecked: 0,
        isExhausted: false,
      });
    }
  }

  startMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkAllLimits();
    
    this.checkInterval = setInterval(() => {
      this.checkAllLimits();
    }, this.CHECK_INTERVAL_MS);

    logger.info('Мониторинг лимитов API запущен', { 
      keysCount: this.freeApiKeys.length,
      interval: this.CHECK_INTERVAL_MS / 1000 / 60 
    });
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async checkAllLimits(): Promise<void> {
    const promises = this.freeApiKeys.map(key => this.checkKeyLimit(key));
    await Promise.allSettled(promises);
  }

  private async checkKeyLimit(key: string): Promise<void> {
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      const testPrompt = 'test';
      const result = await model.generateContent([testPrompt]);
      await result.response;

      const limit = this.freeKeyLimits.get(key);
      if (limit) {
        limit.lastChecked = Date.now();
        if (limit.remaining === 0) {
          limit.isExhausted = true;
        } else {
          limit.isExhausted = false;
        }
      }
    } catch (error: any) {
      const errorCode = error.code || error.status || error.statusCode;
      const errorMessage = error.message?.toLowerCase() || '';
      
      const is429 = errorCode === 429 || 
                   errorMessage.includes('429') ||
                   errorMessage.includes('too many requests') ||
                   errorMessage.includes('rate limit') ||
                   errorMessage.includes('quota exceeded');

      const limit = this.freeKeyLimits.get(key);
      if (limit) {
        limit.lastChecked = Date.now();
        
        if (is429) {
          limit.isExhausted = true;
          limit.remaining = 0;
          logger.warn('Ключ API исчерпал лимит', { key: key.substring(0, 10) + '...' });
        } else {
          if (limit.remaining === 0) {
            limit.isExhausted = true;
          } else {
            limit.isExhausted = false;
          }
        }
      }
    }
  }

  recordUsage(key: string): void {
    const limit = this.freeKeyLimits.get(key);
    if (limit) {
      limit.used++;
      limit.remaining = Math.max(0, limit.remaining - 1);
      
      if (limit.remaining === 0) {
        limit.isExhausted = true;
      }
    }
  }

  getAvailableKey(): string | null {
    const available = Array.from(this.freeKeyLimits.entries())
      .filter(([_, limit]) => !limit.isExhausted && limit.remaining > 0)
      .sort(([_, a], [__, b]) => b.remaining - a.remaining);

    if (available.length === 0) {
      return null;
    }

    return available[0][0];
  }

  getLoadPercentage(): number {
    const totalLimit = this.freeApiKeys.length * this.DAILY_LIMIT_PER_KEY;
    const totalUsed = Array.from(this.freeKeyLimits.values())
      .reduce((sum, limit) => sum + limit.used, 0);
    
    return Math.min(100, (totalUsed / totalLimit) * 100);
  }

  getTotalRemaining(): number {
    return Array.from(this.freeKeyLimits.values())
      .reduce((sum, limit) => sum + limit.remaining, 0);
  }

  getTotalLimit(): number {
    return this.freeApiKeys.length * this.DAILY_LIMIT_PER_KEY;
  }

  getKeyStatus(key: string): ApiKeyLimit | null {
    return this.freeKeyLimits.get(key) || null;
  }

  getAllKeyStatuses(): ApiKeyLimit[] {
    return Array.from(this.freeKeyLimits.values());
  }

  resetDailyLimits(): void {
    for (const limit of this.freeKeyLimits.values()) {
      limit.used = 0;
      limit.remaining = this.DAILY_LIMIT_PER_KEY;
      limit.isExhausted = false;
    }
  }
}

