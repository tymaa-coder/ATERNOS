const { Telegraf } = require('telegraf');
const mineflayer = require('mineflayer');

// Токен твого бота (можна змінити на process.env.BOT_TOKEN, якщо винесеш у змінні середовища)
const BOT_TOKEN = process.env.BOT_TOKEN || 'СЮДИ_ВСТАВ_ТОКЕН_АБО_ЗАЛИШ_ENV';

const bot = new Telegraf(BOT_TOKEN);

let minecraftBot = null;
let currentServerConfig = null; // Зберігаємо параметри для автореконекту
let reconnectTimeout = null;
let isIntentionallyStopped = false; // Прапорець, щоб розуміти, чи це зупинено користувачем

// Функція для створення/перезапуску mineflayer бота
function createMinecraftBot(host, port, username, ctx = null) {
    if (minecraftBot) {
        try {
            minecraftBot.quit();
        } catch (e) {}
        minecraftBot = null;
    }

    isIntentionallyStopped = false;
    currentServerConfig = { host, port, username };

    if (ctx) {
        ctx.reply(`?? Запускаю AFK-бота на сервері ${host}:${port} як ${username}...`).catch(() => {});
    }

    console.log(`[Minecraft] Підключення до ${host}:${port} (${username})...`);

    minecraftBot = mineflayer.createBot({
        host: host,
        port: parseInt(port),
        username: username,
        version: false // Автовизначення версії Minecraft
    });

    // Успішний запуск
    minecraftBot.on('spawn', () => {
        console.log(`[Minecraft] Бот ${username} успішно зайшов на сервер!`);
        if (ctx) {
            ctx.reply(`? Бот успішно зайшов на сервер і тримає AFK!`).catch(() => {});
        }

        // Цикл для запобігання кіку за AFK (стрибок кожну хвилину)
        if (minecraftBot._afkInterval) clearInterval(minecraftBot._afkInterval);
        minecraftBot._afkInterval = setInterval(() => {
            if (minecraftBot && minecraftBot.entity) {
                minecraftBot.setControlState('jump', true);
                setTimeout(() => {
                    if (minecraftBot) minecraftBot.setControlState('jump', false);
                }, 500);
            }
        }, 60000);
    });

    // Обробка помилок і вильотів
    minecraftBot.on('end', (reason) => {
        console.log(`? AFK-бот зупинено. Причина: ${reason}`);
        
        if (minecraftBot && minecraftBot._afkInterval) {
            clearInterval(minecraftBot._afkInterval);
        }

        // Якщо користувач сам не зупиняв бота командою /stop_afk — пробуємо перезайди
        if (!isIntentionallyStopped && currentServerConfig) {
            console.log('?? Сервер вигнав або розірвав з'єднання. Перезаходжу через 10 секунд...');
            if (ctx) {
                ctx.reply(`?? Бот відключився (причина: ${reason}). Пробую перезайті за 10 секунд...`).catch(() => {});
            }

            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(() => {
                if (!isIntentionallyStopped && currentServerConfig) {
                    createMinecraftBot(
                        currentServerConfig.host, 
                        currentServerConfig.port, 
                        currentServerConfig.username
                    );
                }
            }, 10000); // 10 секунд затримки перед реконектом
        }
    });

    minecraftBot.on('error', (err) => {
        console.log(`? Помилка Minecraft бота:`, err);
    });
}

// Команда /start
bot.start((ctx) => {
    ctx.reply(
        'Привіт! Я бот для утримання Aternos-сервера 24/7.\n\n' +
        'Використовуй команду у форматі:\n' +
        '`/start_afk [IP] [ПОРТ] [НІКНЕЙМ]`\n\n' +
        'Приклад:\n' +
        '`/start_afk myServer.aternos.me 12345 AfkBot`\n\n' +
        'Щоб зупинити бота, напиши: `/stop_afk`',
        { parse_mode: 'Markdown' }
    );
});

// Команда /start_afk IP ПОРТ НІКНЕЙМ
bot.command('start_afk', (ctx) => {
    const text = ctx.message.text;
    const args = text.split(' ').slice(1); // Витягуємо аргументи після команди

    if (args.length < 3) {
        return ctx.reply('? Неправильний формат! Використовуй:\n`/start_afk [IP] [ПОРТ] [НІКНЕЙМ]`', { parse_mode: 'Markdown' });
    }

    const [host, port, username] = args;

    // Зупиняємо попереднього бота, якщо він був
    isIntentionallyStopped = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    createMinecraftBot(host, port, username, ctx);
});

// Команда /stop_afk
bot.command('stop_afk', (ctx) => {
    isIntentionallyStopped = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    if (minecraftBot) {
        if (minecraftBot._afkInterval) clearInterval(minecraftBot._afkInterval);
        try {
            minecraftBot.quit();
        } catch (e) {}
        minecraftBot = null;
        currentServerConfig = null;
        ctx.reply('?? AFK-бот повністю зупинено.');
    } else {
        ctx.reply('?? Зараз немає активних ботів.');
    }
});

// Запуск Telegram-бота
bot.launch().then(() => {
    console.log('?? Telegram-бот успішно запущений!');
}).catch((err) => {
    console.error('? Помилка запуску Telegram-бота:', err);
});

// Коректне завершення роботи
process.once('SIGINT', () => {
    if (minecraftBot) minecraftBot.quit();
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    if (minecraftBot) minecraftBot.quit();
    bot.stop('SIGTERM');
});