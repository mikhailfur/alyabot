import { Telegraf } from 'telegraf';
import { minimaxTTS } from './minimax';
import { GeminiClient } from './gemini-client';
import { config } from './config';

export class VoiceHandler {
  private bot: Telegraf;
  private geminiClient: GeminiClient;

  constructor(bot: Telegraf, geminiClient: GeminiClient) {
    this.bot = bot;
    this.geminiClient = geminiClient;
  }

  async processVoiceMessage(ctx: any, isPremium: boolean = false): Promise<string | null> {
    try {
      const voice = ctx.message.voice;
      if (!voice) return null;

      const fileId = voice.file_id;
      const file = await this.bot.telegram.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const audioBuffer = await response.arrayBuffer();

      const transcription = await this.transcribeAudio(audioBuffer, isPremium);
      return transcription;
    } catch (error) {
      console.error('Ошибка при обработке голосового сообщения:', error);
      return null;
    }
  }

  private async transcribeAudio(audioBuffer: ArrayBuffer, isPremium: boolean): Promise<string | null> {
    try {
      // @ts-expect-error - Buffer is available in Node.js
      const audioData = Buffer.from(audioBuffer);
      const base64Audio = audioData.toString('base64');

      const audioPart = {
        inlineData: {
          data: base64Audio,
          mimeType: 'audio/ogg',
        },
      };

      const prompt = 'Распознай речь в этом аудио сообщении и переведи в текст. Ответь только текстом без дополнительных комментариев.';

      const text = await this.geminiClient.generateContent({
        prompt: [prompt, audioPart],
        isPremium,
        maxRetries: 3
      });

      return text.trim() || null;
    } catch (error) {
      console.error('Ошибка при транскрипции через Gemini:', error);
      return null;
    }
  }

  private removeBrackets(text: string): string {
    return text.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
  }

  async sendVoiceMessage(ctx: any, text: string): Promise<void> {
    try {
      if (!text || text.trim().length === 0) {
        console.log('Пустой текст для голосового сообщения');
        return;
      }

      const cleanedText = this.removeBrackets(text);
      
      if (!cleanedText || cleanedText.trim().length === 0) {
        console.log('Текст пустой после удаления скобок');
        return;
      }

      console.log('Генерация голосового сообщения для текста:', cleanedText.substring(0, 50));
      await ctx.sendChatAction('record_voice');
      
      const audioBuffer = await minimaxTTS.generateSpeech(cleanedText);
      if (!audioBuffer) {
        console.error('Не удалось сгенерировать аудио через MiniMax');
        await ctx.reply(cleanedText);
        return;
      }

      console.log('Аудио сгенерировано, размер:', audioBuffer.length, 'байт');
      
      if (audioBuffer.length < 1000) {
        console.error('Аудио файл слишком маленький, отправляю текстом');
        await ctx.reply(cleanedText);
        return;
      }
      
      try {
        await ctx.replyWithVoice({
          source: audioBuffer,
          filename: 'voice.ogg',
        });
        console.log('Голосовое сообщение отправлено успешно');
      } catch (voiceError: any) {
        if (voiceError?.response?.description?.includes('VOICE_MESSAGES_FORBIDDEN')) {
          console.log('Голосовые сообщения запрещены в этом чате, отправляю текстом');
          await ctx.reply(cleanedText);
        } else {
          throw voiceError;
        }
      }
    } catch (error) {
      console.error('Ошибка при отправке голосового сообщения:', error);
      const cleanedText = this.removeBrackets(text);
      await ctx.reply(cleanedText || text);
    }
  }

  shouldSendVoice(): boolean {
    return Math.random() < 0.4;
  }
}

