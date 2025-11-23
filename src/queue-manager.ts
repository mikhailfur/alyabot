import { Telegraf } from 'telegraf';
import { ApiLimitMonitor } from './api-limit-monitor';
import { logger } from './logger';

interface QueueItem {
  userId: number;
  chatId: number;
  message: string;
  timestamp: number;
  queueMessageId?: number;
  resolve: (value: void) => void;
  reject: (error: Error) => void;
}

export class QueueManager {
  private queue: QueueItem[] = [];
  private processing = false;
  private updateIntervals: Map<number, NodeJS.Timeout> = new Map();

  constructor(
    private bot: Telegraf,
    private apiLimitMonitor: ApiLimitMonitor
  ) {}

  async addToQueue(
    userId: number,
    chatId: number,
    message: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const queueItem: QueueItem = {
        userId,
        chatId,
        message,
        timestamp: Date.now(),
        resolve,
        reject,
      };

      this.queue.push(queueItem);
      this.sendQueueMessage(queueItem);
      this.processQueue();
    });
  }

  private calculateWaitTime(loadPercentage: number): number {
    if (loadPercentage < 40) {
      return 0;
    } else if (loadPercentage < 60) {
      const baseTime = 60 * 1000;
      const additionalTime = ((loadPercentage - 40) / 20) * 60 * 1000;
      return Math.min(baseTime + additionalTime, 2 * 60 * 1000);
    } else if (loadPercentage < 80) {
      const baseTime = 2 * 60 * 1000;
      const additionalTime = ((loadPercentage - 60) / 20) * 60 * 1000;
      return Math.min(baseTime + additionalTime, 3 * 60 * 1000);
    } else if (loadPercentage < 95) {
      const baseTime = 3 * 60 * 1000;
      const additionalTime = ((loadPercentage - 80) / 15) * 60 * 1000;
      return Math.min(baseTime + additionalTime, 5 * 60 * 1000);
    } else {
      return 5 * 60 * 1000;
    }
  }

  private getPositionInQueue(userId: number): number {
    return this.queue.findIndex(item => item.userId === userId) + 1;
  }

  private async sendQueueMessage(item: QueueItem): Promise<void> {
    const loadPercentage = this.apiLimitMonitor.getLoadPercentage();
    const waitTime = this.calculateWaitTime(loadPercentage);

    if (waitTime === 0) {
      return;
    }

    const position = this.getPositionInQueue(item.userId);
    const estimatedWait = Math.ceil(waitTime / 1000);

    const message = `⏳ *Ожидание в очереди*\n\n` +
      `📊 Загруженность API: ${loadPercentage.toFixed(1)}%\n` +
      `📍 Ваша позиция: ${position}\n` +
      `⏱ Ожидаемое время: ~${estimatedWait} сек\n\n` +
      `⏰ Ваш запрос будет обработан автоматически...`;

    try {
      const sentMessage = await this.bot.telegram.sendMessage(
        item.chatId,
        message,
        { parse_mode: 'Markdown' }
      );
      
      item.queueMessageId = sentMessage.message_id;
      this.startQueueMessageUpdates(item);
    } catch (error) {
      logger.error('Ошибка при отправке сообщения об очереди', error);
    }
  }

  private startQueueMessageUpdates(item: QueueItem): void {
    if (!item.queueMessageId) return;

    const updateInterval = setInterval(async () => {
      try {
        const loadPercentage = this.apiLimitMonitor.getLoadPercentage();
        const waitTime = this.calculateWaitTime(loadPercentage);
        const position = this.getPositionInQueue(item.userId);
        const estimatedWait = Math.max(0, Math.ceil(waitTime / 1000));

        if (estimatedWait === 0 || position === 0) {
          clearInterval(updateInterval);
          this.updateIntervals.delete(item.userId);
          return;
        }

        const message = `⏳ *Ожидание в очереди*\n\n` +
          `📊 Загруженность API: ${loadPercentage.toFixed(1)}%\n` +
          `📍 Ваша позиция: ${position}\n` +
          `⏱ Ожидаемое время: ~${estimatedWait} сек\n\n` +
          `⏰ Ваш запрос будет обработан автоматически...`;

        await this.bot.telegram.editMessageText(
          item.chatId,
          item.queueMessageId,
          undefined,
          message,
          { parse_mode: 'Markdown' }
        );
      } catch (error: any) {
        if (error.code !== 400 && !error.message?.includes('message is not modified')) {
          clearInterval(updateInterval);
          this.updateIntervals.delete(item.userId);
        }
      }
    }, 5000);

    this.updateIntervals.set(item.userId, updateInterval);
  }

  private async deleteQueueMessage(item: QueueItem): Promise<void> {
    if (item.queueMessageId) {
      try {
        await this.bot.telegram.deleteMessage(item.chatId, item.queueMessageId);
      } catch (error) {
      }
    }

    const interval = this.updateIntervals.get(item.userId);
    if (interval) {
      clearInterval(interval);
      this.updateIntervals.delete(item.userId);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];
      const loadPercentage = this.apiLimitMonitor.getLoadPercentage();
      const waitTime = this.calculateWaitTime(loadPercentage);

      if (waitTime > 0 && this.queue.length > 0) {
        const actualWait = Math.min(waitTime, 5 * 60 * 1000);
        await new Promise(resolve => setTimeout(resolve, actualWait));
      }

      const queueItem = this.queue.shift();
      if (queueItem) {
        await this.deleteQueueMessage(queueItem);
        queueItem.resolve();
      }
    }

    this.processing = false;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  clearQueue(): void {
    for (const item of this.queue) {
      this.deleteQueueMessage(item);
      item.reject(new Error('Очередь очищена'));
    }
    this.queue = [];
  }
}

