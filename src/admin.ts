import { Telegraf, Markup } from 'telegraf';
import { database } from './database';
import { config } from './config';

export class AdminPanel {
  private bot: Telegraf;
  private sessions: Map<number, any> = new Map();

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  isAdmin(userId: number): boolean {
    return config.adminIds.includes(userId);
  }

  private escapeMarkdown(text: string): string {
    if (!text) return '';
    return text
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/~/g, '\\~')
      .replace(/`/g, '\\`');
  }

  private async safeEditMessage(ctx: any, message: string, keyboard: any): Promise<void> {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } catch (error: any) {
      const errorDesc = error?.response?.description || '';
      if (errorDesc.includes('message is not modified')) {
        return;
      }
      if (errorDesc.includes('message to edit not found') || errorDesc.includes('message can\'t be edited')) {
        try {
          await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...keyboard,
          });
        } catch (e) {
          console.error('Ошибка при отправке сообщения:', e);
        }
        return;
      }
      if (errorDesc.includes('can\'t parse entities')) {
        console.error('Ошибка парсинга Markdown:', errorDesc);
        console.error('Проблемное сообщение:', message.substring(0, 500));
        try {
          await ctx.editMessageText(message, {
            parse_mode: undefined,
            ...keyboard,
          });
        } catch (e: any) {
          console.error('Ошибка при отправке без Markdown:', e);
          try {
            await ctx.reply(message.replace(/[*_`[\]()~]/g, ''), {
              parse_mode: undefined,
              ...keyboard,
            });
          } catch (e2) {
            console.error('Критическая ошибка при отправке сообщения:', e2);
          }
        }
        return;
      }
      console.error('Ошибка при редактировании сообщения:', error);
      throw error;
    }
  }

  private async safeReply(ctx: any, message: string, keyboard?: any): Promise<void> {
    try {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...(keyboard || {}),
      });
    } catch (error: any) {
      const errorDesc = error?.response?.description || '';
      if (errorDesc.includes('can\'t parse entities')) {
        console.error('Ошибка парсинга Markdown:', errorDesc);
        console.error('Проблемное сообщение:', message.substring(0, 500));
        try {
          await ctx.reply(message, {
            parse_mode: undefined,
            ...(keyboard || {}),
          });
        } catch (e) {
          console.error('Ошибка при отправке без Markdown:', e);
        }
      } else {
        console.error('Ошибка при отправке сообщения:', error);
      }
    }
  }

  async showAdminPanel(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) {
        await this.safeReply(ctx, 'У вас нет доступа к админ-панели');
        return;
      }

    const stats = await database.getUsersStats();
    const users = await database.getAllUsers();

    const modelStats = users.reduce((acc: Record<string, number>, u: { model_type?: string | null }) => {
      const model = u.model_type || 'auto';
      acc[model] = (acc[model] || 0) + 1;
      return acc;
    }, {});

    const message = `🔐 *Админ-панель*\n\n` +
      `📊 *Статистика:*\n` +
      `👥 Всего пользователей: ${stats.total_users || 0}\n` +
      `⭐ Premium пользователей: ${stats.premium_users || 0}\n` +
      `🟢 Активных за 24ч: ${stats.active_users || 0}\n` +
      `💬 Всего сообщений: ${stats.total_messages || 0}\n\n` +
      `Выберите действие:`;

    let modelInfo = `\n🤖 *Модели:*\n`;
    for (const [model, count] of Object.entries(modelStats)) {
      const modelName = model === 'auto' ? 'Авто' : model === 'pro' ? 'Pro' : 'Flash';
      modelInfo += `  ${modelName}: ${count}\n`;
    }

      await this.safeEditMessage(ctx, message + modelInfo, Markup.inlineKeyboard([
        [Markup.button.callback('👥 Список пользователей', 'admin_users')],
        [Markup.button.callback('⭐ Premium пользователи', 'admin_premium')],
        [Markup.button.callback('🤖 Управление моделями', 'admin_models')],
        [Markup.button.callback('🔗 Реферальные ссылки', 'admin_referrals')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('🧹 Очистить заблокированных', 'admin_cleanup_blocked')],
        [Markup.button.callback('📊 Детальная статистика', 'admin_stats')],
        [Markup.button.callback('🔄 Обновить', 'admin_refresh')],
      ]));
    } catch (error) {
      console.error('Ошибка в showAdminPanel:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке админ-панели');
    }
  }

  async showUsersList(ctx: any, page: number = 0): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const users = await database.getAllUsers();
    const pageSize = 10;
    const totalPages = Math.ceil(users.length / pageSize);
    const pageUsers = users.slice(page * pageSize, (page + 1) * pageSize);

    let message = `👥 *Список пользователей* (${users.length})\n\n`;
    
    for (const user of pageUsers) {
      const premium = user.is_premium ? '⭐' : '';
      const username = user.username ? `@${user.username}` : user.first_name || 'Без имени';
      const lastActive = user.last_active 
        ? new Date(user.last_active).toLocaleDateString('ru-RU')
        : 'Никогда';
      const modelType = user.model_type || (user.is_premium ? 'pro (auto)' : 'flash (auto)');
      const referralInfo = user.referral_source ? ` | 🔗 Источник: ${this.escapeMarkdown(user.referral_source)}` : '';
      const safeUsername = this.escapeMarkdown(username);
      const safeModelType = this.escapeMarkdown(modelType);
      message += `${premium} ${safeUsername} (ID: ${user.user_id})\n`;
      message += `   Сообщений: ${user.total_messages || 0} | Модель: ${safeModelType}${referralInfo}\n`;
      message += `   Активен: ${lastActive}\n\n`;
    }

    message += `\nСтраница ${page + 1} из ${totalPages}\n\n`;
    message += `Нажмите на пользователя для управления моделью`;

    const keyboard = [];
    for (const user of pageUsers) {
      const username = user.username ? `@${user.username}` : user.first_name || `ID:${user.user_id}`;
      keyboard.push([Markup.button.callback(`👤 ${username}`, `admin_user_${user.user_id}`)]);
    }
    
    if (page > 0) {
      keyboard.push([Markup.button.callback('◀️ Назад', `admin_users_page_${page - 1}`)]);
    }
    if (page < totalPages - 1) {
      keyboard.push([Markup.button.callback('Вперёд ▶️', `admin_users_page_${page + 1}`)]);
    }
      keyboard.push([Markup.button.callback('🔙 Назад', 'admin_panel')]);

      await this.safeEditMessage(ctx, message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      console.error('Ошибка в showUsersList:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке списка пользователей');
    }
  }

  async showUserModelSettings(ctx: any, userId: number): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const user = await database.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден');
      return;
    }

    const username = user.username ? `@${user.username}` : user.first_name || `ID:${user.user_id}`;
    const currentModel = user.model_type || (user.is_premium ? 'pro (авто)' : 'flash (авто)');
    const safeUsername = this.escapeMarkdown(username);
    const safeModel = this.escapeMarkdown(currentModel);

    const message = `⚙️ *Управление моделью пользователя*\n\n` +
      `👤 Пользователь: ${safeUsername}\n` +
      `⭐ Premium: ${user.is_premium ? 'Да' : 'Нет'}\n` +
      `🤖 Текущая модель: ${safeModel}\n\n` +
      `Выберите модель для пользователя:`;

      await this.safeEditMessage(ctx, message, Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Gemini 2.5 Pro', `admin_set_model_${userId}_pro`)],
        [Markup.button.callback('⚡ Gemini 2.5 Flash', `admin_set_model_${userId}_flash`)],
        [Markup.button.callback('🔄 Авто (по подписке)', `admin_set_model_${userId}_auto`)],
        [Markup.button.callback('🔙 Назад к списку', 'admin_users')],
      ]));
    } catch (error) {
      console.error('Ошибка в showUserModelSettings:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке настроек модели');
    }
  }

  async showPremiumUsers(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const users = await database.getAllUsers();
    const premiumUsers = users.filter(u => u.is_premium);

    let message = `⭐ *Premium пользователи* (${premiumUsers.length})\n\n`;
    
    for (const user of premiumUsers) {
      const username = user.username ? `@${user.username}` : user.first_name || 'Без имени';
      const safeUsername = this.escapeMarkdown(username);
      const expiresAt = user.subscription_until 
        ? new Date(user.subscription_until).toLocaleDateString('ru-RU')
        : 'Неизвестно';
      const safeExpiresAt = this.escapeMarkdown(expiresAt);
      const mode = user.behavior_mode || 'default';
      const safeMode = this.escapeMarkdown(mode);
      message += `⭐ ${safeUsername} (ID: ${user.user_id})\n`;
      message += `   Режим: ${safeMode} | До: ${safeExpiresAt}\n\n`;
    }

      await this.safeEditMessage(ctx, message, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_panel')],
      ]));
    } catch (error) {
      console.error('Ошибка в showPremiumUsers:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке Premium пользователей');
    }
  }

  async showModelManagement(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

    const users = await database.getAllUsers();
    const modelStats = users.reduce((acc: any, u: any) => {
      const model = u.model_type || 'auto';
      acc[model] = (acc[model] || 0) + 1;
      return acc;
    }, {});

    const premiumUsers = users.filter(u => u.is_premium);
    const freeUsers = users.filter(u => !u.is_premium);

    let message = `🤖 *Управление моделями*\n\n`;
    message += `*Статистика моделей:*\n`;
    for (const [model, count] of Object.entries(modelStats)) {
      const modelName = model === 'auto' ? 'Авто (по подписке)' : model === 'pro' ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash';
      message += `  ${modelName}: ${count} пользователей\n`;
    }

    message += `\n*Группы пользователей:*\n`;
    message += `  ⭐ Premium: ${premiumUsers.length}\n`;
    message += `  💬 Бесплатные: ${freeUsers.length}\n\n`;
    message += `Выберите действие:`;

      await this.safeEditMessage(ctx, message, Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Установить Pro для всех', 'admin_set_all_pro')],
        [Markup.button.callback('⚡ Установить Flash для всех', 'admin_set_all_flash')],
        [Markup.button.callback('🔄 Сбросить на Авто для всех', 'admin_set_all_auto')],
        [Markup.button.callback('⭐ Установить Pro для Premium', 'admin_set_premium_pro')],
        [Markup.button.callback('💬 Установить Flash для бесплатных', 'admin_set_free_flash')],
        [Markup.button.callback('🔙 Назад', 'admin_panel')],
      ]));
    } catch (error) {
      console.error('Ошибка в showModelManagement:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке управления моделями');
    }
  }

  async showDetailedStats(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

    const stats = await database.getUsersStats();
    const users = await database.getAllUsers();
    
    const modes = users.reduce((acc: any, u: any) => {
      const mode = u.behavior_mode || 'default';
      acc[mode] = (acc[mode] || 0) + 1;
      return acc;
    }, {});

    const modelStats = users.reduce((acc: any, u: any) => {
      const model = u.model_type || 'auto';
      acc[model] = (acc[model] || 0) + 1;
      return acc;
    }, {});

    let message = `📊 *Детальная статистика*\n\n`;
    message += `👥 Всего пользователей: ${stats.total_users || 0}\n`;
    message += `⭐ Premium: ${stats.premium_users || 0}\n`;
    message += `🟢 Активных (24ч): ${stats.active_users || 0}\n`;
    message += `💬 Всего сообщений: ${stats.total_messages || 0}\n\n`;
    message += `*Режимы поведения:*\n`;
    for (const [mode, count] of Object.entries(modes)) {
      message += `  ${mode}: ${count}\n`;
    }
    message += `\n*Модели:*\n`;
    for (const [model, count] of Object.entries(modelStats)) {
      const modelName = model === 'auto' ? 'Авто' : model === 'pro' ? 'Pro' : 'Flash';
      message += `  ${modelName}: ${count}\n`;
    }

      await this.safeEditMessage(ctx, message, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_panel')],
      ]));
    } catch (error) {
      console.error('Ошибка в showDetailedStats:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке статистики');
    }
  }

  setupHandlers(): void {
    this.bot.action('admin_panel', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showAdminPanel(ctx);
    });

    this.bot.action('admin_users', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showUsersList(ctx, 0);
    });

    this.bot.action(/^admin_users_page_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const page = parseInt(ctx.match[1]);
      await this.showUsersList(ctx, page);
    });

    this.bot.action(/^admin_user_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const userId = parseInt(ctx.match[1]);
      await this.showUserModelSettings(ctx, userId);
    });

    this.bot.action(/^admin_set_model_(\d+)_(pro|flash|auto)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const userId = parseInt(ctx.match[1]);
      const modelType = ctx.match[2];

      if (modelType === 'auto') {
        await database.setUserModelType(userId, null);
        await ctx.reply(`✅ Модель для пользователя установлена на автоматический выбор (по подписке)`);
      } else {
        await database.setUserModelType(userId, modelType);
        await ctx.reply(`✅ Модель для пользователя установлена на: Gemini 2.5 ${modelType === 'pro' ? 'Pro' : 'Flash'}`);
      }

      await this.showUserModelSettings(ctx, userId);
    });

    this.bot.action('admin_premium', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showPremiumUsers(ctx);
    });

    this.bot.action('admin_stats', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showDetailedStats(ctx);
    });

    this.bot.action('admin_refresh', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showAdminPanel(ctx);
    });

    this.bot.action('admin_models', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showModelManagement(ctx);
    });

    this.bot.action('admin_set_all_pro', async (ctx) => {
      await ctx.answerCbQuery();
      const users = await database.getAllUsers();
      let count = 0;
      for (const user of users) {
        await database.setUserModelType(user.user_id, 'pro');
        count++;
      }
      await ctx.reply(`✅ Модель Gemini 2.5 Pro установлена для всех ${count} пользователей`);
      await this.showModelManagement(ctx);
    });

    this.bot.action('admin_set_all_flash', async (ctx) => {
      await ctx.answerCbQuery();
      const users = await database.getAllUsers();
      let count = 0;
      for (const user of users) {
        await database.setUserModelType(user.user_id, 'flash');
        count++;
      }
      await ctx.reply(`✅ Модель Gemini 2.5 Flash установлена для всех ${count} пользователей`);
      await this.showModelManagement(ctx);
    });

    this.bot.action('admin_set_all_auto', async (ctx) => {
      await ctx.answerCbQuery();
      const users = await database.getAllUsers();
      let count = 0;
      for (const user of users) {
        await database.setUserModelType(user.user_id, null);
        count++;
      }
      await ctx.reply(`✅ Автоматический выбор модели установлен для всех ${count} пользователей`);
      await this.showModelManagement(ctx);
    });

    this.bot.action('admin_set_premium_pro', async (ctx) => {
      await ctx.answerCbQuery();
      const users = await database.getAllUsers();
      const premiumUsers = users.filter(u => u.is_premium);
      let count = 0;
      for (const user of premiumUsers) {
        await database.setUserModelType(user.user_id, 'pro');
        count++;
      }
      await ctx.reply(`✅ Модель Gemini 2.5 Pro установлена для ${count} Premium пользователей`);
      await this.showModelManagement(ctx);
    });

    this.bot.action('admin_set_free_flash', async (ctx) => {
      await ctx.answerCbQuery();
      const users = await database.getAllUsers();
      const freeUsers = users.filter(u => !u.is_premium);
      let count = 0;
      for (const user of freeUsers) {
        await database.setUserModelType(user.user_id, 'flash');
        count++;
      }
      await ctx.reply(`✅ Модель Gemini 2.5 Flash установлена для ${count} бесплатных пользователей`);
      await this.showModelManagement(ctx);
    });

    this.bot.action('admin_referrals', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showReferralLinks(ctx);
    });

    this.bot.action('admin_broadcast', async (ctx) => {
      await ctx.answerCbQuery();
      await this.startBroadcast(ctx);
    });

    this.bot.action('admin_broadcast_cancel', async (ctx) => {
      await ctx.answerCbQuery();
      this.sessions.delete(ctx.from.id);
      await this.safeReply(ctx, '❌ Создание рассылки отменено', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_panel')]
      ]));
    });

    this.bot.action('admin_broadcast_skip_media', async (ctx) => {
      await ctx.answerCbQuery();
      const session = this.sessions.get(ctx.from.id);
      if (session?.creatingBroadcast) {
        session.mediaType = null;
        session.mediaFileId = null;
        await this.askBroadcastText(ctx);
      }
    });

    this.bot.action('admin_broadcast_skip_buttons', async (ctx) => {
      await ctx.answerCbQuery();
      const session = this.sessions.get(ctx.from.id);
      if (session?.creatingBroadcast) {
        await this.confirmBroadcast(ctx);
      }
    });

    this.bot.action('admin_broadcast_send', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendBroadcast(ctx);
    });

    this.bot.action('admin_cleanup_blocked', async (ctx) => {
      await ctx.answerCbQuery();
      await this.cleanupBlockedUsers(ctx);
    });

    this.bot.action('admin_create_referral', async (ctx) => {
      await ctx.answerCbQuery();
      await this.safeReply(ctx, 
        '📝 *Создание новой реферальной ссылки*\n\n' +
        'Отправь мне название для ссылки (например: "YouTube", "Telegram канал" и т.д.)\n\n' +
        'Я автоматически создам уникальный код для ссылки.',
        Markup.inlineKeyboard([
          [Markup.button.callback('❌ Отмена', 'admin_referrals')]
        ])
      );
      this.sessions.set(ctx.from.id, { creatingReferral: true });
    });

    this.bot.action(/^admin_referral_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const linkId = parseInt(ctx.match[1]);
      await this.showReferralLinkDetails(ctx, linkId);
    });

    this.bot.action(/^admin_referral_edit_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const linkId = parseInt(ctx.match[1]);
      await this.safeReply(ctx,
        `📝 *Редактирование ссылки*\n\n` +
        `Отправь новое название для ссылки #${linkId}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('❌ Отмена', `admin_referral_${linkId}`)]
        ])
      );
      this.sessions.set(ctx.from.id, { editingReferral: linkId });
    });

    this.bot.action(/^admin_referral_toggle_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const linkId = parseInt(ctx.match[1]);
      const links = await database.getAllReferralLinks();
      const link = links.find(l => l.id === linkId);
      if (link) {
        await database.updateReferralLink(linkId, link.name, !link.is_active);
        await ctx.reply(`✅ Ссылка ${link.is_active ? 'деактивирована' : 'активирована'}`);
        await this.showReferralLinkDetails(ctx, linkId);
      }
    });

    this.bot.action(/^admin_referral_delete_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const linkId = parseInt(ctx.match[1]);
      await database.deleteReferralLink(linkId);
      await ctx.reply('✅ Ссылка удалена');
      await this.showReferralLinks(ctx);
    });

    this.bot.action(/^admin_referral_stats_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const linkId = parseInt(ctx.match[1]);
      const links = await database.getAllReferralLinks();
      const link = links.find(l => l.id === linkId);
      if (link) {
        await this.showReferralStats(ctx, link.code);
      }
    });

    this.bot.on('text', async (ctx, next) => {
      if (!this.isAdmin(ctx.from.id)) {
        return next();
      }
      
      const session = this.sessions.get(ctx.from.id);
      
      if (session?.creatingReferral) {
        const name = ctx.message.text;
        const code = this.generateReferralCode(name);
        try {
          await database.createReferralLink(code, name, ctx.from.id);
          const botUsername = (await this.bot.telegram.getMe()).username;
          const referralLink = `https://t.me/${botUsername}?start=ref_${code}`;
          
          const safeName = this.escapeMarkdown(name);
          const safeCode = this.escapeMarkdown(code);
          await ctx.reply(
            `✅ *Реферальная ссылка создана!*\n\n` +
            `📝 Название: ${safeName}\n` +
            `🔗 Код: \`${safeCode}\`\n` +
            `🔗 Ссылка: ${referralLink}`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.url('📋 Скопировать ссылку', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Познакомься с Алей!')}`)],
                [Markup.button.callback('🔙 К списку ссылок', 'admin_referrals')]
              ])
            }
          );
          this.sessions.delete(ctx.from.id);
        } catch (error: any) {
          await ctx.reply(`❌ Ошибка: ${error.message || 'Не удалось создать ссылку'}`);
          this.sessions.delete(ctx.from.id);
        }
        return;
      }

      if (session?.editingReferral) {
        const linkId = session.editingReferral;
        const name = ctx.message.text;
        const links = await database.getAllReferralLinks();
        const link = links.find(l => l.id === linkId);
        if (link) {
          await database.updateReferralLink(linkId, name, link.is_active);
          await ctx.reply('✅ Название ссылки обновлено');
          await this.showReferralLinkDetails(ctx, linkId);
        }
        this.sessions.delete(ctx.from.id);
        return;
      }

      if (session?.creatingBroadcast) {
        if (session.step === 'text') {
          if (ctx.message.text.toLowerCase().trim() === '/skip') {
            session.text = '';
            await this.askBroadcastButtons(ctx);
            return;
          }
          session.text = ctx.message.text;
          await this.askBroadcastButtons(ctx);
          return;
        }

        if (session.step === 'buttons') {
          if (ctx.message.text.toLowerCase().trim() === '/skip') {
            session.buttons = [];
            await this.confirmBroadcast(ctx);
            return;
          }
          const buttons = this.parseButtons(ctx.message.text);
          if (buttons.length > 0) {
            session.buttons = buttons;
          } else {
            await this.safeReply(ctx, '❌ Не удалось распознать кнопки. Проверь формат:\n`[Текст - ссылка]`', Markup.inlineKeyboard([
              [Markup.button.callback('⏭️ Пропустить', 'admin_broadcast_skip_buttons')],
              [Markup.button.callback('❌ Отмена', 'admin_broadcast_cancel')]
            ]));
            return;
          }
          await this.confirmBroadcast(ctx);
          return;
        }
      }

      return next();
    });

    this.bot.on('photo', async (ctx, next) => {
      if (!this.isAdmin(ctx.from.id)) {
        return next();
      }

      const session = this.sessions.get(ctx.from.id);
      if (session?.creatingBroadcast && session.step === 'media') {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        session.mediaType = 'photo';
        session.mediaFileId = photo.file_id;
        session.text = ctx.message.caption || '';
        
        if (session.text) {
          await this.askBroadcastButtons(ctx);
        } else {
          await this.askBroadcastText(ctx);
        }
        return;
      }

      return next();
    });

    this.bot.on('animation', async (ctx, next) => {
      if (!this.isAdmin(ctx.from.id)) {
        return next();
      }

      const session = this.sessions.get(ctx.from.id);
      if (session?.creatingBroadcast && session.step === 'media') {
        session.mediaType = 'animation';
        session.mediaFileId = ctx.message.animation.file_id;
        session.text = ctx.message.caption || '';
        
        if (session.text) {
          await this.askBroadcastButtons(ctx);
        } else {
          await this.askBroadcastText(ctx);
        }
        return;
      }

      return next();
    });

    this.bot.on('voice', async (ctx, next) => {
      if (!this.isAdmin(ctx.from.id)) {
        return next();
      }

      const session = this.sessions.get(ctx.from.id);
      if (session?.creatingBroadcast && session.step === 'media') {
        session.mediaType = 'voice';
        session.mediaFileId = ctx.message.voice.file_id;
        session.text = ctx.message.caption || '';
        
        if (session.text) {
          await this.askBroadcastButtons(ctx);
        } else {
          await this.askBroadcastText(ctx);
        }
        return;
      }

      return next();
    });
  }

  private generateReferralCode(name: string): string {
    const timestamp = Date.now().toString(36);
    const namePart = name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
    return `${namePart}_${timestamp}`;
  }

  async showReferralLinks(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const links = await database.getAllReferralLinks();
      
      let message = `🔗 *Реферальные ссылки*\n\n`;
      
      if (links.length === 0) {
        message += `Пока нет созданных ссылок.\nСоздай первую ссылку, чтобы отслеживать источники пользователей!`;
      } else {
        for (const link of links) {
          const status = link.is_active ? '🟢' : '🔴';
          const botUsername = (await this.bot.telegram.getMe()).username;
          const referralLink = `https://t.me/${botUsername}?start=ref_${link.code}`;
          const safeName = this.escapeMarkdown(link.name);
          const safeCode = this.escapeMarkdown(link.code);
          message += `${status} *${safeName}*\n`;
          message += `   Код: \`${safeCode}\`\n`;
          message += `   Переходов: ${link.clicks} | Регистраций: ${link.registrations}\n`;
          message += `   Ссылка: ${referralLink}\n\n`;
        }
      }

      const keyboard = [
        [Markup.button.callback('➕ Создать ссылку', 'admin_create_referral')],
      ];

      for (const link of links) {
        keyboard.push([Markup.button.callback(`${link.is_active ? '🟢' : '🔴'} ${link.name}`, `admin_referral_${link.id}`)]);
      }

      keyboard.push([Markup.button.callback('🔙 Назад', 'admin_panel')]);

      await this.safeEditMessage(ctx, message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      console.error('Ошибка в showReferralLinks:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке реферальных ссылок');
    }
  }

  async showReferralLinkDetails(ctx: any, linkId: number): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const links = await database.getAllReferralLinks();
      const link = links.find(l => l.id === linkId);
      
      if (!link) {
        await this.safeReply(ctx, '❌ Ссылка не найдена');
        return;
      }

      const botUsername = (await this.bot.telegram.getMe()).username;
      const referralLink = `https://t.me/${botUsername}?start=ref_${link.code}`;
      
      const safeName = this.escapeMarkdown(link.name);
      const safeCode = this.escapeMarkdown(link.code);
      const message = `🔗 *${safeName}*\n\n` +
        `📝 Код: \`${safeCode}\`\n` +
        `🔗 Ссылка: ${referralLink}\n\n` +
        `📊 *Статистика:*\n` +
        `👆 Переходов: ${link.clicks}\n` +
        `✅ Регистраций: ${link.registrations}\n` +
        `📅 Создана: ${new Date(link.created_at).toLocaleString('ru-RU')}\n` +
        `⚙️ Статус: ${link.is_active ? '🟢 Активна' : '🔴 Неактивна'}`;

      await this.safeEditMessage(ctx, message, Markup.inlineKeyboard([
        [Markup.button.url('📋 Скопировать ссылку', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Познакомься с Алей!')}`)],
        [Markup.button.callback('📊 Детальная статистика', `admin_referral_stats_${linkId}`)],
        [Markup.button.callback('✏️ Редактировать название', `admin_referral_edit_${linkId}`)],
        [Markup.button.callback(link.is_active ? '🔴 Деактивировать' : '🟢 Активировать', `admin_referral_toggle_${linkId}`)],
        [Markup.button.callback('❌ Удалить', `admin_referral_delete_${linkId}`)],
        [Markup.button.callback('🔙 Назад', 'admin_referrals')],
      ]));
    } catch (error) {
      console.error('Ошибка в showReferralLinkDetails:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке деталей ссылки');
    }
  }

  async showReferralStats(ctx: any, code: string): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const stats = await database.getReferralStats(code);
      const link = await database.getReferralLink(code);
      
      if (!link) {
        await this.safeReply(ctx, '❌ Ссылка не найдена');
        return;
      }

      const safeName = this.escapeMarkdown(link.name);
      let message = `📊 *Статистика: ${safeName}*\n\n` +
        `👆 Всего переходов: ${stats.clicks}\n` +
        `✅ Всего регистраций: ${stats.registrations}\n\n`;

      if (stats.users.length > 0) {
        message += `👥 *Последние пользователи:*\n\n`;
        const recentUsers = stats.users.slice(0, 20);
        for (const user of recentUsers) {
          const userData = await database.getUser(user.user_id);
          const username = userData?.username ? `@${userData.username}` : `ID: ${user.user_id}`;
          const safeUsername = this.escapeMarkdown(username);
          const status = user.registered_at ? '✅' : '👆';
          const date = user.registered_at ? new Date(user.registered_at).toLocaleString('ru-RU') : new Date(user.clicked_at).toLocaleString('ru-RU');
          const safeDate = this.escapeMarkdown(date);
          message += `${status} ${safeUsername} - ${safeDate}\n`;
        }
        if (stats.users.length > 20) {
          message += `\n... и ещё ${stats.users.length - 20} пользователей`;
        }
      }

      await this.safeReply(ctx, message, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', `admin_referral_${link.id}`)]
      ]));
    } catch (error) {
      console.error('Ошибка в showReferralStats:', error);
      await this.safeReply(ctx, '❌ Ошибка при загрузке статистики');
    }
  }

  async startBroadcast(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      this.sessions.set(ctx.from.id, {
        creatingBroadcast: true,
        step: 'media',
        mediaType: null,
        mediaFileId: null,
        text: '',
        buttons: []
      });

      await this.safeEditMessage(ctx,
        `📢 *Создание рассылки*\n\n` +
        `Шаг 1/4: Медиа\n\n` +
        `Отправь фото, GIF или голосовое сообщение для рассылки.\n` +
        `Или нажми "Пропустить", чтобы отправить только текст.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Пропустить', 'admin_broadcast_skip_media')],
          [Markup.button.callback('❌ Отмена', 'admin_broadcast_cancel')]
        ])
      );
    } catch (error) {
      console.error('Ошибка в startBroadcast:', error);
      await this.safeReply(ctx, '❌ Ошибка при создании рассылки');
    }
  }

  async askBroadcastText(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const session = this.sessions.get(ctx.from.id);
      if (!session?.creatingBroadcast) return;

      session.step = 'text';

      const stepNumber = session.mediaType ? '2/4' : '1/4';
      const message = session.mediaType
        ? `📢 *Создание рассылки*\n\n` +
          `Шаг ${stepNumber}: Текст сообщения\n\n` +
          `Отправь текст сообщения для рассылки.\n` +
          `Или отправь /skip, чтобы пропустить этот шаг.`
        : `📢 *Создание рассылки*\n\n` +
          `Шаг ${stepNumber}: Текст сообщения\n\n` +
          `Отправь текст сообщения для рассылки.`;

      await this.safeReply(ctx, message,
        Markup.inlineKeyboard([
          [Markup.button.callback('❌ Отмена', 'admin_broadcast_cancel')]
        ])
      );
    } catch (error) {
      console.error('Ошибка в askBroadcastText:', error);
      await this.safeReply(ctx, '❌ Ошибка');
    }
  }

  async askBroadcastButtons(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const session = this.sessions.get(ctx.from.id);
      if (!session?.creatingBroadcast) return;

      session.step = 'buttons';

      await this.safeReply(ctx,
        `📢 *Создание рассылки*\n\n` +
        `Шаг 3/4: Кнопки (опционально)\n\n` +
        `Отправь кнопки в формате:\n` +
        `\`[Текст кнопки - ссылка]\`\n\n` +
        `Пример:\n` +
        `\`[Перейти на сайт - https://example.com]\`\n` +
        `\`[Наш канал - https://t.me/channel]\`\n\n` +
        `Можно добавить несколько кнопок, каждую с новой строки.\n` +
        `Или нажми "Пропустить", если кнопки не нужны.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Пропустить', 'admin_broadcast_skip_buttons')],
          [Markup.button.callback('❌ Отмена', 'admin_broadcast_cancel')]
        ])
      );
    } catch (error) {
      console.error('Ошибка в askBroadcastButtons:', error);
      await this.safeReply(ctx, '❌ Ошибка');
    }
  }

  async confirmBroadcast(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const session = this.sessions.get(ctx.from.id);
      if (!session?.creatingBroadcast) return;

      session.step = 'confirm';

      let preview = `📢 *Предпросмотр рассылки*\n\n`;

      if (session.mediaType) {
        preview += `📎 Медиа: ${session.mediaType === 'photo' ? 'Фото' : session.mediaType === 'animation' ? 'GIF' : 'Голосовое'}\n`;
      }

      if (session.text) {
        preview += `\n💬 Текст:\n${this.escapeMarkdown(session.text)}\n`;
      }

      if (session.buttons && session.buttons.length > 0) {
        preview += `\n🔘 Кнопки:\n`;
        for (const btn of session.buttons) {
          preview += `• ${this.escapeMarkdown(btn.text)} → ${this.escapeMarkdown(btn.url)}\n`;
        }
      }

      preview += `\n📊 Сообщение будет отправлено всем пользователям бота.`;

      await this.safeReply(ctx, preview, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Отправить рассылку', 'admin_broadcast_send')],
        [Markup.button.callback('❌ Отмена', 'admin_broadcast_cancel')]
      ]));
    } catch (error) {
      console.error('Ошибка в confirmBroadcast:', error);
      await this.safeReply(ctx, '❌ Ошибка');
    }
  }

  parseButtons(text: string): Array<{ text: string; url: string }> {
    const buttons: Array<{ text: string; url: string }> = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    for (const line of lines) {
      const match = line.match(/\[([^\]]+)\s*-\s*([^\]]+)\]/);
      if (match) {
        const buttonText = match[1].trim();
        const buttonUrl = match[2].trim();
        if (buttonText && buttonUrl && (buttonUrl.startsWith('http://') || buttonUrl.startsWith('https://') || buttonUrl.startsWith('tg://'))) {
          buttons.push({ text: buttonText, url: buttonUrl });
        }
      }
    }

    return buttons;
  }

  async sendBroadcast(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      const session = this.sessions.get(ctx.from.id);
      if (!session?.creatingBroadcast) {
        await this.safeReply(ctx, '❌ Сессия создания рассылки не найдена');
        return;
      }

      if (!session.mediaType && !session.text) {
        await this.safeReply(ctx, '❌ Нельзя отправить пустую рассылку. Нужен хотя бы текст или медиа.');
        return;
      }

      await this.safeReply(ctx, '⏳ Начинаю рассылку...');

      const users = await database.getAllUsers();
      let successCount = 0;
      let errorCount = 0;

      const keyboard = session.buttons && session.buttons.length > 0
        ? Markup.inlineKeyboard(session.buttons.map((btn: { text: string; url: string }) => [Markup.button.url(btn.text, btn.url)]))
        : undefined;

      for (const user of users) {
        try {
          if (session.mediaType === 'photo' && session.mediaFileId) {
            await this.bot.telegram.sendPhoto(user.user_id, session.mediaFileId, {
              caption: session.text || undefined,
              parse_mode: session.text ? 'Markdown' : undefined,
              ...(keyboard || {})
            });
          } else if (session.mediaType === 'animation' && session.mediaFileId) {
            await this.bot.telegram.sendAnimation(user.user_id, session.mediaFileId, {
              caption: session.text || undefined,
              parse_mode: session.text ? 'Markdown' : undefined,
              ...(keyboard || {})
            });
          } else if (session.mediaType === 'voice' && session.mediaFileId) {
            await this.bot.telegram.sendVoice(user.user_id, session.mediaFileId, {
              caption: session.text || undefined,
              parse_mode: session.text ? 'Markdown' : undefined,
              ...(keyboard || {})
            });
          } else if (session.text) {
            await this.bot.telegram.sendMessage(user.user_id, session.text, {
              parse_mode: 'Markdown',
              ...(keyboard || {})
            });
          } else {
            continue;
          }

          successCount++;
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error: any) {
          errorCount++;
          if (error.code === 403 || error.response?.error_code === 403) {
            console.log(`Пользователь ${user.user_id} заблокировал бота`);
            try {
              await database.deleteUser(user.user_id);
              console.log(`Удалён заблокированный пользователь: ${user.user_id}`);
            } catch (deleteError) {
              console.error(`Ошибка при удалении пользователя ${user.user_id}:`, deleteError);
            }
          } else {
            console.error(`Ошибка отправки пользователю ${user.user_id}:`, error.message);
          }
        }
      }

      this.sessions.delete(ctx.from.id);

      await this.safeReply(ctx,
        `✅ *Рассылка завершена*\n\n` +
        `✅ Успешно: ${successCount}\n` +
        `❌ Ошибок: ${errorCount}\n` +
        `📊 Всего пользователей: ${users.length}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin_panel')]
        ])
      );
    } catch (error: any) {
      console.error('Ошибка при рассылке:', error);
      this.sessions.delete(ctx.from.id);
      await this.safeReply(ctx, `❌ Ошибка при рассылке: ${error.message || 'Неизвестная ошибка'}`);
    }
  }

  async cleanupBlockedUsers(ctx: any): Promise<void> {
    try {
      if (!this.isAdmin(ctx.from.id)) return;

      await this.safeReply(ctx, '🔍 Проверяю пользователей... Это может занять некоторое время.');

      const users = await database.getAllUsers();
      let blockedCount = 0;
      let checkedCount = 0;
      const totalUsers = users.length;

      for (const user of users) {
        try {
          checkedCount++;
          const isBlocked = await database.checkUserBlocked(user.user_id, this.bot);
          
          if (isBlocked) {
            await database.deleteUser(user.user_id);
            blockedCount++;
            console.log(`✅ Удалён заблокированный пользователь: ${user.user_id} (@${user.username || 'без username'})`);
          } else {
            console.log(`✓ Пользователь ${user.user_id} активен`);
          }

          if (checkedCount % 10 === 0) {
            try {
              await ctx.telegram.editMessageText(
                ctx.chat.id,
                ctx.callbackQuery?.message?.message_id,
                undefined,
                `🔍 Проверка пользователей...\n\n` +
                `Проверено: ${checkedCount}/${totalUsers}\n` +
                `Найдено заблокированных: ${blockedCount}`
              );
        } catch (e) {
          // Игнорируем ошибки удаления
        }
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          console.error(`Ошибка при проверке пользователя ${user.user_id}:`, error);
        }
      }

      await this.safeReply(ctx,
        `✅ *Очистка завершена*\n\n` +
        `📊 Проверено пользователей: ${checkedCount}\n` +
        `🗑️ Удалено заблокированных: ${blockedCount}\n` +
        `👥 Осталось пользователей: ${totalUsers - blockedCount}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin_panel')]
        ])
      );
    } catch (error: any) {
      console.error('Ошибка при очистке заблокированных пользователей:', error);
      await this.safeReply(ctx, `❌ Ошибка при очистке: ${error.message || 'Неизвестная ошибка'}`);
    }
  }
}

