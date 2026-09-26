const { Telegraf } = require('telegraf');
const mineflayer = require('mineflayer');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ Помилка: Не задано BOT_TOKEN у змінних середовища!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

let minecraftBot = null;
let currentServerConfig = null; 
let reconnectTimeout = null;
let isIntentionallyStopped = false; 

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
        ctx.reply(`🔄 Запускаю AFK-бота на сервері ${host}:${port} як ${username}...`).catch(() => {});
    }

    console.log(`[Minecraft] Підключення до ${host}:${port} (${username})...`);

    minecraftBot = mineflayer.createBot({
        host: host,
        port: parseInt(port),
        username: username,
        version: false 
    });

    minecraftBot.on('spawn', () => {
        console.log(`[Minecraft] Бот ${username} успішно зайшов на сервер!`);
        if (ctx) {
            ctx.reply(`✅ Бот успішно зайшов на сервер і тримає AFK!`).catch(() => {});
        }

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

    minecraftBot.on('end', (reason) => {
        console.log(`⛔ AFK-бот зупинено. Причина: ${reason}`);
        
        if (minecraftBot && minecraftBot._afkInterval) {
            clearInterval(minecraftBot._afkInterval);
        }

        if (!isIntentionallyStopped && currentServerConfig) {
            console.log("🔄 Сервер вигнав або розірвав зв'язок. Перезаходжу через 10 секунд...");
            if (ctx) {
                ctx.reply(`⚠️ Бот відключився (причина: ${reason}). Пробую перезайти за 10 секунд...`).catch(() => {});
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
            }, 10000); 
        }
    });

    minecraftBot.on('error', (err) => {
        console.log(`❌ Помилка Minecraft бота:`, err);
    });
}

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

bot.command('start_afk', (ctx) => {
    const text = ctx.message.text;
    const args = text.split(' ').slice(1); 

    if (args.length < 3) {
        return ctx.reply('❌ Неправильний формат! Використовуй:\n`/start_afk [IP] [ПОРТ] [НІКНЕЙМ]`', { parse_mode: 'Markdown' });
    }

    const [host, port, username] = args;

    isIntentionallyStopped = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    createMinecraftBot(host, port, username, ctx);
});

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
        ctx.reply('🛑 AFK-бот повністю зупинено.');
    } else {
        ctx.reply('⚠️ Зараз немає активних ботів.');
    }
});

bot.launch().then(() => {
    console.log('🤖 Telegram-бот успішно запущений!');
}).catch((err) => {
    console.error('❌ Помилка запуску Telegram-бота:', err);
});

process.once('SIGINT', () => {
    if (minecraftBot) minecraftBot.quit();
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    if (minecraftBot) minecraftBot.quit();
    bot.stop('SIGTERM');
});