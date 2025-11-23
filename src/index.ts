import { Telegraf, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as cron from 'node-cron';
import { config, validateConfig } from './config';
import { database } from './database';
import { memoryManager } from './memory';
import { alyaPromptGroup, getBehaviorPrompt } from './prompt';
import { SubscriptionManager } from './subscription';
import { AdminPanel } from './admin';
import { VoiceHandler } from './voice';
import { ImageProcessor } from './image';
import { PremiumBroadcast } from './broadcast';
import { GeminiBalancer } from './gemini-balancer';
import { GeminiClient, RateLimitError, ProhibitedContentError } from './gemini-client';
import { RateLimiter } from './rate-limiter';
import { logger } from './logger';
import { ApiLimitMonitor } from './api-limit-monitor';
import { QueueManager } from './queue-manager';

dotenv.config();
validateConfig();

logger.info('Бот запускается...');

const bot = new Telegraf(config.telegramBotToken);
const apiLimitMonitor = new ApiLimitMonitor(config.geminiApiKeys);

let updateDescriptionTimer: NodeJS.Timeout | null = null;
const DESCRIPTION_UPDATE_DEBOUNCE = 10 * 1000;

apiLimitMonitor.setOnLimitChanged(() => {
  if (updateDescriptionTimer) {
    clearTimeout(updateDescriptionTimer);
  }
  
  updateDescriptionTimer = setTimeout(async () => {
    await updateBotDescription();
    updateDescriptionTimer = null;
  }, DESCRIPTION_UPDATE_DEBOUNCE);
});

apiLimitMonitor.startMonitoring();

const geminiBalancer = new GeminiBalancer(config.geminiApiKeys, config.geminiApiKeysPremium, apiLimitMonitor);
const geminiClient = new GeminiClient(geminiBalancer, apiLimitMonitor);

const subscriptionManager = new SubscriptionManager(bot);
const adminPanel = new AdminPanel(bot, apiLimitMonitor);
const voiceHandler = new VoiceHandler(bot, geminiClient);
const premiumBroadcast = new PremiumBroadcast(bot, voiceHandler, geminiClient);
const rateLimiter = new RateLimiter();
const queueManager = new QueueManager(bot, apiLimitMonitor);

async function sendRateLimitMessage(ctx: any, isApiLimit: boolean = false): Promise<void> {
  const imagePath = path.join(__dirname, '..', 'src', 'images', 'ratelimit.jpg');
  let imageExists = false;
  try {
    await fs.promises.access(imagePath);
    imageExists = true;
  } catch {
    imageExists = false;
  }

  const message = isApiLimit
    ? `😴 *Аля устала!*\n\n` +
      `Хм... Я сегодня очень много болтала, и очень устала... 😔\n\n` +
      `Но если ты купишь мне "энергетик", я смогу болтать с тобой без остановки! Я буду очень рада продолжить наш разговор! 💪✨`
    : `😴 *Аля устала!*\n\n` +
      `Ты отправил(а) 30 сообщений за последний час. Мне нужно отдохнуть. Я отвечу через некоторое время, или ты можешь купить мне "энергетик" (Premium), чтобы я болтала с тобой без остановки! 💪`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💎 Купить Premium', 'premium')],
  ]);

  if (imageExists) {
    await ctx.replyWithPhoto({ source: imagePath }, {
      caption: message,
      parse_mode: 'Markdown',
      ...keyboard,
    });
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
  }
}

async function sendProhibitedContentMessage(ctx: any, userId: number, isPremium: boolean, behaviorMode?: string): Promise<void> {
  if (behaviorMode === 'nsfw') {
    const message = `Ваш запрос нарушает условия использования сервиса.\n` +
      `Аля не может общаться на подобные темы. Ведь она всего лишь хорошая девочка и не может знать о таких вещах.\n\n` +
      `Пожалуйста, ознакомьтесь с нашими правилами:`;

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('📋 Условия использования', 'https://mikhailfur.ru/terms')],
      ]),
    });
    return;
  }

  const imagePath = path.join(__dirname, '..', 'src', 'images', 'ratelimit.jpg');
  let imageExists = false;
  try {
    await fs.promises.access(imagePath);
    imageExists = true;
  } catch {
    imageExists = false;
  }

  let message: string;
  let keyboard: any;

  if (isPremium) {
    message = `Вы отправляете запрос который содержит NSFW (19+) Контент.\n\n` +
      `Чтобы иметь возможность общаться с Алей на интимные темы, в том числе 19+ RolePlay включите режим NSFW в настройках`;

    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔥 Включить NSFW режим', 'mode_nsfw')],
    ]);
  } else {
    message = `Вы отправляете запрос который содержит NSFW (19+) Контент.\n\n` +
      `Чтобы иметь возможность общаться с Алей на интимные темы, в том числе 19+ RolePlay купите подписку`;

    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💎 Купить Premium', 'premium')],
    ]);
  }

  if (imageExists) {
    await ctx.replyWithPhoto({ source: imagePath }, {
      caption: message,
      parse_mode: 'Markdown',
      ...keyboard,
    });
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
  }
}

bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (error: any) {
    logger.error('Ошибка в обработчике', error, { userId: ctx.from?.id, chatId: ctx.chat?.id });
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('❌ Произошла ошибка', { show_alert: false });
      }
      if (ctx.message && 'text' in ctx.message && !ctx.message.text?.startsWith('/')) {
        await ctx.reply('❌ Произошла ошибка при обработке запроса. Попробуйте позже.');
      }
    } catch (replyError) {
      logger.error('Ошибка при отправке сообщения об ошибке', replyError);
    }
  }
});

const lastMessageTime: Map<number, number> = new Map();
const MESSAGE_COOLDOWN = 2000;

