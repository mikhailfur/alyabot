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
    } catch (error) {
      console.error('Ошибка при отправке сообщения:', error);
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
    const premiumUsers = users.filter(u => u.is_premium);

    const modelStats = users.reduce((acc: any, u: any) => {
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
      const referralInfo = user.referral_source ? ` | 🔗 Источник: ${user.referral_source}` : '';
      message += `${premium} ${username} (ID: ${user.user_id})\n`;
      message += `   Сообщений: ${user.total_messages || 0} | Модель: ${modelType}${referralInfo}\n`;
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

    const message = `⚙️ *Управление моделью пользователя*\n\n` +
      `👤 Пользователь: ${username}\n` +
      `⭐ Premium: ${user.is_premium ? 'Да' : 'Нет'}\n` +
      `🤖 Текущая модель: ${currentModel}\n\n` +
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
      const expiresAt = user.subscription_until 
        ? new Date(user.subscription_until).toLocaleDateString('ru-RU')
        : 'Неизвестно';
      const mode = user.behavior_mode || 'default';
      message += `⭐ ${username} (ID: ${user.user_id})\n`;
      message += `   Режим: ${mode} | До: ${expiresAt}\n\n`;
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
          
          await ctx.reply(
            `✅ *Реферальная ссылка создана!*\n\n` +
            `📝 Название: ${name}\n` +
            `🔗 Код: ${code}\n` +
            `🔗 Ссылка: \`${referralLink}\``,
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
          message += `${status} *${link.name}*\n`;
          message += `   Код: \`${link.code}\`\n`;
          message += `   Переходов: ${link.clicks} | Регистраций: ${link.registrations}\n`;
          message += `   Ссылка: \`${referralLink}\`\n\n`;
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
      
      const message = `🔗 *${link.name}*\n\n` +
        `📝 Код: \`${link.code}\`\n` +
        `🔗 Ссылка: \`${referralLink}\`\n\n` +
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

      let message = `📊 *Статистика: ${link.name}*\n\n` +
        `👆 Всего переходов: ${stats.clicks}\n` +
        `✅ Всего регистраций: ${stats.registrations}\n\n`;

      if (stats.users.length > 0) {
        message += `👥 *Последние пользователи:*\n\n`;
        const recentUsers = stats.users.slice(0, 20);
        for (const user of recentUsers) {
          const userData = await database.getUser(user.user_id);
          const username = userData?.username ? `@${userData.username}` : `ID: ${user.user_id}`;
          const status = user.registered_at ? '✅' : '👆';
          const date = user.registered_at ? new Date(user.registered_at).toLocaleString('ru-RU') : new Date(user.clicked_at).toLocaleString('ru-RU');
          message += `${status} ${username} - ${date}\n`;
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
}

