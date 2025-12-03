import { useEffect, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import { UserData } from './types';
import { MainScreen } from './components/MainScreen';
import { AdminPanel } from './components/AdminPanel';
import { api } from './api';

function App() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();

    const fetchUserData = async () => {
      try {
        const data = await api.getMe();
        setUserData(data);
      } catch (err: any) {
        setError(err.message || 'Ошибка загрузки данных');
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);

  const handleSettingsUpdate = async (behaviorMode: string) => {
    try {
      await api.updateSettings({ behavior_mode: behaviorMode });
      if (userData) {
        setUserData({ ...userData, behavior_mode: behaviorMode });
      }
      WebApp.showAlert('Настройки сохранены!');
      WebApp.HapticFeedback.notificationOccurred('success');
    } catch (err: any) {
      WebApp.showAlert(err.message || 'Ошибка сохранения настроек');
      WebApp.HapticFeedback.notificationOccurred('error');
    }
  };

  const handleClearHistory = async () => {
    try {
      await api.clearHistory();
      WebApp.showAlert('История очищена!');
      WebApp.HapticFeedback.notificationOccurred('success');
    } catch (err: any) {
      WebApp.showAlert(err.message || 'Ошибка очистки истории');
      WebApp.HapticFeedback.notificationOccurred('error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-pink-100 via-purple-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-pink-400 border-t-transparent mx-auto mb-4"></div>
          <p className="text-purple-600 font-bold text-lg">Загрузка... ✨</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-pink-100 via-purple-50 to-indigo-100">
        <div className="text-center p-6 bg-white/80 backdrop-blur-lg rounded-3xl shadow-2xl border-2 border-pink-200/50">
          <p className="text-red-500 mb-4 font-bold text-lg">😢 {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-xl font-bold hover:shadow-lg transform hover:scale-105 transition-all"
          >
            Обновить ✨
          </button>
        </div>
      </div>
    );
  }

  if (!userData) {
    return null;
  }

  return (
    <div className="min-h-screen">
      {userData.isAdmin ? (
        <AdminPanel
          userData={userData}
          onClearHistory={handleClearHistory}
        />
      ) : (
        <MainScreen
          userData={userData}
          onSettingsUpdate={handleSettingsUpdate}
        />
      )}
    </div>
  );
}

export default App;

