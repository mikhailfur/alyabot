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

bot.start((ctx) => {
  ctx.reply('Привет! Я Аля 😊 Рада познакомиться! Как дела?');
});

bot.help((ctx) => {
  ctx.reply('Просто напиши мне что-нибудь, и я отвечу! Я люблю общаться 😘\n\nДоступные команды:\n/start - Начать общение\n/help - Показать помощь\n/memory - Показать статистику общения\n/clear - Очистить историю общения');
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

bot.on('text', async (ctx) => {
  try {
    const userMessage = ctx.message.text;
    const userId = ctx.from?.id;
    const username = ctx.from?.username || ctx.from?.first_name;
    
    if (!userId) {
      await ctx.reply('Не могу определить пользователя 😅');
      return;
    }

    await ctx.sendChatAction('typing');

    const chatHistory = await database.getChatHistory(userId, 10);
    const contextWithHistory = memoryManager.buildContextWithHistory(chatHistory, userMessage);
    
    const fullPrompt = `${alyaPrompt}\n\n${contextWithHistory}\n\nАля:`;
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();
    
    await ctx.reply(text);
    
    await database.saveMessage(userId, username, userMessage, text);
    
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
