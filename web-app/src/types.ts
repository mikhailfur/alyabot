export interface UserData {
  userId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  isPremium: boolean;
  subscriptionUntil?: number;
  behavior_mode: string;
  isAdmin: boolean;
}

export interface StatsData {
  totalUsers: number;
  activeToday: number;
  newToday: number;
}

export interface SettingsUpdate {
  behavior_mode: string;
}

