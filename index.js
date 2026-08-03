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

let lastSong = null;
let lastGame = null;

function extractFromPresence(presence) {
  const songActivity = presence?.activities?.find((a) => a.name === "Spotify") || null;
  const gameActivity =
    presence?.activities?.find(
      (a) => a.type === ActivityType.Playing && a.name !== "Spotify"
    ) || null;

  return { songActivity, gameActivity };
}

function updateState(presence) {
  const { songActivity, gameActivity } = extractFromPresence(presence);
  const now = new Date().toISOString();

  if (songActivity) {
    lastSong = {
      title: songActivity.details,
      artist: songActivity.state,
      album: songActivity.assets?.largeText || null,
      albumArt: songActivity.assets?.largeImage
        ? `https://i.scdn.co/image/${songActivity.assets.largeImage.replace("spotify:", "")}`
        : null,
      songUrl: songActivity.syncId
        ? `https://open.spotify.com/track/${songActivity.syncId}`
        : null,
      lastActiveAt: now,
      isActive: true,
    };
  } else if (lastSong) {
    lastSong.isActive = false;
  }

  if (gameActivity) {
    lastGame = {
      name: gameActivity.name,
      details: gameActivity.details || null,
      state: gameActivity.state || null,
      largeImage: gameActivity.assets?.largeImageURL?.() || null,
      lastActiveAt: now,
      isActive: true,
    };
  } else if (lastGame) {
    lastGame.isActive = false;
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(TARGET_USER_ID);
      if (member?.presence) {
        updateState(member.presence);
      }
      break;
    } catch {
      // user not in this guild, keep looking
    }
  }
});

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence || newPresence.userId !== TARGET_USER_ID) return;
  updateState(newPresence);
});

client.login(DISCORD_TOKEN);

const app = express();

app.get("/status", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.json({
    song: lastSong,
    game: lastGame,
    serverTime: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.send("Discord presence bot is running.");
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});
