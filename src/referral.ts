import { Telegraf, Markup } from 'telegraf';
import { database } from './database';
import { config } from './config';

export class ReferralManager {
  private bot: Telegraf;
  public readonly MIN_MESSAGES = 5;
  public readonly REFERER_BONUS_HOURS = 48;
  public readonly REFEREE_BONUS_HOURS = 24;

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  async checkChannelSubscription(userId: number): Promise<boolean> {
    if (!config.referalChannelId) {
      return true;
    }

    try {
      const chatMember = await this.bot.telegram.getChatMember(config.referalChannelId, userId);
      return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
      console.error('Ошибка при проверке подписки на канал:', error);
      return false;
    }
  }

  async getRefereeMessagesCount(refereeId: number): Promise<number> {
    const stats = await database.getUserStats(refereeId);
    return stats.totalMessages || 0;
  }

  async registerReferral(referrerId: number, refereeId: number): Promise<boolean> {
    if (referrerId === refereeId) {
      return false;
    }

    const existingReferral = await database.getReferralByReferee(refereeId);
    if (existingReferral) {
      return false;
    }

    try {
      await database.createReferral(referrerId, refereeId);
      return true;
    } catch (error) {
      console.error('Ошибка при регистрации реферала:', error);
      return false;
    }
  }

  async checkAndGiveBonuses(refereeId: number): Promise<{ referrerBonus: boolean; refereeBonus: boolean }> {
    const referral = await database.getReferralByReferee(refereeId);
    if (!referral) {
      return { referrerBonus: false, refereeBonus: false };
    }

    const messagesCount = await this.getRefereeMessagesCount(refereeId);
    const isSubscribed = await this.checkChannelSubscription(refereeId);
    const conditionsMet = messagesCount >= this.MIN_MESSAGES && isSubscribed;

    if (!conditionsMet) {
      await database.updateRefereeMessagesCount(refereeId, messagesCount);
      await database.updateRefereeSubscribed(refereeId, isSubscribed);
      return { referrerBonus: false, refereeBonus: false };
    }

    const result = { referrerBonus: false, refereeBonus: false };

    if (!referral.referee_bonus_given) {
      await database.createReferralSubscription(refereeId, this.REFEREE_BONUS_HOURS, true);
      await database.giveRefereeBonus(refereeId);
      result.refereeBonus = true;
    }

    if (!referral.referrer_bonus_given) {
      const user = await database.getUser(referral.referrer_id);
      if (user) {
        await database.createReferralSubscription(referral.referrer_id, this.REFERER_BONUS_HOURS, false);
        await database.giveReferrerBonus(referral.referrer_id, refereeId);
        result.referrerBonus = true;
      }
    }

    return result;
  }

  async getReferralLink(referrerId: number): Promise<string> {
    const botInfo = await this.bot.telegram.getMe();
    return `https://t.me/${botInfo.username}?start=ref_${referrerId}`;
  }

  async getReferralsCount(referrerId: number): Promise<number> {
    return await database.getReferrerReferralsCount(referrerId);
  }

  async sendChannelSubscriptionReminder(ctx: any, userId: number): Promise<void> {
    if (!config.referalChannelLink) {
      return;
    }

    const referral = await database.getReferralByReferee(userId);
    if (!referral || referral.referee_bonus_given) {
      return;
    }

    const isSubscribed = await this.checkChannelSubscription(userId);
    if (!isSubscribed) {
      await ctx.reply(
        `📢 *Чтобы получить бонусные часы Premium, подпишись на наш канал!*\n\n` +
        `Подписка бесплатна, а за это ты получишь ${this.REFEREE_BONUS_HOURS} часов Premium 🎁`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('📢 Подписаться на канал', config.referalChannelLink)],
            [Markup.button.callback('✅ Проверить подписку', 'check_subscription')],
          ]),
        }
      );
    }
  }
}

