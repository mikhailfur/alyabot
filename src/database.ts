import mysql from 'mysql2/promise';
import { config } from './config';

export interface ChatMessage {
  id?: number;
  userId: number;
  username?: string;
  message: string;
  response: string;
  timestamp: number;
  chatId?: number;
  chatType?: string;
}

class Database {
  private pool: mysql.Pool;

  constructor() {
    this.pool = mysql.createPool({
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: config.mysqlUser,
      password: config.mysqlPassword,
      database: config.mysqlDatabase,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    
    this.initDatabase();
  }

  private async initDatabase(): Promise<void> {
    try {
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS chat_history (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT NOT NULL,
          username VARCHAR(255),
          message TEXT NOT NULL,
          response TEXT NOT NULL,
          timestamp BIGINT NOT NULL,
          chat_id BIGINT,
          chat_type VARCHAR(50),
          INDEX idx_user_timestamp (user_id, timestamp),
          INDEX idx_chat_timestamp (chat_id, timestamp)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      const createGroupsTableSQL = `
        CREATE TABLE IF NOT EXISTS group_settings (
          chat_id BIGINT PRIMARY KEY,
          is_active BOOLEAN DEFAULT 0,
          mention_mode BOOLEAN DEFAULT 1,
          admin_only BOOLEAN DEFAULT 0,
          created_at BIGINT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      const createUsersTableSQL = `
        CREATE TABLE IF NOT EXISTS users (
          user_id BIGINT PRIMARY KEY,
          username VARCHAR(255),
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          is_premium BOOLEAN DEFAULT 0,
          subscription_until BIGINT,
          behavior_mode VARCHAR(50) DEFAULT 'default',
          model_type VARCHAR(50) DEFAULT NULL,
          created_at BIGINT NOT NULL,
          last_active BIGINT,
          total_messages INT DEFAULT 0,
          trial_used BOOLEAN DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      const createSubscriptionsTableSQL = `
        CREATE TABLE IF NOT EXISTS subscriptions (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT NOT NULL,
          subscription_type VARCHAR(50) NOT NULL,
          started_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL,
          is_active BOOLEAN DEFAULT 1,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
          INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      const createGlobalSettingsTableSQL = `
        CREATE TABLE IF NOT EXISTS global_settings (
          \`key\` VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at BIGINT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      const createReferralsTableSQL = `
        CREATE TABLE IF NOT EXISTS referrals (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          referrer_id BIGINT NOT NULL,
          referee_id BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          referee_messages_count INT DEFAULT 0,
          referee_subscribed BOOLEAN DEFAULT 0,
          referrer_bonus_given BOOLEAN DEFAULT 0,
          referee_bonus_given BOOLEAN DEFAULT 0,
          UNIQUE KEY unique_referral (referrer_id, referee_id),
          INDEX idx_referrer (referrer_id),
          INDEX idx_referee (referee_id),
          FOREIGN KEY (referrer_id) REFERENCES users(user_id) ON DELETE CASCADE,
          FOREIGN KEY (referee_id) REFERENCES users(user_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.pool.execute(createTableSQL);
      await this.pool.execute(createGroupsTableSQL);
      await this.pool.execute(createUsersTableSQL);
      await this.pool.execute(createSubscriptionsTableSQL);
      await this.pool.execute(createGlobalSettingsTableSQL);
      await this.pool.execute(createReferralsTableSQL);
      
      const [rows] = await this.pool.execute('SELECT value FROM global_settings WHERE `key` = ?', ['default_model']);
      const result = rows as any[];
      if (result.length === 0) {
        await this.pool.execute('INSERT INTO global_settings (`key`, value, updated_at) VALUES (?, ?, ?)', ['default_model', 'auto', Date.now()]);
      }
    } catch (error) {
      console.error('Ошибка при инициализации базы данных:', error);
      throw error;
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
      
      await this.pool.execute(sql, [
        userId,
        username || null,
        message.substring(0, 10000),
        response.substring(0, 10000),
        timestamp,
        chatId || null,
        chatType || null
      ]);
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
      
      const safeLimit = parseInt(String(limit), 10);
      
      if (chatId) {
        sql = `
          SELECT id, user_id as userId, username, message, response, timestamp, chat_id as chatId, chat_type as chatType
          FROM chat_history 
          WHERE user_id = ? AND chat_id = ?
          ORDER BY timestamp DESC 
          LIMIT ${safeLimit}
        `;
        params = [userId, chatId];
      } else {
        sql = `
          SELECT id, user_id as userId, username, message, response, timestamp, chat_id as chatId, chat_type as chatType
          FROM chat_history 
          WHERE user_id = ? 
          ORDER BY timestamp DESC 
          LIMIT ${safeLimit}
        `;
        params = [userId];
      }
      
      const [rows] = await this.pool.execute(sql, params);
      const messages = rows as any[];
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
    
    const [rows] = await this.pool.execute(sql, [userId]);
    const result = (rows as any[])[0];
    return {
      totalMessages: result?.totalMessages || 0,
      firstMessage: result?.firstMessage,
      lastMessage: result?.lastMessage
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
    
    const [rows] = await this.pool.execute(sql, [chatId]);
    const result = (rows as any[])[0];
    return {
      totalMessages: result?.totalMessages || 0,
      uniqueUsers: result?.uniqueUsers || 0,
      firstMessage: result?.firstMessage,
      lastMessage: result?.lastMessage
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
      
      await this.pool.execute(sql, params);
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
      
      await this.pool.execute(sql, params);
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
      await this.pool.execute(sql, [chatId]);
    } catch (error) {
      console.error('Ошибка при очистке истории группы:', error);
      throw error;
    }
  }

  async setGroupSettings(chatId: number, isActive: boolean, mentionMode: boolean = true, adminOnly: boolean = false): Promise<void> {
    const timestamp = Date.now();
    const sql = `
      INSERT INTO group_settings (chat_id, is_active, mention_mode, admin_only, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        mention_mode = VALUES(mention_mode),
        admin_only = VALUES(admin_only)
    `;
    
    await this.pool.execute(sql, [chatId, isActive ? 1 : 0, mentionMode ? 1 : 0, adminOnly ? 1 : 0, timestamp]);
  }

  async getGroupSettings(chatId: number): Promise<{ isActive: boolean; mentionMode: boolean; adminOnly: boolean } | null> {
    const [rows] = await this.pool.execute('SELECT is_active, mention_mode, admin_only FROM group_settings WHERE chat_id = ?', [chatId]);
    const result = (rows as any[])[0];
    
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
    const [rows] = await this.pool.execute('SELECT * FROM users WHERE user_id = ?', [userId]);
    return (rows as any[])[0] || null;
  }

  async createOrUpdateUser(userId: number, username?: string, firstName?: string, lastName?: string): Promise<void> {
    const timestamp = Date.now();
    
    const existingUser = await this.getUser(userId);
    
    if (existingUser) {
      const sql = `
        UPDATE users 
        SET username = ?, first_name = ?, last_name = ?, last_active = ?
        WHERE user_id = ?
      `;
      await this.pool.execute(sql, [
        username || null,
        firstName || null,
        lastName || null,
        timestamp,
        userId
      ]);
    } else {
      const sql = `
        INSERT INTO users (user_id, username, first_name, last_name, created_at, last_active, is_premium, subscription_until, behavior_mode, model_type, total_messages, trial_used)
        VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'default', NULL, 0, 0)
      `;
      await this.pool.execute(sql, [
        userId,
        username || null,
        firstName || null,
        lastName || null,
        timestamp,
        timestamp
      ]);
    }
  }

  async updateUserActivity(userId: number): Promise<void> {
    const sql = 'UPDATE users SET last_active = ?, total_messages = total_messages + 1 WHERE user_id = ?';
    await this.pool.execute(sql, [Date.now(), userId]);
  }

  async setUserPremium(userId: number, isPremium: boolean, expiresAt?: number): Promise<void> {
    const sql = 'UPDATE users SET is_premium = ?, subscription_until = ? WHERE user_id = ?';
    await this.pool.execute(sql, [isPremium ? 1 : 0, expiresAt || null, userId]);
  }

  async setUserBehaviorMode(userId: number, mode: string): Promise<void> {
    const sql = 'UPDATE users SET behavior_mode = ? WHERE user_id = ?';
    await this.pool.execute(sql, [mode, userId]);
  }

  async setUserModelType(userId: number, modelType: string | null): Promise<void> {
    const sql = 'UPDATE users SET model_type = ? WHERE user_id = ?';
    await this.pool.execute(sql, [modelType, userId]);
  }

  async getUserModelType(userId: number): Promise<string | null> {
    const user = await this.getUser(userId);
    return user?.model_type || null;
  }

  async getAllUsers(): Promise<any[]> {
    const [rows] = await this.pool.execute('SELECT * FROM users ORDER BY last_active DESC');
    return rows as any[];
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
    const [rows] = await this.pool.execute(sql, [dayAgo]);
    return (rows as any[])[0] || {};
  }

  async createSubscription(userId: number, subscriptionType: string, durationMonths: number): Promise<void> {
    const startedAt = Date.now();
    const expiresAt = startedAt + (durationMonths * 30 * 24 * 60 * 60 * 1000);
    const sql = `
      INSERT INTO subscriptions (user_id, subscription_type, started_at, expires_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `;
    await this.pool.execute(sql, [userId, subscriptionType, startedAt, expiresAt]);
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
    const [rows] = await this.pool.execute('SELECT value FROM global_settings WHERE `key` = ?', [key]);
    const result = (rows as any[])[0];
    return result?.value || null;
  }

  async setGlobalSetting(key: string, value: string): Promise<void> {
    await this.pool.execute(
      'INSERT INTO global_settings (`key`, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)',
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
    await this.pool.execute(sql, [userId]);
  }

  async createTrialSubscription(userId: number): Promise<void> {
    const startedAt = Date.now();
    const expiresAt = startedAt + (7 * 24 * 60 * 60 * 1000);
    const sql = `
      INSERT INTO subscriptions (user_id, subscription_type, started_at, expires_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `;
    await this.pool.execute(sql, [userId, 'trial', startedAt, expiresAt]);
    await this.setUserPremium(userId, true, expiresAt);
    await this.setTrialUsed(userId);
  }

  async createReferral(referrerId: number, refereeId: number): Promise<void> {
    const timestamp = Date.now();
    const sql = `
      INSERT INTO referrals (referrer_id, referee_id, created_at, referee_messages_count, referee_subscribed, referrer_bonus_given, referee_bonus_given)
      VALUES (?, ?, ?, 0, 0, 0, 0)
      ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)
    `;
    await this.pool.execute(sql, [referrerId, refereeId, timestamp]);
  }

  async getReferral(referrerId: number, refereeId: number): Promise<any | null> {
    const [rows] = await this.pool.execute(
      'SELECT * FROM referrals WHERE referrer_id = ? AND referee_id = ?',
      [referrerId, refereeId]
    );
    return (rows as any[])[0] || null;
  }

  async getReferralByReferee(refereeId: number): Promise<any | null> {
    const [rows] = await this.pool.execute(
      'SELECT * FROM referrals WHERE referee_id = ? LIMIT 1',
      [refereeId]
    );
    return (rows as any[])[0] || null;
  }

  async updateRefereeMessagesCount(refereeId: number, count: number): Promise<void> {
    const sql = 'UPDATE referrals SET referee_messages_count = ? WHERE referee_id = ?';
    await this.pool.execute(sql, [count, refereeId]);
  }

  async updateRefereeSubscribed(refereeId: number, subscribed: boolean): Promise<void> {
    const sql = 'UPDATE referrals SET referee_subscribed = ? WHERE referee_id = ?';
    await this.pool.execute(sql, [subscribed ? 1 : 0, refereeId]);
  }

  async giveReferrerBonus(referrerId: number, refereeId: number): Promise<void> {
    const sql = 'UPDATE referrals SET referrer_bonus_given = 1 WHERE referrer_id = ? AND referee_id = ?';
    await this.pool.execute(sql, [referrerId, refereeId]);
  }

  async giveRefereeBonus(refereeId: number): Promise<void> {
    const sql = 'UPDATE referrals SET referee_bonus_given = 1 WHERE referee_id = ?';
    await this.pool.execute(sql, [refereeId]);
  }

  async getReferrerReferralsCount(referrerId: number): Promise<number> {
    const [rows] = await this.pool.execute(
      'SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?',
      [referrerId]
    );
    return (rows as any[])[0]?.count || 0;
  }

  async createReferralSubscription(userId: number, hours: number, isReferee: boolean): Promise<void> {
    const startedAt = Date.now();
    const expiresAt = startedAt + (hours * 60 * 60 * 1000);
    const subscriptionType = isReferee ? 'referral_referee' : 'referral_referrer';
    const sql = `
      INSERT INTO subscriptions (user_id, subscription_type, started_at, expires_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `;
    await this.pool.execute(sql, [userId, subscriptionType, startedAt, expiresAt]);
    
    const user = await this.getUser(userId);
    if (user?.subscription_until && user.subscription_until > Date.now()) {
      const currentExpiresAt = user.subscription_until;
      const newExpiresAt = Math.max(currentExpiresAt, expiresAt);
      await this.setUserPremium(userId, true, newExpiresAt);
    } else {
      await this.setUserPremium(userId, true, expiresAt);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const database = new Database();
