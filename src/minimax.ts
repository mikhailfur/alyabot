import { config } from './config';

export class MiniMaxTTS {
  private apiToken: string;
  private voiceId: string;
  private baseUrl = 'https://api.minimax.io/v1/t2a_v2';

  constructor() {
    this.apiToken = config.minimaxApiToken;
    this.voiceId = config.minimaxVoiceId;
  }

  async generateSpeech(text: string): Promise<any> {
    try {
      if (!this.apiToken || !this.voiceId) {
        console.error('❌ MiniMax API токен или Voice ID не настроены. Проверьте MINIMAX_API_TOKEN и MINIMAX_VOICE_ID в .env файле.');
        return null;
      }

      if (text.length > 10000) {
        console.error('❌ Текст слишком длинный (максимум 10000 символов)');
        return null;
      }

      const requestBody = {
        model: 'speech-2.6-turbo',
        text: text,
        stream: false,
        output_format: 'hex',
        voice_setting: {
          voice_id: this.voiceId,
          speed: 1.0,
          vol: 1.0,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 24000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
        language_boost: 'Russian',
      };

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Ошибка MiniMax API:', response.status, errorText);
        
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.base_resp?.status_code === 2049 || errorText.includes('invalid api key')) {
            console.error('❌ ОШИБКА: Неверный MiniMax API токен! Проверьте MINIMAX_API_TOKEN в .env файле.');
          } else if (errorJson.base_resp) {
            console.error('Код ошибки MiniMax:', errorJson.base_resp.status_code);
            console.error('Сообщение:', errorJson.base_resp.status_msg);
          }
        } catch (e) {
          // Не JSON, просто логируем как есть
        }
        
        return null;
      }

      const responseData = await response.json();
      
      console.log('MiniMax ответ (первые 1000 символов):', JSON.stringify(responseData).substring(0, 1000));
      
      if (responseData.base_resp?.status_code !== 0 && responseData.base_resp?.status_code !== undefined) {
        console.error('MiniMax вернул ошибку:', responseData.base_resp);
        return null;
      }
      
      let audioHex = responseData.audio;
      
      if (!audioHex && responseData.data) {
        audioHex = responseData.data.audio || responseData.data;
      }
      
      if (!audioHex && responseData.result) {
        audioHex = responseData.result.audio || responseData.result;
      }
      
      if (!audioHex) {
        console.error('MiniMax не вернул аудио данные. Структура ответа:', Object.keys(responseData));
        if (responseData.base_resp) {
          console.error('base_resp:', responseData.base_resp);
        }
        return null;
      }

      if (typeof audioHex !== 'string') {
        console.error('Аудио данные не являются строкой:', typeof audioHex);
        return null;
      }

      // @ts-expect-error - Buffer is available in Node.js
      const buffer = Buffer.from(audioHex, 'hex');
      
      if (buffer.length < 1000) {
        console.error('Получен слишком маленький аудио файл:', buffer.length, 'байт');
        console.error('Первые 100 символов hex:', audioHex.substring(0, 100));
        return null;
      }
      
      console.log('✅ Аудио успешно декодировано, размер:', buffer.length, 'байт');
      return buffer;
    } catch (error) {
      console.error('Ошибка при генерации речи:', error);
      return null;
    }
  }
}

export const minimaxTTS = new MiniMaxTTS();


