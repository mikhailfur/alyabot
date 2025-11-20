import { GeminiClient } from './gemini-client';

export class ImageProcessor {
  private geminiClient: GeminiClient;
  private isPremium: boolean;

  constructor(geminiClient: GeminiClient, isPremium: boolean = false) {
    this.geminiClient = geminiClient;
    this.isPremium = isPremium;
  }

  async processImage(imageBuffer: Buffer, mimeType: string, userMessage?: string): Promise<string | null> {
    try {
      const imagePart = {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: mimeType,
        },
      };

      const prompt = userMessage 
        ? `Опиши это изображение и ответь на вопрос пользователя: "${userMessage}"`
        : `Опиши это изображение подробно. Что ты видишь?`;

      return await this.geminiClient.generateContent({
        prompt: [prompt, imagePart],
        isPremium: this.isPremium,
        maxRetries: 3
      });
    } catch (error) {
      console.error('Ошибка при обработке изображения:', error);
      return null;
    }
  }
}

