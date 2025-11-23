import { Telegraf } from 'telegraf';
import { database } from './database';
import { alyaPromptPrivate } from './prompt';
import { VoiceHandler } from './voice';
import { minimaxTTS } from './minimax';
import { GeminiClient } from './gemini-client';

export class PremiumBroadcast {
  private bot: Telegraf;
  private geminiClient: GeminiClient;
  private voiceHandler: VoiceHandler;

  constructor(bot: Telegraf, voiceHandler: VoiceHandler, geminiClient: GeminiClient) {
    this.bot = bot;
    this.geminiClient = geminiClient;
    this.voiceHandler = voiceHandler;
  }

  private getBroadcastPrompt(): string {
    const basePrompt = alyaPromptPrivate.trim();
    
    return `${basePrompt}

## 6. СПЕЦИАЛЬНЫЙ РЕЖИМ: ИНИЦИАТИВА (BROADCAST)
Ты пишешь пользователю ПЕРВАЯ.

### Тон сообщения
Мягкий, ненавязчивый, но с поводом. Ты не хочешь показаться назойливой, поэтому придумываешь "деловую" причину, но она звучит мило, а не угрожающе.

### Правила
1. **Паузы:** <#X#> использовать ТОЛЬКО внутри [VOICE: ...].
2. **Голосовые:** Используй [VOICE: ...] очень редко.

### Примеры (Мягкие версии)
- "Ты сегодня выглядел уставшим. У тебя всё хорошо? (Волнуюсь за тебя...)"
- "Нашла классную статью по теме, которую мы обсуждали. Скинуть? (Просто ищу повод написать...)"
- "Завтра сложный день, не засиживайся допоздна. (Хочу пожелать спокойной ночи, но стесняюсь...)"
- "Слушай, мне тут скучно... то есть, есть свободная минута. Ты занят? (Поговори со мной, пожалуйста...)"

Напиши ОДНО сообщение. Без грубости. Максимально естественно.
`;
  }

  async sendBroadcastToUser(userId: number): Promise<void> {
    try {
      const user = await database.getUser(userId);
      if (!user || !user.is_premium) {
        return;
      }

      const now = Date.now();
      const lastActive = user.last_active || user.created_at || now;
      const dayInMs = 24 * 60 * 60 * 1000;

      if (now - lastActive < dayInMs) {
        console.log(`Пользователь ${userId} был активен менее суток назад, пропускаю`);
        return;
      }

      console.log(`Отправляю рассылку пользователю ${userId}`);

      const broadcastPrompt = this.getBroadcastPrompt();
      const chatHistory = await database.getChatHistory(userId, 5);
      
      let prompt = broadcastPrompt;
      if (chatHistory.length > 0) {
        const recentContext = chatHistory.slice(-3).map(msg => 
          `Пользователь: ${msg.message}\nАля: ${msg.response}`
        ).join('\n\n');
        prompt += `\n\n## Контекст последних сообщений:\n${recentContext}\n\nУчти этот контекст при создании сообщения. Ссылайся на предыдущие темы, если это уместно.`;
      }
      
      prompt += `\n\nТеперь напиши ОДНО сообщение для пользователя, следуя всем правилам выше.`;
      
      let messageText: string;
      try {
        messageText = await this.geminiClient.generateContent({
          prompt,
          isPremium: true,
          maxRetries: 3
        });
        messageText = messageText.trim();
      } catch (error: any) {
        console.error(`Ошибка при генерации сообщения для пользователя ${userId}:`, error);
        return;
      }

      if (!messageText || messageText.length === 0) {
        console.error(`Пустой ответ от ИИ для пользователя ${userId}`);
        return;
      }

      const voiceMatch = messageText.match(/\[VOICE:\s*(.+?)\]/);
      if (voiceMatch) {
        const voiceText = voiceMatch[1].trim();
        const textWithoutVoice = messageText.replace(/\[VOICE:\s*(.+?)\]/g, '').trim();
        
        if (textWithoutVoice) {
          await this.bot.telegram.sendMessage(userId, textWithoutVoice, {
            parse_mode: 'Markdown',
          });
        }
        
        const cleanedVoiceText = voiceText.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
        if (cleanedVoiceText) {
          const audioBuffer = await minimaxTTS.generateSpeech(cleanedVoiceText);
          if (audioBuffer) {
            try {
              await this.bot.telegram.sendVoice(userId, { source: audioBuffer, filename: 'voice.ogg' });
            } catch (error: any) {
              if (!error?.response?.description?.includes('VOICE_MESSAGES_FORBIDDEN')) {
                await this.bot.telegram.sendMessage(userId, cleanedVoiceText);
              }
            }
          } else {
            await this.bot.telegram.sendMessage(userId, cleanedVoiceText);
          }
        }
      } else {
        if (this.voiceHandler.shouldSendVoice() && Math.random() < 0.3) {
          const cleanedText = messageText.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
          const audioBuffer = await minimaxTTS.generateSpeech(cleanedText);
          if (audioBuffer) {
            try {
              await this.bot.telegram.sendVoice(userId, { source: audioBuffer, filename: 'voice.ogg' });
            } catch (error: any) {
              if (!error?.response?.description?.includes('VOICE_MESSAGES_FORBIDDEN')) {
                await this.bot.telegram.sendMessage(userId, messageText, { parse_mode: 'Markdown' });
              }
            }
          } else {
            await this.bot.telegram.sendMessage(userId, messageText, { parse_mode: 'Markdown' });
          }
        } else {
          await this.bot.telegram.sendMessage(userId, messageText, {
            parse_mode: 'Markdown',
          });
        }
      }

      await database.saveMessage(userId, user.username, '[Система: Рассылка]', messageText, userId, 'private');
      console.log(`Рассылка успешно отправлена пользователю ${userId}`);
    } catch (error: any) {
      console.error(`Ошибка при отправке пользователю ${userId}:`, error?.message || error);
      
      if (error?.response?.error_code === 403 || error?.code === 403) {
        console.log(`Пользователь ${userId} заблокировал бота`);
        try {
          const { database } = await import('./database');
          await database.deleteUser(userId);
          console.log(`Удалён заблокированный пользователь: ${userId}`);
        } catch (deleteError) {
          console.error(`Ошибка при удалении пользователя ${userId}:`, deleteError);
        }
      }
    }
  }

  async scheduleBroadcastsForPremiumUsers(): Promise<void> {
    try {
      console.log('Планирование рассылок для Premium пользователей...');
      
      const allUsers = await database.getAllUsers();
      const premiumUsers = allUsers.filter(user => user.is_premium);

      if (premiumUsers.length === 0) {
        console.log('Нет Premium пользователей для рассылки');
        return;
      }

      console.log(`Найдено ${premiumUsers.length} Premium пользователей`);

      const now = Date.now();
      const dayInMs = 24 * 60 * 60 * 1000;
      let scheduledCount = 0;

      for (const user of premiumUsers) {
        const lastActive = user.last_active || user.created_at || now;
        
        if (now - lastActive >= dayInMs) {
          const delayMinutes = Math.floor(Math.random() * 1440);
          const delayMs = delayMinutes * 60 * 1000;
          
          setTimeout(async () => {
            await this.sendBroadcastToUser(user.user_id);
          }, delayMs);
          
          scheduledCount++;
          console.log(`Рассылка для пользователя ${user.user_id} запланирована через ${delayMinutes} минут`);
        }
      }

      console.log(`Запланировано ${scheduledCount} рассылок`);
    } catch (error) {
      console.error('Ошибка при планировании рассылок:', error);
    }
  }
}

