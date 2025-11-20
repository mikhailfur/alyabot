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
  private currentFreeIndex: number = 0;
  private currentPremiumIndex: number = 0;

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

  private getNextToken(tokens: TokenInstance[], currentIndex: number): { token: TokenInstance; newIndex: number } {
    if (tokens.length === 0) {
      throw new Error('Нет доступных токенов');
    }

    const availableTokens = tokens.filter(t => t.isAvailable);
    if (availableTokens.length === 0) {
      availableTokens.push(...tokens);
      tokens.forEach(t => t.isAvailable = true);
    }

    const token = availableTokens[currentIndex % availableTokens.length];
    token.lastUsed = Date.now();
    token.requestCount++;
    
    const newIndex = (currentIndex + 1) % availableTokens.length;
    return { token, newIndex };
  }

  getFreeToken(): GoogleGenerativeAI {
    const { token, newIndex } = this.getNextToken(this.freeTokens, this.currentFreeIndex);
    this.currentFreeIndex = newIndex;
    return token.api;
  }

  getPremiumToken(): GoogleGenerativeAI {
    if (this.premiumTokens.length === 0) {
      return this.getFreeToken();
    }
    
    const { token, newIndex } = this.getNextToken(this.premiumTokens, this.currentPremiumIndex);
    this.currentPremiumIndex = newIndex;
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

