import WebApp from '@twa-dev/sdk';
import { UserData, StatsData, SettingsUpdate } from './types';

const API_BASE = '/api';

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const initData = WebApp.initData;
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData || '',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Ошибка запроса' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  getMe: async (): Promise<UserData> => {
    return request<UserData>('/me');
  },

  updateSettings: async (settings: SettingsUpdate): Promise<void> => {
    return request<void>('/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  },

  getStats: async (): Promise<StatsData> => {
    return request<StatsData>('/stats');
  },

  clearHistory: async (): Promise<void> => {
    return request<void>('/clear-history', {
      method: 'POST',
    });
  },
};

