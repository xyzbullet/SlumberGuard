const express = require('express');
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');

// CONFIG
const PORT = process.env.PORT || 3000;
const SLUMBER_CHECK_INTERVAL = 10000;
const TEMPLATE_CHECK_INTERVAL = 60000;
const ACTIVITY_THRESHOLD = 5;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

let slumberGuardChannels = new Map();
let messageCounts = new Map();
let lastTemplateCache = new Map();

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    setInterval(checkSlumberGuard, SLUMBER_CHECK_INTERVAL);
    setInterval(checkTemplates, TEMPLATE_CHECK_INTERVAL);
    populateTemplateCache();
    registerCommands();
});

client.on('messageCreate', (message) => {
    if (!message.guild || !message.channel) return;

    if (slumberGuardChannels.has(message.channel.id)) {
        let count = messageCounts.get(message.channel.id) || 0;
        messageCounts.set(message.channel.id, count + 1);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'slumberguard') {
        const state = interaction.options.getString('state');

        if (!interaction.channel || !interaction.guild) {
            await interaction.reply({ content: '⚠️ This command must be used in a server text channel.', ephemeral: true });
            return;
        }

        if (state === 'on') {
            slumberGuardChannels.set(interaction.channel.id, true);
            await interaction.reply({ content: '🛡️ Slumber Guard is now **active** in this channel.', ephemeral: true });
        } else {
            slumberGuardChannels.delete(interaction.channel.id);
            await interaction.reply({ content: '❌ Slumber Guard is now **disabled** in this channel.', ephemeral: true });
        }
    }
});

async function checkSlumberGuard() {
    for (let [channelId] of slumberGuardChannels) {
        const count = messageCounts.get(channelId) || 0;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) continue;

        let newSlowmode = 0;
        if (count >= ACTIVITY_THRESHOLD) {
            newSlowmode = Math.min(10, Math.floor(count * 2));
        }

        if (channel.rateLimitPerUser !== newSlowmode) {
            await channel.setRateLimitPerUser(newSlowmode)
                .then(() => console.log(`🌙 Updated slowmode in #${channel.name} to ${newSlowmode}s`))
                .catch(console.error);
        }

        messageCounts.set(channelId, 0);
    }
}

async function checkTemplates() {
    for (const [guildId, lastTemplate] of lastTemplateCache) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const templates = await guild.fetchTemplates().catch(() => []);
        if (!templates.length) continue;

        const template = templates[0];
        if (
            template.serializedSourceGuild.name !== lastTemplate.name ||
            template.serializedSourceGuild.description !== lastTemplate.description
        ) {
            await template.sync()
                .then(() => {
                    console.log(`📦 Synced template for guild: ${guild.name}`);
                    lastTemplateCache.set(guildId, {
                        name: template.serializedSourceGuild.name,
                        description: template.serializedSourceGuild.description
                    });
                })
                .catch(console.error);
        }
    }
}

async function populateTemplateCache() {
    for (const [guildId, guild] of client.guilds.cache) {
        const templates = await guild.fetchTemplates().catch(() => []);
        if (templates.length) {
            const template = templates[0];
            lastTemplateCache.set(guildId, {
                name: template.serializedSourceGuild.name,
                description: template.serializedSourceGuild.description
            });
        }
    }
}

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    const commands = [
        new SlashCommandBuilder()
            .setName('slumberguard')
            .setDescription('Toggle Slumber Guard in this channel')
            .addStringOption(option =>
                option.setName('state')
                    .setDescription('Enable or disable Slumber Guard')
                    .setRequired(true)
                    .addChoices(
                        { name: 'on', value: 'on' },
                        { name: 'off', value: 'off' }
                    )
            )
    ].map(command => command.toJSON());

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    console.log('✅ Slash commands registered');
}

// Healthcheck Express Server
const app = express();

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, () => {
    console.log(`🚀 Healthcheck server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
