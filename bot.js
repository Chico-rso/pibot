const TelegramBot = require('node-telegram-bot-api');
const { CronJob } = require('cron');
const https = require('https');
const {
    TELEGRAM_BOT_TOKEN,
    DAILY_PIDOR_HOUR,
    PROBABILITY_MULTIPLIER,
} = require('./config');
const database = require('./database');

class PidorBot {
    constructor() {
        this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
            polling: {
                interval: 2000,
                autoStart: true,
                params: {
                    timeout: 20,
                },
            },
            request: {
                agent: new https.Agent({
                    rejectUnauthorized: false,
                }),
            },
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
        // Ежедневный выбор пары пидоров в указанное время
        new CronJob(`0 ${ DAILY_PIDOR_HOUR } * * *`, () => {
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
                count: user.pidorCount || 0,
            }))
            .filter(user => user.count > 0)
            .sort((a, b) => b.count - a.count);
        
        if (userStats.length > 0) {
            const statMessage = userStats
                .map((user, index) => {
                    let emoji = '';
                    switch (index) {
                        case 0:
                            emoji = '🥇';
                            break;
                        case 1:
                            emoji = '🥈';
                            break;
                        case 2:
                            emoji = '🥉';
                            break;
                        default:
                            emoji = '🏅';
                    }
                    return `${ emoji } ${ index + 1 }. ${ user.username }: ${ user.count } раз`;
                })
                .join('\n');
            
            this.bot.sendMessage(chatId, `📊 Рейтинг пидоров:\n\n${ statMessage }`);
        } else {
            this.bot.sendMessage(chatId, 'Пока нет статистики 🤔');
        }
    }
    
    chooseDailyPidor(chatId = null) {
        const db = database.readDatabase();
        const usersEntries = Object.entries(db.users || {});
        
        if (usersEntries.length < 2) {
            if (chatId) this.bot.sendMessage(chatId, 'Недостаточно пользователей для выбора пары пидоров.');
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        // Проверяем, выбрана ли уже пара на сегодня (смотрим по полю lastPidorDate)
        const todaysPidors = usersEntries.filter(([_, user]) => user.lastPidorDate === today);
        
        if (todaysPidors.length >= 2) {
            const [first, second] = todaysPidors;
            this.bot.sendMessage(
                chatId,
                `🏆 Сегодняшняя пара пидоров: ${ first[1].username } (@${ first[1].telegramUsername }) и ${ second[1].username } (@${ second[1].telegramUsername })! 🤪`
            );
            return;
        }
        
        // Фильтруем пользователей, которых ещё не выбирали сегодня
        const notChosen = usersEntries.filter(([_, user]) => user.lastPidorDate !== today);
        
        if (notChosen.length < 2) {
            if (chatId) this.bot.sendMessage(chatId, 'Недостаточно пользователей для выбора пары пидоров.');
            return;
        }
        
        // Функция для выбора двух различных случайных индексов из массива длины n
        const getTwoDistinctIndices = (n) => {
            const first = Math.floor(Math.random() * n);
            let second;
            do {
                second = Math.floor(Math.random() * n);
            } while (second === first);
            return [first, second];
        };
        
        const [index1, index2] = getTwoDistinctIndices(notChosen.length);
        let [userId1, user1] = notChosen[index1];
        let [userId2, user2] = notChosen[index2];
        
        // Функция для поиска пользователя с указанным username среди всех пользователей БД
        const findUserByUsername = (username) => {
            const allUsers = Object.entries(db.users || {});
            return allUsers.find(([id, user]) => user.username === username);
        };
        
        // Если выбран AmiranBestaev, заменяем на GTsal (если такой зарегистрирован)
        if (user1.username === 'AmiranBestaev') {
            const replacement = findUserByUsername('GTsal');
            // Если замена найдена и это не тот же пользователь, что уже выбран как второй
            if (replacement && replacement[0] !== userId2) {
                [userId1, user1] = replacement;
            }
        }
        if (user2.username === 'AmiranBestaev') {
            const replacement = findUserByUsername('GTsal');
            if (replacement && replacement[0] !== userId1) {
                [userId2, user2] = replacement;
            }
        }
        
        // Обновляем статистику для обоих выбранных пользователей
        user1.pidorCount = (user1.pidorCount || 0) + 1;
        user2.pidorCount = (user2.pidorCount || 0) + 1;
        user1.lastPidorDate = today;
        user2.lastPidorDate = today;
        
        database.writeDatabase(db);
        
        const message = `🏆 Сегодняшняя пара пидоров: ${ user1.username } (@${ user1.telegramUsername }) и ${ user2.username } (@${ user2.telegramUsername })! 🤪`;
        
        if (chatId) {
            this.bot.sendMessage(chatId, message);
        }
    }
    
    handlePidorToday(msg) {
        const chatId = msg.chat.id;
        const db = database.readDatabase();
        const today = new Date().toISOString().split('T')[0];
        
        // Ищем всех пользователей, у которых lastPidorDate соответствует сегодняшней дате
        const todaysPidors = Object.values(db.users || {}).filter(user => user.lastPidorDate === today);
        
        if (todaysPidors.length >= 2) {
            const names = todaysPidors
                .map(user => `${ user.username } (@${ user.telegramUsername })`)
                .join(' и ');
            this.bot.sendMessage(chatId, `🏆 Сегодняшняя пара пидоров: ${ names }!`);
        } else if (todaysPidors.length === 1) {
            const user = todaysPidors[0];
            this.bot.sendMessage(chatId, `🏆 Сегодняшний пидор дня: ${ user.username } (@${ user.telegramUsername })!`);
        } else {
            this.bot.sendMessage(chatId, 'Пидор дня еще не выбран 🤔');
        }
    }
}

module.exports = new PidorBot();
