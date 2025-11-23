import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { GeminiBalancer } from './gemini-balancer';

interface GenerateContentOptions {
  prompt: string | (string | any)[];
  isPremium?: boolean;
  maxRetries?: number;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class GeminiClient {
  private balancer: GeminiBalancer;

  constructor(balancer: GeminiBalancer) {
    this.balancer = balancer;
  }

  private isRetryableError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || error.status || error.statusCode;
    
    // Проверяем коды ошибок перегрузки
    if (errorCode === 503 || errorCode === 429 || errorCode === 500) {
      return true;
    }
    
    // Проверяем сообщения об ошибках
    const retryableMessages = [
      '503',
      '429',
      '500',
      'service unavailable',
      'too many requests',
      'rate limit',
      'quota exceeded',
      'overloaded',
      'resource exhausted',
      'backend error',
      'internal error'
    ];
    
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  private getTokenKey(api: GoogleGenerativeAI, isPremium: boolean): string | null {
    try {
      const tokens = isPremium ? (this.balancer as any).premiumTokens : (this.balancer as any).freeTokens;
      const token = tokens.find((t: any) => t.api === api);
      return token?.key || null;
    } catch {
      return null;
    }
  }

  async generateContent(options: GenerateContentOptions): Promise<string> {
    const { prompt, isPremium = false, maxRetries = 3 } = options;
    let lastError: any = null;
    const usedTokens = new Set<string>();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const genAI = this.balancer.getToken(isPremium);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const tokenKey = this.getTokenKey(genAI, isPremium);
        if (tokenKey) {
          usedTokens.add(tokenKey);
        }

        const result = await model.generateContent(Array.isArray(prompt) ? prompt : [prompt]);
        const response = await result.response;
        const text = response.text();

        return text;
      } catch (error: any) {
        lastError = error;
        
        const errorCode = error.code || error.status || error.statusCode;
        const is429 = errorCode === 429 || 
                     error.message?.toLowerCase().includes('429') ||
                     error.message?.toLowerCase().includes('too many requests') ||
                     error.message?.toLowerCase().includes('rate limit');
        
        if (is429 && attempt === maxRetries - 1) {
          throw new RateLimitError('API rate limit exceeded');
        }
        
        if (this.isRetryableError(error)) {
          const genAI = this.balancer.getToken(isPremium);
          const tokenKey = this.getTokenKey(genAI, isPremium);
          
          if (tokenKey) {
            console.log(`⚠️ Ошибка перегрузки API (попытка ${attempt + 1}/${maxRetries}), пробую другой токен...`);
            this.balancer.markTokenUnavailable(tokenKey, isPremium);
            usedTokens.add(tokenKey);
            
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
              continue;
            }
          }
        }
        
        throw error;
      }
    }

    throw lastError || new Error('Не удалось выполнить запрос после всех попыток');
  }

  getModel(isPremium: boolean = false): GenerativeModel {
    const genAI = this.balancer.getToken(isPremium);
    return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }
}

