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
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-purple-50 to-indigo-100">
      <div className="max-w-md mx-auto p-4 pt-8">
        <div className="bg-white/80 backdrop-blur-lg rounded-3xl shadow-2xl p-6 mb-6 border-2 border-pink-200/50">
          <h1 className="text-3xl font-bold mb-6 bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent text-center">
            🔐 Админ-панель
          </h1>
          
          <div className="mb-6 p-4 bg-gradient-to-r from-purple-100 to-pink-100 rounded-2xl border-2 border-purple-200">
            <p className="text-sm text-purple-600 font-medium mb-1">Пользователь</p>
            <p className="font-bold text-lg text-gray-800">
              {userData.firstName} {userData.lastName || ''}
            </p>
            {userData.username && (
              <p className="text-sm text-purple-500 font-medium">@{userData.username}</p>
            )}
          </div>

          <h2 className="text-2xl font-bold mb-6 bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent text-center">
            📊 Статистика
          </h2>
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-400 border-t-transparent mx-auto"></div>
            </div>
          ) : stats ? (
            <div className="space-y-4 mb-6">
              <div className="p-5 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-2xl shadow-lg border-2 border-blue-300">
                <p className="text-sm text-white/90 font-medium mb-2">Всего пользователей</p>
                <p className="text-3xl font-bold text-white">{stats.totalUsers}</p>
              </div>
              <div className="p-5 bg-gradient-to-r from-green-400 to-emerald-400 rounded-2xl shadow-lg border-2 border-green-300">
                <p className="text-sm text-white/90 font-medium mb-2">Активных за сегодня</p>
                <p className="text-3xl font-bold text-white">{stats.activeToday}</p>
              </div>
              <div className="p-5 bg-gradient-to-r from-purple-400 to-pink-400 rounded-2xl shadow-lg border-2 border-purple-300">
                <p className="text-sm text-white/90 font-medium mb-2">Новых за сегодня</p>
                <p className="text-3xl font-bold text-white">{stats.newToday}</p>
              </div>
            </div>
          ) : (
            <p className="text-purple-600 text-center py-6 font-medium bg-purple-50 p-4 rounded-xl border border-purple-200">
              😢 Не удалось загрузить статистику
            </p>
          )}

          <button
            onClick={handleClearHistory}
            disabled={clearing}
            className={`w-full py-4 px-4 rounded-2xl font-bold text-lg transition-all transform ${
              clearing
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white shadow-lg hover:shadow-xl active:scale-95'
            }`}
          >
            {clearing ? '⏳ Очистка...' : '🧹 Очистить историю'}
          </button>
        </div>
      </div>
    </div>
  );
}

