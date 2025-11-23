import { ChatMessage } from './database';

export class MemoryManager {
  private readonly maxHistoryLength = 15;
  private readonly maxContextLength = 1800;
  private readonly importantKeywords = new Set([
    'имя', 'зовут', 'меня', 'я', 'мое', 'моя', 'мой',
    'люблю', 'нравится', 'хобби', 'работа', 'учусь',
    'живу', 'город', 'страна', 'возраст', 'семья',
    'друзья', 'планы', 'мечты', 'цели'
  ]);

  formatChatHistory(history: ChatMessage[]): string {
    if (!history || history.length === 0) {
      return '';
    }

    const context: string[] = ['Предыдущие сообщения:\n'];
    let totalLength = context[0].length;
    const recentHistory = history.slice(-this.maxHistoryLength);

    for (const msg of recentHistory) {
      if (!msg || !msg.message || !msg.response) continue;
      
      const messageText = `Пользователь: ${msg.message}\nАля: ${msg.response}\n\n`;
      
      if (totalLength + messageText.length > this.maxContextLength) {
        break;
      }
      
      context.push(messageText);
      totalLength += messageText.length;
    }

    return context.length > 1 ? context.join('') : '';
  }

  buildContextWithHistory(history: ChatMessage[], currentMessage: string): string {
    if (!currentMessage || !currentMessage.trim()) {
      return '';
    }

    const historyContext = this.formatChatHistory(history);
    
    if (historyContext) {
      return `${historyContext}Текущее сообщение пользователя: ${currentMessage.trim()}`;
    }
    
    return currentMessage.trim();
  }

  shouldRememberMessage(message: string): boolean {
    if (!message || typeof message !== 'string') {
      return false;
    }
    
    const lowerMessage = message.toLowerCase();
    for (const keyword of this.importantKeywords) {
      if (lowerMessage.includes(keyword)) {
        return true;
      }
    }
    return false;
  }

  extractImportantInfo(message: string, _response: string): string {
    if (!this.shouldRememberMessage(message)) {
      return '';
    }
    return `Важная информация: ${message}`;
  }
}

export const memoryManager = new MemoryManager();
