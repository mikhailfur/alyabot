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
        timestamp INTEGER NOT NULL,
        chat_id INTEGER,
        chat_type TEXT
      )
    `;
    
    const createGroupsTableSQL = `
      CREATE TABLE IF NOT EXISTS group_settings (
        chat_id INTEGER PRIMARY KEY,
        is_active BOOLEAN DEFAULT 0,
        mention_mode BOOLEAN DEFAULT 1,
        admin_only BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `;
    
    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_user_timestamp 
      ON chat_history(user_id, timestamp)
    `;
    
    const createChatIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_chat_timestamp 
      ON chat_history(chat_id, timestamp)
    `;
    
    await this.run(createTableSQL);
    await this.run(createGroupsTableSQL);
    await this.run(createIndexSQL);
    await this.run(createChatIndexSQL);
  }

  async saveMessage(userId: number, username: string | undefined, message: string, response: string, chatId?: number, chatType?: string): Promise<void> {
    const timestamp = Date.now();
    const sql = `
      INSERT INTO chat_history (user_id, username, message, response, timestamp, chat_id, chat_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    await this.run(sql, [userId, username, message, response, timestamp, chatId, chatType]);
  }

  async getChatHistory(userId: number, limit: number = 10, chatId?: number): Promise<ChatMessage[]> {
    let sql: string;
    let params: any[];
    
    if (chatId) {
      sql = `
        SELECT * FROM chat_history 
        WHERE user_id = ? AND chat_id = ?
        ORDER BY timestamp DESC 
        LIMIT ?
      `;
      params = [userId, chatId, limit];
    } else {
      sql = `
        SELECT * FROM chat_history 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `;
      params = [userId, limit];
    }
    
    const messages = await this.all(sql, params);
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

  async setGroupSettings(chatId: number, isActive: boolean, mentionMode: boolean = true, adminOnly: boolean = false): Promise<void> {
    const timestamp = Date.now();
    const sql = `
      INSERT OR REPLACE INTO group_settings (chat_id, is_active, mention_mode, admin_only, created_at)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    await this.run(sql, [chatId, isActive ? 1 : 0, mentionMode ? 1 : 0, adminOnly ? 1 : 0, timestamp]);
  }

  async getGroupSettings(chatId: number): Promise<{ isActive: boolean; mentionMode: boolean; adminOnly: boolean } | null> {
    const sql = 'SELECT is_active, mention_mode, admin_only FROM group_settings WHERE chat_id = ?';
    const result = await this.get(sql, [chatId]);
    
    if (!result) return null;
    
    return {
      isActive: Boolean(result.is_active),
      mentionMode: Boolean(result.mention_mode),
      adminOnly: Boolean(result.admin_only)
    };
  }

  async isGroupActive(chatId: number): Promise<boolean> {
    const settings = await this.getGroupSettings(chatId);
    return settings?.isActive || false;
  }

  close(): void {
    this.db.close();
  }
}

export const database = new Database();
