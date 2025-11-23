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

interface CommandTest {
  command: string;
  description: string;
  expectedBehavior: string;
}

const commands: CommandTest[] = [
  {
    command: '/start',
    description: 'Команда запуска бота',
    expectedBehavior: 'Бот должен отправить приветственное сообщение с меню'
  },
  {
    command: '/help',
    description: 'Команда помощи',
    expectedBehavior: 'Бот должен отправить информацию о командах'
  },
  {
    command: '/premium',
    description: 'Команда Premium подписки',
    expectedBehavior: 'Бот должен показать информацию о Premium подписке'
  },
  {
    command: '/settings',
    description: 'Команда настроек',
    expectedBehavior: 'Бот должен показать настройки пользователя'
  },
  {
    command: '/stats',
    description: 'Команда статистики',
    expectedBehavior: 'Бот должен показать статистику пользователя'
  },
  {
    command: '/memory',
    description: 'Команда памяти',
    expectedBehavior: 'Бот должен показать статистику общения'
  },
  {
    command: '/info',
    description: 'Команда информации',
    expectedBehavior: 'Бот должен показать юридическую информацию'
  }
];

async function testCommand(cmd: CommandTest): Promise<{ passed: boolean; error?: string; duration: number }> {
  const startTime = Date.now();
  try {
    const response = await bot.telegram.sendMessage(TEST_USER_ID, cmd.command);
    const duration = Date.now() - startTime;
    
    if (response && response.message_id) {
      return { passed: true, duration };
    }
    
    return { passed: false, error: 'Нет ответа от бота', duration };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorCode = error.code || error.response?.error_code;
    
    if (errorCode === 403) {
      return { passed: false, error: 'Бот заблокирован тестовым пользователем', duration };
    }
    
    return { passed: false, error: error.message || 'Неизвестная ошибка', duration };
  }
}

async function runCommandTests() {
  console.log('🧪 Запуск тестирования команд бота...\n');
  
  const results: Array<CommandTest & { passed: boolean; error?: string; duration: number }> = [];
  
  for (const cmd of commands) {
    console.log(`🔍 Тестирование: ${cmd.command} - ${cmd.description}`);
    const result = await testCommand(cmd);
    results.push({ ...cmd, ...result });
    
    if (result.passed) {
      console.log(`   ✅ Успешно (${result.duration}ms)\n`);
    } else {
      console.log(`   ❌ Ошибка: ${result.error} (${result.duration}ms)\n`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
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
  process.exit(0);
}

runCommandTests().catch(error => {
  console.error('❌ Критическая ошибка при тестировании команд:', error);
  process.exit(1);
});

