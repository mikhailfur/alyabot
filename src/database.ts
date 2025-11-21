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
          trial_used BOOLEAN DEFAULT 0,
          referral_source VARCHAR(255) DEFAULT NULL,
          INDEX idx_referral_source (referral_source)
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
    
      await this.pool.execute(createTableSQL);
      await this.pool.execute(createGroupsTableSQL);
      await this.pool.execute(createUsersTableSQL);
      await this.pool.execute(createSubscriptionsTableSQL);
      await this.pool.execute(createGlobalSettingsTableSQL);
      
      const createReferralLinksTableSQL = `
        CREATE TABLE IF NOT EXISTS referral_links (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          created_by BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          clicks INT DEFAULT 0,
          registrations INT DEFAULT 0,
          is_active BOOLEAN DEFAULT 1,
          INDEX idx_code (code),
          INDEX idx_created_by (created_by)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      const createReferralTrackingTableSQL = `
        CREATE TABLE IF NOT EXISTS referral_tracking (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          referral_code VARCHAR(255) NOT NULL,
          user_id BIGINT NOT NULL,
          clicked_at BIGINT NOT NULL,
          registered_at BIGINT,
          INDEX idx_code (referral_code),
          INDEX idx_user_id (user_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.pool.execute(createReferralLinksTableSQL);
      await this.pool.execute(createReferralTrackingTableSQL);
      
      try {
        await this.pool.execute('ALTER TABLE users ADD COLUMN referral_source VARCHAR(255) DEFAULT NULL');
        await this.pool.execute('ALTER TABLE users ADD INDEX idx_referral_source (referral_source)');
      } catch (e: any) {
        if (!e.message?.includes('Duplicate column name')) {
          console.error('Ошибка при добавлении поля referral_source:', e);
        }
      }
      
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

  async createOrUpdateUser(userId: number, username?: string, firstName?: string, lastName?: string, referralSource?: string): Promise<void> {
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
      
      if (referralSource && !existingUser.referral_source) {
        await this.setUserReferralSource(userId, referralSource);
        await this.trackReferralRegistration(referralSource, userId);
      }
    } else {
      const sql = `
        INSERT INTO users (user_id, username, first_name, last_name, created_at, last_active, is_premium, subscription_until, behavior_mode, model_type, total_messages, trial_used, referral_source)
        VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'default', NULL, 0, 0, ?)
      `;
      await this.pool.execute(sql, [
        userId,
        username || null,
        firstName || null,
        lastName || null,
        timestamp,
        timestamp,
        referralSource || null
      ]);
      
      if (referralSource) {
        await this.trackReferralRegistration(referralSource, userId);
      }
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

  async createReferralLink(code: string, name: string, createdBy: number): Promise<number> {
    const sql = `
      INSERT INTO referral_links (code, name, created_by, created_at, clicks, registrations, is_active)
      VALUES (?, ?, ?, ?, 0, 0, 1)
    `;
    const [result] = await this.pool.execute(sql, [code, name, createdBy, Date.now()]);
    return (result as any).insertId;
  }

  async getReferralLink(code: string): Promise<any> {
    const [rows] = await this.pool.execute('SELECT * FROM referral_links WHERE code = ?', [code]);
    return (rows as any[])[0] || null;
  }

  async getAllReferralLinks(): Promise<any[]> {
    const [rows] = await this.pool.execute('SELECT * FROM referral_links ORDER BY created_at DESC');
    return rows as any[];
  }

  async updateReferralLink(id: number, name: string, isActive: boolean): Promise<void> {
    const sql = 'UPDATE referral_links SET name = ?, is_active = ? WHERE id = ?';
    await this.pool.execute(sql, [name, isActive, id]);
  }

  async deleteReferralLink(id: number): Promise<void> {
    await this.pool.execute('DELETE FROM referral_links WHERE id = ?', [id]);
  }

  async trackReferralClick(code: string, userId: number): Promise<void> {
    const link = await this.getReferralLink(code);
    if (!link) return;

    await this.pool.execute('UPDATE referral_links SET clicks = clicks + 1 WHERE code = ?', [code]);
    
    const sql = `
      INSERT INTO referral_tracking (referral_code, user_id, clicked_at, registered_at)
      VALUES (?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE clicked_at = VALUES(clicked_at)
    `;
    try {
      await this.pool.execute(sql, [code, userId, Date.now()]);
    } catch (e) {
      const updateSql = `
        UPDATE referral_tracking 
        SET clicked_at = ? 
        WHERE referral_code = ? AND user_id = ?
      `;
      await this.pool.execute(updateSql, [Date.now(), code, userId]);
    }
  }

  async trackReferralRegistration(code: string, userId: number): Promise<void> {
    await this.pool.execute('UPDATE referral_links SET registrations = registrations + 1 WHERE code = ?', [code]);
    
    const sql = `
      UPDATE referral_tracking 
      SET registered_at = ? 
      WHERE referral_code = ? AND user_id = ? AND registered_at IS NULL
    `;
    await this.pool.execute(sql, [Date.now(), code, userId]);
  }

  async setUserReferralSource(userId: number, referralCode: string): Promise<void> {
    const sql = 'UPDATE users SET referral_source = ? WHERE user_id = ?';
    await this.pool.execute(sql, [referralCode, userId]);
  }

  async getReferralStats(code: string): Promise<{ clicks: number; registrations: number; users: any[] }> {
    const link = await this.getReferralLink(code);
    if (!link) {
      return { clicks: 0, registrations: 0, users: [] };
    }

    const [rows] = await this.pool.execute(
      'SELECT user_id, clicked_at, registered_at FROM referral_tracking WHERE referral_code = ? ORDER BY clicked_at DESC LIMIT 100',
      [code]
    );
    const users = rows as any[];

    return {
      clicks: link.clicks,
      registrations: link.registrations,
      users
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const database = new Database();
