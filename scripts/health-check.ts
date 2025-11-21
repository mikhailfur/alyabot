import * as dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import { config, validateConfig } from '../src/config';

dotenv.config();

async function healthCheck() {
  console.log('🏥 Проверка работоспособности бота...\n');

  const startTime = Date.now();
  let bot: Telegraf | null = null;

  try {
    validateConfig();
    console.log('✅ Конфигурация валидна');

    bot = new Telegraf(config.telegramBotToken);
    console.log('✅ Экземпляр бота создан');

    const me = await bot.telegram.getMe();
    console.log(`✅ Бот активен: @${me.username} (${me.first_name})`);

    const webhookInfo = await bot.telegram.getWebhookInfo();
    console.log(`✅ Webhook статус: ${webhookInfo.url || 'не установлен'}`);

    if (config.geminiApiKeys.length === 0) {
      throw new Error('GEMINI_API_KEY не установлен');
    }
    console.log(`✅ Gemini API ключи настроены (${config.geminiApiKeys.length})`);

    const elapsed = Date.now() - startTime;
    console.log(`\n✅ Все проверки пройдены за ${elapsed}ms`);
    console.log('🤖 Бот готов к работе!');

    await bot.stop();
    process.exit(0);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`\n❌ Ошибка проверки (${elapsed}ms):`, error);

    if (bot) {
      try {
        await bot.stop();
      } catch (stopError) {
        console.error('Ошибка при остановке бота:', stopError);
      }
    }

    process.exit(1);
  }
}

healthCheck();

