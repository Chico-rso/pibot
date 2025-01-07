const TelegramBot = require('node-telegram-bot-api');
const { CronJob } = require('cron');
const https = require('https');
const {
  TELEGRAM_BOT_TOKEN,
  DAILY_PIDOR_HOUR,
  PROBABILITY_MULTIPLIER
} = require('./config');
const database = require('./database');

class PidorBot {
  constructor() {
    this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
      polling: {
        interval: 2000,
        autoStart: true,
        params: {
          timeout: 20
        }
      },
      request: {
        agent: new https.Agent({
          rejectUnauthorized: false
        })
      }
    });

    this.bot.on('polling_error', (error) => {
      console.error('Ошибка подключения к Telegram:', error);
      setTimeout(() => {
        try {
          this.bot.stopPolling();
          this.bot.startPolling();
        } catch (restartError) {
          console.error('Ошибка при перезапуске бота:', restartError);
        }
      }, 5000);
    });

    this.setupCommands();
    this.setupScheduledTasks();
  }

  setupCommands() {
    this.bot.onText(/\/pidortoday/, (msg) => this.handlePidorToday(msg));
    this.bot.onText(/\/pidorstats/, (msg) => this.handlePidorStats(msg));
    this.bot.onText(/\/choosepidor/, (msg) => this.chooseDailyPidor(msg.chat.id));
  }

  setupScheduledTasks() {
    // Ежедневный выбор пидора в указанное время
    new CronJob(`0 ${DAILY_PIDOR_HOUR} * * *`, () => {
      this.chooseDailyPidor();
    }, null, true);
  }

  handlePidorStats(msg) {
    const chatId = msg.chat.id;
    const db = database.readDatabase();
    const users = db.users || {};

    // Собираем статистику для каждого пользователя
    const userStats = Object.values(users)
      .map(user => ({
        username: user.username,
        count: user.pidorCount || 0
      }))
      .filter(user => user.count > 0)
      .sort((a, b) => b.count - a.count);

    if (userStats.length > 0) {
      const statMessage = userStats
        .map((user, index) => {
          let emoji = '';
          switch (index) {
            case 0: emoji = '🥇'; break;
            case 1: emoji = '🥈'; break;
            case 2: emoji = '🥉'; break;
            default: emoji = '🏅';
          }
          return `${emoji} ${index + 1}. ${user.username}: ${user.count} раз`;
        })
        .join('\n');

      this.bot.sendMessage(chatId, `📊 Рейтинг пидоров:\n\n${statMessage}`);
    } else {
      this.bot.sendMessage(chatId, 'Пока нет статистики 🤔');
    }
  }

  chooseDailyPidor(chatId = null) {
    const db = database.readDatabase();
    const users = Object.entries(db.users || {});

    if (users.length === 0) {
      if (chatId) this.bot.sendMessage(chatId, 'Нет зарегистрированных пользователей');
      return;
    }

    // Проверяем, был ли уже выбран пидор сегодня
    const today = new Date().toISOString().split('T')[0];
    const someoneChosen = users.some(([_, user]) => user.lastPidorDate === today);

    if (someoneChosen) {
      if (chatId) {
        const todaysPidor = users.find(([_, user]) => user.lastPidorDate === today);
        this.bot.sendMessage(chatId, `Пидор на сегодня уже выбран: ${todaysPidor[1].username} (@${todaysPidor[1].telegramUsername}) 🏆`);
      }
      return;
    }

    // Выбираем случайного пользователя
    const randomIndex = Math.floor(Math.random() * users.length);
    const [userId, user] = users[randomIndex];

    // Обновляем статистику
    user.pidorCount = (user.pidorCount || 0) + 1;
    user.lastPidorDate = today;

    database.writeDatabase(db);

    const message = `🏆 Сегодняшний ПИДОР дня: ${user.username} (@${user.telegramUsername})! 🤪`;

    // Отправляем сообщение
    if (chatId) {
      this.bot.sendMessage(chatId, message);
    }
  }

  handlePidorToday(msg) {
    const chatId = msg.chat.id;
    const db = database.readDatabase();
    const today = new Date().toISOString().split('T')[0];

    const todaysPidor = Object.values(db.users || {})
      .find(user => user.lastPidorDate === today);

    if (todaysPidor) {
      this.bot.sendMessage(chatId, `Сегодняшний пидор дня: ${todaysPidor.username} (@${todaysPidor.telegramUsername}) 🏆`);
    } else {
      this.bot.sendMessage(chatId, 'Пидор дня еще не выбран 🤔');
    }
  }
}

module.exports = new PidorBot();