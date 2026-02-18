const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Lavalink filter presets
const FILTER_PRESETS = {
    bassboost_low: {
        equalizer: [
            { band: 0, gain: 0.15 }, { band: 1, gain: 0.12 },
            { band: 2, gain: 0.10 }, { band: 3, gain: 0.05 },
            { band: 4, gain: 0.0 }
        ]
    },
    bassboost_medium: {
        equalizer: [
            { band: 0, gain: 0.3 }, { band: 1, gain: 0.25 },
            { band: 2, gain: 0.20 }, { band: 3, gain: 0.10 },
            { band: 4, gain: 0.05 }
        ]
    },
    bassboost_high: {
        equalizer: [
            { band: 0, gain: 0.5 }, { band: 1, gain: 0.40 },
            { band: 2, gain: 0.35 }, { band: 3, gain: 0.20 },
            { band: 4, gain: 0.10 }
        ]
    },
    nightcore: {
        timescale: { speed: 1.165, pitch: 1.125, rate: 1.05 }
    },
    slowmo: {
        timescale: { speed: 0.7, pitch: 1.0, rate: 0.8 }
    },
    '3d': {
        rotation: { rotationHz: 0.2 }
    },
    chipmunk: {
        timescale: { speed: 1.05, pitch: 1.35, rate: 1.25 }
    },
    tremolo: {
        tremolo: { frequency: 2.0, depth: 0.5 }
    },
    vibrato: {
        vibrato: { frequency: 2.0, depth: 0.5 }
    }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Apply audio filters to the music')
        .addSubcommand(sub =>
            sub.setName('bassboost')
                .setDescription('Apply bass boost effect')
                .addStringOption(opt =>
                    opt.setName('level')
                        .setDescription('Bass boost level')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Off', value: 'off' },
                            { name: 'Low', value: 'low' },
                            { name: 'Medium', value: 'medium' },
                            { name: 'High', value: 'high' }
                        )))
        .addSubcommand(sub =>
            sub.setName('nightcore')
                .setDescription('Apply nightcore effect'))
        .addSubcommand(sub =>
            sub.setName('slowmo')
                .setDescription('Apply slow motion effect'))
        .addSubcommand(sub =>
            sub.setName('3d')
                .setDescription('Apply 3D rotation effect'))
        .addSubcommand(sub =>
            sub.setName('chipmunk')
                .setDescription('Apply chipmunk effect'))
        .addSubcommand(sub =>
            sub.setName('tremolo')
                .setDescription('Apply tremolo effect'))
        .addSubcommand(sub =>
            sub.setName('vibrato')
                .setDescription('Apply vibrato effect'))
        .addSubcommand(sub =>
            sub.setName('speed')
                .setDescription('Change playback speed')
                .addNumberOption(opt =>
                    opt.setName('multiplier')
                        .setDescription('Speed multiplier (0.25 to 3.0)')
                        .setRequired(true)
                        .setMinValue(0.25)
                        .setMaxValue(3.0)))
        .addSubcommand(sub =>
            sub.setName('pitch')
                .setDescription('Change pitch')
                .addNumberOption(opt =>
                    opt.setName('multiplier')
                        .setDescription('Pitch multiplier (0.5 to 2.0)')
                        .setRequired(true)
                        .setMinValue(0.5)
                        .setMaxValue(2.0)))
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Remove all applied filters')),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || !queue.songs[0]) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
        }

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        const player = queue.player;

        // Initialize filter tracking
        if (!queue.filters) queue.filters = {};

        let filterName = '';
        let filterData = {};

        switch (sub) {
            case 'bassboost': {
                const level = interaction.options.getString('level');
                if (level === 'off') {
                    delete queue.filters.equalizer;
                    filterName = 'Bass Boost Off';
                } else {
                    filterData = FILTER_PRESETS[`bassboost_${level}`];
                    queue.filters.equalizer = filterData.equalizer;
                    filterName = `Bass Boost ${level.charAt(0).toUpperCase() + level.slice(1)}`;
                }
                break;
            }
            case 'nightcore':
                queue.filters.timescale = FILTER_PRESETS.nightcore.timescale;
                filterName = '👻 Nightcore';
                break;
            case 'slowmo':
                queue.filters.timescale = FILTER_PRESETS.slowmo.timescale;
                filterName = '🐌 Slow Motion';
                break;
            case '3d':
                queue.filters.rotation = FILTER_PRESETS['3d'].rotation;
                filterName = '🌀 3D Rotation';
                break;
            case 'chipmunk':
                queue.filters.timescale = FILTER_PRESETS.chipmunk.timescale;
                filterName = '🐿️ Chipmunk';
                break;
            case 'tremolo':
                queue.filters.tremolo = FILTER_PRESETS.tremolo.tremolo;
                filterName = '🔊 Tremolo';
                break;
            case 'vibrato':
                queue.filters.vibrato = FILTER_PRESETS.vibrato.vibrato;
                filterName = '〰️ Vibrato';
                break;
            case 'speed': {
                const speed = interaction.options.getNumber('multiplier');
                if (!queue.filters.timescale) queue.filters.timescale = {};
                queue.filters.timescale.speed = speed;
                filterName = `⚡ Speed x${speed}`;
                break;
            }
            case 'pitch': {
                const pitch = interaction.options.getNumber('multiplier');
                if (!queue.filters.timescale) queue.filters.timescale = {};
                queue.filters.timescale.pitch = pitch;
                filterName = `🎵 Pitch x${pitch}`;
                break;
            }
            case 'reset':
                queue.filters = {};
                filterName = '🔄 All Filters Cleared';
                break;
        }

        // Build the Lavalink filters object from accumulated filters
        const filtersPayload = {};
        if (queue.filters.equalizer) filtersPayload.equalizer = queue.filters.equalizer;
        if (queue.filters.timescale) filtersPayload.timescale = queue.filters.timescale;
        if (queue.filters.rotation) filtersPayload.rotation = queue.filters.rotation;
        if (queue.filters.tremolo) filtersPayload.tremolo = queue.filters.tremolo;
        if (queue.filters.vibrato) filtersPayload.vibrato = queue.filters.vibrato;

        // Apply filters via Shoukaku
        player.setFilters(filtersPayload);

        // Show active filters
        const activeFilters = Object.keys(queue.filters);
        const activeText = activeFilters.length > 0
            ? activeFilters.map(f => `\`${f}\``).join(', ')
            : 'None';

        const embed = new EmbedBuilder()
            .setColor('Purple')
            .setTitle(`🎛️ Filter Applied: ${filterName}`)
            .setDescription(`**Active filters:** ${activeText}\n\n*Note: Filter changes may take a second to apply.*`);
        return interaction.reply({ embeds: [embed] });
    }
};
