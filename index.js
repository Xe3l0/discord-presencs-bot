const { Client, GatewayIntentBits, Partials, ActivityType } = require("discord.js");
const express = require("express");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TARGET_USER_ID = process.env.TARGET_USER_ID;
const PORT = process.env.PORT || 3000;
const RAWG_API_KEY = "cef074605c474781807438136d7719e9";

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

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence || newPresence.userId !== TARGET_USER_ID) return;
  updateState(newPresence);
});

client.login(DISCORD_TOKEN);

const app = express();

app.get("/game-cover", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  const gameName = req.query.name;
  if (!gameName) {
    return res.status(400).json({ error: "missing 'name' query param" });
  }

  const cover = await findGameImageOnWikipedia(gameName);
  return res.json({ cover });
});

app.get("/status", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.json({ song: lastSong, game: lastGame, serverTime: new Date().toISOString() });
});

// Looks up a game cover image from Wikipedia's free public API.
// No signup, no API key, no 2FA -- works immediately.
async function findGameImageOnWikipedia(gameName) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(gameName + " video game")}&format=json&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const pageTitle = searchData?.query?.search?.[0]?.title;
    if (!pageTitle) return null;

    const imageUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
    const imageRes = await fetch(imageUrl);
    const imageData = await imageRes.json();
    const pages = imageData?.query?.pages || {};
    const page = Object.values(pages)[0];
    return page?.thumbnail?.source || null;
  } catch (err) {
    console.error("Wikipedia lookup failed:", err.message);
    return null;
  }
}

app.get("/", (req, res) => res.send("Discord presence bot is running."));

app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));
