import { GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiBalancer } from './gemini-balancer';

export class ImageProcessor {
  private geminiBalancer: GeminiBalancer;
  private isPremium: boolean;

  constructor(geminiBalancer: GeminiBalancer, isPremium: boolean = false) {
    this.geminiBalancer = geminiBalancer;
    this.isPremium = isPremium;
  }

  async processImage(imageBuffer: Buffer, mimeType: string, userMessage?: string): Promise<string | null> {
    try {
      const genAI = this.geminiBalancer.getToken(this.isPremium);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      const imagePart = {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: mimeType,
        },
      };

      const prompt = userMessage 
        ? `Опиши это изображение и ответь на вопрос пользователя: "${userMessage}"`
        : `Опиши это изображение подробно. Что ты видишь?`;

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Ошибка при обработке изображения:', error);
      return null;
    }
  }
}

