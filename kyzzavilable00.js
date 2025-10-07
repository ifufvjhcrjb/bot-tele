const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const os = require("os");
const chalk = require("chalk");
const DATA_FILE = "data.json";
let autoShares = {};
const chatSessions = {};

const {
    BOT_TOKEN,
    OWNER_IDS,
    CHANNEL_USERNAME,
    DEVELOPER,
    VERSION,
    CHANNEL_URL,
    MENU_IMAGES
} = require("./config.js");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const BOT_START_TIME = Date.now();
const defaultData = {
    premium: {},
    owner: OWNER_IDS,
    groups: [],
    users: [],
    blacklist: []
};

const getUptime = () => {
    const uptimeSeconds = process.uptime();
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);

    return `${hours}h ${minutes}m ${seconds}s`;
};

function getRandomImage() {
    return MENU_IMAGES[Math.floor(Math.random() * MENU_IMAGES.length)];
}

function loadData() {
    try {
        const file = fs.readFileSync(DATA_FILE, "utf8");
        return JSON.parse(file);
    } catch {
        return defaultData;
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function isMainOwner(id) {
    return OWNER_IDS.map(String).includes(String(id));
}

function isAdditionalOwner(id) {
    const data = loadData();
    return (
        Array.isArray(data.owner) && data.owner.map(String).includes(String(id))
    );
}

function isAnyOwner(id) {
    return isMainOwner(id) || isAdditionalOwner(id);
}

function isOwner(id) {
    return isAnyOwner(id);
}

function isPremium(id) {
    const data = loadData();
    const exp = data.premium[id];
    if (!exp) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec < exp;
}

function getGlobalCooldownMinutes() {
    const data = loadData();
    if (
        data.settings &&
        data.settings.cooldown &&
        data.settings.cooldown.default
    ) {
        return data.settings.cooldown.default;
    }
    return 15;
}

function getGlobalCooldownMs() {
    return getGlobalCooldownMinutes() * 60 * 1000;
}

async function requireNotBlacklisted(msg) {
    const userId = msg.from.id;
    if (isBlacklisted(userId)) {
        await bot.sendMessage(
            userId,
            "⛔ Kamu diblokir tidak bisa menggunakan bot."
        );
        return false;
    }
    return true;
}

function isBlacklisted(userId) {
    const data = loadData();
    return (
        Array.isArray(data.blacklist) &&
        data.blacklist.map(String).includes(String(userId))
    );
}

const { writeFileSync, existsSync, mkdirSync } = require("fs");

function backupData() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = "./backup";
    const backupPath = `${backupDir}/data-${timestamp}.json`;

    if (!existsSync(backupDir)) mkdirSync(backupDir);
    if (!existsSync(DATA_FILE)) return null;
    const content = fs.readFileSync(DATA_FILE);
    writeFileSync(backupPath, content);

    return backupPath;
}

bot.on("my_chat_member", async msg => {
    try {
        const data = loadData();
        const chat = msg.chat || msg.chat_member?.chat;
        const user = msg.from;
        const status = msg.new_chat_member?.status;
        const chatId = chat?.id;
        const userId = user?.id;

        if (!chat || !user || !status || !chatId || !userId) return;

        const isGroup = chat.type === "group" || chat.type === "supergroup";
        const mainOwner = OWNER_IDS[0];

        if (!data.groups) data.groups = [];
        if (!data.user_group_count) data.user_group_count = {};
        if (!data.premium) data.premium = {};

        const minGrupPermanent = 10;
        const premHariPerGrup = 2;

        // === BOT DITAMBAHKAN ===
        if (["member", "administrator"].includes(status)) {
            if (isGroup && !data.groups.includes(chatId)) {
                data.groups.push(chatId);

                data.user_group_count[userId] =
                    (data.user_group_count[userId] || 0) + 1;
                const total = data.user_group_count[userId];

                let memberCount = 0;
                try {
                    memberCount = await bot
                        .getChatMemberCount(chatId)
                        .catch(() => 0);
                } catch {
                    memberCount = 0;
                }

                if (memberCount >= 20) {
                    const sekarang = Math.floor(Date.now() / 1000);
                    let durasiDetik = 0;

                    if (total >= minGrupPermanent) {
                        data.premium[userId] = "permanent";
                    } else {
                        durasiDetik = premHariPerGrup * 86400;
                        const current = data.premium[userId] || sekarang;
                        data.premium[userId] =
                            current > sekarang
                                ? current + durasiDetik
                                : sekarang + durasiDetik;
                    }

                    // ✅ Notifikasi ke user
                    if (durasiDetik > 0) {
                        bot.sendMessage(
                            userId,
                            `🎉 Kamu berhasil menambahkan bot ke ${total} grup (≥20 member).\n✅ Premium aktif *${premHariPerGrup} hari*!`,
                            { parse_mode: "Markdown" }
                        ).catch(() => {});
                    } else if (total >= minGrupPermanent) {
                        bot.sendMessage(
                            userId,
                            `🎉 Kamu berhasil menambahkan bot ke ${total} grup!\n✅ Premium aktif *PERMANEN*!`,
                            { parse_mode: "Markdown" }
                        ).catch(() => {});
                    }

                    const info = `
➕ Bot ditambahkan ke grup baru!

👤 User: [${user.first_name}](tg://user?id=${userId})
🔗 Username: @${user.username || "-"}
🆔 ID User: \`${userId}\`

👥 Grup: ${chat.title}
🆔 ID Grup: \`${chatId}\`

📊 Total Grup Ditambahkan: ${total}
👥 Member Grup: ${memberCount}
`.trim();

                    await bot
                        .sendMessage(mainOwner, info, {
                            parse_mode: "Markdown"
                        })
                        .catch(() => {});

                    const backupPath = backupData();
                    if (backupPath) {
                        await bot
                            .sendDocument(
                                mainOwner,
                                backupPath,
                                {},
                                { filename: "data-backup.json" }
                            )
                            .catch(() => {});
                    }
                } else {
                    bot.sendMessage(
                        userId,
                        `⚠️ Grup ${chat.title} hanya punya ${memberCount} member.\n❌ Minimal 20 member.`
                    ).catch(() => {});
                }

                saveData(data);
            }
        }

        // === BOT DIKELUARKAN ===
        if (["left", "kicked", "banned", "restricted"].includes(status)) {
            if (isGroup && data.groups.includes(chatId)) {
                data.groups = data.groups.filter(id => id !== chatId);

                if (data.user_group_count[userId]) {
                    data.user_group_count[userId]--;

                    if (data.user_group_count[userId] < minGrupPermanent) {
                        delete data.premium[userId];
                        bot.sendMessage(
                            userId,
                            `❌ Kamu menghapus bot dari grup.\n🔒 Premium otomatis dicabut.`
                        ).catch(() => {});
                    }

                    let memberCount = 0;
                    try {
                        memberCount = await bot
                            .getChatMemberCount(chatId)
                            .catch(() => 0);
                    } catch {
                        memberCount = 0;
                    }

                    const info = `
⚠️ Bot dikeluarkan dari grup!

👤 User: [${user.first_name}](tg://user?id=${userId})
🔗 Username: @${user.username || "-"}
🆔 ID User: \`${userId}\`

👥 Grup: ${chat.title}
🆔 ID Grup: \`${chatId}\`

📊 Total Grup Saat Ini: ${data.user_group_count[userId] || 0}
👥 Member Grup: ${memberCount}
`.trim();

                    await bot
                        .sendMessage(mainOwner, info, {
                            parse_mode: "Markdown"
                        })
                        .catch(() => {});

                    const backupPath = backupData();
                    if (backupPath) {
                        await bot
                            .sendDocument(
                                mainOwner,
                                backupPath,
                                {},
                                { filename: "data-backup.json" }
                            )
                            .catch(() => {});
                    }
                }

                saveData(data);
            }
        }
    } catch (err) {
        console.error("❌ Error my_chat_member:", err);
    }
});

setInterval(() => {
    const data = loadData();
    const now = Math.floor(Date.now() / 1000);

    for (const uid in data.premium) {
        if (data.premium[uid] <= now) {
            delete data.premium[uid];
            console.log(`🔒 Premium expired & dicabut untuk ${uid}`);

            bot.sendMessage(
                uid,
                "⚠️ Masa aktif Premium kamu sudah *expired*.",
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: `💎 Buy Akses`,
                                    url: `https://t.me/${DEVELOPER}`
                                }
                            ]
                        ]
                    }
                }
            ).catch(() => {});
        }
    }

    saveData(data);
}, 60 * 1000);

