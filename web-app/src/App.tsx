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
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center p-6">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Обновить
          </button>
        </div>
      </div>
    );
  }

  if (!userData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
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

