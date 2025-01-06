const express = require('express');
const bot = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Webhook для Telegram (опционально)
app.use(express.json());
app.post(`/webhook/${bot.bot.token}`, (req, res) => {
  bot.bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Healthcheck endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Pidor Bot запущен на порту ${PORT}`);
  console.log(`Бот готов к работе: @${bot.bot.options.username}`);
});