async function checkChannelMembership(userId) {
    try {
        const chatMember = await bot.getChatMember(CHANNEL_USERNAME, userId);
        return ["member", "administrator", "creator"].includes(
            chatMember.status
        );
    } catch (err) {
        return false;
    }
}

async function requireJoin(msg) {
    const userId = msg.from.id;
    const isMember = await checkChannelMembership(userId);

    if (!isMember) {
        await bot.sendMessage(
            userId,
            "🚫 *Kamu belum bergabung Join Channel Di Bawah Untuk Memakai Bot!*",
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "📢 Gabung Channel",
                                url: `https://t.me/${CHANNEL_USERNAME.replace(
                                    "@",
                                    ""
                                )}`
                            }
                        ],
                        [
                            {
                                text: "🔁 Coba Lagi",
                                callback_data: "check_join_again"
                            }
                        ]
                    ]
                }
            }
        );
        return false;
    }
    return true;
}

function withRequireJoin(handler) {
    return async (msg, match) => {
        const ok = await requireJoin(msg);
        if (!ok) return;
        return handler(msg, match);
    };
}

bot.on("callback_query", async query => {
    const userId = query.from.id;

    if (query.data === "check_join_again") {
        const isMember = await checkChannelMembership(userId);

        if (isMember) {
            await bot.sendMessage(userId, "✅ Makasih Kamu Sudah Join");
        } else {
            await bot.sendMessage(userId, "❌ Lu Belum Join Tolol.");
        }

        bot.answerCallbackQuery(query.id);
    }
});

const activeMenus = {};

async function replaceMenu(chatId, caption, buttons) {
    try {
        if (activeMenus[chatId]) {
            try {
                await bot.deleteMessage(chatId, activeMenus[chatId]);
            } catch (e) {}
            delete activeMenus[chatId];
        }

        // Kirim pesan baru
        const sent = await bot.sendPhoto(chatId, getRandomImage(), {
            caption,
            parse_mode: "HTML",
            reply_markup: buttons
        });

        activeMenus[chatId] = sent.message_id;
    } catch (err) {
        console.error("replaceMenu error:", err);
    }
}
// simpan pesan terakhir per chat
const lastMenuMessage = {};

