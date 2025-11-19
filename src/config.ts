import * as dotenv from 'dotenv';
dotenv.config();

export interface Config {
  telegramBotToken: string;
  geminiApiKey: string;
  geminiApiKeyPremium: string;
  minimaxApiToken: string;
  minimaxVoiceId: string;
  tributeChannelId: string;
  tributePaymentLink1Month: string;
  tributePaymentLink3Months: string;
  tributePaymentLink6Months: string;
  tributePaymentLink12Months: string;
  tributePaymentLinkTrial: string;
  adminIds: number[];
  subscriptionCheckInterval: number;
}

export const config: Config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiApiKeyPremium: process.env.GEMINI_API_KEY_PREMIUM || '',
  minimaxApiToken: process.env.MINIMAX_API_TOKEN || '',
  minimaxVoiceId: process.env.MINIMAX_VOICE_ID || '',
  tributeChannelId: process.env.TRIBUTE_CHANNEL_ID || '',
  tributePaymentLink1Month: process.env.TRIBUTE_PAYMENT_LINK_1_MONTH || '',
  tributePaymentLink3Months: process.env.TRIBUTE_PAYMENT_LINK_3_MONTHS || '',
  tributePaymentLink6Months: process.env.TRIBUTE_PAYMENT_LINK_6_MONTHS || '',
  tributePaymentLink12Months: process.env.TRIBUTE_PAYMENT_LINK_12_MONTHS || '',
  tributePaymentLinkTrial: process.env.TRIBUTE_PAYMENT_LINK_TRIAL || '',
  adminIds: (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)),
  subscriptionCheckInterval: parseInt(process.env.SUBSCRIPTION_CHECK_INTERVAL || '300000'),
};

export const validateConfig = (): void => {
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN не установлен в переменных окружения');
  }
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY не установлен в переменных окружения');
  }
};