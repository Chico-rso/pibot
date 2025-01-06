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
    this.bot.onText(/\/pidormonth/, (msg) => this.handlePidorMonth(msg));
    this.bot.onText(/\/pidoryear/, (msg) => this.handlePidorYear(msg));
    this.bot.onText(/\/choosepidor/, (msg) => this.manualChoosePidor(msg));
    this.bot.onText(/\/pidorstats/, (msg) => this.handlePidorStats(msg));
    this.bot.on('new_chat_members', (msg) => this.handleNewChatMembers(msg));
  }

  setupScheduledTasks() {
    // Ежедневный выбор пидора в указанное время
    new CronJob(`0 ${DAILY_PIDOR_HOUR} * * *`, () => {
      this.chooseDailyPidor();
    }, null, true);

    // Проверка и сброс пидора каждые 12 часов
    new CronJob('0 */12 * * *', () => {
      this.checkAndResetDailyPidor();
    }, null, true);
  }

  handlePidorStats(msg) {
    const chatId = msg.chat.id;
    const db = database.readDatabase();
    const users = db.users || {};

    // Собираем общую статистику для каждого пользователя
    const userStats = Object.entries(users)
      .map(([userId, userData]) => {
        // Считаем количество попаданий из месячной и годовой статистики
        const monthPidors = (db.monthPidors || [])
          .filter(p => p.userId === userId);

        return {
          userId,
          username: userData.username,
          count: monthPidors.reduce((sum, pidor) => sum + pidor.count, 0)
        };
      })
      // Сортируем по количеству попаданий
      .sort((a, b) => b.count - a.count)
      // Оставляем только тех, у кого были попадания
      .filter(user => user.count > 0);

    // Формируем сообщение со статистикой
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

      this.bot.sendMessage(chatId, `📊 Рейтинг пидоров за все время:\n\n${statMessage}`, {
        parse_mode: 'Markdown'
      });
    } else {
      this.bot.sendMessage(chatId, 'Пока нет статистики 🤔');
    }
  }

  handleNewChatMembers(msg) {
    const chatId = msg.chat.id;

    // Проверяем, добавлен ли бот в группу
    const botAdded = msg.new_chat_members.some(member => member.is_bot && member.username === 'Piiiddor_bot');

    if (botAdded) {
      // Собираем всех участников группы
      this.collectGroupMembers(chatId);
    }
  }

  async collectGroupMembers(chatId) {
    try {
      // Проверяем, является ли бот администратором группы
      const botChatMember = await this.bot.getChatMember(chatId, this.bot.botInfo.id);

      if (!['administrator', 'creator'].includes(botChatMember.status)) {
        this.bot.sendMessage(chatId, '❌ Для сбора информации о пользователях, пожалуйста, сделайте бота администратором группы!');
        return [];
      }

      // Получаем общее количество участников группы
      const membersCount = await this.bot.getChatMembersCount(chatId);

      // Массив для хранения информации о пользователях
      const usersToRegister = [];

      // Получаем информацию о каждом участнике группы
      for (let offset = 0; offset < membersCount; offset += 200) {
        const members = await this.bot.getChatMembers(chatId, {
          offset: offset,
          limit: 200
        });

        // Фильтруем и собираем информацию о пользователях
        const filteredMembers = members
          .filter(member =>
            member.status !== 'left' &&
            member.status !== 'kicked' &&
            !member.user.is_bot
          )
          .map(member => ({
            userId: member.user.id,
            username: member.user.username || member.user.first_name || 'Unknown',
            firstName: member.user.first_name,
            lastName: member.user.last_name,
            status: member.status
          }));

        usersToRegister.push(...filteredMembers);
      }

      // Получаем информацию о чате
      const chatInfo = await this.bot.getChat(chatId);

      // Обновляем базу данных
      const db = database.readDatabase();
      if (!db.users) db.users = {};
      if (!db.chats) db.chats = {};

      // Сохраняем информацию о чате
      db.chats[chatId] = {
        title: chatInfo.title,
        type: chatInfo.type,
        membersCount: membersCount,
        registeredAt: new Date().toISOString()
      };

      // Регистрируем пользователей
      usersToRegister.forEach(user => {
        db.users[user.userId] = {
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          memberStatus: user.status,
          lastPidorDate: null,
          registeredAt: new Date().toISOString()
        };
      });

      // Сохраняем базу данных
      database.writeDatabase(db);

      // Отправляем подтверждающее сообщение
      this.bot.sendMessage(chatId, `✅ Собрал информацию о ${usersToRegister.length} участниках группы!\n\n📊 Всего участников: ${membersCount}`);

      return usersToRegister;
    } catch (error) {
      console.error('Ошибка при сборе участников группы:', error);

      // Разные типы обработки ошибок
      if (error.response && error.response.statusCode === 403) {
        this.bot.sendMessage(chatId, '❌ У бота нет доступа к информации о пользователях. Проверьте права администратора.');
      } else {
        this.bot.sendMessage(chatId, '❌ Не удалось собрать информацию об участниках группы.');
      }

      return [];
    }
  }

  manualChoosePidor(msg) {
    const chatId = msg.chat.id;
    const db = database.readDatabase();

    // Проверяем, можно ли выбрать нового пидора
    if (this.canChoosePidor(db)) {
      this.chooseDailyPidor(chatId);
    } else {
      const remainingTime = this.calculateRemainingTime(db);
      this.bot.sendMessage(chatId, `🕒 Следующий пидор может быть выбран через ${remainingTime}`);
    }
  }

  canChoosePidor(db) {
    if (!db.todayPidor) return true;

    const lastPidorTime = new Date(db.todayPidor.timestamp);
    const currentTime = new Date();
    const timeDiff = (currentTime - lastPidorTime) / (1000 * 60 * 60); // разница в часах

    return timeDiff >= 12;
  }

  calculateRemainingTime(db) {
    if (!db.todayPidor) return '0 часов';

    const lastPidorTime = new Date(db.todayPidor.timestamp);
    const nextPossibleTime = new Date(lastPidorTime.getTime() + 12 * 60 * 60 * 1000);
    const currentTime = new Date();

    const remainingHours = Math.ceil((nextPossibleTime - currentTime) / (1000 * 60 * 60));
    return `${remainingHours} часов`;
  }

  chooseDailyPidor(chatId = null) {
    const db = database.readDatabase();
    const userIds = Object.keys(db.users);

    if (userIds.length === 0) {
      if (chatId) this.bot.sendMessage(chatId, 'Нет зарегистрированных пользователей');
      return;
    }

    // Алгоритм взвешенного случайного выбора
    const weightedUsers = userIds.map(userId => {
      const user = db.users[userId];
      let weight = 1;

      if (user.lastPidorDate) {
        const daysSinceLastPidor = (Date.now() - new Date(user.lastPidorDate).getTime()) / (1000 * 60 * 60 * 24);
        weight *= Math.pow(PROBABILITY_MULTIPLIER, daysSinceLastPidor);
      }

      return { userId, weight };
    });

    // Нормализация весов
    const totalWeight = weightedUsers.reduce((sum, user) => sum + user.weight, 0);
    const normalizedUsers = weightedUsers.map(user => ({
      ...user,
      normalizedWeight: user.weight / totalWeight
    }));

    // Случайный выбор с учетом весов
    let randomValue = Math.random();
    const selectedUser = normalizedUsers.find(user => {
      randomValue -= user.normalizedWeight;
      return randomValue <= 0;
    });

    if (selectedUser) {
      const user = db.users[selectedUser.userId];
      user.lastPidorDate = new Date().toISOString();

      // Обновляем статистику
      db.todayPidor = {
        userId: selectedUser.userId,
        username: user.username,
        timestamp: new Date().toISOString()
      };

      // Обновляем месячную и годовую статистику
      this.updatePidorStatistics(db, selectedUser.userId, user.username);

      database.writeDatabase(db);

      // Отправляем сообщение
      const groupMessage = `🏆 Сегодняшний ПИДОР дня: @${user.username}! 🤪`;
      const personalMessage = `🎉 Поздравляем! Сегодня ты - ПИДОР ДНЯ! 🏆\n\n 😄`;

      // Отправка в группу
      if (chatId) {
        this.bot.sendMessage(chatId, groupMessage);
      } else {
        // Отправляем во все зарегистрированные чаты
        Object.keys(db.chats || {}).forEach(chatId => {
          this.bot.sendMessage(chatId, groupMessage);
        });
      }

      // Отправка личного сообщения пидору дня
      try {
        this.bot.sendMessage(selectedUser.userId, personalMessage);
      } catch (error) {
        console.error('Не удалось отправить личное сообщение:', error);
      }
    }
  }

  checkAndResetDailyPidor() {
    const db = database.readDatabase();

    if (db.todayPidor) {
      const lastPidorTime = new Date(db.todayPidor.timestamp);
      const currentTime = new Date();
      const timeDiff = (currentTime - lastPidorTime) / (1000 * 60 * 60); // разница в часах

      if (timeDiff >= 12) {
        // Сбрасываем пидора дня
        delete db.todayPidor;
        database.writeDatabase(db);

        // Автоматически выбираем нового пидора
        this.chooseDailyPidor();
      }
    }
  }

  updatePidorStatistics(db, userId, username) {
    if (!db.monthPidors) db.monthPidors = [];
    if (!db.yearPidors) db.yearPidors = [];

    const monthPidorIndex = db.monthPidors.findIndex(p => p.userId === userId);
    const yearPidorIndex = db.yearPidors.findIndex(p => p.userId === userId);

    if (monthPidorIndex !== -1) {
      db.monthPidors[monthPidorIndex].count++;
    } else {
      db.monthPidors.push({
        userId: userId,
        username: username,
        count: 1
      });
    }

    if (yearPidorIndex !== -1) {
      db.yearPidors[yearPidorIndex].count++;
    } else {
      db.yearPidors.push({
        userId: userId,
        username: username,
        count: 1
      });
    }
  }

  handlePidorToday(msg) {
    const chatId = msg.chat.id;
    const db = database.readDatabase();
    const todayPidor = db.todayPidor;

    if (todayPidor) {
      this.bot.sendMessage(chatId, `Сегодняшний пидор дня: ${todayPidor.username} 🏆`);
    } else {
      this.bot.sendMessage(chatId, 'Пидор дня еще не выбран 🤔');
    }
  }

  handlePidorMonth(msg) {
    const chatId = msg.chat.id;
    const db = database.readDatabase();
    const monthPidors = db.monthPidors || [];

    if (monthPidors.length > 0) {
      const pidorsList = monthPidors.map(p => `${p.username} (${p.count} раз)`).join('\n');
      this.bot.sendMessage(chatId, `Пидоры месяца:\n${pidorsList} 🏆`);
    } else {
      this.bot.sendMessage(chatId, 'Пока нет пидоров месяца 🤔');
    }
  }

  handlePidorYear(msg) {
    const chatId = msg.chat.id;
    const db = database.readDatabase();
    const yearPidors = db.yearPidors || [];

    if (yearPidors.length > 0) {
      const pidorsList = yearPidors.map(p => `${p.username} (${p.count} раз)`).join('\n');
      this.bot.sendMessage(chatId, `Пидоры года:\n${pidorsList} 🏆`);
    } else {
      this.bot.sendMessage(chatId, 'Пока нет пидоров года 🤔');
    }
  }
}

module.exports = new PidorBot();