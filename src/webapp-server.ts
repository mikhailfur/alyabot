import express from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from './config';
import { database } from './database';
import { SubscriptionManager } from './subscription';
import { AdminPanel } from './admin';

export function createWebAppServer(
  bot: any,
  subscriptionManager: SubscriptionManager,
  adminPanel: AdminPanel
): express.Application {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'web-app', 'dist')));

  function validateWebAppData(initData: string): { userId: number } | null {
    if (!initData) {
      return null;
    }

    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      urlParams.delete('hash');

      const dataCheckString = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(config.telegramBotToken)
        .digest();

      const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      if (calculatedHash !== hash) {
        return null;
      }

      const userStr = urlParams.get('user');
      if (!userStr) {
        return null;
      }

      const user = JSON.parse(userStr);
      return { userId: user.id };
    } catch (error) {
      console.error('Ошибка валидации initData:', error);
      return null;
    }
  }

  async function requireAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): Promise<void> {
    const initData = req.headers['x-telegram-init-data'] as string;
    const authData = validateWebAppData(initData);

    if (!authData) {
      res.status(401).json({ message: 'Неавторизован' });
      return;
    }

    (req as any).userId = authData.userId;
    next();
  }

  async function requireAdmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): Promise<void> {
    const userId = (req as any).userId;
    if (!adminPanel.isAdmin(userId)) {
      res.status(403).json({ message: 'Доступ запрещён' });
      return;
    }
    next();
  }

  app.get('/api/me', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const user = await database.getUser(userId);
      
      if (!user) {
        res.status(404).json({ message: 'Пользователь не найден' });
        return;
      }

      const isPremium = await subscriptionManager.checkUserSubscription(userId);
      const isAdmin = adminPanel.isAdmin(userId);

      res.json({
        userId: user.user_id,
        firstName: user.first_name || '',
        lastName: user.last_name || null,
        username: user.username || null,
        isPremium,
        subscriptionUntil: user.subscription_until || null,
        behavior_mode: user.behavior_mode || 'default',
        isAdmin,
      });
    } catch (error) {
      console.error('Ошибка в /api/me:', error);
      res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
  });

  app.post('/api/settings', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { behavior_mode } = req.body;

      if (!behavior_mode) {
        res.status(400).json({ message: 'Не указан режим поведения' });
        return;
      }

      const validModes = ['default', 'study', 'work', 'psychologist', 'nsfw'];
      if (!validModes.includes(behavior_mode)) {
        res.status(400).json({ message: 'Недопустимый режим поведения' });
        return;
      }

      const isPremium = await subscriptionManager.checkUserSubscription(userId);
      if (!isPremium && behavior_mode !== 'default') {
        res.status(403).json({ message: 'Для изменения режима нужна Premium подписка' });
        return;
      }

      await database.setUserBehaviorMode(userId, behavior_mode);
      res.json({ success: true });
    } catch (error) {
      console.error('Ошибка в /api/settings:', error);
      res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/stats', requireAuth, requireAdmin, async (req, res) => {
    try {
      const stats = await database.getUsersStats();
      const now = Date.now();
      const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

      const allUsers = await database.getAllUsers();
      const activeToday = allUsers.filter(
        (u) => u.last_active && u.last_active > dayStart
      ).length;
      const newToday = allUsers.filter(
        (u) => u.created_at && u.created_at > dayStart
      ).length;

      res.json({
        totalUsers: stats.total_users || 0,
        activeToday,
        newToday,
      });
    } catch (error) {
      console.error('Ошибка в /api/stats:', error);
      res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
  });

  app.post('/api/clear-history', requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const chatId = userId;

      await database.clearChatHistory(userId, chatId);
      res.json({ success: true });
    } catch (error) {
      console.error('Ошибка в /api/clear-history:', error);
      res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'web-app', 'dist', 'index.html'));
  });

  return app;
}