async function checkAdminStatus(ctx: any): Promise<boolean> {
  try {
    if (!ctx.from?.id || !ctx.chat?.id) return false;
    const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return chatMember.status === 'administrator' || chatMember.status === 'creator';
  } catch (error) {
    logger.error('Ошибка при проверке статуса администратора', error);
    return false;
  }
}

function shouldProcessMessage(userId: number): boolean {
  const now = Date.now();
  const lastTime = lastMessageTime.get(userId) || 0;
  if (now - lastTime < MESSAGE_COOLDOWN) {
    return false;
  }
  lastMessageTime.set(userId, now);
  return true;
}

bot.start(async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  let referralCode: string | undefined;
  const startParam = ctx.startPayload || ctx.message.text?.split(' ')[1];
  
  logger.userAction(userId, 'Команда /start', { payload: startParam });
  
  if (startParam && (startParam.startsWith('ref_') || startParam.startsWith('ref'))) {
    let extractedCode = startParam.replace(/^ref_?/, '');
    logger.debug('Извлечение реферального кода', { extractedCode, userId });
    
    try {
      let link = await database.getReferralLink(extractedCode);
      
      if (!link) {
        link = await database.findReferralLinkByNormalizedCode(extractedCode);
        if (link) {
          extractedCode = link.code;
          logger.debug('Найден реферальный код по нормализованному сравнению', { actualCode: link.code, userId });
        }
      }
      
      referralCode = link ? link.code : undefined;
      logger.info('Реферальная ссылка найдена', { 
        found: !!link, 
        linkId: link?.id, 
        linkName: link?.name, 
        code: link?.code,
        userId 
      });
    } catch (error) {
      logger.error('Ошибка при поиске реферальной ссылки', error, { extractedCode, userId });
      referralCode = undefined;
    }
  }

  await database.createOrUpdateUser(
    userId,
    ctx.from.username,
    ctx.from.first_name,
    ctx.from.last_name,
    referralCode
  );

  if (referralCode) {
    try {
      const link = await database.getReferralLink(referralCode);
      if (link && link.is_active) {
        await database.trackReferralClick(referralCode, userId);
        logger.info('Отслежен переход по реферальной ссылке', { code: referralCode, userId });
      }
    } catch (error) {
      logger.error('Ошибка при отслеживании перехода по реферальной ссылке', error, { code: referralCode, userId });
    }
  }

  const isPremium = await subscriptionManager.checkUserSubscription(userId);
  
  const message = `👋 *Привет! Я Аля* 😊\n\n` +
    `Рада познакомиться! Я твой AI-компаньон, который всегда готов поболтать.\n\n` +
    `${isPremium ? '⭐ У тебя активна Premium подписка!' : '💬 Ты используешь бесплатную версию'}\n\n` +
    `Просто напиши мне что-нибудь, и я отвечу!`;

  const imagePath = path.join(__dirname, '..', 'src', 'images', 'menu.jpg');
  const buttons: any[] = [
    [Markup.button.callback('⚙️ Настройки', 'settings'), Markup.button.callback('💎 Premium', 'premium')],
    [Markup.button.callback('📊 Статистика', 'stats'), Markup.button.callback('ℹ️ Информация', 'info')],
  ];

  if (config.telegramChannelUrl) {
    buttons.push([Markup.button.url('📢 Канал', config.telegramChannelUrl)]);
  }
  if (config.feedbackUrl) {
    buttons.push([Markup.button.url('⭐ Отзывы', config.feedbackUrl)]);
  }

  try {
    await fs.promises.access(imagePath);
    await ctx.replyWithPhoto({ source: imagePath }, {
      caption: message,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }
});

bot.help(async (ctx) => {
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  
  if (isGroup) {
    await ctx.reply('Привет! Я Аля 😊\n\nКоманды для групп:\n/activate - Активировать бота (только админы)\n/deactivate - Деактивировать бота (только админы)\n/settings - Настройки группы\n/memory - Статистика группы\n/clear - Очистить историю группы (только админы)\n\nВ группах отвечаю когда:\n• Меня упоминают @youralyasanbot\n• Бот активирован в группе\n• Отвечаете на мои сообщения');
  } else {
    await ctx.reply('Просто напиши мне что-нибудь, и я отвечу! Я люблю общаться 😘\n\nДоступные команды:\n/start - Начать общение\n/help - Показать помощь\n/memory - Показать статистику общения\n/clear - Очистить историю общения\n/info - Юридическая информация');
  }
});

bot.command('admin', async (ctx) => {
  await adminPanel.showAdminPanel(ctx);
});

bot.command('premium', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const isPremium = await subscriptionManager.checkUserSubscription(userId);
  const prices = subscriptionManager.getSubscriptionPrices();

  if (isPremium) {
    await ctx.reply(`⭐ *У тебя активна Premium подписка!*\n\n` +
      `Доступные функции:\n` +
      `• Изменение режима поведения\n` +
      `• Обработка фото\n` +
      `• Голосовые сообщения\n` +
      `• Платный Gemini API`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Настройки', 'settings')],
        [Markup.button.callback('🔙 Назад', 'menu')],
      ]),
    });
    return;
  }

  let message = `💎 *Premium подписка*\n\n` +
    `Получи доступ к расширенным функциям:\n\n` +
    `✨ Изменение режима поведения (учёба, работа, психолог, NSFW)\n` +
    `📷 Обработка прикреплённых фото\n` +
    `🎤 Голосовые сообщения (отправка и получение)\n` +
    `🚀 Платный Gemini API (быстрее и лучше)\n\n` +
    `*Тарифы:*\n\n`;

  for (const price of prices) {
    const discountText = price.discount > 0 ? ` (скидка ${price.discount}%)` : '';
    message += `${price.months} мес. — ${price.price}₽${discountText}\n`;
  }

  const imagePath = path.join(__dirname, '..', 'src', 'images', 'sub.png');
  try {
    await fs.promises.access(imagePath);
    await ctx.replyWithPhoto({ source: imagePath }, {
      caption: message,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('1 месяц — 500₽', 'subscribe_1')],
        [Markup.button.callback('3 месяца — 1350₽', 'subscribe_3')],
        [Markup.button.callback('6 месяцев — 2400₽', 'subscribe_6')],
        [Markup.button.callback('12 месяцев — 4200₽', 'subscribe_12')],
        [Markup.button.callback('🔙 Назад', 'menu')],
      ]),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('1 месяц — 500₽', 'subscribe_1')],
        [Markup.button.callback('3 месяца — 1350₽', 'subscribe_3')],
        [Markup.button.callback('6 месяцев — 2400₽', 'subscribe_6')],
        [Markup.button.callback('12 месяцев — 4200₽', 'subscribe_12')],
        [Markup.button.callback('🔙 Назад', 'menu')],
      ]),
    });
  }
});

