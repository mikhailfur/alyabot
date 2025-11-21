import * as dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import { config, validateConfig } from '../src/config';

dotenv.config();

async function stressTest() {
  console.log('🧪 Начало стресс-теста...\n');

  try {
    validateConfig();
  } catch (error) {
    console.error('❌ Ошибка валидации конфигурации:', error);
    process.exit(1);
  }

  const bot = new Telegraf(config.telegramBotToken);
  const testResults = {
    botInitialized: false,
    apiConnection: false,
    errors: [] as string[],
  };

  try {
    console.log('1️⃣ Проверка инициализации бота...');
    await bot.telegram.getMe();
    testResults.botInitialized = true;
    console.log('✅ Бот успешно инициализирован\n');
  } catch (error) {
    testResults.errors.push(`Ошибка инициализации бота: ${error}`);
    console.error('❌ Ошибка инициализации бота:', error);
  }

  try {
    console.log('2️⃣ Проверка подключения к Telegram API...');
    const me = await bot.telegram.getMe();
    testResults.apiConnection = true;
    console.log(`✅ Подключение к API успешно (бот: @${me.username})\n`);
  } catch (error) {
    testResults.errors.push(`Ошибка подключения к API: ${error}`);
    console.error('❌ Ошибка подключения к API:', error);
  }

  try {
    console.log('3️⃣ Проверка конфигурации Gemini API...');
    if (config.geminiApiKeys.length === 0) {
      throw new Error('GEMINI_API_KEY не установлен');
    }
    console.log(`✅ Найдено ${config.geminiApiKeys.length} API ключей\n`);
  } catch (error) {
    testResults.errors.push(`Ошибка конфигурации Gemini: ${error}`);
    console.error('❌ Ошибка конфигурации Gemini:', error);
  }

  try {
    console.log('4️⃣ Симуляция нагрузки (10 последовательных запросов)...');
    const requests = Array.from({ length: 10 }, (_, i) => i + 1);
    let successCount = 0;
    let failCount = 0;

    for (const requestNum of requests) {
      try {
        await bot.telegram.getMe();
        successCount++;
        if (requestNum % 3 === 0) {
          console.log(`   Запрос ${requestNum}/10: ✅`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failCount++;
        console.error(`   Запрос ${requestNum}/10: ❌ ${error}`);
      }
    }

    console.log(`\n✅ Завершено: ${successCount} успешных, ${failCount} неудачных\n`);
  } catch (error) {
    testResults.errors.push(`Ошибка стресс-теста: ${error}`);
    console.error('❌ Ошибка стресс-теста:', error);
  }

  await bot.stop();

  console.log('📊 Итоговые результаты:');
  console.log(`   Бот инициализирован: ${testResults.botInitialized ? '✅' : '❌'}`);
  console.log(`   API подключение: ${testResults.apiConnection ? '✅' : '❌'}`);
  console.log(`   Ошибок: ${testResults.errors.length}\n`);

  if (testResults.errors.length > 0) {
    console.log('❌ Обнаружены ошибки:');
    testResults.errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error}`);
    });
    process.exit(1);
  }

  if (!testResults.botInitialized || !testResults.apiConnection) {
    console.log('❌ Критические проверки не пройдены');
    process.exit(1);
  }

  console.log('✅ Все проверки пройдены успешно!');
  process.exit(0);
}

stressTest().catch((error) => {
  console.error('💥 Критическая ошибка:', error);
  process.exit(1);
});

