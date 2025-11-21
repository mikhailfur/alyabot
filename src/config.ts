import * as dotenv from 'dotenv';
dotenv.config();

export interface Config {
  telegramBotToken: string;
  geminiApiKeys: string[];
  geminiApiKeysPremium: string[];
  minimaxApiToken: string;
  minimaxVoiceId: string;
  tributeChannelId: string;
  tributePaymentLink1Month: string;
  tributePaymentLink3Months: string;
  tributePaymentLink6Months: string;
  tributePaymentLink12Months: string;
  tributePaymentLinkTrial: string;
  referalChannelId: string;
  referalChannelLink: string;
  adminIds: number[];
  subscriptionCheckInterval: number;
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlDatabase: string;
}

function parseMySQLConnectionString(connectionString?: string): { host: string; port: number; user: string; password: string; database: string } | null {
  if (!connectionString) return null;
  
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.replace('/', ''),
    };
  } catch (error) {
    return null;
  }
}

const mysqlConnection = parseMySQLConnectionString(process.env.MYSQL_CONNECTION_STRING);

function parseApiKeys(envVar?: string, fallback?: string): string[] {
  if (envVar) {
    return envVar.split(',').map(key => key.trim()).filter(key => key.length > 0);
  }
  if (fallback) {
    return [fallback];
  }
  return [];
}

const freeApiKeys = parseApiKeys(
  process.env.GEMINI_API_KEYS,
  process.env.GEMINI_API_KEY
);

const premiumApiKeys = parseApiKeys(
  process.env.GEMINI_API_KEYS_PREMIUM,
  process.env.GEMINI_API_KEY_PREMIUM
);

export const config: Config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  geminiApiKeys: freeApiKeys,
  geminiApiKeysPremium: premiumApiKeys,
  minimaxApiToken: process.env.MINIMAX_API_TOKEN || '',
  minimaxVoiceId: process.env.MINIMAX_VOICE_ID || '',
  tributeChannelId: process.env.TRIBUTE_CHANNEL_ID || '',
  tributePaymentLink1Month: process.env.TRIBUTE_PAYMENT_LINK_1_MONTH || '',
  tributePaymentLink3Months: process.env.TRIBUTE_PAYMENT_LINK_3_MONTHS || '',
  tributePaymentLink6Months: process.env.TRIBUTE_PAYMENT_LINK_6_MONTHS || '',
  tributePaymentLink12Months: process.env.TRIBUTE_PAYMENT_LINK_12_MONTHS || '',
  tributePaymentLinkTrial: process.env.TRIBUTE_PAYMENT_LINK_TRIAL || '',
  referalChannelId: process.env.REFERAL_CHANNEL_ID || '',
  referalChannelLink: process.env.REFERAL_CHANNEL_LINK || '',
  adminIds: (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)),
  subscriptionCheckInterval: parseInt(process.env.SUBSCRIPTION_CHECK_INTERVAL || '300000'),
  mysqlHost: mysqlConnection?.host || process.env.MYSQL_HOST || 'localhost',
  mysqlPort: mysqlConnection?.port || parseInt(process.env.MYSQL_PORT || '3306'),
  mysqlUser: mysqlConnection?.user || process.env.MYSQL_USER || 'root',
  mysqlPassword: mysqlConnection?.password || process.env.MYSQL_PASSWORD || '',
  mysqlDatabase: mysqlConnection?.database || process.env.MYSQL_DATABASE || 'alyabot',
};

export const validateConfig = (): void => {
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN не установлен в переменных окружения');
  }
  if (config.geminiApiKeys.length === 0) {
    throw new Error('GEMINI_API_KEY или GEMINI_API_KEYS не установлен в переменных окружения');
  }
};