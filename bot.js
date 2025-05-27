const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// Health check web server for Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is healthy!'));
app.listen(PORT, () => console.log(`✅ Health check server running on port ${PORT}`));

// Slumber Guard state
const slumberGuardChannels = new Set();
const messageCounts = new Map();

// Register slash commands
const commands = [
    new SlashCommandBuilder().setName('slumberguard').setDescription('Toggle slumber guard slowmode feature')
].map(cmd => cmd.toJSON);

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Registered slash commands.');
    } catch (err) {
        console.error('❌ Error registering commands:', err);
    }
})();

// Slumber Guard logic
async function checkSlumberGuard() {
    for (let [channelId] of slumberGuardChannels) {
        const count = messageCounts.get(channelId) || 0;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) continue;

        let newSlowmode = 0;

        if (count >= 60) newSlowmode = 20;
        else if (count >= 36) newSlowmode = 15;
        else if (count >= 21) newSlowmode = 10;
        else if (count >= 11) newSlowmode = 5;
        else if (count >= 5) newSlowmode = 2;

        if (channel.rateLimitPerUser !== newSlowmode) {
            await channel.setRateLimitPerUser(newSlowmode)
                .then(() => console.log(`🌙 [${channel.name}] Slowmode adjusted to ${newSlowmode}s (${count} messages in last interval)`))
                .catch(console.error);
        }

        messageCounts.set(channelId, 0);
    }
}

// Check every 10 seconds
setInterval(checkSlumberGuard, 10_000);

// Auto-save server template every 30 minutes
async function saveTemplate() {
    for (let guild of client.guilds.cache.values()) {
        const templates = await guild.fetchTemplates().catch(() => []);
        for (let template of templates) {
            await template.sync()
                .then(() => console.log(`💾 Template "${template.name}" synced for ${guild.name}`))
                .catch(err => console.error(`❌ Failed syncing template in ${guild.name}:`, err));
        }
    }
}
setInterval(saveTemplate, 30 * 60 * 1000);

// Message activity tracking
client.on('messageCreate', message => {
    if (!message.guild || message.author.bot) return;
    if (slumberGuardChannels.has(message.channel.id)) {
        const count = messageCounts.get(message.channel.id) || 0;
        messageCounts.set(message.channel.id, count + 1);
    }
});

// Slash command handling
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const { commandName, channel } = interaction;

    if (commandName === 'slumberguard') {
        if (slumberGuardChannels.has(channel.id)) {
            slumberGuardChannels.delete(channel.id);
            await interaction.reply({ content: '🛑 Slumber Guard disabled for this channel.', ephemeral: false });
        } else {
            slumberGuardChannels.add(channel.id);
            await interaction.reply({ content: '🌙 Slumber Guard is now active for this channel.', ephemeral: false });
        }
    }
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
