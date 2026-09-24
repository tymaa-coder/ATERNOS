// index.js
// Telegram-бот, який керує mineflayer-ботом для утримання Aternos-сервера онлайн.
//
// Змінні середовища:
//   BOT_TOKEN - токен Telegram-бота (обов'язково)
//   PORT      - порт для HTTP-заглушки (Railway підставляє автоматично)

const http = require('http');
const { Telegraf } = require('telegraf');
const mineflayer = require('mineflayer');

// ---------- Перевірка обов'язкових змінних середовища ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('[FATAL] Не задано BOT_TOKEN у змінних середовища. Бот не може запуститись.');
  process.exit(1);
}

// ---------- Міні HTTP-сервер (потрібен для Railway health-check) ----------
// Без відкритого порту деякі типи сервісів на Railway вважають деплой "unhealthy"
// і перезапускають контейнер у циклі — саме через це бот часто "не відповідає".
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Aternos AFK bot is running.\n');
  })
  .listen(PORT, () => console.log(`[HTTP] Заглушка слухає порт ${PORT}`));

// ---------- Telegram bot ----------
const bot = new Telegraf(BOT_TOKEN);

// Мапа активних сесій mineflayer, ключ - chatId
// session = { mcBot, jumpTimer, reconnectTimer, host, port, username, chatId }
const sessions = new Map();

const JUMP_INTERVAL_MS = 30_000; // раз на 30 секунд
const JUMP_HOLD_MS = 400; // тримати "jump" 400мс

function safeSend(chatId, text) {
  bot.telegram.sendMessage(chatId, text).catch((err) => {
    console.error('[TG] Не вдалося надіслати повідомлення:', err.message);
  });
}

function stopSession(chatId, reason) {
  const session = sessions.get(chatId);
  if (!session) return;

  if (session.jumpTimer) clearInterval(session.jumpTimer);

  try {
    if (session.mcBot) {
      session.mcBot.removeAllListeners();
      session.mcBot.quit();
    }
  } catch (err) {
    console.error('[MC] Помилка під час зупинки бота:', err.message);
  }

  sessions.delete(chatId);

  if (reason) {
    safeSend(chatId, `⛔ AFK-бот зупинено. Причина: ${reason}`);
  }
}

function startAfkBot(chatId, host, port, username) {
  if (sessions.has(chatId)) {
    safeSend(chatId, '⚠️ У цьому чаті вже є активна AFK-сесія. Спочатку виконайте /stop_afk.');
    return;
  }

  safeSend(chatId, `🔄 Підключаюсь до ${host}:${port} як "${username}"...`);

  let mcBot;
  try {
    mcBot = mineflayer.createBot({
      host,
      port: Number(port),
      username,
      version: false, // авто-визначення версії сервера
      auth: 'offline', // Aternos зазвичай працює в offline/cracked режимі
    });
  } catch (err) {
    console.error('[MC] Помилка створення бота:', err.message);
    safeSend(chatId, `❌ Не вдалося створити бота: ${err.message}`);
    return;
  }

  const session = {
    mcBot,
    jumpTimer: null,
    host,
    port,
    username,
    chatId,
  };
  sessions.set(chatId, session);

  mcBot.once('spawn', () => {
    safeSend(chatId, `✅ Бот "${username}" успішно зайшов на сервер ${host}:${port}.`);

    // Анти-АФК цикл: стрибки з інтервалом
    session.jumpTimer = setInterval(() => {
      try {
        mcBot.setControlState('jump', true);
        setTimeout(() => {
          try {
            mcBot.setControlState('jump', false);
          } catch (e) {
            // бот міг вже відключитись між стрибком і відпусканням - ігноруємо
          }
        }, JUMP_HOLD_MS);
      } catch (err) {
        console.error('[MC] Помилка анти-АФК циклу:', err.message);
      }
    }, JUMP_INTERVAL_MS);
  });

  mcBot.on('kicked', (reason) => {
    console.warn('[MC] Kicked:', reason);
    stopSession(chatId, `сервер вигнав бота (${String(reason).slice(0, 200)})`);
  });

  mcBot.on('end', (reason) => {
    console.warn('[MC] Connection ended:', reason);
    // stopSession безпечний до повторного виклику - якщо сесію вже видалено, нічого не станеться
    if (sessions.has(chatId)) {
      stopSession(chatId, `з'єднання розірвано (${reason || 'невідома причина'})`);
    }
  });

  mcBot.on('error', (err) => {
    console.error('[MC] Bot error:', err.message);
    safeSend(chatId, `⚠️ Помилка Minecraft-бота: ${err.message}`);
    // Помилки на кшталт ECONNREFUSED / ENOTFOUND зазвичай супроводжуються 'end' - додатково не зупиняємо тут,
    // щоб уникнути подвійного виклику stopSession.
  });

  mcBot.on('death', () => {
    try {
      mcBot.respawn();
    } catch (err) {
      console.error('[MC] Помилка respawn:', err.message);
    }
  });
}

