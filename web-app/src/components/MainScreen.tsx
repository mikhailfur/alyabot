import { UserData } from '../types';

interface MainScreenProps {
  userData: UserData;
  onSettingsUpdate: (behaviorMode: string) => void;
}

const BEHAVIOR_MODES = [
  { value: 'default', label: 'Обычный', emoji: '🔄' },
  { value: 'study', label: 'Учёба', emoji: '📚' },
  { value: 'work', label: 'Работа', emoji: '💼' },
  { value: 'psychologist', label: 'Психолог', emoji: '🧠' },
  { value: 'nsfw', label: 'NSFW', emoji: '🔥' },
];

export function MainScreen({ userData, onSettingsUpdate }: MainScreenProps) {
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Не указано';
    return new Date(timestamp).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getDisplayName = () => {
    if (userData.firstName && userData.lastName) {
      return `${userData.firstName} ${userData.lastName}`;
    }
    return userData.firstName || userData.username || 'Пользователь';
  };

  const currentMode = BEHAVIOR_MODES.find(m => m.value === userData.behavior_mode) || BEHAVIOR_MODES[0];

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-lg shadow-md p-6 mb-4">
        <div className="flex items-center space-x-4 mb-4">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
            {getDisplayName().charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold">{getDisplayName()}</h1>
            {userData.username && (
              <p className="text-gray-500">@{userData.username}</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <span className="font-medium">Статус подписки</span>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
              userData.isPremium
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-gray-100 text-gray-800'
            }`}>
              {userData.isPremium ? '⭐ Premium' : '💬 Free'}
            </span>
          </div>

          {userData.isPremium && userData.subscriptionUntil && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">Действует до</p>
              <p className="font-medium">{formatDate(userData.subscriptionUntil)}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-bold mb-4">Режим поведения</h2>
        <div className="space-y-2">
          {BEHAVIOR_MODES.map((mode) => (
            <button
              key={mode.value}
              onClick={() => onSettingsUpdate(mode.value)}
              disabled={!userData.isPremium && mode.value !== 'default'}
              className={`w-full p-4 rounded-lg border-2 transition-all ${
                userData.behavior_mode === mode.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              } ${
                !userData.isPremium && mode.value !== 'default'
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{mode.emoji}</span>
                  <span className="font-medium">{mode.label}</span>
                </div>
                {userData.behavior_mode === mode.value && (
                  <span className="text-blue-500">✓</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {!userData.isPremium && (
          <p className="mt-4 text-sm text-gray-500 text-center">
            Для изменения режима нужна Premium подписка
          </p>
        )}
      </div>
    </div>
  );
}

