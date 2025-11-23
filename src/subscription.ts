import { Telegraf } from 'telegraf';
import { database } from './database';
import { config } from './config';

export class SubscriptionManager {
  private bot: Telegraf;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  async checkUserSubscription(userId: number): Promise<boolean> {
    try {
      if (!config.tributeChannelId) return false;
      
      const chatMember = await this.bot.telegram.getChatMember(config.tributeChannelId, userId);
      const isMember = ['member', 'administrator', 'creator'].includes(chatMember.status);
      
      if (isMember) {
        const user = await database.getUser(userId);
        if (!user || !user.is_premium) {
          const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
          await database.setUserPremium(userId, true, expiresAt);
        }
        return true;
      } else {
        await database.setUserPremium(userId, false);
        return false;
      }
    } catch (error) {
      console.error('Ошибка при проверке подписки:', error);
      return await database.checkSubscription(userId);
    }
  }

  getSubscriptionPrices(): { type: string; months: number; price: number; discount: number }[] {
    return [
      { type: '1_month', months: 1, price: 500, discount: 0 },
      { type: '3_months', months: 3, price: 1350, discount: 10 },
      { type: '6_months', months: 6, price: 2400, discount: 20 },
      { type: '12_months', months: 12, price: 4200, discount: 30 },
    ];
  }

  getPaymentLink(subscriptionType: string): string {
    switch (subscriptionType) {
      case '1_month':
        return config.tributePaymentLink1Month;
      case '3_months':
        return config.tributePaymentLink3Months;
      case '6_months':
        return config.tributePaymentLink6Months;
      case '12_months':
        return config.tributePaymentLink12Months;
      case 'trial':
        return config.tributePaymentLinkTrial;
      default:
        return config.tributePaymentLink1Month;
    }
  }

  async canUseTrial(userId: number): Promise<boolean> {
    const hasUsed = await database.hasUsedTrial(userId);
    const isPremium = await this.checkUserSubscription(userId);
    return !hasUsed && !isPremium;
  }

  async activateTrial(userId: number): Promise<boolean> {
    if (!(await this.canUseTrial(userId))) {
      return false;
    }
    await database.createTrialSubscription(userId);
    return true;
  }

  startPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        const users = await database.getAllUsers();
        for (const user of users) {
          if (user.is_premium) {
            await this.checkUserSubscription(user.user_id);
          }
        }
      } catch (error) {
        console.error('Ошибка при периодической проверке подписок:', error);
      }
    }, config.subscriptionCheckInterval);
  }

  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

