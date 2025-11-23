import { GoogleGenerativeAI } from '@google/generative-ai';

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
  
  const pstMidnight = new Date(`${pacificDateStr}T00:00:00-08:00`);
  const pdtMidnight = new Date(`${pacificDateStr}T00:00:00-07:00`);
  
  const pstPacific = pstMidnight.toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  if (pstPacific.startsWith('00:') || pstPacific === '12:00 AM') {
    return pstMidnight.getTime();
  }
  
  return pdtMidnight.getTime();
}

export class GeminiBalancer {
  private freeTokens: TokenInstance[] = [];
  private premiumTokens: TokenInstance[] = [];

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
    }));

    if (this.freeTokens.length === 0) {
      throw new Error('Необходимо указать хотя бы один Free API ключ');
    }
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
    
    if (currentPacificDayStart !== lastCheckPacificDayStart) {
      token.requestCount = 0;
      token.remainingQuota = token.dailyLimit;
      token.quotaExhausted = false;
    }

    const estimatedUsed = token.requestCount;
    const estimated = Math.max(0, token.dailyLimit - estimatedUsed);
    token.remainingQuota = estimated;
    
    if (token.remainingQuota <= 0) {
      token.quotaExhausted = true;
    } else {
      token.quotaExhausted = false;
    }
    
    token.lastQuotaCheck = Date.now();
  }

  async checkAllFreeTokensQuota(): Promise<void> {
    const promises = this.freeTokens.map(token => this.checkQuotaForToken(token));
    await Promise.all(promises);
  }

  getFreeTokenWithQuota(): GoogleGenerativeAI | null {
    const availableTokens = this.freeTokens.filter(t => !t.quotaExhausted && t.isAvailable);
    if (availableTokens.length === 0) {
      return null;
    }
    const token = this.selectBestToken(availableTokens);
    return token.api;
  }

  getTotalFreeQuota(): { total: number; remaining: number; used: number; percentage: number } {
    const totalLimit = this.freeTokens.length * 250;
    const remaining = this.freeTokens.reduce((sum, t) => sum + Math.max(0, t.remainingQuota), 0);
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
    if (token) {
      token.quotaExhausted = true;
      token.remainingQuota = 0;
    }
  }

  decrementQuota(key: string, isPremium: boolean): void {
    const tokens = isPremium ? this.premiumTokens : this.freeTokens;
    const token = tokens.find(t => t.key === key);
    if (token && !token.isPremium) {
      const now = Date.now();
      const currentPacificDayStart = getPacificDayStart(now);
      const lastUsedPacificDayStart = getPacificDayStart(token.lastUsed || now);
      
      if (currentPacificDayStart !== lastUsedPacificDayStart) {
        token.requestCount = 0;
        token.remainingQuota = token.dailyLimit;
        token.quotaExhausted = false;
      }
      
      token.requestCount++;
      const estimated = Math.max(0, token.dailyLimit - token.requestCount);
      token.remainingQuota = estimated;
      
      if (token.remainingQuota <= 0) {
        token.quotaExhausted = true;
      }
    }
  }
}