// ==================== START ====================
// ==================== START ====================
bot.onText(
    /\/start/,
    withRequireJoin(async msg => {
        if (!(await requireNotBlacklisted(msg))) return;
        const data = loadData();
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        const waktuRunPanel = getUptime();
        const username = msg.from.username
            ? `@${msg.from.username}`
            : "Tidak ada username";
        if (msg.date * 1000 < BOT_START_TIME) return;

        if (!data.users.includes(userId)) {
            data.users.push(userId);
            saveData(data);
        }

        const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
𝗝𝗮𝘀𝗲𝗯 ─ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 ボットは、速く柔軟で安全な自動化ツール。デジタルタスクを
┌────────>
│ 𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐬𝐢 ☇ 𝐁𝐨𝐭 ° 𝐉𝐚𝐬𝐞𝐛
├⬡ Author : ${DEVELOPER} 〽️
├⬡ Versi : ${VERSION} 
├⬡ Grup Count : ${data.groups.length}
├⬡ Users Count : ${data.users.length} 
├⬡ Channel : <a href="https://t.me/chkurokaii">Gabung Channel</a> 
├⬡ Time Bot : ${waktuRunPanel}
└────>
<blockquote>Created By <a href="https://t.me/ku_kaii">kaii</a></blockquote>
`;

        await replaceMenu(chatId, caption, {
            keyboard: [
                [{ text: "✨ Jasher Menu" }, { text: "⚡ Plans Free" }],
                [{ text: "💎 Plans Owner" }, { text: "💬 Contact Owner" }],
                [{ text: "🧩 Tools Menu" }, { text: "⁉️ Hubungi Owner" }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        });
    })
);

// ==================== HUBUNGI ADMIN (SESSION) ====================
bot.on("message", async msg => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text;
    const data = loadData();
    const waktuRunPanel = getUptime();
    const username = msg.from.username
        ? `@${msg.from.username}`
        : "Tidak ada username";
    const ownerIdUtama = OWNER_IDS[0];

    if (
        [
            "🔙 Kembali",
            "✨ Jasher Menu",
            "💎 Plans Owner",
            "⚡ Plans Free",
            "🧩 Tools Menu",
            "💬 Contact Owner",
            "⁉️ Hubungi Owner"
        ].includes(text)
    ) {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }

    // ==================== MAIN MENU ====================
    if (text === "🔙 Kembali") {
        const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
𝗝𝗮𝘀𝗲𝗯 ─ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 ボットは、速く柔軟で安全な自動化ツール。デジタルタスクを
┌────────>
│ 𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐬𝐢 ☇ 𝐁𝐨𝐭 ° 𝐉𝐚𝐬𝐞𝐛
├⬡ Author : ${DEVELOPER} 〽️
├⬡ Versi : ${VERSION} 
├⬡ Grup Count : ${data.groups.length}
├⬡ Users Count : ${data.users.length} 
├⬡ Channel : <a href="https://t.me/chkurokaii">Gabung Channel</a> 
├⬡ Time Bot : ${waktuRunPanel}
└────>
<blockquote>Created By <a href="https://t.me/ku_kaii">kaii</a></blockquote>
`;
        return replaceMenu(chatId, caption, {
            keyboard: [
                [{ text: "✨ Jasher Menu" }, { text: "⚡ Plans Free" }],
                [{ text: "💎 Plans Owner" }, { text: "💬 Contact Owner" }],
                [{ text: "🧩 Tools Menu" }, { text: "⁉️ Hubungi Owner" }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        });
    }

    // ==================== OWNER ====================
    if (text === "💬 Contact Owner") {
        return bot.sendMessage(chatId, `💬 Contact Owner: ${DEVELOPER}`);
    }

    // ==================== 💎 Plans Owner ====================
    if (text === "💎 Plans Owner") {
        if (!isAnyOwner(userId)) {
            return bot.sendMessage(chatId, "⛔ Only Owner Can Use This Menu");
        }
        const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
𝗝𝗮𝘀𝗲𝗯 ─ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 ボットは、速く柔軟で安全な自動化ツール。デジタルタスクを
┌────────>
│ 𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐬𝐢 ☇ 𝐁𝐨𝐭 ° 𝐉𝐚𝐬𝐞𝐛
├⬡ Author : ${DEVELOPER} 〽️
├⬡ Versi : ${VERSION} 
├⬡ Grup Count : ${data.groups.length}
├⬡ Users Count : ${data.users.length} 
├⬡ Channel : <a href="https://t.me/chkurokaii">Gabung Channel</a> 
├⬡ Time Bot : ${waktuRunPanel}
└────>
<blockquote>💎 Plans Owner</blockquote>
• /addownjs
• /delownjs
• /listownjs 
• /addakses 
• /delakses
• /listakses
<blockquote>Created By <a href="https://t.me/ku_kaii">kaii</a></blockquote>
`;
        return replaceMenu(chatId, caption, {
            keyboard: [[{ text: "🔙 Kembali" }]],
            resize_keyboard: true,
            one_time_keyboard: false
        });
    }

    // ==================== 🧩 Tools Menu ====================
    if (text === "🧩 Tools Menu") {
        const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
𝗝𝗮𝘀𝗲𝗯 ─ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 ボットは、速く柔軟で安全な自動化ツール。デジタルタスクを
┌────────>
│ 𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐬𝐢 ☇ 𝐁𝐨𝐭 ° 𝐉𝐚𝐬𝐞𝐛
├⬡ Author : ${DEVELOPER} 〽️
├⬡ Versi : ${VERSION} 
├⬡ Grup Count : ${data.groups.length}
├⬡ Users Count : ${data.users.length} 
├⬡ Channel : <a href="https://t.me/chkurokaii">Gabung Channel</a> 
├⬡ Time Bot : ${waktuRunPanel}
└────>
<blockquote>🧩 Tools Menu</blockquote>
• /addbl
• /delbl
• /listbl
• /ping
• /cekid
• /backup
<blockquote>Created By <a href="https://t.me/ku_kaii">kaii</a></blockquote>
`;
        return replaceMenu(chatId, caption, {
            keyboard: [[{ text: "🔙 Kembali" }]],
            resize_keyboard: true,
            one_time_keyboard: false
        });
    }

    // ==================== ✨ Jasher Menu ====================
    if (text === "✨ Jasher Menu") {
        const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
𝗝𝗮𝘀𝗲𝗯 ─ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 ボットは、速く柔軟で安全な自動化ツール。デジタルタスクを
┌────────>
│ 𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐬𝐢 ☇ 𝐁𝐨𝐭 ° 𝐉𝐚𝐬𝐞𝐛
├⬡ Author : ${DEVELOPER} 〽️
├⬡ Versi : ${VERSION} 
├⬡ Grup Count : ${data.groups.length}
├⬡ Users Count : ${data.users.length} 
├⬡ Channel : <a href="https://t.me/chkurokaii">Gabung Channel</a> 
├⬡ Time Bot : ${waktuRunPanel}
└────>
<blockquote>✨ Jasher Menu</blockquote>
• /sharemsg 
• /broadcast
• /sharemsgv2
• /broadcastv2
• /setpesan 
• /setjeda
• /auto on/off
• /auto status
<blockquote>Created By <a href="https://t.me/ku_kaii">kaii</a></blockquote>
`;
        return replaceMenu(chatId, caption, {
            keyboard: [[{ text: "🔙 Kembali" }]],
            resize_keyboard: true,
            one_time_keyboard: false
        });
    }

    // ==================== ⚡ Plans Free ====================
    if (text === "⚡ Plans Free") {
        const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
𝗝𝗮𝘀𝗲𝗯 ─ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 ボットは、速く柔軟で安全な自動化ツール。デジタルタスクを
┌────────>
│ 𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐬𝐢 ☇ 𝐁𝐨𝐭 ° 𝐉𝐚𝐬𝐞𝐛
├⬡ Author : ${DEVELOPER} 〽️
├⬡ Versi : ${VERSION} 
├⬡ Grup Count : ${data.groups.length}
├⬡ Users Count : ${data.users.length} 
├⬡ Channel : <a href="https://t.me/chkurokaii">Gabung Channel</a> 
├⬡ Time Bot : ${waktuRunPanel}
└────>
<blockquote>⚡ PLANS FREE</blockquote>
┌─ ⧼ 𝗖𝗔𝗥𝗔 𝗗𝗔𝗣𝗔𝗧𝗜𝗡 𝗣𝗥𝗘𝗠 ⧽
├ 𝙼𝙰𝚂𝚄𝙺𝙸𝙽 𝙱𝙾𝚃 𝙺𝙴 𝙶𝚁𝚄𝙱 𝙼𝙸𝙽𝙸𝙼𝙰𝙻 2 𝙶𝚁𝚄𝙿 
├ 𝙹𝙸𝙺𝙰 𝚂𝚄𝙳𝙰𝙷 𝙺𝙰𝙻𝙸𝙰𝙽 𝙱𝙰𝙺𝙰𝙻 𝙳𝙰𝙿𝙴𝚃 𝙰𝙺𝚂𝙴𝚂 𝙿𝚁𝙴𝙼 𝙾𝚃𝙾𝙼𝙰𝚃𝙸𝚂
├ 𝙳𝙰𝙽 𝙻𝚄 𝚃𝙸𝙽𝙶𝙶𝙰𝙻 𝙺𝙴𝚃𝙸𝙺 𝚈𝙰𝙽𝙶 𝙼𝙰𝚄 𝙳𝙸 𝚂𝙷𝙴𝚁𝙴
├ 𝙳𝙰𝙽 𝙻𝚄 𝚃𝙸𝙽𝙶𝙶𝙰𝙻 𝚁𝙴𝙿𝙻𝚈 𝚃𝙴𝙺𝚂 𝙽𝚈𝙰 𝙺𝙴𝚃𝙸𝙺 /𝚂𝙷𝙰𝚁𝙴𝙼𝚂𝙶
╰────────────────────
┌─ ⧼ 𝗣𝗘𝗥𝗔𝗧𝗨𝗥𝗔𝗡‼️ ⧽
├ 𝙹𝙸𝙺𝙰 𝙱𝙾𝚃 𝚂𝚄𝙳𝙰𝙷 𝙱𝙴𝚁𝙶𝙰𝙱𝚄𝙽𝙶
├ 𝙳𝙰𝙽 𝙰𝙽𝙳𝙰 𝙼𝙴𝙽𝙶𝙴𝙻𝚄𝙰𝚁𝙺𝙰𝙽 𝙽𝚈𝙰
├ 𝙱𝙾𝚃 𝙰𝙺𝙰𝙽 𝙾𝚃𝙾𝙼𝙰𝚃𝙸𝚂 𝙼𝙴𝙽𝙶𝙷𝙰𝙿𝚄𝚂 𝙰𝙺𝚂𝙴𝚂 𝙿𝚁𝙴𝙼
├ 𝙹𝙰𝙽𝙶𝙰𝙽 𝙳𝙸 𝚂𝙿𝙰𝙼 𝙱𝙾𝚃 𝙽𝚈𝙰 𝙺𝙾𝙽𝚃𝙾𝙻
├ 𝙷𝙰𝚁𝙰𝙿 𝙳𝙸 𝙿𝙰𝚃𝚄𝙷𝙸 ‼️
╰────────────────────
<blockquote>CREATED BY @ku_kaii</blockquote>
`;
        return replaceMenu(chatId, caption, {
            keyboard: [[{ text: "🔙 Kembali" }]],
            resize_keyboard: true,
            one_time_keyboard: false
        });
    }

    // ==================== HUBUNGI ADMIN SESSION ====================
    if (text === "⁉️ Hubungi Owner") {
        chatSessions[userId] = { active: true, ownerId: ownerIdUtama };

        await bot.sendMessage(
            chatId,
            "🔔 Kamu sekarang terhubung dengan Admin.\nKetik pesanmu di sini.\n\nKetik ❌ BATALKAN untuk mengakhiri sesi.",
            {
                reply_markup: {
                    keyboard: [[{ text: "❌ BATALKAN" }]],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );

        return bot.sendMessage(
            ownerIdUtama,
            `👤 User <a href="tg://user?id=${userId}">${msg.from.first_name}</a> memulai sesi chat.`,
            { parse_mode: "HTML" }
        );
    }

    // ==================== BATALKAN DARI USER ====================
    if (text === "❌ BATALKAN" && chatSessions[userId]?.active) {
        const ownerId = chatSessions[userId].ownerId;
        delete chatSessions[userId];

        await bot.sendMessage(chatId, "❌ Sesi chat dengan Admin ditutup.", {
            reply_markup: { remove_keyboard: true }
        });

        const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
𝗝𝗮𝘀𝗲𝗯 ─ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 ボットは、速く柔軟で安全な自動化ツール。デジタルタスクを
┌────────>
│ 𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐬𝐢 ☇ 𝐁𝐨𝐭 ° 𝐉𝐚𝐬𝐞𝐛
├⬡ Author : ${DEVELOPER} 〽️
├⬡ Versi : ${VERSION} 
├⬡ Grup Count : ${data.groups.length}
├⬡ Users Count : ${data.users.length} 
├⬡ Channel : <a href="https://t.me/chkurokaii">Gabung Channel</a> 
├⬡ Time Bot : ${waktuRunPanel}
└────>
<blockquote>Created By <a href="https://t.me/ku_kaii">kaii</a></blockquote>
`;
        await replaceMenu(chatId, caption, {
            keyboard: [
                [{ text: "✨ Jasher Menu" }, { text: "⚡ Plans Free" }],
                [{ text: "💎 Plans Owner" }, { text: "💬 Contact Owner" }],
                [{ text: "🧩 Tools Menu" }, { text: "⁉️ Hubungi Owner" }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        });

        return bot.sendMessage(
            ownerId,
            `🚪 User <a href="tg://user?id=${userId}">${msg.from.first_name}</a> menutup sesi chat.`,
            { parse_mode: "HTML" }
        );
    }

    // ==================== CHAT SESSION ====================
    if (chatSessions[userId]?.active) {
        const ownerId = chatSessions[userId].ownerId;
        await bot
            .forwardMessage(ownerId, chatId, msg.message_id)
            .catch(() => {});
        return bot.sendMessage(chatId, "✅ Pesan berhasil terkirim ke Admin.");
    }

    if (isAnyOwner(userId) && msg.reply_to_message) {
        const fwdFrom = msg.reply_to_message.forward_from;
        if (fwdFrom) {
            const targetUserId = fwdFrom.id.toString();
            if (chatSessions[targetUserId]?.active) {
                if (msg.text) {
                    await bot.sendMessage(targetUserId, msg.text);
                } else if (msg.photo) {
                    await bot.sendPhoto(
                        targetUserId,
                        msg.photo[msg.photo.length - 1].file_id,
                        { caption: msg.caption || "" }
                    );
                } else if (msg.voice) {
                    await bot.sendVoice(targetUserId, msg.voice.file_id, {
                        caption: msg.caption || ""
                    });
                } else if (msg.document) {
                    await bot.sendDocument(targetUserId, msg.document.file_id, {
                        caption: msg.caption || ""
                    });
                }
                return bot.sendMessage(
                    userId,
                    "✅ Pesan berhasil terkirim ke user."
                );
            }
        }
    }
});

bot.onText(/^\/sharemsg$/, async msg => {
    if (!(await requireNotBlacklisted(msg))) return;
    const senderId = msg.from.id.toString();
    const data = loadData();
    const chatId = msg.chat.id;

    try {
        const isMain = isMainOwner(senderId);
        const isOwnerNow = isAnyOwner(senderId);
        const isPremiumUser =
            data.premium?.[senderId] &&
            Math.floor(Date.now() / 1000) < data.premium[senderId];
        const groupCount = data.user_group_count?.[senderId] || 0;

        if (!isOwnerNow && !isPremiumUser && groupCount < 2) {
            return bot
                .sendMessage(chatId, "⛔ Can Only Be Used Premium User")
                .catch(() => {});
        }

        if (!data.cooldowns) data.cooldowns = {};
        if (!data.cooldowns.share) data.cooldowns.share = {};
        const now = Math.floor(Date.now() / 1000);
        const lastUse = data.cooldowns.share[senderId] || 0;
        const cooldown = getGlobalCooldownMinutes() * 60;

        if (!isMain && now - lastUse < cooldown) {
            const sisa = cooldown - (now - lastUse);
            const menit = Math.floor(sisa / 60);
            const detik = sisa % 60;
            return bot
                .sendMessage(
                    chatId,
                    `🕒 Tunggu ${menit} menit ${detik} detik sebelum menggunakan /sharemsg lagi.`
                )
                .catch(() => {});
        }

        if (!msg.reply_to_message) {
            return bot
                .sendMessage(
                    chatId,
                    "⚠️ Harap *reply* ke pesan yang ingin kamu bagikan.",
                    { parse_mode: "Markdown" }
                )
                .catch(() => {});
        }

        if (!isMain) {
            data.cooldowns.share[senderId] = now;
            saveData(data);
        }

        const groups = data.groups || [];
        if (groups.length === 0) {
            return bot
                .sendMessage(chatId, "⚠️ Tidak ada grup terdaftar untuk share.")
                .catch(() => {});
        }

        const total = groups.length;
        let sukses = 0,
            gagal = 0;
        await bot
            .sendMessage(
                chatId,
                `📡 Memproses sharemsg ke *${total}* grup/channel...`,
                { parse_mode: "Markdown" }
            )
            .catch(() => {});
        const reply = msg.reply_to_message;

        for (const groupId of groups) {
            try {
                if (reply.text) {
                    await bot
                        .sendMessage(groupId, reply.text, {
                            parse_mode: "Markdown"
                        })
                        .catch(() =>
                            bot.sendMessage(groupId, reply.text).catch(() => {})
                        );
                } else if (reply.photo) {
                    const fileId = reply.photo[reply.photo.length - 1].file_id;
                    await bot
                        .sendPhoto(groupId, fileId, {
                            caption: reply.caption || ""
                        })
                        .catch(() => {});
                } else if (reply.video) {
                    await bot
                        .sendVideo(groupId, reply.video.file_id, {
                            caption: reply.caption || ""
                        })
                        .catch(() => {});
                } else if (reply.document) {
                    await bot
                        .sendDocument(groupId, reply.document.file_id, {
                            caption: reply.caption || ""
                        })
                        .catch(() => {});
                } else if (reply.sticker) {
                    await bot
                        .sendSticker(groupId, reply.sticker.file_id)
                        .catch(() => {});
                } else {
                    await bot
                        .sendMessage(
                            groupId,
                            "⚠️ Jenis pesan ini belum didukung untuk sharemsg otomatis."
                        )
                        .catch(() => {});
                }
                sukses++;
            } catch {
                gagal++;
            }
            await new Promise(r => setTimeout(r, 300));
        }

        await bot
            .sendMessage(
                chatId,
                `
✅ Share selesai!
📊 Hasil:
• Total Grup: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()
            )
            .catch(() => {});
    } catch (err) {
        console.error("❌ Error fatal di /sharemsg:", err);
        bot.sendMessage(
            chatId,
            "⚠️ Terjadi error saat memproses /sharemsg."
        ).catch(() => {});
    }
});

bot.onText(/^\/broadcast$/, async msg => {
    if (!(await requireNotBlacklisted(msg))) return;
    const senderId = msg.from.id.toString();
    const data = loadData();
    const chatId = msg.chat.id;

    try {
        const isMain = isMainOwner(senderId);
        const isOwnerNow = isAnyOwner(senderId);

        if (!isOwnerNow) {
            return bot
                .sendMessage(chatId, "⛔ Can Only Be Used Owner User")
                .catch(() => {});
        }

        if (!data.cooldowns) data.cooldowns = {};
        if (!data.cooldowns.broadcast) data.cooldowns.broadcast = {};
        const now = Math.floor(Date.now() / 1000);
        const lastUse = data.cooldowns.broadcast[senderId] || 0;
        const cooldown = getGlobalCooldownMinutes() * 60;

        if (!isMain && now - lastUse < cooldown) {
            const sisa = cooldown - (now - lastUse);
            const menit = Math.floor(sisa / 60);
            const detik = sisa % 60;
            return bot
                .sendMessage(
                    chatId,
                    `🕒 Tunggu ${menit} menit ${detik} detik sebelum menggunakan /broadcast lagi.`
                )
                .catch(() => {});
        }

        if (!msg.reply_to_message) {
            return bot
                .sendMessage(
                    chatId,
                    "⚠️ Harap *reply* ke pesan yang ingin dibroadcast.",
                    { parse_mode: "Markdown" }
                )
                .catch(() => {});
        }

        if (!isMain) {
            data.cooldowns.broadcast[senderId] = now;
            saveData(data);
        }

        const uniqueUsers = [...new Set(data.users || [])];
        const total = uniqueUsers.length;
        let sukses = 0,
            gagal = 0;
        await bot
            .sendMessage(
                chatId,
                `📡 Sedang memulai broadcast ke *${total}* user...`,
                { parse_mode: "Markdown" }
            )
            .catch(() => {});
        const reply = msg.reply_to_message;

        for (const userId of uniqueUsers) {
            try {
                if (reply.text) {
                    await bot
                        .sendMessage(userId, reply.text, {
                            parse_mode: "Markdown"
                        })
                        .catch(() =>
                            bot.sendMessage(userId, reply.text).catch(() => {})
                        );
                } else if (reply.photo) {
                    const fileId = reply.photo[reply.photo.length - 1].file_id;
                    await bot
                        .sendPhoto(userId, fileId, {
                            caption: reply.caption || ""
                        })
                        .catch(() => {});
                } else if (reply.document) {
                    await bot
                        .sendDocument(userId, reply.document.file_id, {
                            caption: reply.caption || ""
                        })
                        .catch(() => {});
                } else if (reply.video) {
                    await bot
                        .sendVideo(userId, reply.video.file_id, {
                            caption: reply.caption || ""
                        })
                        .catch(() => {});
                } else {
                    await bot
                        .sendMessage(
                            userId,
                            "⚠️ Jenis pesan ini belum bisa dibroadcast."
                        )
                        .catch(() => {});
                }
                sukses++;
            } catch {
                gagal++;
            }
            await new Promise(r => setTimeout(r, 300));
        }

        await bot
            .sendMessage(
                chatId,
                `
✅ Broadcast selesai!
📊 Hasil:
• Total User: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()
            )
            .catch(() => {});
    } catch (err) {
        console.error("❌ Error fatal di /broadcast:", err);
        bot.sendMessage(
            chatId,
            "⚠️ Terjadi error saat memproses /broadcast."
        ).catch(() => {});
    }
});

// === /sharemsgv2 ===
bot.onText(/^\/sharemsgv2$/, async msg => {
    if (!(await requireNotBlacklisted(msg))) return;
    const senderId = msg.from.id.toString();
    const data = loadData();
    const chatId = msg.chat.id;

    try {
        const isOwnerNow = isAnyOwner(senderId);
        const isPremiumUser =
            data.premium?.[senderId] &&
            Math.floor(Date.now() / 1000) < data.premium[senderId];
        const isMainOwner = senderId === OWNER_IDS[0].toString();

        if (!isOwnerNow && !isPremiumUser) {
            return bot
                .sendMessage(
                    chatId,
                    "⛔ Hanya bisa digunakan oleh Owner atau User Premium."
                )
                .catch(() => {});
        }

        if (!msg.reply_to_message) {
            return bot
                .sendMessage(
                    chatId,
                    "⚠️ Harap *reply* ke pesan yang ingin kamu forward.",
                    { parse_mode: "Markdown" }
                )
                .catch(() => {});
        }

        const groups = data.groups || [];
        if (groups.length === 0) {
            return bot
                .sendMessage(
                    chatId,
                    "⚠️ Tidak ada grup terdaftar untuk forward."
                )
                .catch(() => {});
        }

        const total = groups.length;
        let sukses = 0,
            gagal = 0;
        await bot
            .sendMessage(
                chatId,
                `📡 Memproses sharemsgv2 (forward) ke *${total}* grup/channel...`,
                { parse_mode: "Markdown" }
            )
            .catch(() => {});

        const jedaMs = isMainOwner ? 0 : 15000;

        for (const groupId of groups) {
            try {
                await bot
                    .forwardMessage(
                        groupId,
                        chatId,
                        msg.reply_to_message.message_id
                    )
                    .catch(() => {});
                sukses++;
            } catch {
                gagal++;
            }
            if (jedaMs > 0) {
                await new Promise(r => setTimeout(r, jedaMs));
            }
        }

        await bot
            .sendMessage(
                chatId,
                `
✅ Sharemsgv2 selesai!
📊 Hasil:
• Total Grup: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()
            )
            .catch(() => {});
    } catch (err) {
        console.error("❌ Error fatal di /sharemsgv2:", err);
        bot.sendMessage(
            chatId,
            "⚠️ Terjadi error saat memproses /sharemsgv2."
        ).catch(() => {});
    }
});

// === /broadcastv2 ===
bot.onText(/^\/broadcastv2$/, async msg => {
    if (!(await requireNotBlacklisted(msg))) return;
    const senderId = msg.from.id.toString();
    const data = loadData();
    const chatId = msg.chat.id;

    try {
        const isOwnerNow = isAnyOwner(senderId);
        const isPremiumUser =
            data.premium?.[senderId] &&
            Math.floor(Date.now() / 1000) < data.premium[senderId];
        const isMainOwner = senderId === OWNER_IDS[0].toString();

        if (!isOwnerNow && !isPremiumUser) {
            return bot
                .sendMessage(
                    chatId,
                    "⛔ Hanya Owner & Premium yang bisa menggunakan /broadcastv2 (forward ke user)."
                )
                .catch(() => {});
        }

        if (!msg.reply_to_message) {
            return bot
                .sendMessage(
                    chatId,
                    "⚠️ Harap *reply* ke pesan yang ingin di-forward ke semua user.",
                    { parse_mode: "Markdown" }
                )
                .catch(() => {});
        }

        const users = data.users || [];
        if (users.length === 0) {
            return bot
                .sendMessage(
                    chatId,
                    "⚠️ Tidak ada user terdaftar untuk broadcast."
                )
                .catch(() => {});
        }

        const total = users.length;
        let sukses = 0,
            gagal = 0;
        await bot
            .sendMessage(
                chatId,
                `📡 broadcastv2 (forward) ke *${total}* user dimulai...`,
                { parse_mode: "Markdown" }
            )
            .catch(() => {});

        const jedaMs = isMainOwner ? 0 : 15000;

        for (const targetId of users) {
            try {
                await bot
                    .forwardMessage(
                        targetId,
                        chatId,
                        msg.reply_to_message.message_id
                    )
                    .catch(() => {});
                sukses++;
            } catch {
                gagal++;
            }
            if (jedaMs > 0) {
                await new Promise(r => setTimeout(r, jedaMs));
            }
        }

        await bot
            .sendMessage(
                chatId,
                `
✅ Broadcastv2 selesai!
📊 Hasil:
• Total User: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()
            )
            .catch(() => {});
    } catch (err) {
        console.error("❌ Error di /broadcastv2:", err);
        bot.sendMessage(
            chatId,
            "⚠️ Terjadi error saat memproses /broadcastv2."
        ).catch(() => {});
    }
});

bot.onText(/^\/setpesan$/, async msg => {
    const senderId = msg.from.id.toString();
    const chatId = msg.chat.id;

    if (!isAnyOwner(senderId)) {
        return bot.sendMessage(chatId, "⛔ Hanya Owner yang bisa set pesan.");
    }
    if (!msg.reply_to_message) {
        return bot.sendMessage(
            chatId,
            "⚠️ Harap *reply* ke pesan yang ingin dijadikan auto-share.",
            { parse_mode: "Markdown" }
        );
    }

    const reply = msg.reply_to_message;
    let content = null;

    if (reply.text) {
        content = { type: "text", text: reply.text };
    } else if (reply.photo) {
        content = {
            type: "photo",
            file_id: reply.photo[reply.photo.length - 1].file_id,
            caption: reply.caption || ""
        };
    } else if (reply.video) {
        content = {
            type: "video",
            file_id: reply.video.file_id,
            caption: reply.caption || ""
        };
    } else if (reply.document) {
        content = {
            type: "document",
            file_id: reply.document.file_id,
            caption: reply.caption || ""
        };
    } else if (reply.sticker) {
        content = { type: "sticker", file_id: reply.sticker.file_id };
    }

    if (!content) {
        return bot.sendMessage(
            chatId,
            "⚠️ Jenis pesan ini belum didukung autoshare."
        );
    }

    autoShares[senderId] = { active: false, content, lastSent: 0 };
    return bot.sendMessage(
        chatId,
        "✅ Pesan berhasil disimpan untuk auto-share (akan dikirim ulang oleh bot)."
    );
});

bot.onText(/^\/auto\s*(on|off|status)?$/, async (msg, match) => {
    const senderId = msg.from.id.toString();
    const chatId = msg.chat.id;

    if (!isAnyOwner(senderId)) {
        return bot.sendMessage(
            chatId,
            "⛔ Hanya Owner yang bisa kontrol auto-share."
        );
    }
    if (!autoShares[senderId]) {
        autoShares[senderId] = { active: false, content: null, lastSent: 0 };
    }

    const arg = match[1];
    if (!arg || arg === "status") {
        const status = autoShares[senderId].active ? "ON ✅" : "OFF ❌";
        return bot.sendMessage(chatId, `📊 Status auto-share: *${status}*`, {
            parse_mode: "Markdown"
        });
    }

    if (arg === "on") {
        if (!autoShares[senderId].content) {
            return bot.sendMessage(
                chatId,
                "⚠️ Belum ada pesan di-set. Gunakan /setpesan dengan reply pesan dulu."
            );
        }
        autoShares[senderId].active = true;
        autoShares[senderId].lastSent = Date.now();
        return bot.sendMessage(
            chatId,
            "🔄 Auto-share dimulai.\nMenunggu jeda pertama sebelum pesan dikirim..."
        );
    }

    if (arg === "off") {
        autoShares[senderId].active = false;
        return bot.sendMessage(chatId, "❌ Auto-share dimatikan.");
    }
});

setInterval(async () => {
    try {
        const data = loadData();
        const groups = data.groups || [];
        if (groups.length === 0) return;

        const now = Date.now();
        const cooldownMs = getGlobalCooldownMs();

        for (const ownerId of Object.keys(autoShares)) {
            const conf = autoShares[ownerId];
            if (!conf.active || !conf.content) continue;
            if (now - conf.lastSent < cooldownMs) continue;

            conf.lastSent = now;
            const content = conf.content;
            let sukses = 0,
                gagal = 0;

            for (const groupId of groups) {
                try {
                    if (content.type === "text") {
                        await bot
                            .sendMessage(groupId, content.text, {
                                parse_mode: "Markdown"
                            })
                            .catch(() =>
                                bot.sendMessage(groupId, content.text)
                            );
                    } else if (content.type === "photo") {
                        await bot
                            .sendPhoto(groupId, content.file_id, {
                                caption: content.caption
                            })
                            .catch(() => {});
                    } else if (content.type === "video") {
                        await bot
                            .sendVideo(groupId, content.file_id, {
                                caption: content.caption
                            })
                            .catch(() => {});
                    } else if (content.type === "document") {
                        await bot
                            .sendDocument(groupId, content.file_id, {
                                caption: content.caption
                            })
                            .catch(() => {});
                    } else if (content.type === "sticker") {
                        await bot
                            .sendSticker(groupId, content.file_id)
                            .catch(() => {});
                    }
                    sukses++;
                } catch {
                    gagal++;
                }
                await new Promise(r => setTimeout(r, 300));
            }
            console.log(
                `Auto-share owner ${ownerId}: sukses ${sukses}, gagal ${gagal}`
            );
        }
    } catch (e) {
        console.error("❌ Error di auto-share loop:", e);
    }
}, 10 * 1000);

// === /addownjs <id> ===
bot.onText(/^\/addownjs(?:\s+(\d+))?$/, (msg, match) => {
    const senderId = msg.from.id;
    const chatId = msg.chat.id;

    if (!isMainOwner(senderId)) {
        return bot.sendMessage(senderId, "⛔ Can Only Be Used Owner");
    }

    if (!match[1]) {
        return bot.sendMessage(
            senderId,
            "⚠️ Contoh penggunaan yang benar:\n\n`/addownjs 123456789`",
            { parse_mode: "Markdown" }
        );
    }

    const targetId = match[1];
    const data = loadData();

    if (!Array.isArray(data.owner)) data.owner = [];

    if (!data.owner.includes(targetId)) {
        data.owner.push(targetId);
        saveData(data);
        bot.sendMessage(
            senderId,
            `✅ User ${targetId} berhasil ditambahkan sebagai owner tambahan.`
        );
    } else {
        bot.sendMessage(
            senderId,
            `⚠️ User ${targetId} sudah menjadi owner tambahan.`
        );
    }
});

// === /delownjs <id> ===
bot.onText(/^\/delownjs(?:\s+(\d+))?$/, (msg, match) => {
    const senderId = msg.from.id;
    const chatId = msg.chat.id;

    if (!isMainOwner(senderId)) {
        return bot.sendMessage(senderId, "⛔ Can Only Be Used Owner");
    }

    if (!match[1]) {
        return bot.sendMessage(
            senderId,
            "⚠️ Contoh penggunaan yang benar:\n\n`/delownjs 123456789`",
            { parse_mode: "Markdown" }
        );
    }

    const targetId = match[1];
    const data = loadData();

    if (OWNER_IDS.map(String).includes(String(targetId))) {
        return bot.sendMessage(
            senderId,
            `❌ Tidak bisa menghapus Owner Utama (${targetId}).`
        );
    }

    if (Array.isArray(data.owner) && data.owner.includes(targetId)) {
        data.owner = data.owner.filter(id => id !== targetId);
        saveData(data);
        bot.sendMessage(
            senderId,
            `✅ User ${targetId} berhasil dihapus dari owner tambahan.`
        );
    } else {
        bot.sendMessage(senderId, `⚠️ User ${targetId} bukan owner tambahan.`);
    }
});

// === /listownjs ===
bot.onText(/^\/listownjs$/, msg => {
    const senderId = msg.from.id;
    const chatId = msg.chat.id;

    if (!isMainOwner(senderId)) {
        return bot.sendMessage(
            chatId,
            "⛔ Hanya Owner Utama yang bisa melihat daftar owner tambahan."
        );
    }

    const data = loadData();
    const ownersTambahan = Array.isArray(data.owner) ? data.owner : [];

    if (ownersTambahan.length === 0) {
        return bot.sendMessage(
            chatId,
            "📋 Tidak ada owner tambahan yang terdaftar."
        );
    }

    const teks = `📋 Daftar Owner Tambahan:\n\n${ownersTambahan
        .map((id, i) => `${i + 1}. ${id}`)
        .join("\n")}`;
    bot.sendMessage(chatId, teks);
});

// /addakses <id> <durasi>
bot.onText(/^\/addakses(?:\s+(\d+)\s+(\d+)([dh]))?$/, (msg, match) => {
    const senderId = msg.from.id.toString();
    const chatId = msg.chat.id;
    if (!isOwner(senderId)) {
        return bot.sendMessage(chatId, "⛔ Can Only Be Used Owner");
    }

    const userId = match[1];
    const jumlah = match[2];
    const satuan = match[3];

    if (!userId || !jumlah || !satuan) {
        return bot.sendMessage(
            chatId,
            "📌 Contoh penggunaan:\n/addakses 123456789 3d\n\n(d = hari, h = jam)"
        );
    }

    const durasi = parseInt(jumlah);
    let detik;
    if (satuan === "d") detik = durasi * 86400;
    else if (satuan === "h") detik = durasi * 3600;
    else
        return bot.sendMessage(
            chatId,
            '❌ Format waktu salah. Gunakan "d" (hari) atau "h" (jam).'
        );

    const now = Math.floor(Date.now() / 1000);
    const data = loadData();
    if (!data.premium) data.premium = {};

    const current = data.premium[userId] || now;
    data.premium[userId] = current > now ? current + detik : now + detik;

    saveData(data);
    const waktuText = satuan === "d" ? "hari" : "jam";
    bot.sendMessage(
        chatId,
        `✅ User ${userId} berhasil ditambahkan Premium selama ${durasi} ${waktuText}.`
    );
});

// /delakses <id>
bot.onText(/^\/delakses(?:\s+(\d+))?$/, (msg, match) => {
    const senderId = msg.from.id.toString();
    const chatId = msg.chat.id;

    if (!isOwner(senderId)) {
        return bot.sendMessage(chatId, "⛔ Can Only Be Used Owner");
    }

    const userId = match[1];
    if (!userId) {
        return bot.sendMessage(
            chatId,
            "📌 Contoh penggunaan:\n/delakses 123456789"
        );
    }

    const data = loadData();
    if (!data.premium || !data.premium[userId]) {
        return bot.sendMessage(
            chatId,
            `❌ User ${userId} tidak ditemukan atau belum premium.`
        );
    }

    delete data.premium[userId];
    saveData(data);
    bot.sendMessage(chatId, `✅ Premium user ${userId} berhasil dihapus.`);
});

// /listakses (tanpa tombol navigasi, versi simple)
bot.onText(/\/listakses/, msg => {
    const senderId = msg.from.id.toString();
    const chatId = msg.chat.id;

    if (!isOwner(senderId)) {
        return bot.sendMessage(chatId, "⛔ Can Only Be Used Owner");
    }

    const data = loadData();
    const now = Math.floor(Date.now() / 1000);

    const entries = Object.entries(data.premium || {})
        .map(([uid, exp]) => {
            const sisaJam = Math.floor((exp - now) / 3600);
            return sisaJam > 0 ? `👤 ${uid} - ${sisaJam} jam tersisa` : null;
        })
        .filter(Boolean);

    if (entries.length === 0) {
        return bot.sendMessage(
            chatId,
            "📋 Daftar Premium:\n\nBelum ada user Premium."
        );
    }

    const teks = `📋 Daftar Premium:\n\n${entries.join("\n")}`;
    bot.sendMessage(chatId, teks);
});

// /addbl <id>
bot.onText(/^\/addbl\s+(\d+)$/, (msg, match) => {
    const senderId = msg.from.id;
    if (!isAnyOwner(senderId)) return;
    const targetId = match[1];
    const data = loadData();
    if (!data.blacklist) data.blacklist = [];
    if (!data.blacklist.includes(targetId)) {
        data.blacklist.push(targetId);
        saveData(data);
        bot.sendMessage(
            msg.chat.id,
            `✅ User ${targetId} ditambahkan ke blacklist.`
        );
    } else {
        bot.sendMessage(
            msg.chat.id,
            `⚠️ User ${targetId} sudah ada di blacklist.`
        );
    }
});

// /delbl <id>
bot.onText(/^\/delbl\s+(\d+)$/, (msg, match) => {
    const senderId = msg.from.id;
    if (!isAnyOwner(senderId)) return;
    const targetId = match[1];
    const data = loadData();
    if (data.blacklist && data.blacklist.includes(targetId)) {
        data.blacklist = data.blacklist.filter(x => x !== targetId);
        saveData(data);
        bot.sendMessage(
            msg.chat.id,
            `✅ User ${targetId} dihapus dari blacklist.`
        );
    } else {
        bot.sendMessage(
            msg.chat.id,
            `⚠️ User ${targetId} tidak ada di blacklist.`
        );
    }
});

// /listbl
bot.onText(/^\/listbl$/, msg => {
    const senderId = msg.from.id;
    if (!isAnyOwner(senderId)) return;
    const data = loadData();
    const list = data.blacklist || [];
    if (list.length === 0) {
        bot.sendMessage(msg.chat.id, "📋 Blacklist kosong.");
    } else {
        bot.sendMessage(
            msg.chat.id,
            "📋 Daftar blacklist:\n" + list.join("\n")
        );
    }
});

// === /setjeda [menit] ===
bot.onText(/^\/setjeda(?:\s+(\d+))?$/, async (msg, match) => {
    const senderId = msg.from.id.toString();
    const chatId = msg.chat.id;

    if (!isAnyOwner(senderId)) {
        return bot
            .sendMessage(chatId, "⛔ Can Only Be Used Owner")
            .catch(() => {});
    }

    const data = loadData();
    if (!data.settings) data.settings = {};
    if (!data.settings.cooldown) data.settings.cooldown = {};

    const menit = parseInt(match[1]);
    if (!menit || menit <= 0) {
        const current = getGlobalCooldownMinutes();
        return bot.sendMessage(
            chatId,
            `⚙️ Cooldown saat ini: *${current} menit*`,
            { parse_mode: "Markdown" }
        );
    }

    data.settings.cooldown.default = menit;
    saveData(data);

    return bot.sendMessage(
        chatId,
        `✅ Jeda berhasil diatur ke *${menit} menit*.`,
        { parse_mode: "Markdown" }
    );
});

// === /cekid ===
bot.onText(/\/cekid/, async msg => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || "";
    const lastName = msg.from.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();
    const username = msg.from.username ? "@" + msg.from.username : "Tidak ada";
    const date = new Date().toLocaleDateString("id-ID", {
        timeZone: "Asia/Jakarta"
    });

    // Ambil DC ID dari user_id
    const dcId = (userId >> 27) & 7;

    const caption = `
🪪 <b>ID CARD TELEGRAM</b>

👤 <b>Nama</b> : ${fullName}
🆔 <b>User ID</b> : <code>${userId}</code>
🌐 <b>Username</b> : ${username}
🔒 <b>DC ID</b> : ${dcId}
📅 <b>Tanggal</b> : ${date}

© @ku_kaii
  `;

    try {
        const userProfilePhotos = await bot.getUserProfilePhotos(userId, {
            limit: 1
        });

        if (userProfilePhotos.total_count === 0)
            throw new Error("No profile photo");

        const fileId = userProfilePhotos.photos[0][0].file_id;

        await bot.sendPhoto(chatId, fileId, {
            caption: caption,
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: `${fullName}`, url: `tg://user?id=${userId}` }]
                ]
            }
        });
    } catch (err) {
        await bot.sendMessage(chatId, caption, { parse_mode: "HTML" });
    }
});

