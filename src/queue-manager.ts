import { Telegraf } from 'telegraf';
import { GeminiBalancer } from './gemini-balancer';

interface QueueItem {
  userId: number;
  chatId: number;
  messageId: number;
  queueMessageId: number;
  startTime: number;
  estimatedWaitTime: number;
  resolve: (value: void) => void;
  reject: (error: Error) => void;
}

export class QueueManager {
  private queue: QueueItem[] = [];
  private processing = false;
  private bot: Telegraf;
  private balancer: GeminiBalancer;
  private updateInterval: NodeJS.Timeout | null = null;
  private usersInQueue: Set<number> = new Set();

  constructor(bot: Telegraf, balancer: GeminiBalancer) {
    this.bot = bot;
    this.balancer = balancer;
    this.startUpdateInterval();
  }

  private calculateWaitTime(percentage: number): number {
    if (percentage < 40) {
      return 0;
    } else if (percentage >= 40 && percentage < 60) {
      return 60 + Math.random() * 60;
    } else if (percentage >= 60 && percentage < 80) {
      return 120 + Math.random() * 60;
    } else if (percentage >= 80) {
      return Math.min(300, 180 + Math.random() * 120);
    }
    return 0;
  }

  isUserInQueue(userId: number): boolean {
    return this.usersInQueue.has(userId);
  }

  async addToQueue(userId: number, chatId: number): Promise<void> {
    if (this.usersInQueue.has(userId)) {
      throw new Error('Пользователь уже в очереди');
    }

    return new Promise((resolve, reject) => {
      const quota = this.balancer.getTotalFreeQuota();
      const waitTime = this.calculateWaitTime(quota.percentage);

      console.log(`[Queue] Загруженность: ${quota.percentage.toFixed(2)}%, Время ожидания: ${waitTime}с, Осталось: ${quota.remaining}/${quota.total}, Использовано: ${quota.used}`);

      if (waitTime === 0) {
        console.log(`[Queue] Очередь не требуется, загруженность ${quota.percentage.toFixed(2)}% < 40%`);
        resolve();
        return;
      }

      console.log(`[Queue] Добавление в очередь: userId=${userId}, waitTime=${waitTime}с`);

      this.usersInQueue.add(userId);

      const queueItem: QueueItem = {
        userId,
        chatId,
        messageId: 0,
        queueMessageId: 0,
        startTime: Date.now(),
        estimatedWaitTime: waitTime * 1000,
        resolve: () => {
          this.usersInQueue.delete(userId);
          resolve();
        },
        reject: (error: Error) => {
          this.usersInQueue.delete(userId);
          reject(error);
        },
      };

      this.queue.push(queueItem);
      this.sendQueueMessage(queueItem).catch(error => {
        console.error('Ошибка при отправке сообщения об очереди:', error);
      });
      this.processQueue();
    });
  }

  private async sendQueueMessage(item: QueueItem): Promise<void> {
    try {
      const waitSeconds = Math.ceil(item.estimatedWaitTime / 1000);
      const minutes = Math.floor(waitSeconds / 60);
      const seconds = waitSeconds % 60;
      
      const timeText = minutes > 0 
        ? `${minutes} ${this.pluralize(minutes, 'минуту', 'минуты', 'минут')} ${seconds > 0 ? `и ${seconds} ${this.pluralize(seconds, 'секунду', 'секунды', 'секунд')}` : ''}`.trim()
        : `${seconds} ${this.pluralize(seconds, 'секунду', 'секунды', 'секунд')}`;

      const message = `⏳ *Ожидание в очереди*\n\n` +
        `📊 Твой запрос поставлен в очередь\n` +
        `⏰ Примерное время ожидания: *${timeText}*\n\n` +
        `💡 Это сообщение будет автоматически обновляться`;

      const sent = await this.bot.telegram.sendMessage(item.chatId, message, {
        parse_mode: 'Markdown',
      });

      item.queueMessageId = sent.message_id;
    } catch (error) {
      console.error('Ошибка при отправке сообщения об очереди:', error);
    }
  }

  private async updateQueueMessage(item: QueueItem): Promise<void> {
    if (!item.queueMessageId) return;

    try {
      const elapsed = Date.now() - item.startTime;
      const remaining = Math.max(0, item.estimatedWaitTime - elapsed);
      const waitSeconds = Math.ceil(remaining / 1000);
      
      if (waitSeconds <= 0) {
        return;
      }

      const minutes = Math.floor(waitSeconds / 60);
      const seconds = waitSeconds % 60;
      
      const timeText = minutes > 0 
        ? `${minutes} ${this.pluralize(minutes, 'минуту', 'минуты', 'минут')} ${seconds > 0 ? `и ${seconds} ${this.pluralize(seconds, 'секунду', 'секунды', 'секунд')}` : ''}`.trim()
        : `${seconds} ${this.pluralize(seconds, 'секунду', 'секунды', 'секунд')}`;

      const position = this.queue.indexOf(item) + 1;
      const message = `⏳ *Ожидание в очереди*\n\n` +
        `📊 Твой запрос в очереди (позиция: ${position})\n` +
        `⏰ Осталось ждать: *${timeText}*\n\n` +
        `💡 Это сообщение будет автоматически обновляться`;

      await this.bot.telegram.editMessageText(
        item.chatId,
        item.queueMessageId,
        undefined,
        message,
        { parse_mode: 'Markdown' }
      );
    } catch (error: any) {
      if (!error.message?.includes('message is not modified') && 
          !error.message?.includes('message to edit not found')) {
        console.error('Ошибка при обновлении сообщения об очереди:', error);
      }
    }
  }

  private async deleteQueueMessage(item: QueueItem): Promise<void> {
    if (!item.queueMessageId) return;

    try {
      await this.bot.telegram.deleteMessage(item.chatId, item.queueMessageId);
    } catch (error: any) {
      if (!error.message?.includes('message to delete not found')) {
        console.error('Ошибка при удалении сообщения об очереди:', error);
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];
      const elapsed = Date.now() - item.startTime;

      if (elapsed >= item.estimatedWaitTime) {
        this.queue.shift();
        this.deleteQueueMessage(item).catch(error => {
          console.error('Ошибка при удалении сообщения об очереди:', error);
        });
        item.resolve();
      } else {
        break;
      }
    }

    this.processing = false;
  }

  private startUpdateInterval(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(async () => {
      for (const item of this.queue) {
        await this.updateQueueMessage(item);
      }
      this.processQueue();
    }, 5000);
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

  getQueueLength(): number {
    return this.queue.length;
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

