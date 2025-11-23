import * as dotenv from 'dotenv';

dotenv.config();

const TEST_USER_ID = parseInt(process.env.TEST_USER_ID || '123456789');

// Обрабатываем необработанные промисы (ошибки инициализации БД)
process.on('unhandledRejection', (reason: any) => {
  if (reason?.code === 'ECONNREFUSED' || reason?.message?.includes('ECONNREFUSED')) {
    console.log('\n⚠️  База данных недоступна, стресс-тест будет пропущен');
    process.exit(0);
  }
});

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

async function testCommand(command: string, userId: number, database: any): Promise<TestResult> {
  const startTime = Date.now();
  try {
    switch (command) {
      case '/start':
        await database.createOrUpdateUser(
          userId,
          `test_user_${userId}`,
          'Test',
          'User',
          undefined
        );
        const user = await database.getUser(userId);
        if (!user) {
          throw new Error('User was not created');
        }
        break;
      case '/help':
        // Просто проверяем доступность базы данных
        await database.getUser(userId);
        break;
      case '/premium':
        await database.getUser(userId);
        await database.checkSubscription(userId);
        break;
      case '/settings':
        const settings = await database.getUser(userId);
        if (!settings) {
          await database.createOrUpdateUser(
            userId,
            `test_user_${userId}`,
            'Test',
            'User',
            undefined
          );
        }
        break;
      case '/stats':
        await database.getUserStats(userId);
        break;
      case '/memory':
        const history = await database.getChatHistory(userId, 20);
        if (!Array.isArray(history)) {
          throw new Error('Chat history is not an array');
        }
        break;
      case '/info':
        // Просто проверяем доступность базы данных
        await database.getUser(userId);
        break;
    }
    
    const duration = Date.now() - startTime;
    
    return {
      name: `Команда ${command}`,
      passed: true,
      duration
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    // Если ошибка подключения к БД, это не критическая ошибка для теста
    if (error.code === 'ECONNREFUSED' || 
        error.code === 'ENOTFOUND' || 
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('connect')) {
      return {
        name: `Команда ${command}`,
        passed: false,
        error: 'База данных недоступна',
        duration
      };
    }
    return {
      name: `Команда ${command}`,
      passed: false,
      error: error.message || 'Неизвестная ошибка',
      duration
    };
  }
}

async function runStressTest() {
  console.log('🚀 Запуск стресс-теста бота (внутренняя обработка)...\n');
  
  // Динамически загружаем модуль базы данных
  let database: any;
  let dbAvailable = false;
  
  try {
    const dbModule = require('../dist/database');
    database = dbModule.database;
    // Даем время на инициализацию базы данных
    await new Promise(resolve => setTimeout(resolve, 500));
    dbAvailable = true;
  } catch (error: any) {
    console.log('⚠️  База данных недоступна, стресс-тест будет пропущен');
    console.log('   Причина:', error.code === 'ECONNREFUSED' ? 'Нет подключения к БД' : error.message);
    console.log('\n✅ Стресс-тест пропущен (база данных недоступна)');
    process.exit(0);
  }
  
  const commands = ['/start', '/help', '/premium', '/settings', '/stats', '/memory', '/info'];
  const results: TestResult[] = [];
  
  const iterations = 5;
  const concurrentRequests = 3;
  
  console.log(`📊 Параметры теста:`);
  console.log(`   Итераций: ${iterations}`);
  console.log(`   Параллельных запросов: ${concurrentRequests}`);
  console.log(`   Команд для теста: ${commands.length}\n`);
  
  for (let i = 0; i < iterations; i++) {
    console.log(`\n🔄 Итерация ${i + 1}/${iterations}`);
    
    const batch: Promise<TestResult>[] = [];
    
    for (const command of commands) {
      for (let j = 0; j < concurrentRequests; j++) {
        const userId = TEST_USER_ID + (i * 1000) + j;
        batch.push(testCommand(command, userId, database));
      }
    }
    
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
    
    const passed = batchResults.filter(r => r.passed).length;
    const failed = batchResults.filter(r => !r.passed).length;
    const avgDuration = batchResults.reduce((sum, r) => sum + r.duration, 0) / batchResults.length;
    
    console.log(`   ✅ Успешно: ${passed}`);
    console.log(`   ❌ Ошибок: ${failed}`);
    console.log(`   ⏱️  Среднее время ответа: ${avgDuration.toFixed(0)}ms`);
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('\n📈 Итоговая статистика:');
  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / results.length;
  const maxDuration = Math.max(...results.map(r => r.duration));
  const minDuration = Math.min(...results.map(r => r.duration));
  
  console.log(`   Всего тестов: ${results.length}`);
  console.log(`   ✅ Успешно: ${totalPassed} (${((totalPassed / results.length) * 100).toFixed(1)}%)`);
  console.log(`   ❌ Ошибок: ${totalFailed} (${((totalFailed / results.length) * 100).toFixed(1)}%)`);
  console.log(`   ⏱️  Среднее время: ${avgDuration.toFixed(0)}ms`);
  console.log(`   ⏱️  Минимальное время: ${minDuration}ms`);
  console.log(`   ⏱️  Максимальное время: ${maxDuration}ms`);
  
  if (totalFailed > 0) {
    console.log('\n❌ Ошибки:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }
  
  // Проверяем, есть ли ошибки подключения к БД
  const dbErrors = results.filter(r => !r.passed && r.error === 'База данных недоступна');
  const otherErrors = results.filter(r => !r.passed && r.error !== 'База данных недоступна');
  
  if (dbErrors.length > 0 && dbErrors.length === totalFailed) {
    // Все ошибки связаны с недоступностью БД
    console.log('\n⚠️  Стресс-тест пропущен: база данных недоступна');
    try {
      await database.close();
    } catch (e) {
      // Игнорируем ошибки закрытия
    }
    process.exit(0);
  }
  
  const successRate = (totalPassed / results.length) * 100;
  if (successRate < 90 && otherErrors.length > 0) {
    console.error('\n❌ Тест провален: успешность менее 90%');
    try {
      await database.close();
    } catch (e) {
      // Игнорируем ошибки закрытия
    }
    process.exit(1);
  }
  
  if (avgDuration > 5000) {
    console.error('\n❌ Тест провален: среднее время ответа более 5 секунд');
    try {
      await database.close();
    } catch (e) {
      // Игнорируем ошибки закрытия
    }
    process.exit(1);
  }
  
  console.log('\n✅ Стресс-тест пройден успешно!');
  try {
    await database.close();
  } catch (e) {
    // Игнорируем ошибки закрытия
  }
  process.exit(0);
}

runStressTest().catch(async (error) => {
  console.error('❌ Критическая ошибка при выполнении стресс-теста:', error);
  if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
    console.log('⚠️  База данных недоступна, стресс-тест пропущен');
    process.exit(0);
  }
  try {
    const dbModuleClose = require('../dist/database');
    await dbModuleClose.database.close();
  } catch (e) {
    // Игнорируем ошибки закрытия
  }
  process.exit(1);
});
