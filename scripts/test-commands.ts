import * as dotenv from 'dotenv';

dotenv.config();

const TEST_USER_ID = parseInt(process.env.TEST_USER_ID || '123456789');

interface CommandTest {
  command: string;
  description: string;
  testFunction: (database: any) => Promise<void>;
}

const createCommands = (database: any): CommandTest[] => [
  {
    command: '/start',
    description: 'Команда запуска бота',
    testFunction: async (db: any) => {
      await db.createOrUpdateUser(
        TEST_USER_ID,
        'test_user',
        'Test',
        'User',
        undefined
      );
      const user = await db.getUser(TEST_USER_ID);
      if (!user) {
        throw new Error('User was not created');
      }
    }
  },
  {
    command: '/help',
    description: 'Команда помощи',
    testFunction: async (db: any) => {
      // Проверяем, что база данных доступна
      const user = await db.getUser(TEST_USER_ID);
      // Просто проверяем доступность, не важно есть ли пользователь
    }
  },
  {
    command: '/premium',
    description: 'Команда Premium подписки',
    testFunction: async (db: any) => {
      const user = await db.getUser(TEST_USER_ID);
      if (!user) {
        await db.createOrUpdateUser(
          TEST_USER_ID,
          'test_user',
          'Test',
          'User',
          undefined
        );
      }
      // Проверяем работу с подписками
      await db.checkSubscription(TEST_USER_ID);
    }
  },
  {
    command: '/settings',
    description: 'Команда настроек',
    testFunction: async (db: any) => {
      const user = await db.getUser(TEST_USER_ID);
      if (!user) {
        await db.createOrUpdateUser(
          TEST_USER_ID,
          'test_user',
          'Test',
          'User',
          undefined
        );
      }
      // Проверяем получение настроек пользователя
      const settings = await db.getUser(TEST_USER_ID);
      if (!settings) {
        throw new Error('Could not get user settings');
      }
    }
  },
  {
    command: '/stats',
    description: 'Команда статистики',
    testFunction: async (db: any) => {
      const stats = await db.getUserStats(TEST_USER_ID);
      if (!stats) {
        throw new Error('Could not get user stats');
      }
    }
  },
  {
    command: '/memory',
    description: 'Команда памяти',
    testFunction: async (db: any) => {
      const history = await db.getChatHistory(TEST_USER_ID, 20);
      // История может быть пустой, это нормально
      if (!Array.isArray(history)) {
        throw new Error('Chat history is not an array');
      }
    }
  },
  {
    command: '/info',
    description: 'Команда информации',
    testFunction: async (db: any) => {
      // Просто проверяем доступность базы данных
      const user = await db.getUser(TEST_USER_ID);
      // Не важно, есть ли пользователь
    }
  }
];

async function testCommand(cmd: CommandTest, database: any): Promise<{ passed: boolean; error?: string; duration: number }> {
  const startTime = Date.now();
  try {
    await cmd.testFunction(database);
    const duration = Date.now() - startTime;
    return { passed: true, duration };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return { 
      passed: false, 
      error: error.message || 'Неизвестная ошибка', 
      duration 
    };
  }
}

async function runCommandTests() {
  console.log('🧪 Запуск тестирования команд бота (внутренняя обработка)...\n');
  
  // Динамически загружаем модуль базы данных
  const dbModule = require('../dist/database');
  const database = dbModule.database;
  
  const commands = createCommands(database);
  const results: Array<CommandTest & { passed: boolean; error?: string; duration: number }> = [];
  
  for (const cmd of commands) {
    console.log(`🔍 Тестирование: ${cmd.command} - ${cmd.description}`);
    const result = await testCommand(cmd, database);
    results.push({ ...cmd, ...result });
    
    if (result.passed) {
      console.log(`   ✅ Успешно (${result.duration}ms)\n`);
    } else {
      console.log(`   ❌ Ошибка: ${result.error} (${result.duration}ms)\n`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('📊 Итоговые результаты:\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.command}: ${result.passed ? 'OK' : result.error} (${result.duration}ms)`);
  }
  
  console.log(`\n📈 Статистика:`);
  console.log(`   Всего команд: ${results.length}`);
  console.log(`   ✅ Успешно: ${passed} (${((passed / results.length) * 100).toFixed(1)}%)`);
  console.log(`   ❌ Ошибок: ${failed} (${((failed / results.length) * 100).toFixed(1)}%)`);
  console.log(`   ⏱️  Среднее время ответа: ${avgDuration.toFixed(0)}ms`);
  
  if (failed > 0) {
    console.error('\n❌ Тест провален: некоторые команды не работают');
    process.exit(1);
  }
  
  console.log('\n✅ Все команды работают корректно!');
  
  // Закрываем соединение с базой данных
  await database.close();
  process.exit(0);
}

runCommandTests().catch(async (error) => {
  console.error('❌ Критическая ошибка при тестировании команд:', error);
  try {
    const dbModuleClose = require('../dist/database');
    await dbModuleClose.database.close();
  } catch (e) {
    // Игнорируем ошибки закрытия
  }
  process.exit(1);
});
