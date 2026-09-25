minecraftBot.on('spawn', () => {
        console.log(`[Minecraft] Бот ${username} успішно зайшов на сервер!`);
        if (ctx) {
            ctx.reply(`✅ Бот успішно зайшов на сервер і тримає AFK!`).catch(() => {});
        }

        // Телепортація на вказані координати одразу після спавну
        setTimeout(() => {
            if (minecraftBot) {
                minecraftBot.chat(`/tp ${username} 1 -63 36`);
                console.log(`[Minecraft] Бот телепортований на координати: 1, -63, 36`);
            }
        }, 2000); // затримка 2 секунди, щоб сервер встиг повністю завантажити гравця

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