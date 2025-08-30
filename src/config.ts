import * as dotenv from 'dotenv';
dotenv.config();

export interface Config {
  telegramBotToken: string;
  geminiApiKey: string;
}

export const config: Config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};

export const validateConfig = (): void => {
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN не установлен в переменных окружения');
  }
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY не установлен в переменных окружения');
  }
};