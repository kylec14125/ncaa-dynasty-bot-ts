import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const token = process.env.DISCORD_TOKEN;

// ------------------
//  DIALOG LOGIC
// ------------------

bot.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.toLowerCase();

  // --- Winning / losing chatter ---
  if (content.includes("i won") || content.includes("we won")) {
    msg.reply("BIG DUB 🔥 Akron marching toward greatness!");
  }

  if (content.includes("i lost") || content.includes("we lost")) {
    msg.reply("Tough one… but champions are built in the grind. 🏋️‍♂️ Keep pushing.");
  }

  if (content.includes("he lost") || content.includes("nick lost")) {
    msg.reply("L + ratio + Akron superiority 😤 Kent stays losing.");
  }

  // --- Team identities ---
  if (content.includes("akron")) {
    msg.reply("ZIPS ON TOP ⚡🐘 The MAC runs through Akron.");
  }

  if (content.includes("kent") || content.includes("kent state")) {
    msg.reply("Kent State? More like Kent *Sad*. 😭🔥");
  }

  // --- Recruiting chatter ---
  if (content.includes("5 star") ||
      content.includes("commit") ||
      content.includes("recruit")) {
    msg.reply("🎯 Recruiting update logged. The dynasty grows stronger.");
  }

  // --- Standings / Scores ---
  if (content.includes("score") || content.includes("standings")) {
    msg.reply("📊 Dropping the latest standings soon. Akron > Everybody.");
  }

  // --- Positive hype ---
  if (content.includes("gg") || content.includes("good game")) {
    msg.reply("Respect. Real football energy. 🏈🔥");
  }

  // --- Image reactions ---
  if (msg.attachments.size > 0) {
    msg.reply("🔥 Nice highlight! Updating the dynasty feed…");
  }
});

// ------------------
//  BOT LOGIN
// ------------------

bot.once("ready", () => {
  console.log(`Logged in as ${bot.user?.tag}`);
});

bot.login(token);
