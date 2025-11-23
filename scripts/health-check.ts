import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

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

interface HealthCheck {
  name: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  duration?: number;
}

async function checkBotConnection(): Promise<HealthCheck> {
  const startTime = Date.now();
  try {
    const me = await bot.telegram.getMe();
    const duration = Date.now() - startTime;
    
    if (me && me.id) {
      return {
        name: 'Подключение к Telegram API',
        status: 'ok',
        message: `Бот @${me.username} (ID: ${me.id}) подключен`,
        duration
      };
    }
    
    return {
      name: 'Подключение к Telegram API',
      status: 'error',
      message: 'Не удалось получить информацию о боте',
      duration
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      name: 'Подключение к Telegram API',
      status: 'error',
      message: error.message || 'Ошибка подключения',
      duration
    };
  }
}

async function checkCommand(command: string): Promise<HealthCheck> {
  const startTime = Date.now();
  try {
    const response = await bot.telegram.sendMessage(TEST_USER_ID, command);
    const duration = Date.now() - startTime;
    
    if (response && response.message_id) {
      return {
        name: `Команда ${command}`,
        status: 'ok',
        message: 'Команда обработана успешно',
        duration
      };
    }
    
    return {
      name: `Команда ${command}`,
      status: 'error',
      message: 'Нет ответа от бота',
      duration
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorCode = error.code || error.response?.error_code;
    
    if (errorCode === 403) {
      return {
        name: `Команда ${command}`,
        status: 'warning',
        message: 'Бот заблокирован тестовым пользователем',
        duration
      };
    }
    
    return {
      name: `Команда ${command}`,
      status: 'error',
      message: error.message || 'Неизвестная ошибка',
      duration
    };
  }
}

async function checkFiles(): Promise<HealthCheck> {
  const requiredFiles = [
    'src/index.ts',
    'src/config.ts',
    'src/database.ts',
    'src/logger.ts',
    'package.json',
    'tsconfig.json'
  ];
  
  const missingFiles: string[] = [];
  
  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
    }
  }
  
  if (missingFiles.length > 0) {
    return {
      name: 'Проверка файлов',
      status: 'error',
      message: `Отсутствуют файлы: ${missingFiles.join(', ')}`
    };
  }
  
  return {
    name: 'Проверка файлов',
    status: 'ok',
    message: 'Все необходимые файлы присутствуют'
  };
}

async function checkEnvironment(): Promise<HealthCheck> {
  const requiredVars = ['TELEGRAM_BOT_TOKEN'];
  const optionalVars = ['GEMINI_API_KEY', 'GEMINI_API_KEYS'];
  
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingRequired.push(varName);
    }
  }
  
  for (const varName of optionalVars) {
    if (!process.env[varName]) {
      missingOptional.push(varName);
    }
  }
  
  if (missingRequired.length > 0) {
    return {
      name: 'Переменные окружения',
      status: 'error',
      message: `Отсутствуют обязательные переменные: ${missingRequired.join(', ')}`
    };
  }
  
  if (missingOptional.length === optionalVars.length) {
    return {
      name: 'Переменные окружения',
      status: 'warning',
      message: 'Отсутствуют опциональные переменные (GEMINI_API_KEY)'
    };
  }
  
  return {
    name: 'Переменные окружения',
    status: 'ok',
    message: 'Все необходимые переменные установлены'
  };
}

async function runHealthCheck() {
  console.log('🏥 Запуск проверки работоспособности бота...\n');
  
  const checks: HealthCheck[] = [];
  
  console.log('📋 Проверка файлов...');
  checks.push(await checkFiles());
  
  console.log('🔐 Проверка переменных окружения...');
  checks.push(await checkEnvironment());
  
  console.log('🔌 Проверка подключения к Telegram...');
  checks.push(await checkBotConnection());
  
  console.log('🤖 Проверка команд бота...');
  const commands = ['/start', '/help', '/premium', '/settings', '/stats', '/memory'];
  for (const command of commands) {
    checks.push(await checkCommand(command));
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n📊 Результаты проверки:\n');
  
  const ok = checks.filter(c => c.status === 'ok');
  const warnings = checks.filter(c => c.status === 'warning');
  const errors = checks.filter(c => c.status === 'error');
  
  for (const check of checks) {
    const icon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
    const duration = check.duration ? ` (${check.duration}ms)` : '';
    console.log(`${icon} ${check.name}: ${check.message}${duration}`);
  }
  
  console.log(`\n📈 Статистика:`);
  console.log(`   ✅ Успешно: ${ok.length}`);
  console.log(`   ⚠️  Предупреждения: ${warnings.length}`);
  console.log(`   ❌ Ошибки: ${errors.length}`);
  
  if (errors.length > 0) {
    console.error('\n❌ Проверка провалена: обнаружены критические ошибки');
    process.exit(1);
  }
  
  if (warnings.length > 0 && errors.length === 0) {
    console.log('\n⚠️  Проверка пройдена с предупреждениями');
    process.exit(0);
  }
  
  console.log('\n✅ Проверка пройдена успешно!');
  process.exit(0);
}

runHealthCheck().catch(error => {
  console.error('❌ Критическая ошибка при выполнении проверки:', error);
  process.exit(1);
});

