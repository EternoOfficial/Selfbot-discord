const { Client } = require('discord.js-selfbot-v13');
const mysql = require('mysql2/promise');

const client = new Client({ partials: ['CHANNEL'] });

const token = "tokenselfbot";
const authorizedUserId = "useridpersonaluser";

const serversToSearch = [
  { guildId: "serverid", channelIds: ["channelid"] },
];

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'selfbot'
};

let db;

async function saveOrUpdateMessage(msg) {
  const query = `
    INSERT INTO messages 
      (message_id, guild_id, channel_id, guild_name, channel_name, author_tag, content, embeds, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      content = VALUES(content),
      embeds = VALUES(embeds),
      timestamp = CURRENT_TIMESTAMP
  `;

  const embedsJson = JSON.stringify(msg.embeds);

  await db.execute(query, [
    msg.messageId,
    msg.guildId,
    msg.channelId,
    msg.guildName,
    msg.channelName,
    msg.authorTag,
    msg.content,
    embedsJson,
    msg.url
  ]);
}

async function updateMessagesInChannel(channel) {
  let lastId;
  let totalMessagesRead = 0;
  while (true) {
    const options = { limit: 100, ...(lastId && { before: lastId }) };
    const messages = await channel.messages.fetch(options).catch(() => null);
    if (!messages?.size) break;

    for (const msg of messages.values()) {
      await saveOrUpdateMessage({
        messageId: msg.id,
        guildId: channel.guild.id,
        channelId: channel.id,
        guildName: channel.guild.name,
        channelName: channel.name,
        authorTag: msg.author.tag,
        content: msg.content,
        embeds: msg.embeds.map(e => ({
          title: e.title,
          description: e.description,
          footer: e.footer?.text,
          fields: e.fields
        })),
        url: `https://discord.com/channels/${channel.guild.id}/${channel.id}/${msg.id}`
      });
    }

    totalMessagesRead += messages.size;
    process.stdout.write(`📥 ${channel.guild.name} / #${channel.name}: ${totalMessagesRead} messaggi letti...\r`);

    lastId = messages.last().id;
    if (messages.size < 100) break;
  }
  console.log(`\n✅ Aggiornati messaggi in ${channel.guild.name} / #${channel.name}`);
}

async function updateAllChannels() {
  for (const { guildId, channelIds } of serversToSearch) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;
    for (const channelId of channelIds) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (channel?.isText()) {
        await updateMessagesInChannel(channel);
      }
    }
  }
  console.log('Tutti i messaggi aggiornati.');
}

async function searchMessages(discordId) {
  const likePattern = `%${discordId}%`;
  const [rows] = await db.execute(`
    SELECT * FROM messages 
    WHERE content LIKE ? OR embeds LIKE ?
    ORDER BY timestamp DESC
    LIMIT 50
  `, [likePattern, likePattern]);

  return rows;
}

async function startBot() {
  await client.login(token);
}

client.on('ready', async () => {
  console.log(`Connesso come ${client.user.tag}`);

  db = await mysql.createConnection(dbConfig);

  await updateAllChannels();

  setInterval(updateAllChannels, 30 * 60 * 1000);

  setTimeout(async function disconnectAndReconnect() {
    console.log('🔌 Disconnessione per 30 minuti per evitare rilevamenti...');
    await client.destroy();

    setTimeout(async () => {
      console.log('🔌 Riconnessione...');
      await startBot();
    }, 30 * 60 * 1000);

    setTimeout(disconnectAndReconnect, 24 * 60 * 60 * 1000);
  }, 24 * 60 * 60 * 1000);
});

startBot();

client.on('messageCreate', async (message) => {
  if (message.author.id !== authorizedUserId || message.channel.type !== 'DM') return;

  const [command, discordIdToSearch] = message.content.trim().split(/\s+/);
  if (command?.toLowerCase() !== 'check' || !/^\d{17,19}$/.test(discordIdToSearch)) {
    message.channel.send("❌ Usa: check <discordId> con un ID valido.");
    return;
  }

  try {
    const results = await searchMessages(discordIdToSearch);

    if (results.length === 0) {
      await message.channel.send(`❌ Nessun messaggio trovato con l'ID ${discordIdToSearch}.`);
    } else {
      const formatted = results.map(r => {
        const date = new Date(r.timestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Gennaio = 0
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const formattedDate = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;

        return `🔸 **${r.guild_name}** #${r.channel_name}\n🕒 ${formattedDate}\n📝 ${r.author_tag}: ${r.content || '*(messaggio vuoto o solo embed)*'}\n[Vai al messaggio](${r.url})\n`;
      });

      const chunks = formatted.reduce((acc, cur, idx) => {
        const group = Math.floor(idx / 5);
        acc[group] = acc[group] || [];
        acc[group].push(cur);
        return acc;
      }, []);

      for (const chunk of chunks) {
        await message.channel.send(chunk.join('\n'));
      }
    }


  } catch (err) {
    console.error("Errore:", err);
    message.channel.send("❌ Errore durante la ricerca.");
  }
});

