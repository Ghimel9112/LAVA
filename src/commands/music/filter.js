const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { requirePremium } = require('../../utils/requirePremium');

// Lavalink filter presets
const FILTER_PRESETS = {
    bassboost_low:    { equalizer: [{ band: 0, gain: 0.15 }, { band: 1, gain: 0.12 }, { band: 2, gain: 0.10 }, { band: 3, gain: 0.05 }, { band: 4, gain: 0.0 }] },
    bassboost_medium: { equalizer: [{ band: 0, gain: 0.3 },  { band: 1, gain: 0.25 }, { band: 2, gain: 0.20 }, { band: 3, gain: 0.10 }, { band: 4, gain: 0.05 }] },
    bassboost_high:   { equalizer: [{ band: 0, gain: 0.5 },  { band: 1, gain: 0.40 }, { band: 2, gain: 0.35 }, { band: 3, gain: 0.20 }, { band: 4, gain: 0.10 }] },
    nightcore:  { timescale: { speed: 1.165, pitch: 1.125, rate: 1.05 } },
    slowmo:     { timescale: { speed: 0.7,   pitch: 1.0,   rate: 0.8  } },
    '3d':       { rotation:  { rotationHz: 0.2 } },
    chipmunk:   { timescale: { speed: 1.05,  pitch: 1.35,  rate: 1.25 } },
    tremolo:    { tremolo:   { frequency: 2.0, depth: 0.5 } },
    vibrato:    { vibrato:   { frequency: 2.0, depth: 0.5 } },
};

// Which filter types have a level/intensity option, and what choices to show
const LEVEL_FILTERS = new Set(['bassboost']);
const NUMBER_FILTERS = new Set(['speed', 'pitch']);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Apply an audio filter to the music (Premium only)')
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('The filter to apply')
                .setRequired(true)
                .addChoices(
                    { name: '🎸 Bass Boost',      value: 'bassboost'  },
                    { name: '👻 Nightcore',        value: 'nightcore'  },
                    { name: '🐌 Slow Motion',      value: 'slowmo'     },
                    { name: '🌀 3D Rotation',      value: '3d'         },
                    { name: '🐿️ Chipmunk',         value: 'chipmunk'   },
                    { name: '🔊 Tremolo',          value: 'tremolo'    },
                    { name: '〰️ Vibrato',          value: 'vibrato'    },
                    { name: '⚡ Speed',            value: 'speed'      },
                    { name: '🎵 Pitch',            value: 'pitch'      },
                    { name: '🔄 Reset All Filters', value: 'reset'     },
                ))
        .addStringOption(opt =>
            opt.setName('level')
                .setDescription('Bass Boost level — only used when type is Bass Boost')
                .setRequired(false)
                .addChoices(
                    { name: 'Off',    value: 'off'    },
                    { name: 'Low',    value: 'low'    },
                    { name: 'Medium', value: 'medium' },
                    { name: 'High',   value: 'high'   },
                ))
        .addNumberOption(opt =>
            opt.setName('intensity')
                .setDescription('Speed (0.25–3.0) or Pitch (0.5–2.0) multiplier — only used for those types')
                .setRequired(false)
                .setMinValue(0.25)
                .setMaxValue(3.0)),

    async execute(interaction) {
        // Premium check
        if (!await requirePremium(interaction)) return;

        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || !queue.songs[0]) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', flags: MessageFlags.Ephemeral });
        }

        const type      = interaction.options.getString('type');
        const level     = interaction.options.getString('intensity') === null ? interaction.options.getString('level') : null;
        const intensity = interaction.options.getNumber('intensity');
        const player    = queue.player;

        if (!queue.filters) queue.filters = {};

        let filterName = '';

        switch (type) {
            case 'bassboost': {
                // Require a level choice for bassboost
                if (!level) {
                    return interaction.reply({
                        content: '❌ Please also choose a **level** (Off / Low / Medium / High) when using Bass Boost.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                if (level === 'off') {
                    delete queue.filters.equalizer;
                    filterName = '🎸 Bass Boost — Off';
                } else {
                    queue.filters.equalizer = FILTER_PRESETS[`bassboost_${level}`].equalizer;
                    filterName = `🎸 Bass Boost — ${level.charAt(0).toUpperCase() + level.slice(1)}`;
                }
                break;
            }

            case 'speed': {
                if (intensity == null) {
                    return interaction.reply({
                        content: '❌ Please provide an **intensity** multiplier (0.25 – 3.0) for Speed.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                if (!queue.filters.timescale) queue.filters.timescale = {};
                queue.filters.timescale.speed = intensity;
                filterName = `⚡ Speed ×${intensity}`;
                break;
            }

            case 'pitch': {
                if (intensity == null) {
                    return interaction.reply({
                        content: '❌ Please provide an **intensity** multiplier (0.5 – 2.0) for Pitch.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                if (intensity < 0.5 || intensity > 2.0) {
                    return interaction.reply({
                        content: '❌ Pitch multiplier must be between **0.5** and **2.0**.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                if (!queue.filters.timescale) queue.filters.timescale = {};
                queue.filters.timescale.pitch = intensity;
                filterName = `🎵 Pitch ×${intensity}`;
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

            case 'reset':
                queue.filters = {};
                filterName = '🔄 All Filters Cleared';
                break;

            default:
                return interaction.reply({ content: '❌ Unknown filter type.', flags: MessageFlags.Ephemeral });
        }

        // Build and apply the Lavalink filters payload from accumulated active filters
        const filtersPayload = {};
        if (queue.filters.equalizer) filtersPayload.equalizer = queue.filters.equalizer;
        if (queue.filters.timescale) filtersPayload.timescale = queue.filters.timescale;
        if (queue.filters.rotation)  filtersPayload.rotation  = queue.filters.rotation;
        if (queue.filters.tremolo)   filtersPayload.tremolo   = queue.filters.tremolo;
        if (queue.filters.vibrato)   filtersPayload.vibrato   = queue.filters.vibrato;

        player.setFilters(filtersPayload);

        // Build active filters display
        const activeFilters = Object.keys(queue.filters);
        const activeText = activeFilters.length > 0
            ? activeFilters.map(f => `\`${f}\``).join(', ')
            : 'None';

        const embed = new EmbedBuilder()
            .setColor('Purple')
            .setTitle(`🎛️ Filter Applied: ${filterName}`)
            .setDescription(`**Active filters:** ${activeText}\n\n*Note: Filter changes may take a second to apply.*`);

        return interaction.reply({ embeds: [embed] });
    },
};