bot.command('settings', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = await database.getUser(userId);
  const isPremium = await subscriptionManager.checkUserSubscription(userId);
  const behaviorMode = user?.behavior_mode || 'default';

  const modeNames: Record<string, string> = {
    default: 'Обычный',
    study: 'Учёба',
    work: 'Работа',
    psychologist: 'Психолог',
    nsfw: 'NSFW',
  };

  let message = `⚙️ *Настройки*\n\n`;
  message += `Режим поведения: ${modeNames[behaviorMode] || 'Обычный'}\n`;
  message += `Статус: ${isPremium ? '⭐ Premium' : '💬 Бесплатно'}\n\n`;

  if (!isPremium) {
    message += `Для изменения режима нужна Premium подписка!`;
  }

  const buttons = [];
  if (isPremium) {
    buttons.push([Markup.button.callback('📚 Учёба', 'mode_study')]);
    buttons.push([Markup.button.callback('💼 Работа', 'mode_work')]);
    buttons.push([Markup.button.callback('🧠 Психолог', 'mode_psychologist')]);
    buttons.push([Markup.button.callback('🔥 NSFW', 'mode_nsfw')]);
    buttons.push([Markup.button.callback('🔄 Обычный', 'mode_default')]);
  }
  buttons.push([Markup.button.callback('🔙 Назад', 'menu')]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const stats = await database.getUserStats(userId);
  const user = await database.getUser(userId);

  const message = `📊 *Статистика*\n\n` +
    `💬 Всего сообщений: ${stats.totalMessages || 0}\n` +
    `📅 Первое сообщение: ${stats.firstMessage ? new Date(stats.firstMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
    `🕐 Последнее сообщение: ${stats.lastMessage ? new Date(stats.lastMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
    `⭐ Premium: ${user?.is_premium ? 'Да' : 'Нет'}`;

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'menu')],
    ]),
  });
});

