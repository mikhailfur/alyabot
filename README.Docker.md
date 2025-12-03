# Запуск бота в Docker

## Требования
- Docker
- Docker Compose

## Настройка

1. Создайте файл `.env` на основе `env.example`:
```bash
cp env.example .env
```

2. Заполните все необходимые переменные в `.env` файле.

3. Убедитесь, что указаны переменные для Web App:
```env
WEBAPP_URL=https://yourdomain.com
PORT=3000
```

4. Создайте директорию для данных (если её нет):
```bash
mkdir -p data
```

## Запуск

### Сборка и запуск:
```bash
docker-compose up -d --build
```

### Просмотр логов:
```bash
docker-compose logs -f
```

### Остановка:
```bash
docker-compose down
```

### Перезапуск:
```bash
docker-compose restart
```

## Структура данных

- База данных SQLite сохраняется в `./data/alyabot.db`
- Изображения находятся в `./src/images/` (монтируются как read-only)

## Web App

Web App автоматически собирается при сборке Docker образа и доступен на порту, указанном в переменной `PORT` (по умолчанию 3000).

После запуска контейнера Web App будет доступен по адресу:
- Локально: `http://localhost:3000`
- В сети: `http://your-server-ip:3000`

Убедитесь, что в `.env` указан правильный `WEBAPP_URL` для кнопки в боте.

## Обновление

1. Остановите контейнер:
```bash
docker-compose down
```

2. Обновите код и пересоберите:
```bash
docker-compose up -d --build
```

