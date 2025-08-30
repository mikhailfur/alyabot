import { ChatMessage } from './database';

export class MemoryManager {
  private maxHistoryLength = 20;
  private maxContextLength = 2000;

  formatChatHistory(history: ChatMessage[]): string {
    if (history.length === 0) {
      return '';
    }

    let context = 'Предыдущие сообщения:\n';
    let totalLength = context.length;

    for (const msg of history.slice(-this.maxHistoryLength)) {
      const messageText = `Пользователь: ${msg.message}\nАля: ${msg.response}\n\n`;
      
      if (totalLength + messageText.length > this.maxContextLength) {
        break;
      }
      
      context += messageText;
      totalLength += messageText.length;
    }

    return context;
  }

  buildContextWithHistory(history: ChatMessage[], currentMessage: string): string {
    const historyContext = this.formatChatHistory(history);
    
    if (historyContext) {
      return `${historyContext}Текущее сообщение пользователя: ${currentMessage}`;
    }
    
    return currentMessage;
  }

  shouldRememberMessage(message: string): boolean {
    const importantKeywords = [
      'имя', 'зовут', 'меня', 'я', 'мое', 'моя', 'мой',
      'люблю', 'нравится', 'хобби', 'работа', 'учусь',
      'живу', 'город', 'страна', 'возраст', 'семья',
      'друзья', 'планы', 'мечты', 'цели'
    ];
    
    const lowerMessage = message.toLowerCase();
    return importantKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  extractImportantInfo(message: string, response: string): string {
    const info: string[] = [];
    
    if (this.shouldRememberMessage(message)) {
      info.push(`Важная информация: ${message}`);
    }
    
    return info.join('\n');
  }
}

export const memoryManager = new MemoryManager();
