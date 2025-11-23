import { GoogleGenerativeAI } from '@google/generative-ai';

interface TokenInstance {
  api: GoogleGenerativeAI;
  key: string;
  isPremium: boolean;
  lastUsed: number;
  requestCount: number;
  isAvailable: boolean;
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
    }));

    this.premiumTokens = premiumApiKeys.map(key => ({
      api: new GoogleGenerativeAI(key),
      key,
      isPremium: true,
      lastUsed: 0,
      requestCount: 0,
      isAvailable: true,
    }));

    if (this.freeTokens.length === 0) {
      throw new Error('Необходимо указать хотя бы один Free API ключ');
    }
  }

  private getNextToken(tokens: TokenInstance[]): TokenInstance {
    if (tokens.length === 0) {
      throw new Error('Нет доступных токенов');
    }

    const availableTokens = tokens.filter(t => t.isAvailable);
    if (availableTokens.length === 0) {
      tokens.forEach(t => t.isAvailable = true);
      return this.selectBestToken(tokens);
    }

    return this.selectBestToken(availableTokens);
  }

  private selectBestToken(tokens: TokenInstance[]): TokenInstance {
    if (tokens.length === 1) {
      const token = tokens[0];
      token.lastUsed = Date.now();
      token.requestCount++;
      return token;
    }

    const now = Date.now();
    let bestToken = tokens[0];
    let bestScore = Infinity;

    for (const token of tokens) {
      const timeSinceLastUse = now - token.lastUsed;
      const score = token.requestCount * 1000 - timeSinceLastUse;
      
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

  getStats(): { free: number; premium: number; freeRequests: number; premiumRequests: number } {
    return {
      free: this.freeTokens.length,
      premium: this.premiumTokens.length,
      freeRequests: this.freeTokens.reduce((sum, t) => sum + t.requestCount, 0),
      premiumRequests: this.premiumTokens.reduce((sum, t) => sum + t.requestCount, 0),
    };
  }
}

