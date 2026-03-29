import { REST, Routes } from 'discord.js';

let rest = null;

export function initializeDiscordBot() {
	const token = process.env.DISCORD_BOT_TOKEN;
	if (!token) {
		console.warn('DISCORD_BOT_TOKEN not set — Discord role sync disabled');
		return;
	}
	rest = new REST({ version: '10' }).setToken(token);
}

export async function grantDiscordRole(discordUserId) {
	if (!rest) return;
	const guildId = process.env.DISCORD_GUILD_ID;
	const roleId = process.env.DISCORD_PREMIUM_ROLE_ID;
	if (!guildId || !roleId) return;

	try {
		await rest.put(Routes.guildMemberRole(guildId, discordUserId, roleId));
	} catch (error) {
		console.error(`Failed to grant Discord role to ${discordUserId}:`, error.message);
	}
}

export async function revokeDiscordRole(discordUserId) {
	if (!rest) return;
	const guildId = process.env.DISCORD_GUILD_ID;
	const roleId = process.env.DISCORD_PREMIUM_ROLE_ID;
	if (!guildId || !roleId) return;

	try {
		await rest.delete(Routes.guildMemberRole(guildId, discordUserId, roleId));
	} catch (error) {
		console.error(`Failed to revoke Discord role from ${discordUserId}:`, error.message);
	}
}
