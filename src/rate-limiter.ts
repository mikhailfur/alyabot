interface MessageRecord {
  timestamp: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  cooldownEnd?: number;
}

export class RateLimiter {
  private messageHistory: Map<number, MessageRecord[]> = new Map();
  private cooldowns: Map<number, number> = new Map();
  
  private readonly MESSAGE_LIMIT = 50;
  private readonly TIME_WINDOW_MS = 4 * 60 * 60 * 1000;
  private readonly COOLDOWN_MS = 2 * 60 * 60 * 1000;

  canSendMessage(userId: number): RateLimitResult {
    const now = Date.now();

    const cooldownEnd = this.cooldowns.get(userId);
    if (cooldownEnd && now < cooldownEnd) {
      return {
        allowed: false,
        remaining: 0,
        cooldownEnd
      };
    }

    if (cooldownEnd && now >= cooldownEnd) {
      this.cooldowns.delete(userId);
    }

    const messages = this.messageHistory.get(userId) || [];
    const windowStart = now - this.TIME_WINDOW_MS;
    const recentMessages = messages.filter(msg => msg.timestamp > windowStart);

    if (recentMessages.length >= this.MESSAGE_LIMIT) {
      const cooldownEndTime = now + this.COOLDOWN_MS;
      this.cooldowns.set(userId, cooldownEndTime);
      
      return {
        allowed: false,
        remaining: 0,
        cooldownEnd: cooldownEndTime
      };
    }

    return {
      allowed: true,
      remaining: this.MESSAGE_LIMIT - recentMessages.length
    };
  }

  recordMessage(userId: number): void {
    const now = Date.now();
    const messages = this.messageHistory.get(userId) || [];
    
    messages.push({ timestamp: now });
    
    const windowStart = now - this.TIME_WINDOW_MS;
    const filteredMessages = messages.filter(msg => msg.timestamp > windowStart);
    
    this.messageHistory.set(userId, filteredMessages);
  }

  formatTimeRemaining(ms: number): string {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    
    if (hours > 0) {
      return `${hours} ${this.pluralize(hours, 'час', 'часа', 'часов')} ${minutes > 0 ? `и ${minutes} ${this.pluralize(minutes, 'минуту', 'минуты', 'минут')}` : ''}`.trim();
    }
    
    return `${minutes} ${this.pluralize(minutes, 'минуту', 'минуты', 'минут')}`;
  }

  private pluralize(count: number, one: string, few: string, many: string): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    
    if (mod100 >= 11 && mod100 <= 19) {
      return many;
    }
    
    if (mod10 === 1) {
      return one;
    }
    
    if (mod10 >= 2 && mod10 <= 4) {
      return few;
    }
    
    return many;
  }

  clearUserHistory(userId: number): void {
    this.messageHistory.delete(userId);
    this.cooldowns.delete(userId);
  }
}

