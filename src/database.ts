import sqlite3 from 'sqlite3';
import { promisify } from 'util';

export interface ChatMessage {
  id?: number;
  userId: number;
  username?: string;
  message: string;
  response: string;
  timestamp: number;
}

class Database {
  private db: sqlite3.Database;
  private run: (sql: string, params?: any[]) => Promise<sqlite3.RunResult>;
  private get: (sql: string, params?: any[]) => Promise<any>;
  private all: (sql: string, params?: any[]) => Promise<any[]>;

  constructor(dbPath: string = './alyabot.db') {
    this.db = new sqlite3.Database(dbPath);
    this.run = promisify(this.db.run.bind(this.db));
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));
    
    this.initDatabase();
  }

  private async initDatabase(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT,
        message TEXT NOT NULL,
        response TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `;
    
    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_user_timestamp 
      ON chat_history(user_id, timestamp)
    `;
    
    await this.run(createTableSQL);
    await this.run(createIndexSQL);
  }

  async saveMessage(userId: number, username: string | undefined, message: string, response: string): Promise<void> {
    const timestamp = Date.now();
    const sql = `
      INSERT INTO chat_history (user_id, username, message, response, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    await this.run(sql, [userId, username, message, response, timestamp]);
  }

  async getChatHistory(userId: number, limit: number = 10): Promise<ChatMessage[]> {
    const sql = `
      SELECT * FROM chat_history 
      WHERE user_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `;
    
    const messages = await this.all(sql, [userId, limit]);
    return messages.reverse();
  }

  async getUserStats(userId: number): Promise<{ totalMessages: number; firstMessage?: number; lastMessage?: number }> {
    const sql = `
      SELECT 
        COUNT(*) as totalMessages,
        MIN(timestamp) as firstMessage,
        MAX(timestamp) as lastMessage
      FROM chat_history 
      WHERE user_id = ?
    `;
    
    const result = await this.get(sql, [userId]);
    return {
      totalMessages: result.totalMessages || 0,
      firstMessage: result.firstMessage,
      lastMessage: result.lastMessage
    };
  }

  async clearUserHistory(userId: number): Promise<void> {
    const sql = 'DELETE FROM chat_history WHERE user_id = ?';
    await this.run(sql, [userId]);
  }

  close(): void {
    this.db.close();
  }
}

export const database = new Database();
