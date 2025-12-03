# Web App для Telegram бота Аля

React приложение для управления настройками бота через Telegram Mini App.

## Технологии

- React 18
- TypeScript
- Vite
- Tailwind CSS
- @twa-dev/sdk

## Разработка

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
```

Собранные файлы будут в папке `dist/`.

## Структура

- `src/App.tsx` - главный компонент
- `src/components/MainScreen.tsx` - экран для обычных пользователей
- `src/components/AdminPanel.tsx` - панель администратора
- `src/api.ts` - API клиент
- `src/types.ts` - TypeScript типы

