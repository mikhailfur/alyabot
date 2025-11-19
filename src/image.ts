import { GoogleGenerativeAI } from '@google/generative-ai';

export class ImageProcessor {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async processImage(imageBuffer: Buffer, mimeType: string, userMessage?: string): Promise<string | null> {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
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

