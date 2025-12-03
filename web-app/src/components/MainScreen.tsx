import { useState, useEffect } from 'react';
import WebApp from '@twa-dev/sdk';
import { UserData } from '../types';

interface MainScreenProps {
  userData: UserData;
  onSettingsUpdate: (behaviorMode: string) => void;
}

const BEHAVIOR_MODES = [
  { value: 'default', label: 'Обычный', emoji: '🌸', color: 'from-pink-400 to-purple-400' },
  { value: 'study', label: 'Учёба', emoji: '📚', color: 'from-blue-400 to-cyan-400' },
  { value: 'work', label: 'Работа', emoji: '💼', color: 'from-indigo-400 to-purple-400' },
  { value: 'psychologist', label: 'Психолог', emoji: '🧠', color: 'from-purple-400 to-pink-400' },
  { value: 'nsfw', label: 'NSFW', emoji: '🔥', color: 'from-red-400 to-orange-400' },
];

export function MainScreen({ userData, onSettingsUpdate }: MainScreenProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const user = WebApp.initDataUnsafe?.user;
    if (user?.photo_url) {
      setAvatarUrl(user.photo_url);
    }
  }, []);

  const getDisplayName = () => {
    if (userData.firstName && userData.lastName) {
      return `${userData.firstName} ${userData.lastName}`;
    }
    return userData.firstName || userData.username || 'Пользователь';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-purple-50 to-indigo-100">
      <div className="max-w-md mx-auto p-4 pt-8">
        <div className="bg-white/80 backdrop-blur-lg rounded-3xl shadow-2xl p-6 mb-6 border-2 border-pink-200/50">
          <div className="flex items-center space-x-4 mb-6">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-20 h-20 rounded-full border-4 border-pink-300 shadow-lg object-cover"
              />
            ) : (
              <div className="w-20 h-20 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-lg border-4 border-pink-300">
                {getDisplayName().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
                {getDisplayName()}
              </h1>
              {userData.username && (
                <p className="text-purple-500 font-medium">@{userData.username}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-yellow-100 to-pink-100 rounded-2xl border-2 border-yellow-200">
            <span className="font-bold text-gray-800">Статус подписки</span>
            <span className={`px-4 py-2 rounded-full text-sm font-bold shadow-md ${
              userData.isPremium
                ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-white'
                : 'bg-gradient-to-r from-gray-300 to-gray-400 text-white'
            }`}>
              {userData.isPremium ? '⭐ Premium' : '💬 Free'}
            </span>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-lg rounded-3xl shadow-2xl p-6 border-2 border-pink-200/50">
          <h2 className="text-2xl font-bold mb-6 bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent text-center">
            ✨ Режим поведения
          </h2>
          <div className="space-y-3">
            {BEHAVIOR_MODES.map((mode) => {
              const isSelected = userData.behavior_mode === mode.value;
              const isDisabled = !userData.isPremium && mode.value !== 'default';
              
              return (
                <button
                  key={mode.value}
                  onClick={() => onSettingsUpdate(mode.value)}
                  disabled={isDisabled}
                  className={`w-full p-4 rounded-2xl border-2 transition-all transform ${
                    isSelected
                      ? `bg-gradient-to-r ${mode.color} border-transparent text-white shadow-lg scale-105`
                      : 'bg-white border-pink-200 hover:border-pink-300 hover:shadow-md'
                  } ${
                    isDisabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer active:scale-95'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-3xl">{mode.emoji}</span>
                      <span className={`font-bold text-lg ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                        {mode.label}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="text-2xl">✨</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {!userData.isPremium && (
            <p className="mt-6 text-sm text-center text-purple-600 font-medium bg-purple-50 p-3 rounded-xl border border-purple-200">
              💎 Для изменения режима нужна Premium подписка
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