bot.onText(/^\/backup$/, async msg => {
    const senderId = msg.from.id;
    const chatId = msg.chat.id;
    if (!isAnyOwner(senderId)) return bot.sendMessage(chatId, "⛔ Only Owner");

    try {
        const backupPath = backupData();
        if (backupPath) {
            await bot.sendDocument(
                chatId,
                backupPath,
                {},
                { filename: "data-backup.json" }
            );
        } else {
            await bot.sendMessage(
                chatId,
                "⚠️ Tidak ada data.json untuk di-backup."
            );
        }
    } catch (e) {
        console.error("❌ Error backup manual:", e);
        bot.sendMessage(chatId, "❌ Gagal membuat backup.");
    }
});

bot.onText(/\/ping/, msg => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAnyOwner(userId))
        return bot.sendMessage(chatId, "⛔ Can Only Be Used Owner");

    try {
        const uptimeMs = Date.now() - BOT_START_TIME;
        const uptime = formatUptime(Math.floor(uptimeMs / 1000));
        const totalMem = os.totalmem() / 1024 ** 3;
        const freeMem = os.freemem() / 1024 ** 3;
        const cpuModel = os.cpus()[0].model;
        const cpuCores = os.cpus().length;

        const teks = `
<blockquote>
🖥️ Informasi VPS

CPU:${cpuModel}(${cpuCores} CORE)
RAM: ${freeMem.toFixed(2)} GB / ${totalMem.toFixed(2)} GB
Uptime: ${uptime}
</blockquote>
    `.trim();

        bot.sendMessage(chatId, teks, { parse_mode: "HTML" });
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Gagal membaca info VPS.");
    }
});

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${d} hari, ${h} jam, ${m} menit, ${s} detik`;
}

// ✅ Warna Judul
console.log(
    chalk.hex("#FF4500").bold(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${chalk.hex("#FFD700").bold("BOT JASEB ACTIVE")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEVELOPER SCRIPT : ${chalk.hex("#00FFFF")(DEVELOPER)}
VERSION SCRIPT : ${chalk.hex("#ADFF2F")(VERSION)}
CHANNEL DEVELOPER : ${chalk.hex("#1E90FF").underline(CHANNEL_URL)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
);

console.log(
    chalk.hex("#FF69B4").bold(`
⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⠀
⠀⣠⠾⡏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡟⢦⠀
⢰⠇⠀⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠃⠈⣧
⠘⡇⠀⠸⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡞⠀⠀⣿
⠀⡇⠘⡄⢱⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⢁⡆⢀⡏
⠀⠹⣄⠹⡀⠙⣄⠀⠀⠀⠀⠀⢀⣤⣴⣶⣶⣶⣾⣶⣶⣶⣶⣤⣀⠀⠀⠀⠀⠀⢀⠜⠁⡜⢀⡞⠀
⠀⠀⠘⣆⢣⡄⠈⢣⡀⢀⣤⣾⣿⣿⢿⠉⠉⠉⠉⠉⠉⠉⣻⢿⣿⣷⣦⣄⠀⡰⠋⢀⣾⢡⠞⠀⠀
⠀⠀⠀⠸⣿⡿⡄⡀⠉⠙⣿⡿⠁⠈⢧⠃⠀⠀⠀⠀⠀⠀⢷⠋⠀⢹⣿⠛⠉⢀⠄⣞⣧⡏⠀⠀⠀
⠀⠀⠀⠀⠸⣿⣹⠘⡆⠀⡿⢁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⢻⡆⢀⡎⣼⣽⡟⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣹⣿⣇⠹⣼⣷⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢷⣳⡜⢰⣿⣟⡀⠀⠀⠀⠀
⠀⠀⠀⠀⡾⡉⠛⣿⠴⠳⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠳⢾⠟⠉⢻⡀⠀⠀⠀
⠀⠀⠀⠀⣿⢹⠀⢘⡇⠀⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠃⠀⡏⠀⡼⣾⠇⠀⠀⠀
⠀⠀⠀⠀⢹⣼⠀⣾⠀⣀⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣄⡀⢹⠀⢳⣼⠀⠀⠀⠀
⠀⠀⠀⠀⢸⣇⠀⠸⣾⠁⠀⠀⠀⠀⠀⢀⡾⠀⠀⠀⠰⣄⠀⠀⠀⠀⠀⠀⣹⡞⠀⣀⣿⠀⠀⠀⠀
⠀⠀⠀⠀⠈⣇⠱⡄⢸⡛⠒⠒⠒⠒⠚⢿⣇⠀⠀⠀⢠⣿⠟⠒⠒⠒⠒⠚⡿⢀⡞⢹⠇⠀⠀⠀⠀
⠀⠀⠀⠀⠀⡞⢰⣷⠀⠑⢦⣄⣀⣀⣠⠞⢹⠀⠀⠀⣸⠙⣤⣀⣀⣀⡤⠞⠁⢸⣶⢸⡄⠀⠀⠀⠀
⠀⠀⠀⠀⠰⣧⣰⠿⣄⠀⠀⠀⢀⣈⡉⠙⠏⠀⠀⠀⠘⠛⠉⣉⣀⠀⠀⠀⢀⡟⣿⣼⠇⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢀⡿⠀⠘⠷⠤⠾⢻⠞⠋⠀⠀⠀⠀⠀⠀⠀⠘⠛⣎⠻⠦⠴⠋⠀⠹⡆⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠸⣿⡀⢀⠀⠀⡰⡌⠻⠷⣤⡀⠀⠀⠀⠀⣠⣶⠟⠋⡽⡔⠀⡀⠀⣰⡟⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠙⢷⣄⡳⡀⢣⣿⣀⣷⠈⠳⣦⣀⣠⡾⠋⣸⡇⣼⣷⠁⡴⢁⣴⠟⠁⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⠻⣶⡷⡜⣿⣻⠈⣦⣀⣀⠉⠀⣀⣠⡏⢹⣿⣏⡼⣡⡾⠃⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢿⣿⣿⣻⡄⠹⡙⠛⠿⠟⠛⡽⠀⣿⣻⣾⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⡏⢏⢿⡀⣹⢲⣶⡶⢺⡀⣴⢫⢃⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣷⠈⠷⠭⠽⠛⠛⠛⠋⠭⠴⠋⣸⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣷⣄⡀⢀⣀⣠⣀⣀⢀⣀⣴⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⠀⠀⠀⠈⠉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
  `)
);
