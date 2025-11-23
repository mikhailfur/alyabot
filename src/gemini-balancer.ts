import { GoogleGenerativeAI } from '@google/generative-ai';
import * as crypto from 'crypto';
import { database } from './database';

interface TokenInstance {
  api: GoogleGenerativeAI;
  key: string;
  isPremium: boolean;
  lastUsed: number;
  requestCount: number;
  isAvailable: boolean;
  dailyLimit: number;
  remainingQuota: number;
  lastQuotaCheck: number;
  quotaExhausted: boolean;
  error429Date: number;
}

function getPacificDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const pacificDateStr = formatter.format(date);
  const [year, month, day] = pacificDateStr.split('-').map(Number);
  
  const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  
  const pacificFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const pacificParts = pacificFormatter.formatToParts(testDate);
  const pacificYear = parseInt(pacificParts.find(p => p.type === 'year')?.value || String(year));
  const pacificMonth = parseInt(pacificParts.find(p => p.type === 'month')?.value || String(month));
  const pacificDay = parseInt(pacificParts.find(p => p.type === 'day')?.value || String(day));
  const pacificHour = parseInt(pacificParts.find(p => p.type === 'hour')?.value || '12');
  
  const pacificNoon = new Date(Date.UTC(pacificYear, pacificMonth - 1, pacificDay, pacificHour, 0, 0));
  const offset = testDate.getTime() - pacificNoon.getTime();
  
  const pacificMidnightUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  pacificMidnightUTC.setTime(pacificMidnightUTC.getTime() - offset);
  
  return pacificMidnightUTC.getTime();
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export class GeminiBalancer {
  private freeTokens: TokenInstance[] = [];
  private premiumTokens: TokenInstance[] = [];
  private saveInterval: NodeJS.Timeout | null = null;

  constructor(freeApiKeys: string[], premiumApiKeys: string[] = []) {
    this.freeTokens = freeApiKeys.map(key => ({
      api: new GoogleGenerativeAI(key),
      key,
      isPremium: false,
      lastUsed: 0,
      requestCount: 0,
      isAvailable: true,
      dailyLimit: 250,
      remainingQuota: 250,
      lastQuotaCheck: 0,
      quotaExhausted: false,
      error429Date: 0,
    }));

    this.premiumTokens = premiumApiKeys.map(key => ({
      api: new GoogleGenerativeAI(key),
      key,
      isPremium: true,
      lastUsed: 0,
      requestCount: 0,
      isAvailable: true,
      dailyLimit: Infinity,
      remainingQuota: Infinity,
      lastQuotaCheck: 0,
      quotaExhausted: false,
      error429Date: 0,
    }));

    if (this.freeTokens.length === 0) {
      throw new Error('Необходимо указать хотя бы один Free API ключ');
    }
    
    this.initializeTokensFromDb();
    this.startAutoSave();
  }

  private async initializeTokensFromDb(): Promise<void> {
    try {
      const allKeysData = await database.getAllApiKeysData();
      const keysDataMap = new Map(allKeysData.map(data => [data.key_hash, data]));

      const now = Date.now();
      const currentPacificDayStart = getPacificDayStart(now);

      for (const token of [...this.freeTokens, ...this.premiumTokens]) {
        const keyHash = hashKey(token.key);
        const dbData = keysDataMap.get(keyHash);
        
        if (dbData) {
          token.lastUsed = dbData.last_used || 0;
          token.requestCount = dbData.request_count || 0;
          token.lastQuotaCheck = dbData.last_quota_check || 0;
          
          if (!token.isPremium) {
            const lastCheckPacificDayStart = getPacificDayStart(token.lastQuotaCheck || now);
            const error429PacificDayStart = dbData.error_429_date ? getPacificDayStart(dbData.error_429_date) : 0;
            
            if (currentPacificDayStart !== lastCheckPacificDayStart) {
              token.requestCount = 0;
              
              if (error429PacificDayStart !== currentPacificDayStart) {
                token.remainingQuota = token.dailyLimit;
                token.quotaExhausted = false;
                token.error429Date = 0;
              } else {
                token.remainingQuota = dbData.remaining_quota ?? 250;
                token.quotaExhausted = dbData.quota_exhausted ? true : false;
                token.error429Date = dbData.error_429_date || 0;
              }
            } else {
              token.remainingQuota = dbData.remaining_quota ?? 250;
              token.quotaExhausted = dbData.quota_exhausted ? true : false;
              token.error429Date = dbData.error_429_date || 0;
            }
          } else {
            token.remainingQuota = Infinity;
          }
        }
      }
    } catch (error) {
      console.error('Ошибка при загрузке данных ключей из БД:', error);
    }
  }

  private async saveTokenToDb(token: TokenInstance): Promise<void> {
    try {
      const keyHash = hashKey(token.key);
      await database.saveApiKeyData(keyHash, {
        isPremium: token.isPremium,
        requestCount: token.requestCount,
        lastUsed: token.lastUsed,
        lastQuotaCheck: token.lastQuotaCheck,
        remainingQuota: token.isPremium ? Infinity : token.remainingQuota,
        quotaExhausted: token.quotaExhausted,
        error429Date: token.error429Date,
      });
    } catch (error) {
      console.error('Ошибка при сохранении токена в БД:', error);
    }
  }

  private async saveAllTokensToDb(): Promise<void> {
    const allTokens = [...this.freeTokens, ...this.premiumTokens];
    await Promise.all(allTokens.map(token => this.saveTokenToDb(token)));
  }

  private startAutoSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.saveInterval = setInterval(() => {
      this.saveAllTokensToDb().catch((error: any) => {
        console.error('Ошибка при автосохранении лимитов ключей:', error);
      });
    }, 30000);
  }

  stop(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    this.saveAllTokensToDb().catch((error: any) => {
      console.error('Ошибка при финальном сохранении лимитов ключей:', error);
    });
  }

  private getNextToken(tokens: TokenInstance[]): TokenInstance {
    if (tokens.length === 0) {
      throw new Error('Нет доступных токенов');
    }

    const availableTokens = tokens.filter(t => t.isAvailable && !t.quotaExhausted);
    if (availableTokens.length === 0) {
      const allExhausted = tokens.filter(t => t.quotaExhausted);
      if (allExhausted.length === tokens.length) {
        throw new Error('Все токены исчерпали лимит');
      }
      tokens.forEach(t => t.isAvailable = true);
      const notExhausted = tokens.filter(t => !t.quotaExhausted);
      if (notExhausted.length === 0) {
        throw new Error('Все токены исчерпали лимит');
      }
      return this.selectBestToken(notExhausted);
    }

    return this.selectBestToken(availableTokens);
  }

  private selectBestToken(tokens: TokenInstance[]): TokenInstance {
    const availableTokens = tokens.filter(t => !t.quotaExhausted && t.isAvailable);
    
    if (availableTokens.length === 0) {
      const allExhausted = tokens.filter(t => t.quotaExhausted);
      if (allExhausted.length > 0) {
        throw new Error('Все токены исчерпали лимит');
      }
      return tokens[0];
    }

    if (availableTokens.length === 1) {
      const token = availableTokens[0];
      token.lastUsed = Date.now();
      token.requestCount++;
      this.saveTokenToDb(token).catch((error: any) => {
        console.error('Ошибка при сохранении токена:', error);
      });
      return token;
    }

    const now = Date.now();
    let bestToken = availableTokens[0];
    let bestScore = Infinity;

    for (const token of availableTokens) {
      const timeSinceLastUse = now - token.lastUsed;
      const quotaScore = (token.dailyLimit - token.remainingQuota) * 10;
      const score = token.requestCount * 1000 - timeSinceLastUse + quotaScore;
      
      if (score < bestScore) {
        bestScore = score;
        bestToken = token;
      }
    }

    bestToken.lastUsed = now;
    bestToken.requestCount++;
    this.saveTokenToDb(bestToken).catch((error: any) => {
      console.error('Ошибка при сохранении токена:', error);
    });
    return bestToken;
  }

  getFreeToken(): GoogleGenerativeAI {
    const token = this.getNextToken(this.freeTokens);
    return token.api;
  }

  getPremiumToken(): GoogleGenerativeAI {
    if (this.premiumTokens.length === 0) {
      return this.getFreeToken();
    }
    
    const token = this.getNextToken(this.premiumTokens);
    return token.api;
  }

  getToken(isPremium: boolean): GoogleGenerativeAI {
    return isPremium ? this.getPremiumToken() : this.getFreeToken();
  }

  markTokenUnavailable(key: string, isPremium: boolean): void {
    const tokens = isPremium ? this.premiumTokens : this.freeTokens;
    const token = tokens.find(t => t.key === key);
    if (token) {
      token.isAvailable = false;
      setTimeout(() => {
        token.isAvailable = true;
      }, 60000);
    }
  }

  async checkQuotaForToken(token: TokenInstance): Promise<void> {
    if (token.isPremium) {
      token.remainingQuota = Infinity;
      token.quotaExhausted = false;
      token.lastQuotaCheck = Date.now();
      return;
    }

    const now = Date.now();
    const currentPacificDayStart = getPacificDayStart(now);
    const lastCheckPacificDayStart = getPacificDayStart(token.lastQuotaCheck || now);
    const error429PacificDayStart = token.error429Date > 0 ? getPacificDayStart(token.error429Date) : 0;
    
    if (currentPacificDayStart !== lastCheckPacificDayStart) {
      token.requestCount = 0;
      
      if (error429PacificDayStart !== currentPacificDayStart) {
        token.quotaExhausted = false;
        token.remainingQuota = token.dailyLimit;
        token.error429Date = 0;
      }
    }

    if (error429PacificDayStart === currentPacificDayStart && token.error429Date > 0) {
      token.quotaExhausted = true;
      token.remainingQuota = 0;
    } else {
      const estimatedUsed = token.requestCount;
      const estimated = Math.max(0, token.dailyLimit - estimatedUsed);
      token.remainingQuota = estimated;
      
      if (token.remainingQuota <= 0) {
        token.quotaExhausted = true;
      } else {
        token.quotaExhausted = false;
      }
    }
    
    token.lastQuotaCheck = Date.now();
    this.saveTokenToDb(token).catch((error: any) => {
      console.error('Ошибка при сохранении токена после проверки:', error);
    });
  }

  async checkAllFreeTokensQuota(): Promise<void> {
    const promises = this.freeTokens.map(token => this.checkQuotaForToken(token));
    await Promise.all(promises);
  }

  getFreeTokenWithQuota(): GoogleGenerativeAI | null {
    const now = Date.now();
    const currentPacificDayStart = getPacificDayStart(now);
    
    const availableTokens = this.freeTokens.filter(t => {
      if (t.error429Date > 0) {
        const error429PacificDayStart = getPacificDayStart(t.error429Date);
        if (error429PacificDayStart === currentPacificDayStart) {
          return false;
        }
      }
      return !t.quotaExhausted && t.isAvailable;
    });
    
    if (availableTokens.length === 0) {
      return null;
    }
    const token = this.selectBestToken(availableTokens);
    return token.api;
  }

  getTotalFreeQuota(): { total: number; remaining: number; used: number; percentage: number } {
    const now = Date.now();
    const currentPacificDayStart = getPacificDayStart(now);
    
    const workingTokens = this.freeTokens.filter(t => {
      if (t.error429Date > 0) {
        const error429PacificDayStart = getPacificDayStart(t.error429Date);
        return error429PacificDayStart !== currentPacificDayStart;
      }
      return true;
    });
    
    const exhaustedTokens = this.freeTokens.filter(t => {
      if (t.error429Date > 0) {
        const error429PacificDayStart = getPacificDayStart(t.error429Date);
        return error429PacificDayStart === currentPacificDayStart;
      }
      return t.quotaExhausted;
    });
    
    const totalLimit = this.freeTokens.length * 250;
    
    const remaining = workingTokens.reduce((sum, t) => {
      if (t.error429Date > 0) {
        const error429PacificDayStart = getPacificDayStart(t.error429Date);
        if (error429PacificDayStart === currentPacificDayStart) {
          return sum;
        }
      }
      return sum + Math.max(0, t.remainingQuota);
    }, 0);
    
    const used = totalLimit - remaining;
    const percentage = totalLimit > 0 ? (used / totalLimit) * 100 : 0;
    
    return {
      total: totalLimit,
      remaining,
      used,
      percentage: Math.min(100, Math.max(0, percentage)),
    };
  }

  getStats(): { free: number; premium: number; freeRequests: number; premiumRequests: number; freeQuota: { total: number; remaining: number; used: number; percentage: number } } {
    return {
      free: this.freeTokens.length,
      premium: this.premiumTokens.length,
      freeRequests: this.freeTokens.reduce((sum, t) => sum + t.requestCount, 0),
      premiumRequests: this.premiumTokens.reduce((sum, t) => sum + t.requestCount, 0),
      freeQuota: this.getTotalFreeQuota(),
    };
  }

  markTokenQuotaExhausted(key: string, isPremium: boolean): void {
    const tokens = isPremium ? this.premiumTokens : this.freeTokens;
    const token = tokens.find(t => t.key === key);
    if (token && !token.isPremium) {
      token.quotaExhausted = true;
      token.remainingQuota = 0;
      token.error429Date = Date.now();
      this.saveTokenToDb(token).catch((error: any) => {
        console.error('Ошибка при сохранении токена с 429:', error);
      });
    }
  }

  decrementQuota(key: string, isPremium: boolean): void {
    const tokens = isPremium ? this.premiumTokens : this.freeTokens;
    const token = tokens.find(t => t.key === key);
    if (token && !token.isPremium) {
      const now = Date.now();
      const currentPacificDayStart = getPacificDayStart(now);
      const lastUsedPacificDayStart = getPacificDayStart(token.lastUsed || now);
      const error429PacificDayStart = token.error429Date > 0 ? getPacificDayStart(token.error429Date) : 0;
      
      if (currentPacificDayStart !== lastUsedPacificDayStart) {
        token.requestCount = 0;
        
        if (error429PacificDayStart !== currentPacificDayStart) {
          token.remainingQuota = token.dailyLimit;
          token.quotaExhausted = false;
          token.error429Date = 0;
        }
      }
      
      if (error429PacificDayStart === currentPacificDayStart && token.error429Date > 0) {
        token.quotaExhausted = true;
        token.remainingQuota = 0;
        this.saveTokenToDb(token).catch((error: any) => {
          console.error('Ошибка при сохранении токена с 429 в decrement:', error);
        });
        return;
      }
      
      token.requestCount++;
      token.lastUsed = now;
      const estimated = Math.max(0, token.dailyLimit - token.requestCount);
      token.remainingQuota = estimated;
      
      if (token.remainingQuota <= 0) {
        token.quotaExhausted = true;
      }
      
      this.saveTokenToDb(token).catch((error: any) => {
        console.error('Ошибка при сохранении токена после decrement:', error);
      });
    }
  }
}

