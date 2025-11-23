import { GoogleGenerativeAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { GeminiBalancer } from './gemini-balancer';
import { database } from './database';
import { logger } from './logger';

interface GenerateContentOptions {
  prompt: string | (string | any)[];
  isPremium?: boolean;
  maxRetries?: number;
  behaviorMode?: string;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ProhibitedContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProhibitedContentError';
  }
}

export class GeminiClient {
  private balancer: GeminiBalancer;
  private apiLimitMonitor?: any;

  constructor(balancer: GeminiBalancer, apiLimitMonitor?: any) {
    this.balancer = balancer;
    this.apiLimitMonitor = apiLimitMonitor;
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

  private getSafetySettings(behaviorMode?: string): any[] {
    if (behaviorMode === 'nsfw') {
      return [
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ];
    }
    return [];
  }

  async generateContent(options: GenerateContentOptions): Promise<string> {
    const { prompt, isPremium = false, maxRetries = 3, behaviorMode } = options;
    let lastError: any = null;
    const usedTokens = new Set<string>();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const genAI = this.balancer.getToken(isPremium);
        const safetySettings = this.getSafetySettings(behaviorMode);
        const modelConfig: any = { model: 'gemini-2.5-flash' };
        if (safetySettings.length > 0) {
          modelConfig.safetySettings = safetySettings;
        }
        const model = genAI.getGenerativeModel(modelConfig);
        
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
        
        const blockReason = error?.response?.promptFeedback?.blockReason;
        if (blockReason === 'PROHIBITED_CONTENT') {
          throw new ProhibitedContentError('PROHIBITED_CONTENT');
        }
        
        const errorCode = error.code || error.status || error.statusCode;
        const is429 = errorCode === 429 || 
                     error.message?.toLowerCase().includes('429') ||
                     error.message?.toLowerCase().includes('too many requests') ||
                     error.message?.toLowerCase().includes('rate limit');
        
        if (is429) {
          try {
            await database.recordApiError('gemini_429', 429);
            logger.warn('Записана ошибка 429 от Gemini API', { attempt: attempt + 1, maxRetries });
          } catch (dbError) {
            logger.error('Ошибка при записи ошибки 429 в базу данных', dbError);
          }
        }
        
        if (is429) {
          const genAI = this.balancer.getToken(isPremium);
          const tokenKey = this.getTokenKey(genAI, isPremium);
          
          if (tokenKey && !isPremium && this.apiLimitMonitor) {
            this.apiLimitMonitor.markKeyExhausted(tokenKey);
            logger.warn('Ключ API исчерпал лимит (429)', { key: tokenKey.substring(0, 10) + '...' });
          }
          
          if (!isPremium) {
            const availableKey = this.balancer.getAvailableFreeKey();
            if (!availableKey) {
              if (attempt === maxRetries - 1) {
                try {
                  await database.recordApiError('gemini_429', 429);
                  logger.warn('Все FREE ключи исчерпали лимит', { attempt: attempt + 1, maxRetries });
                } catch (dbError) {
                  logger.error('Ошибка при записи ошибки 429 в базу данных', dbError);
                }
                throw new RateLimitError('API rate limit exceeded');
              }
            } else {
              if (tokenKey) {
                logger.warn(`Ошибка 429, переключаюсь на доступный ключ`, { 
                  attempt: attempt + 1, 
                  maxRetries,
                  oldKey: tokenKey.substring(0, 10) + '...',
                  newKey: availableKey.substring(0, 10) + '...'
                });
                this.balancer.markTokenUnavailable(tokenKey, isPremium);
                usedTokens.add(tokenKey);
                
                if (attempt < maxRetries - 1) {
                  await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                  continue;
                }
              }
            }
          } else {
            if (attempt === maxRetries - 1) {
              throw new RateLimitError('API rate limit exceeded');
            }
          }
        }
        
        if (this.isRetryableError(error) && !is429) {
          const genAI = this.balancer.getToken(isPremium);
          const tokenKey = this.getTokenKey(genAI, isPremium);
          
          if (tokenKey) {
            logger.warn(`Ошибка перегрузки API (попытка ${attempt + 1}/${maxRetries}), пробую другой токен...`);
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

  getModel(isPremium: boolean = false, behaviorMode?: string): GenerativeModel {
    const genAI = this.balancer.getToken(isPremium);
    const safetySettings = this.getSafetySettings(behaviorMode);
    const modelConfig: any = { model: 'gemini-2.5-flash' };
    if (safetySettings.length > 0) {
      modelConfig.safetySettings = safetySettings;
    }
    return genAI.getGenerativeModel(modelConfig);
  }
}