// ---------- Команди Telegram ----------

bot.start((ctx) => {
  ctx.reply(
    [
      '👋 Привіт! Я тримаю твій Aternos-сервер онлайн.',
      '',
      'Команди:',
      '/start_afk <IP> <ПОРТ> <НІКНЕЙМ> - підключити бота до сервера',
      '/stop_afk - відключити бота',
      '/status - перевірити стан',
      '',
      'Приклад:',
      '/start_afk myserver.aternos.me 25565 AfkBot',
    ].join('\n')
  );
});

bot.command('start_afk', (ctx) => {
  const chatId = ctx.chat.id;
  const parts = ctx.message.text.trim().split(/\s+/).slice(1); // прибираємо саму команду

  if (parts.length < 3) {
    ctx.reply(
      '❗ Невірний формат.\nВикористання:\n/start_afk <IP> <ПОРТ> <НІКНЕЙМ>\n\nПриклад:\n/start_afk myserver.aternos.me 25565 AfkBot'
    );
    return;
  }

  const [host, portStr, ...nickParts] = parts;
  const username = nickParts.join('_'); // якщо в ніку були пробіли
  const port = parseInt(portStr, 10);

  if (!host || Number.isNaN(port) || port <= 0 || port > 65535) {
    ctx.reply('❗ IP або порт вказано невірно. Порт має бути числом від 1 до 65535.');
    return;
  }

  try {
    startAfkBot(chatId, host, port, username);
  } catch (err) {
    console.error('[TG] Неочікувана помилка start_afk:', err);
    ctx.reply(`❌ Сталася непередбачена помилка: ${err.message}`);
  }
});

bot.command('stop_afk', (ctx) => {
  const chatId = ctx.chat.id;
  if (!sessions.has(chatId)) {
    ctx.reply('ℹ️ Немає активної AFK-сесії в цьому чаті.');
    return;
  }
  stopSession(chatId, 'зупинено користувачем');
});

bot.command('status', (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  if (!session) {
    ctx.reply('ℹ️ AFK-бот наразі неактивний.');
    return;
  }
  ctx.reply(
    `✅ Активна сесія:\nСервер: ${session.host}:${session.port}\nНік: ${session.username}`
  );
});

// ---------- Глобальна обробка помилок Telegraf ----------
// Дуже важливо: без цього одна необроблена помилка в будь-якому обробнику
// може "покласти" весь процес і бот перестане відповідати на всі команди.
bot.catch((err, ctx) => {
  console.error(`[Telegraf] Помилка для оновлення ${ctx.updateType}:`, err);
  try {
    ctx.reply('⚠️ Сталася внутрішня помилка. Спробуйте ще раз.');
  } catch (_) {
    // ігноруємо, якщо навіть відповісти не вдалося
  }
});

// ---------- Запуск бота ----------
bot
  .launch()
  .then(() => console.log('[TG] Telegram-бот запущено (long polling).'))
  .catch((err) => {
    console.error('[FATAL] Не вдалося запустити Telegram-бота:', err);
    process.exit(1);
  });

// ---------- Глобальні захисні обробники, щоб процес не падав ----------
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// ---------- Коректне завершення роботи ----------
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  sessions.forEach((_, chatId) => stopSession(chatId));
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  sessions.forEach((_, chatId) => stopSession(chatId));
  process.exit(0);
});
