require('dotenv').config();

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN',
  DATABASE_FILE: './pidors.json',
  DAILY_PIDOR_HOUR: 12, // Время выбора пидора дня
  ADMIN_CHAT_ID: null, // ID чата для логирования
  PROBABILITY_MULTIPLIER: 1.5 // Коэффициент увеличения шанса стать пидором
};