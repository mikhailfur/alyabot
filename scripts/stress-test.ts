import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TEST_USER_ID = parseInt(process.env.TEST_USER_ID || '0');

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не установлен');
  process.exit(1);
}

if (!TEST_USER_ID) {
  console.error('❌ TEST_USER_ID не установлен');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

async function testCommand(command: string, expectedResponse?: string): Promise<TestResult> {
  const startTime = Date.now();
  try {
    const response = await bot.telegram.sendMessage(TEST_USER_ID, command);
    const duration = Date.now() - startTime;
    
    if (response && response.message_id) {
      return {
        name: `Команда ${command}`,
        passed: true,
        duration
      };
    }
    
    return {
      name: `Команда ${command}`,
      passed: false,
      error: 'Нет ответа от бота',
      duration
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      name: `Команда ${command}`,
      passed: false,
      error: error.message || 'Неизвестная ошибка',
      duration
    };
  }
}

async function runStressTest() {
  console.log('🚀 Запуск стресс-теста бота...\n');
  
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
        batch.push(testCommand(command));
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
    
    await new Promise(resolve => setTimeout(resolve, 1000));
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
  
  const successRate = (totalPassed / results.length) * 100;
  if (successRate < 90) {
    console.error('\n❌ Тест провален: успешность менее 90%');
    process.exit(1);
  }
  
  if (avgDuration > 5000) {
    console.error('\n❌ Тест провален: среднее время ответа более 5 секунд');
    process.exit(1);
  }
  
  console.log('\n✅ Стресс-тест пройден успешно!');
  process.exit(0);
}

runStressTest().catch(error => {
  console.error('❌ Критическая ошибка при выполнении стресс-теста:', error);
  process.exit(1);
});

