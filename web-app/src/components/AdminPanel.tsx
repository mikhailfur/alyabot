import { useEffect, useState } from 'react';
import { UserData, StatsData } from '../types';
import { api } from '../api';

interface AdminPanelProps {
  userData: UserData;
  onClearHistory: () => void;
}

export function AdminPanel({ userData, onClearHistory }: AdminPanelProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await api.getStats();
        setStats(data);
      } catch (err) {
        console.error('Ошибка загрузки статистики:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const handleClearHistory = async () => {
    if (!confirm('Вы уверены, что хотите очистить историю?')) {
      return;
    }

    setClearing(true);
    try {
      await onClearHistory();
      const data = await api.getStats();
      setStats(data);
    } catch (err) {
      console.error('Ошибка очистки истории:', err);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-lg shadow-md p-6 mb-4">
        <h1 className="text-2xl font-bold mb-4">🔐 Админ-панель</h1>
        
        <div className="space-y-3 mb-6">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">Пользователь</p>
            <p className="font-medium">
              {userData.firstName} {userData.lastName || ''}
            </p>
            {userData.username && (
              <p className="text-sm text-gray-500">@{userData.username}</p>
            )}
          </div>
        </div>

        <h2 className="text-lg font-bold mb-4">Статистика</h2>
        {loading ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          </div>
        ) : stats ? (
          <div className="space-y-3 mb-6">
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-600">Всего пользователей</p>
              <p className="text-2xl font-bold text-blue-600">{stats.totalUsers}</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-gray-600">Активных за сегодня</p>
              <p className="text-2xl font-bold text-green-600">{stats.activeToday}</p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <p className="text-sm text-gray-600">Новых за сегодня</p>
              <p className="text-2xl font-bold text-purple-600">{stats.newToday}</p>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">Не удалось загрузить статистику</p>
        )}

        <button
          onClick={handleClearHistory}
          disabled={clearing}
          className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors ${
            clearing
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-red-500 hover:bg-red-600 text-white'
          }`}
        >
          {clearing ? 'Очистка...' : '🧹 Очистить историю'}
        </button>
      </div>
    </div>
  );
}

