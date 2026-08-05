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

function updateState(presence) {
  const songActivity = presence?.activities?.find((a) => a.name === "Spotify") || null;
  const gameActivity =
    presence?.activities?.find((a) => a.type === ActivityType.Playing && a.name !== "Spotify") || null;
  const now = new Date().toISOString();

  if (songActivity) {
    lastSong = {
      title: songActivity.details,
      artist: songActivity.state,
      albumArt: songActivity.assets?.largeImage
        ? `https://i.scdn.co/image/${songActivity.assets.largeImage.replace("spotify:", "")}`
        : null,
      songUrl: songActivity.syncId ? `https://open.spotify.com/track/${songActivity.syncId}` : null,
      startTs: songActivity.timestamps?.start ? new Date(songActivity.timestamps.start).getTime() : null,
      endTs: songActivity.timestamps?.end ? new Date(songActivity.timestamps.end).getTime() : null,
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
      startTs: gameActivity.timestamps?.start
        ? new Date(gameActivity.timestamps.start).getTime()
        : (lastGame?.name === gameActivity.name ? lastGame.startTs : Date.now()),
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
      if (member?.presence) updateState(member.presence);
      break;
    } catch {}
  }
});

setInterval(() => {
  if (!client.isReady()) {
    console.log("Bot is disconnected from Discord. Exiting so Railway restarts the process...");
    process.exit(1);
  }
}, 5 * 60 * 1000);

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence || newPresence.userId !== TARGET_USER_ID) return;
  console.log(`presenceUpdate received for target user at ${new Date().toISOString()}`);
  updateState(newPresence);
});

client.login(DISCORD_TOKEN);

const app = express();

const SGDB_API_KEY = "f0302142a3f69766d96574fc1e576fa2";

async function findGameImageOnWikipedia(gameName) {
  try {
    const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${SGDB_API_KEY}` },
    });
    const searchData = await searchRes.json();
    const gameId = searchData?.data?.[0]?.id;
    if (!gameId) return { cover: null };

    const gridUrl = `https://www.steamgriddb.com/api/v2/grids/game/${gameId}`;
    const gridRes = await fetch(gridUrl, {
      headers: { Authorization: `Bearer ${SGDB_API_KEY}` },
    });
    const gridData = await gridRes.json();
    const cover = gridData?.data?.[0]?.url || null;
    return { cover };
  } catch (err) {
    return { cover: null };
  }
}

app.get("/game-cover", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  const gameName = req.query.name;
  if (!gameName) {
    return res.status(400).json({ error: "missing 'name' query param" });
  }

  const result = await findGameImageOnWikipedia(gameName);
  return res.json(result);
});

app.get("/status", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.json({
    song: lastSong,
    game: lastGame,
    serverTime: new Date().toISOString(),
    botConnected: client.isReady(),
    wsStatus: client.ws.status,
    wsPing: client.ws.ping,
  });
});

app.get("/", (req, res) => res.send("Discord presence bot is running."));

app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));