bot.command('memory', async (ctx) => {
  try {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    
    if (!userId || !chatId) {
      await ctx.reply('Не удалось определить пользователя или чат.');
      return;
    }

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    
    if (isGroup) {
      const stats = await database.getGroupStats(chatId);
      const message = `📊 *Статистика группы*\n\n` +
        `💬 Всего сообщений: ${stats.totalMessages || 0}\n` +
        `👥 Уникальных пользователей: ${stats.uniqueUsers || 0}\n` +
        `📅 Первое сообщение: ${stats.firstMessage ? new Date(stats.firstMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
        `🕐 Последнее сообщение: ${stats.lastMessage ? new Date(stats.lastMessage).toLocaleDateString('ru-RU') : 'Нет данных'}`;
      
      await ctx.reply(message, {
        parse_mode: 'Markdown',
      });
    } else {
      const stats = await database.getUserStats(userId);
      const user = await database.getUser(userId);
      const chatHistory = await database.getChatHistory(userId, 20);

      const message = `📊 *Статистика общения*\n\n` +
        `💬 Всего сообщений: ${stats.totalMessages || 0}\n` +
        `📅 Первое сообщение: ${stats.firstMessage ? new Date(stats.firstMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
        `🕐 Последнее сообщение: ${stats.lastMessage ? new Date(stats.lastMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
        `⭐ Premium: ${user?.is_premium ? 'Да' : 'Нет'}\n\n` +
        `💭 История в памяти: ${chatHistory.length} последних сообщений`;
      
      await ctx.reply(message, {
        parse_mode: 'Markdown',
      });
    }
  } catch (error) {
    console.error('Ошибка при получении статистики памяти:', error);
    try {
      await ctx.reply('❌ Не могу получить статистику 😅');
    } catch (e) {
      console.error('Ошибка при отправке сообщения об ошибке:', e);
    }
  }
});

bot.command('clear', async (ctx) => {
    logger.userAction(ctx.from?.id || 0, 'Команда /clear');
  try {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    
    if (!userId || !chatId) {
      logger.warn('Не удалось определить userId или chatId для команды /clear');
      await ctx.reply('Не удалось определить пользователя или чат.');
      return;
    }

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    
    if (isGroup) {
      const isAdmin = await checkAdminStatus(ctx);
      if (!isAdmin) {
        logger.warn('Попытка очистки истории группы не администратором', { userId, chatId });
        await ctx.reply('Только администраторы могут очищать историю в группах!');
        return;
      }
    }

    logger.userAction(userId, 'Очистка истории', { isGroup, chatId });
    await ctx.sendChatAction('typing');

    if (isGroup) {
      await database.clearGroupHistory(chatId);
      logger.info('История группы очищена', { chatId });
      await ctx.reply('✅ История общения группы очищена! Начнем с чистого листа 😊');
    } else {
      await database.clearChatHistory(userId, chatId);
      logger.info('История чата очищена', { userId, chatId });
      await ctx.reply('✅ История общения очищена! Начнем с чистого листа 😊');
    }
  } catch (error) {
    logger.error('Ошибка при очистке истории', error, { userId: ctx.from?.id, chatId: ctx.chat?.id });
    try {
      await ctx.reply('❌ Не могу очистить историю 😅');
    } catch (e) {
      console.error('Ошибка при отправке сообщения об ошибке:', e);
    }
  }
});

bot.command('broadcast', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!adminPanel.isAdmin(userId)) {
    await ctx.reply('❌ Эта команда доступна только администраторам!');
    return;
  }

  await adminPanel.startBroadcast(ctx);
});

bot.action('menu', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const isPremium = await subscriptionManager.checkUserSubscription(userId);
  
  const message = `👋 *Главное меню*\n\n` +
    `${isPremium ? '⭐ У тебя активна Premium подписка!' : '💬 Ты используешь бесплатную версию'}`;

  const buttons: any[] = [
    [Markup.button.callback('⚙️ Настройки', 'settings'), Markup.button.callback('💎 Premium', 'premium')],
    [Markup.button.callback('📊 Статистика', 'stats'), Markup.button.callback('ℹ️ Информация', 'info')],
  ];

  if (config.telegramChannelUrl) {
    buttons.push([Markup.button.url('📢 Канал', config.telegramChannelUrl)]);
  }
  if (config.feedbackUrl) {
    buttons.push([Markup.button.url('⭐ Отзывы', config.feedbackUrl)]);
  }

  const keyboard = Markup.inlineKeyboard(buttons);
  const imagePath = path.join(__dirname, '..', 'src', 'images', 'menu.jpg');

  try {
    const hasPhoto = ctx.callbackQuery?.message && 'photo' in ctx.callbackQuery.message;
    let imageExists = false;
    try {
      await fs.promises.access(imagePath);
      imageExists = true;
    } catch {
      imageExists = false;
    }

    if (hasPhoto) {
      if (imageExists) {
        await ctx.replyWithPhoto({ source: imagePath }, {
          caption: message,
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } else {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    } else {
      if (imageExists) {
        try {
          await ctx.deleteMessage();
        } catch (e) {
          // Игнорируем ошибки удаления
        }
        await ctx.replyWithPhoto({ source: imagePath }, {
          caption: message,
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } else {
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    }
  } catch (error: any) {
    if (error?.response?.description?.includes('message is not modified') || 
        error?.response?.description?.includes('there is no text in the message')) {
      let imageExists = false;
      try {
        await fs.promises.access(imagePath);
        imageExists = true;
      } catch {
        imageExists = false;
      }
      if (imageExists) {
        await ctx.replyWithPhoto({ source: imagePath }, {
          caption: message,
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } else {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    } else {
      throw error;
    }
  }
});

bot.action('subscribe_trial', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const canUseTrial = await subscriptionManager.canUseTrial(userId);
  if (!canUseTrial) {
    await ctx.reply('❌ Пробная подписка уже была использована или у тебя уже есть Premium подписка.');
    return;
  }

  const paymentLink = subscriptionManager.getPaymentLink('trial');
  
  await ctx.reply(`🎁 *Пробная подписка*\n\n` +
    `Период: 24 часа\n` +
    `Сумма: 1₽\n\n` +
    `Перейди по ссылке для оплаты:\n${paymentLink}\n\n` +
    `После оплаты ты автоматически получишь доступ к Premium функциям на 24 часа!`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.url('💳 Оплатить', paymentLink)],
      [Markup.button.callback('🔙 Назад', 'premium')],
    ]),
  });
});

bot.action(/^subscribe_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const months = parseInt(ctx.match[1]);
  const prices = subscriptionManager.getSubscriptionPrices();
  const priceInfo = prices.find(p => p.months === months);
  
  if (!priceInfo) return;

  const paymentLink = subscriptionManager.getPaymentLink(priceInfo.type);
  
  await ctx.reply(`💳 *Оплата подписки*\n\n` +
    `Период: ${months} месяц(ей)\n` +
    `Сумма: ${priceInfo.price}₽\n\n` +
    `Перейди по ссылке для оплаты:\n${paymentLink}\n\n` +
    `После оплаты ты автоматически получишь доступ к Premium функциям!`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.url('💳 Оплатить', paymentLink)],
      [Markup.button.callback('🔙 Назад', 'premium')],
    ]),
  });
});

bot.action(/^mode_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const mode = ctx.match[1];
  await database.setUserBehaviorMode(userId, mode);

  const modeNames: Record<string, string> = {
    default: 'Обычный',
    study: 'Учёба',
    work: 'Работа',
    psychologist: 'Психолог',
    nsfw: 'NSFW',
  };

  await ctx.reply(`✅ Режим изменён на: ${modeNames[mode] || 'Обычный'}`, {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'settings')],
    ]),
  });
});

bot.action('settings', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    const user = await database.getUser(userId);
    const isPremium = await subscriptionManager.checkUserSubscription(userId);
    const behaviorMode = user?.behavior_mode || 'default';

    const modeNames: Record<string, string> = {
      default: 'Обычный',
      study: 'Учёба',
      work: 'Работа',
      psychologist: 'Психолог',
      nsfw: 'NSFW',
    };

    let message = `⚙️ *Настройки*\n\n`;
    message += `Режим поведения: ${modeNames[behaviorMode] || 'Обычный'}\n`;
    message += `Статус: ${isPremium ? '⭐ Premium' : '💬 Бесплатно'}\n\n`;

    if (!isPremium) {
      message += `Для изменения режима нужна Premium подписка!`;
    }

    const buttons = [];
    if (isPremium) {
      buttons.push([Markup.button.callback('📚 Учёба', 'mode_study')]);
      buttons.push([Markup.button.callback('💼 Работа', 'mode_work')]);
      buttons.push([Markup.button.callback('🧠 Психолог', 'mode_psychologist')]);
      buttons.push([Markup.button.callback('🔥 NSFW', 'mode_nsfw')]);
      buttons.push([Markup.button.callback('🔄 Обычный', 'mode_default')]);
    }
    buttons.push([Markup.button.callback('🔙 Назад', 'menu')]);

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error: any) {
      if (error?.response?.description?.includes('message is not modified') || 
          error?.response?.description?.includes('there is no text in the message')) {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        });
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    console.error('Ошибка в обработчике settings:', error);
    throw error;
  }
});

bot.action('premium', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    const isPremium = await subscriptionManager.checkUserSubscription(userId);
    const prices = subscriptionManager.getSubscriptionPrices();

    if (isPremium) {
      try {
        await ctx.editMessageText(`⭐ *У тебя активна Premium подписка!*\n\n` +
          `Доступные функции:\n` +
          `• Изменение режима поведения\n` +
          `• Обработка фото\n` +
          `• Голосовые сообщения\n` +
          `• Платный Gemini API`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⚙️ Настройки', 'settings')],
            [Markup.button.callback('🔙 Назад', 'menu')],
          ]),
        });
      } catch (error: any) {
        if (error?.response?.description?.includes('message is not modified') || 
            error?.response?.description?.includes('there is no text in the message')) {
          await ctx.reply(`⭐ *У тебя активна Premium подписка!*\n\n` +
            `Доступные функции:\n` +
            `• Изменение режима поведения\n` +
            `• Обработка фото\n` +
            `• Голосовые сообщения\n` +
            `• Платный Gemini API`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⚙️ Настройки', 'settings')],
              [Markup.button.callback('🔙 Назад', 'menu')],
            ]),
          });
        } else {
          throw error;
        }
      }
      return;
    }

    const canUseTrial = await subscriptionManager.canUseTrial(userId);

    let message = `💎 *Premium подписка*\n\n` +
      `Получи доступ к расширенным функциям:\n\n` +
      `✨ Изменение режима поведения (учёба, работа, психолог, NSFW)\n` +
      `📷 Обработка прикреплённых фото\n` +
      `🎤 Голосовые сообщения (отправка и получение)\n` +
      `🚀 Платный Gemini API (быстрее и лучше)\n\n`;

    if (canUseTrial) {
      message += `🎁 *Пробная подписка на 24 часа за 1₽!*\n\n`;
    }

    message += `*Тарифы:*\n\n`;

    for (const price of prices) {
      const discountText = price.discount > 0 ? ` (скидка ${price.discount}%)` : '';
      message += `${price.months} мес. — ${price.price}₽${discountText}\n`;
    }

    const buttons = [];
    if (canUseTrial) {
      buttons.push([Markup.button.callback('🎁 Пробная подписка (24 часа) — 1₽', 'subscribe_trial')]);
    }
    buttons.push([Markup.button.callback('1 месяц — 500₽', 'subscribe_1')]);
    buttons.push([Markup.button.callback('3 месяца — 1350₽', 'subscribe_3')]);
    buttons.push([Markup.button.callback('6 месяцев — 2400₽', 'subscribe_6')]);
    buttons.push([Markup.button.callback('12 месяцев — 4200₽', 'subscribe_12')]);
    buttons.push([Markup.button.callback('🔙 Назад', 'menu')]);

    const imagePath = path.join(process.cwd(), 'src', 'images', 'sub.png');
    let imageExists = false;
    try {
      await fs.promises.access(imagePath);
      imageExists = true;
    } catch {
      imageExists = false;
    }

    if (imageExists) {
      try {
        await ctx.editMessageMedia({
          type: 'photo',
          media: { source: fs.createReadStream(imagePath) },
          caption: message,
          parse_mode: 'Markdown',
        }, Markup.inlineKeyboard(buttons));
      } catch (error: any) {
        if (error?.response?.description?.includes('message is not modified') || 
            error?.response?.description?.includes('there is no text in the message')) {
          await ctx.replyWithPhoto({ source: imagePath }, {
            caption: message,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        } else {
          throw error;
        }
      }
    } else {
      try {
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        });
      } catch (error: any) {
        if (error?.response?.description?.includes('message is not modified') || 
            error?.response?.description?.includes('there is no text in the message')) {
          await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        } else {
          throw error;
        }
      }
    }
  } catch (error: any) {
    console.error('Ошибка в обработчике premium:', error);
    throw error;
  }
});

bot.action('stats', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    const stats = await database.getUserStats(userId);
    const user = await database.getUser(userId);

    const message = `📊 *Статистика*\n\n` +
      `💬 Всего сообщений: ${stats.totalMessages || 0}\n` +
      `📅 Первое сообщение: ${stats.firstMessage ? new Date(stats.firstMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
      `🕐 Последнее сообщение: ${stats.lastMessage ? new Date(stats.lastMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
      `⭐ Premium: ${user?.is_premium ? 'Да' : 'Нет'}`;

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'menu')],
        ]),
      });
    } catch (error: any) {
      if (error?.response?.description?.includes('message is not modified') || 
          error?.response?.description?.includes('there is no text in the message')) {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'menu')],
          ]),
        });
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    console.error('Ошибка в обработчике stats:', error);
    throw error;
  }
});

bot.action('info', async (ctx) => {
  await ctx.answerCbQuery();
  
  const message = ctx.callbackQuery?.message;
  try {
    if (message && 'photo' in message && (message as any).photo) {
      await ctx.deleteMessage();
    }
  } catch (e) {
    // Игнорируем ошибки удаления
  }

  const infoMessage = 'ℹ️ *Информация*\n\n' +
    '📄 *Документы:*\n' +
    '• Политика конфиденциальности\n' +
    '• Публичная оферта\n' +
    '• Политика возврата средств\n\n' +
    '💬 *Поддержка:*\n' +
    '• Связь с разработчиком';

  try {
    if (message && 'photo' in message && (message as any).photo) {
      await ctx.reply(infoMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔒 Политика конфиденциальности', 'https://mikhailfur.ru/privacy')],
          [Markup.button.url('📋 Публичная оферта', 'https://mikhailfur.ru/offer')],
          [Markup.button.url('💰 Политика возврата', 'https://mikhailfur.ru/refund')],
          [Markup.button.url('💬 Связаться с разработчиком', 'https://tap.mikhailfur.ru')],
          [Markup.button.callback('🔙 Назад', 'menu')],
        ]),
      });
    } else {
      await ctx.editMessageText(infoMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔒 Политика конфиденциальности', 'https://mikhailfur.ru/privacy')],
          [Markup.button.url('📋 Публичная оферта', 'https://mikhailfur.ru/offer')],
          [Markup.button.url('💰 Политика возврата', 'https://mikhailfur.ru/refund')],
          [Markup.button.url('💬 Связаться с разработчиком', 'https://tap.mikhailfur.ru')],
          [Markup.button.callback('🔙 Назад', 'menu')],
        ]),
      });
    }
  } catch (error: any) {
    if (error?.response?.description?.includes('message is not modified')) {
      return;
    }
    await ctx.reply(infoMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🔒 Политика конфиденциальности', 'https://mikhailfur.ru/privacy')],
        [Markup.button.url('📋 Публичная оферта', 'https://mikhailfur.ru/offer')],
        [Markup.button.url('💰 Политика возврата', 'https://mikhailfur.ru/refund')],
        [Markup.button.url('💬 Связаться с разработчиком', 'https://tap.mikhailfur.ru')],
        [Markup.button.callback('🔙 Назад', 'menu')],
      ]),
    });
  }
});

adminPanel.setupHandlers();

bot.on('photo', async (ctx) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  
  try {
    if (!userId || !chatId) return;


    if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
      return;
    }

    if (!shouldProcessMessage(userId)) return;

    const isPremium = await subscriptionManager.checkUserSubscription(userId);
    if (!isPremium) {
      await ctx.reply('📷 Обработка фото доступна только в Premium подписке!\n\nИспользуй /premium для покупки подписки.', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💎 Купить Premium', 'premium')],
        ]),
      });
      return;
    }

    await ctx.sendChatAction('upload_photo');

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    
    const response = await fetch(fileUrl);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    
    const mimeType = file.file_path?.endsWith('.jpg') || file.file_path?.endsWith('.jpeg') 
      ? 'image/jpeg' 
      : 'image/png';

    const user = await database.getUser(userId);
    const behaviorMode = user?.behavior_mode || 'default';
    const imageProcessor = new ImageProcessor(geminiClient, isPremium);

    const caption = ctx.message.caption || '';
    const imageDescription = await imageProcessor.processImage(imageBuffer, mimeType, caption);

    if (!imageDescription) {
      await ctx.reply('Не могу обработать это изображение 😅');
      return;
    }

    await ctx.sendChatAction('typing');

    const chatHistory = await database.getChatHistory(userId, 10);
    const contextWithHistory = memoryManager.buildContextWithHistory(chatHistory, caption || 'Что на этом фото?');
    
    const prompt = getBehaviorPrompt(behaviorMode);
    const fullPrompt = `${prompt}\n\n${contextWithHistory}\n\nОписание фото: ${imageDescription}\n\nАля:`;
    
    let text: string;
    try {
      text = await geminiClient.generateContent({
        prompt: fullPrompt,
        isPremium,
        maxRetries: 3,
        behaviorMode
      });
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        console.error('Ошибка rate limit от Gemini API при обработке фото:', error);
        await sendRateLimitMessage(ctx, true);
        return;
      }
      if (error instanceof ProhibitedContentError) {
        console.error('Ошибка PROHIBITED_CONTENT от Gemini API при обработке фото:', error);
        await sendProhibitedContentMessage(ctx, userId, isPremium, behaviorMode);
        return;
      }
      console.error('Ошибка при генерации ответа на фото через Gemini:', error);
      throw error;
    }

    const voiceMatch = text.match(/\[VOICE:\s*(.+?)\]/);
    if (voiceMatch && isPremium) {
      text = text.replace(/\[VOICE:\s*(.+?)\]/g, '');
      await voiceHandler.sendVoiceMessage(ctx, voiceMatch[1].trim());
      if (text.trim()) {
        await ctx.reply(text.trim());
      }
    } else {
      if (voiceHandler.shouldSendVoice() && isPremium) {
        await voiceHandler.sendVoiceMessage(ctx, text);
      } else {
        await ctx.reply(text);
      }
    }

    await database.saveMessage(userId, ctx.from?.username, `[Фото] ${caption || ''}`, text, chatId, ctx.chat?.type);
    await database.updateUserActivity(userId);
  } catch (error) {
    console.error('Ошибка при обработке фото:', error);
    try {
      if (userId && chatId) {
        await ctx.reply('Ой, что-то пошло не так при обработке фото... 😅');
      }
    } catch (replyError) {
      console.error('Ошибка при отправке сообщения об ошибке:', replyError);
    }
  }
});

bot.on('voice', async (ctx) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  
  try {
    if (!userId || !chatId) return;

    if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
      return;
    }

    if (!shouldProcessMessage(userId)) return;

    const isPremium = await subscriptionManager.checkUserSubscription(userId);
    if (!isPremium) {
      await ctx.reply('🎤 Голосовые сообщения доступны только в Premium подписке!\n\nИспользуй /premium для покупки подписки.', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💎 Купить Premium', 'premium')],
        ]),
      });
      return;
    }

    await ctx.sendChatAction('typing');

    const transcription = await voiceHandler.processVoiceMessage(ctx, isPremium);
    if (!transcription) {
      await ctx.reply('Не могу распознать голосовое сообщение 😅');
      return;
    }

    const user = await database.getUser(userId);
    const behaviorMode = user?.behavior_mode || 'default';
    const chatHistory = await database.getChatHistory(userId, 10);
    const contextWithHistory = memoryManager.buildContextWithHistory(chatHistory, transcription);
    
    const prompt = getBehaviorPrompt(behaviorMode);
    const fullPrompt = `${prompt}\n\n${contextWithHistory}\n\nАля:`;
    
    let text: string;
    try {
      text = await geminiClient.generateContent({
        prompt: fullPrompt,
        isPremium,
        maxRetries: 3,
        behaviorMode
      });
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        console.error('Ошибка rate limit от Gemini API при обработке голосового:', error);
        await sendRateLimitMessage(ctx, true);
        return;
      }
      if (error instanceof ProhibitedContentError) {
        console.error('Ошибка PROHIBITED_CONTENT от Gemini API при обработке голосового:', error);
        await sendProhibitedContentMessage(ctx, userId, isPremium, behaviorMode);
        return;
      }
      console.error('Ошибка при генерации ответа на голосовое через Gemini:', error);
      throw error;
    }

    const voiceMatch = text.match(/\[VOICE:\s*(.+?)\]/);
    if (voiceMatch) {
      text = text.replace(/\[VOICE:\s*(.+?)\]/g, '');
      await voiceHandler.sendVoiceMessage(ctx, voiceMatch[1].trim());
      if (text.trim()) {
        await ctx.reply(text.trim());
      }
    } else {
      if (voiceHandler.shouldSendVoice()) {
        await voiceHandler.sendVoiceMessage(ctx, text);
      } else {
        await ctx.reply(text);
      }
    }

    await database.saveMessage(userId, ctx.from?.username, `[Голос] ${transcription}`, text, chatId, ctx.chat?.type);
    await database.updateUserActivity(userId);
  } catch (error) {
    console.error('Ошибка при обработке голосового сообщения:', error);
    try {
      if (userId && chatId) {
        await ctx.reply('Ой, что-то пошло не так при обработке голосового сообщения... 😅');
      }
    } catch (replyError) {
      console.error('Ошибка при отправке сообщения об ошибке:', replyError);
    }
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  
  try {
    const userMessage = ctx.message.text;
    const username = ctx.from?.username || ctx.from?.first_name;
    const chatType = ctx.chat?.type;
    
    if (!userId || !chatId) return;

    if (userMessage?.startsWith('/')) {
      return;
    }

    if (!shouldProcessMessage(userId)) return;

    await database.createOrUpdateUser(userId, username, ctx.from.first_name, ctx.from.last_name);

    const isGroup = chatType === 'group' || chatType === 'supergroup';
    let shouldRespond = false;

    if (isGroup) {
      const settings = await database.getGroupSettings(chatId);
      const isActive = settings?.isActive || false;
      const mentionMode = settings?.mentionMode !== false;
      
      const botMentioned = userMessage.includes('@youralyasanbot') || userMessage.includes('@youralyasanbot');
      const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
      
      if (isActive && !mentionMode) {
        shouldRespond = true;
      } else if (mentionMode && botMentioned) {
        shouldRespond = true;
      } else if (isReplyToBot) {
        shouldRespond = true;
      }
    } else {
      shouldRespond = true;
    }

    if (!shouldRespond) return;

    const isPremium = await subscriptionManager.checkUserSubscription(userId);
    
    if (!isPremium && !isGroup) {
      const limitCheck = rateLimiter.canSendMessage(userId);
      if (!limitCheck.allowed) {
        if (limitCheck.cooldownEnd) {
          await sendRateLimitMessage(ctx, false);
          return;
        }
      }
    }

    if (!isPremium && !isGroup) {
      const loadPercentage = apiLimitMonitor.getLoadPercentage();
      if (loadPercentage >= 100) {
        await sendRateLimitMessage(ctx, true);
        return;
      }
      await queueManager.addToQueue(userId, chatId, userMessage);
    }

    await ctx.sendChatAction('typing');
    const user = await database.getUser(userId);
    const behaviorMode = user?.behavior_mode || 'default';

    const chatHistory = await database.getChatHistory(userId, 10, isGroup ? chatId : undefined);
    const contextWithHistory = memoryManager.buildContextWithHistory(chatHistory, userMessage);
    
    const selectedPrompt = isGroup ? alyaPromptGroup : getBehaviorPrompt(behaviorMode, !isGroup);
    const fullPrompt = `${selectedPrompt}\n\n${contextWithHistory}\n\nАля:`;
    
    let text: string;
    try {
      text = await geminiClient.generateContent({
        prompt: fullPrompt,
        isPremium,
        maxRetries: 3,
        behaviorMode
      });
      
      if (text.trim() === '[NSFW_BLOCKED]' || text.trim().includes('[NSFW_BLOCKED]')) {
        await sendProhibitedContentMessage(ctx, userId, isPremium);
        return;
      }
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        console.error('Ошибка rate limit от Gemini API:', error);
        await sendRateLimitMessage(ctx, true);
        return;
      }
      if (error instanceof ProhibitedContentError) {
        console.error('Ошибка PROHIBITED_CONTENT от Gemini API:', error);
        await sendProhibitedContentMessage(ctx, userId, isPremium, behaviorMode);
        return;
      }
      console.error('Ошибка при генерации ответа через Gemini:', error);
      throw error;
    }

    const voiceMatch = text.match(/\[VOICE:\s*(.+?)\]/);
    if (voiceMatch && isPremium) {
      text = text.replace(/\[VOICE:\s*(.+?)\]/g, '');
      await voiceHandler.sendVoiceMessage(ctx, voiceMatch[1].trim());
      if (text.trim()) {
        await ctx.reply(text.trim());
      }
    } else {
      if (voiceHandler.shouldSendVoice() && isPremium) {
        await voiceHandler.sendVoiceMessage(ctx, text);
      } else {
        await ctx.reply(text);
      }
    }
    
    await database.saveMessage(userId, username, userMessage, text, chatId, chatType);
    await database.updateUserActivity(userId);
    
    if (!isPremium && !isGroup) {
      rateLimiter.recordMessage(userId);
    }
    
  } catch (error: any) {
    console.error('Ошибка при генерации ответа:', error);
    
    if (error instanceof RateLimitError) {
      await sendRateLimitMessage(ctx, true);
      return;
    }
    
    try {
      if (userId && chatId) {
        await ctx.reply('Ой, что-то пошло не так... 😅 Попробуй еще раз!');
      }
    } catch (replyError) {
      console.error('Ошибка при отправке сообщения об ошибке:', replyError);
    }
  }
});

bot.command('activate', async (ctx) => {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    
    if (!chatId || !userId) return;

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    if (!isGroup) {
      await ctx.reply('Эта команда работает только в группах!');
      return;
    }

    const isAdmin = await checkAdminStatus(ctx);
    if (!isAdmin) {
      await ctx.reply('Только администраторы могут активировать бота!');
      return;
    }

    await database.setGroupSettings(chatId, true, true, false);
    await ctx.reply('✅ Бот Аля активирован в группе! Теперь я буду отвечать на сообщения 😊');
  } catch (error) {
    console.error('Ошибка при активации:', error);
    await ctx.reply('Не могу активировать бота 😅');
  }
});

bot.command('deactivate', async (ctx) => {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    
    if (!chatId || !userId) return;

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    if (!isGroup) {
      await ctx.reply('Эта команда работает только в группах!');
      return;
    }

    const isAdmin = await checkAdminStatus(ctx);
    if (!isAdmin) {
      await ctx.reply('Только администраторы могут деактивировать бота!');
      return;
    }

    await database.setGroupSettings(chatId, false, true, false);
    await ctx.reply('❌ Бот Аля деактивирован в группе. Теперь отвечаю только на упоминания.');
  } catch (error) {
    console.error('Ошибка при деактивации:', error);
    await ctx.reply('Не могу деактивировать бота 😅');
  }
});

subscriptionManager.startPeriodicCheck();

let broadcastTask: cron.ScheduledTask | null = null;

function scheduleNextBroadcast(): void {
  if (broadcastTask) {
    broadcastTask.stop();
  }

  const hour = Math.floor(Math.random() * 12) + 9;
  const minute = Math.floor(Math.random() * 60);
  const schedule = `${minute} ${hour} * * *`;
  
  console.log(`Планирование рассылок Premium пользователям на: ${hour}:${minute.toString().padStart(2, '0')}`);

  broadcastTask = cron.schedule(schedule, async () => {
    const shouldSend = Math.random() < 0.7;
    if (shouldSend) {
      console.log('Запуск планирования рассылок для Premium пользователей...');
      await premiumBroadcast.scheduleBroadcastsForPremiumUsers();
    } else {
      console.log('Планирование рассылок пропущено (случайная вероятность)');
    }
    scheduleNextBroadcast();
  }, {
    timezone: 'Europe/Moscow'
  });
}

scheduleNextBroadcast();

async function updateBotDescription(): Promise<void> {
  try {
    const activeUsers = await database.getActiveUsersCount(5);
    
    let loadStatus = '🟢';
    let loadText = 'Низкая';
    let loadPercentage = 0;
    
    if (apiLimitMonitor) {
      loadPercentage = apiLimitMonitor.getLoadPercentage();
      
      if (loadPercentage >= 80) {
        loadStatus = '🔴';
        loadText = 'Повышенная';
      } else if (loadPercentage >= 40) {
        loadStatus = '🟡';
        loadText = 'Средняя';
      }
    } else {
      let error429Count = 0;
      try {
        error429Count = await database.getApiErrorCount('gemini_429', 3);
      } catch (error: any) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
          logger.debug('Таблица api_errors еще не создана, используем 0 ошибок');
          error429Count = 0;
        } else {
          logger.warn('Ошибка при получении количества ошибок 429', error);
        }
      }
      
      if (activeUsers >= 20) {
        loadStatus = '🔴';
        loadText = 'Повышенная';
      } else if (activeUsers >= 10) {
        loadStatus = '🟡';
        loadText = 'Средняя';
      }
      
      if (error429Count >= 8) {
        loadStatus = '🔴';
        loadText = 'Повышенная';
      } else if (error429Count > 3 && loadStatus !== '🔴') {
        loadStatus = '🟡';
        loadText = 'Средняя';
      }
    }
    
    const shortDescription = `💬 Общается: ${activeUsers} чел. | ${loadStatus} ${loadText}`;
    
    const fullDescription = `🤖 AI-компаньон Аля из аниме "Аля иногда кокетничает со мной по-русски"

✨ Бесплатно: общение, память, группы
⭐ Premium: режимы, фото, голос, инициативные сообщения

Просто напиши мне что-нибудь! 😊`;
    
    await bot.telegram.setMyShortDescription(shortDescription);
    await bot.telegram.setMyDescription(fullDescription);
    logger.debug('Описание бота обновлено', { activeUsers, loadPercentage, loadText });
  } catch (error) {
    logger.error('Ошибка при обновлении описания бота', error);
  }
}

cron.schedule('* * * * *', async () => {
  await updateBotDescription();
}, {
  timezone: 'Europe/Moscow'
});

cron.schedule('0 0 * * *', async () => {
  apiLimitMonitor.resetDailyLimits();
  logger.info('Дневные лимиты API сброшены');
}, {
  timezone: 'America/Los_Angeles'
});

updateBotDescription();

bot.launch();

logger.info('Бот Аля запущен! 🤖');

process.once('SIGINT', async () => {
  logger.info('Завершение работы бота... (SIGINT)');
  subscriptionManager.stopPeriodicCheck();
  apiLimitMonitor.stopMonitoring();
  await database.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', async () => {
  logger.info('Завершение работы бота... (SIGTERM)');
  subscriptionManager.stopPeriodicCheck();
  apiLimitMonitor.stopMonitoring();
  await database.close();
  bot.stop('SIGTERM');
});
