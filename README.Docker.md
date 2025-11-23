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

3. Создайте директорию для данных (если её нет):
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

## Обновление

1. Остановите контейнер:
```bash
docker-compose down
```

2. Обновите код и пересоберите:
```bash
docker-compose up -d --build
```

