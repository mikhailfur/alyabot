import { Telegraf } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { config, validateConfig } from './config';
import { database } from './database';
import { memoryManager } from './memory';
import { alyaPrompt } from './prompt';

dotenv.config();
validateConfig();

const bot = new Telegraf(config.telegramBotToken);
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function checkAdminStatus(ctx: any): Promise<boolean> {
  try {
    if (!ctx.from?.id || !ctx.chat?.id) return false;
    
    const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return chatMember.status === 'administrator' || chatMember.status === 'creator';
  } catch (error) {
    console.error('Ошибка при проверке статуса администратора:', error);
    return false;
  }
}

bot.start((ctx) => {
  ctx.reply('Привет! Я Аля 😊 Рада познакомиться! Как дела?');
});

bot.help((ctx) => {
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  
  if (isGroup) {
    ctx.reply('Привет! Я Аля 😊\n\nКоманды для групп:\n/activate - Активировать бота в группе\n/deactivate - Деактивировать бота\n/settings - Настройки группы\n\nВ группах отвечаю только когда меня упоминают @alyabot или когда бот активирован!');
  } else {
    ctx.reply('Просто напиши мне что-нибудь, и я отвечу! Я люблю общаться 😘\n\nДоступные команды:\n/start - Начать общение\n/help - Показать помощь\n/memory - Показать статистику общения\n/clear - Очистить историю общения');
  }
});

bot.command('memory', async (ctx) => {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('Не могу определить пользователя 😅');
      return;
    }

    await ctx.sendChatAction('typing');

    const stats = await database.getUserStats(userId);
    const message = `📊 Статистика нашего общения:\n\n` +
      `💬 Всего сообщений: ${stats.totalMessages}\n` +
      `📅 Первое сообщение: ${stats.firstMessage ? new Date(stats.firstMessage).toLocaleDateString('ru-RU') : 'Нет данных'}\n` +
      `🕐 Последнее сообщение: ${stats.lastMessage ? new Date(stats.lastMessage).toLocaleDateString('ru-RU') : 'Нет данных'}`;
    
    await ctx.reply(message);
  } catch (error) {
    console.error('Ошибка при получении статистики:', error);
    await ctx.reply('Не могу получить статистику 😅');
  }
});

bot.command('clear', async (ctx) => {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('Не могу определить пользователя 😅');
      return;
    }

    await ctx.sendChatAction('typing');

    await database.clearUserHistory(userId);
    await ctx.reply('История общения очищена! Начнем с чистого листа 😊');
  } catch (error) {
    console.error('Ошибка при очистке истории:', error);
    await ctx.reply('Не могу очистить историю 😅');
  }
});

bot.command('activate', async (ctx) => {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    
    if (!chatId || !userId) {
      await ctx.reply('Не могу определить чат или пользователя 😅');
      return;
    }

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
    
    if (!chatId || !userId) {
      await ctx.reply('Не могу определить чат или пользователя 😅');
      return;
    }

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

bot.command('settings', async (ctx) => {
  try {
    const chatId = ctx.chat?.id;
    
    if (!chatId) {
      await ctx.reply('Не могу определить чат 😅');
      return;
    }

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    if (!isGroup) {
      await ctx.reply('Эта команда работает только в группах!');
      return;
    }

    const settings = await database.getGroupSettings(chatId);
    if (!settings) {
      await ctx.reply('Группа не настроена. Используйте /activate для активации бота.');
      return;
    }

    const status = settings.isActive ? '✅ Активен' : '❌ Неактивен';
    const mentionMode = settings.mentionMode ? '✅ Включен' : '❌ Выключен';
    const adminOnly = settings.adminOnly ? '✅ Только админы' : '❌ Все пользователи';

    await ctx.reply(`⚙️ Настройки группы:\n\n` +
      `Статус: ${status}\n` +
      `Режим упоминаний: ${mentionMode}\n` +
      `Доступ: ${adminOnly}`);
  } catch (error) {
    console.error('Ошибка при получении настроек:', error);
    await ctx.reply('Не могу получить настройки 😅');
  }
});

bot.on('text', async (ctx) => {
  try {
    const userMessage = ctx.message.text;
    const userId = ctx.from?.id;
    const username = ctx.from?.username || ctx.from?.first_name;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;
    
    if (!userId || !chatId) {
      await ctx.reply('Не могу определить пользователя или чат 😅');
      return;
    }

    const isGroup = chatType === 'group' || chatType === 'supergroup';
    let shouldRespond = false;

    if (isGroup) {
      const settings = await database.getGroupSettings(chatId);
      const isActive = settings?.isActive || false;
      const mentionMode = settings?.mentionMode !== false;
      
      const botMentioned = userMessage.includes('@alyabot') || userMessage.includes('@AlyaBot');
      
      if (isActive && !mentionMode) {
        shouldRespond = true;
      } else if (mentionMode && botMentioned) {
        shouldRespond = true;
      }
    } else {
      shouldRespond = true;
    }

    if (!shouldRespond) {
      return;
    }

    await ctx.sendChatAction('typing');

    const chatHistory = await database.getChatHistory(userId, 10, isGroup ? chatId : undefined);
    const contextWithHistory = memoryManager.buildContextWithHistory(chatHistory, userMessage);
    
    const fullPrompt = `${alyaPrompt}\n\n${contextWithHistory}\n\nАля:`;
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();
    
    await ctx.reply(text);
    
    await database.saveMessage(userId, username, userMessage, text, chatId, chatType);
    
  } catch (error) {
    console.error('Ошибка при генерации ответа:', error);
    await ctx.reply('Ой, что-то пошло не так... 😅 Попробуй еще раз!');
  }
});

bot.launch();

console.log('Бот Аля запущен! 🤖');

process.once('SIGINT', () => {
  console.log('Завершение работы бота...');
  database.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('Завершение работы бота...');
  database.close();
  bot.stop('SIGTERM');
});
