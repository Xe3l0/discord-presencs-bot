// Discord presence-watching bot
// Watches ONE specific user (you) and exposes their current Spotify + game
// activity as a small JSON API that your website can poll.

const { Client, GatewayIntentBits, Partials, ActivityType } = require("discord.js");
const express = require("express");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TARGET_USER_ID = process.env.TARGET_USER_ID;
const PORT = process.env.PORT || 3000;

if (!DISCORD_TOKEN || !TARGET_USER_ID) {
  console.error("Missing DISCORD_TOKEN or TARGET_USER_ID environment variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.User, Partials.GuildMember],
});

// In-memory "latest known state" -- good enough for a single-user widget.
let latestState = {
  song: null,
  game: null,
  updatedAt: null,
};

function extractFromPresence(presence) {
  const song = presence?.activities?.find((a) => a.name === "Spotify") || null;
  const game =
    presence?.activities?.find(
      (a) => a.type === ActivityType.Playing && a.name !== "Spotify"
    ) || null;

  return {
    song: song
      ? {
          title: song.details,
          artist: song.state,
          album: song.assets?.largeText || null,
          albumArt: song.assets?.largeImage
            ? `https://i.scdn.co/image/${song.assets.largeImage.replace("spotify:", "")}`
            : null,
          songUrl: song.syncId
            ? `https://open.spotify.com/track/${song.syncId}`
            : null,
        }
      : null,
    game: game
      ? {
          name: game.name,
          details: game.details || null,
          state: game.state || null,
          largeImage: game.assets?.largeImageURL?.() || null,
        }
      : null,
  };
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Prime the initial state on startup
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(TARGET_USER_ID);
      if (member?.presence) {
        const { song, game } = extractFromPresence(member.presence);
        latestState = { song, game, updatedAt: new Date().toISOString() };
      }
      break;
    } catch {
      // user not in this guild, keep looking
    }
  }
});

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence || newPresence.userId !== TARGET_USER_ID) return;

  const { song, game } = extractFromPresence(newPresence);
  latestState = { song, game, updatedAt: new Date().toISOString() };
});

client.login(DISCORD_TOKEN);

// --- Tiny HTTP API ---
const app = express();

app.get("/status", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.json(latestState);
});

app.get("/", (req, res) => {
  res.send("Discord presence bot is running.");
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});