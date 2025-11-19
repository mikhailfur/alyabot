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

  constructor(dbPath: string = process.env.DB_PATH || './alyabot.db') {
    const finalPath = dbPath.startsWith('/') ? dbPath : `${process.cwd()}/${dbPath}`;
    this.db = new sqlite3.Database(finalPath);
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
    
    const createUsersTableSQL = `
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        is_premium BOOLEAN DEFAULT 0,
        subscription_until INTEGER,
        behavior_mode TEXT DEFAULT 'default',
        model_type TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        last_active INTEGER,
        total_messages INTEGER DEFAULT 0,
        trial_used BOOLEAN DEFAULT 0
      )
    `;
    
    const createSubscriptionsTableSQL = `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        subscription_type TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
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
    
    const createGlobalSettingsTableSQL = `
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    
    await this.run(createTableSQL);
    await this.run(createGroupsTableSQL);
    await this.run(createUsersTableSQL);
    await this.run(createSubscriptionsTableSQL);
    await this.run(createGlobalSettingsTableSQL);
    await this.run(createIndexSQL);
    await this.run(createChatIndexSQL);
    
    const defaultModel = await this.get('SELECT value FROM global_settings WHERE key = ?', ['default_model']);
    if (!defaultModel) {
      await this.run('INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)', ['default_model', 'auto', Date.now()]);
    }
  }

  async saveMessage(userId: number, username: string | undefined, message: string, response: string, chatId?: number, chatType?: string): Promise<void> {
    try {
      if (!userId || !message || !response) {
        console.warn('Попытка сохранить некорректное сообщение');
        return;
      }

      const timestamp = Date.now();
      const sql = `
        INSERT INTO chat_history (user_id, username, message, response, timestamp, chat_id, chat_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      await this.run(sql, [userId, username || null, message.substring(0, 10000), response.substring(0, 10000), timestamp, chatId || null, chatType || null]);
    } catch (error) {
      console.error('Ошибка при сохранении сообщения:', error);
      throw error;
    }
  }

  async getChatHistory(userId: number, limit: number = 10, chatId?: number): Promise<ChatMessage[]> {
    try {
      if (!userId || limit <= 0 || limit > 50) {
        limit = Math.min(Math.max(limit, 1), 50);
      }

      let sql: string;
      let params: any[];
      
      if (chatId) {
        sql = `
          SELECT id, user_id, username, message, response, timestamp, chat_id, chat_type
          FROM chat_history 
          WHERE user_id = ? AND chat_id = ?
          ORDER BY timestamp DESC 
          LIMIT ?
        `;
        params = [userId, chatId, limit];
      } else {
        sql = `
          SELECT id, user_id, username, message, response, timestamp, chat_id, chat_type
          FROM chat_history 
          WHERE user_id = ? 
          ORDER BY timestamp DESC 
          LIMIT ?
        `;
        params = [userId, limit];
      }
      
      const messages = await this.all(sql, params);
      return (messages || []).reverse();
    } catch (error) {
      console.error('Ошибка при получении истории чата:', error);
      return [];
    }
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

  async getGroupStats(chatId: number): Promise<{ totalMessages: number; uniqueUsers: number; firstMessage?: number; lastMessage?: number }> {
    const sql = `
      SELECT 
        COUNT(*) as totalMessages,
        COUNT(DISTINCT user_id) as uniqueUsers,
        MIN(timestamp) as firstMessage,
        MAX(timestamp) as lastMessage
      FROM chat_history 
      WHERE chat_id = ?
    `;
    
    const result = await this.get(sql, [chatId]);
    return {
      totalMessages: result.totalMessages || 0,
      uniqueUsers: result.uniqueUsers || 0,
      firstMessage: result.firstMessage,
      lastMessage: result.lastMessage
    };
  }

  async clearUserHistory(userId: number, chatId?: number): Promise<void> {
    try {
      if (!userId) {
        throw new Error('User ID не указан');
      }
      let sql: string;
      let params: any[];
      
      if (chatId) {
        sql = 'DELETE FROM chat_history WHERE user_id = ? AND chat_id = ?';
        params = [userId, chatId];
      } else {
        sql = 'DELETE FROM chat_history WHERE user_id = ?';
        params = [userId];
      }
      
      await this.run(sql, params);
    } catch (error) {
      console.error('Ошибка при очистке истории пользователя:', error);
      throw error;
    }
  }

  async clearChatHistory(userId: number, chatId: number): Promise<void> {
    try {
      if (!userId || !chatId) {
        throw new Error('User ID или Chat ID не указан');
      }
      let sql: string;
      let params: any[];
      
      if (chatId === userId) {
        sql = 'DELETE FROM chat_history WHERE user_id = ? AND (chat_id = ? OR chat_id IS NULL OR chat_id = ?)';
        params = [userId, chatId, userId];
      } else {
        sql = 'DELETE FROM chat_history WHERE user_id = ? AND chat_id = ?';
        params = [userId, chatId];
      }
      
      await this.run(sql, params);
      console.log(`Очищена история для пользователя ${userId} в чате ${chatId}`);
    } catch (error) {
      console.error('Ошибка при очистке истории чата:', error);
      throw error;
    }
  }

  async clearGroupHistory(chatId: number): Promise<void> {
    try {
      if (!chatId) {
        throw new Error('Chat ID не указан');
      }
      const sql = 'DELETE FROM chat_history WHERE chat_id = ?';
      await this.run(sql, [chatId]);
    } catch (error) {
      console.error('Ошибка при очистке истории группы:', error);
      throw error;
    }
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

  async getUser(userId: number): Promise<any> {
    const sql = 'SELECT * FROM users WHERE user_id = ?';
    return await this.get(sql, [userId]);
  }

  async createOrUpdateUser(userId: number, username?: string, firstName?: string, lastName?: string): Promise<void> {
    const timestamp = Date.now();
    const sql = `
      INSERT OR REPLACE INTO users (user_id, username, first_name, last_name, created_at, last_active)
      VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM users WHERE user_id = ?), ?), ?)
    `;
    await this.run(sql, [userId, username, firstName, lastName, userId, timestamp, timestamp]);
  }

  async updateUserActivity(userId: number): Promise<void> {
    const sql = 'UPDATE users SET last_active = ?, total_messages = total_messages + 1 WHERE user_id = ?';
    await this.run(sql, [Date.now(), userId]);
  }

  async setUserPremium(userId: number, isPremium: boolean, expiresAt?: number): Promise<void> {
    const sql = 'UPDATE users SET is_premium = ?, subscription_until = ? WHERE user_id = ?';
    await this.run(sql, [isPremium ? 1 : 0, expiresAt || null, userId]);
  }

  async setUserBehaviorMode(userId: number, mode: string): Promise<void> {
    const sql = 'UPDATE users SET behavior_mode = ? WHERE user_id = ?';
    await this.run(sql, [mode, userId]);
  }

  async setUserModelType(userId: number, modelType: string | null): Promise<void> {
    const sql = 'UPDATE users SET model_type = ? WHERE user_id = ?';
    await this.run(sql, [modelType, userId]);
  }

  async getUserModelType(userId: number): Promise<string | null> {
    const user = await this.getUser(userId);
    return user?.model_type || null;
  }

  async getAllUsers(): Promise<any[]> {
    const sql = 'SELECT * FROM users ORDER BY last_active DESC';
    return await this.all(sql);
  }

  async getUsersStats(): Promise<any> {
    const sql = `
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN is_premium = 1 THEN 1 END) as premium_users,
        COUNT(CASE WHEN last_active > ? THEN 1 END) as active_users,
        SUM(total_messages) as total_messages
      FROM users
    `;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return await this.get(sql, [dayAgo]);
  }

  async createSubscription(userId: number, subscriptionType: string, durationMonths: number): Promise<void> {
    const startedAt = Date.now();
    const expiresAt = startedAt + (durationMonths * 30 * 24 * 60 * 60 * 1000);
    const sql = `
      INSERT INTO subscriptions (user_id, subscription_type, started_at, expires_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `;
    await this.run(sql, [userId, subscriptionType, startedAt, expiresAt]);
    await this.setUserPremium(userId, true, expiresAt);
  }

  async checkSubscription(userId: number): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user || !user.is_premium) return false;
    if (user.subscription_until && user.subscription_until < Date.now()) {
      await this.setUserPremium(userId, false);
      return false;
    }
    return true;
  }

  async getGlobalSetting(key: string): Promise<string | null> {
    const result = await this.get('SELECT value FROM global_settings WHERE key = ?', [key]);
    return result?.value || null;
  }

  async setGlobalSetting(key: string, value: string): Promise<void> {
    await this.run(
      'INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, Date.now()]
    );
  }

  async getDefaultModel(): Promise<string> {
    const model = await this.getGlobalSetting('default_model');
    return model || 'auto';
  }

  async setDefaultModel(modelType: string): Promise<void> {
    await this.setGlobalSetting('default_model', modelType);
  }

  async hasUsedTrial(userId: number): Promise<boolean> {
    const user = await this.getUser(userId);
    return Boolean(user?.trial_used);
  }

  async setTrialUsed(userId: number): Promise<void> {
    const sql = 'UPDATE users SET trial_used = 1 WHERE user_id = ?';
    await this.run(sql, [userId]);
  }

  async createTrialSubscription(userId: number): Promise<void> {
    const startedAt = Date.now();
    const expiresAt = startedAt + (7 * 24 * 60 * 60 * 1000);
    const sql = `
      INSERT INTO subscriptions (user_id, subscription_type, started_at, expires_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `;
    await this.run(sql, [userId, 'trial', startedAt, expiresAt]);
    await this.setUserPremium(userId, true, expiresAt);
    await this.setTrialUsed(userId);
  }

  close(): void {
    this.db.close();
  }
}

export const database = new Database();
