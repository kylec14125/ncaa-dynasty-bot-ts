import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Attachment,
  EmbedBuilder,
  ColorResolvable,
} from "discord.js";

// ---------- TYPES ----------

interface TeamStats {
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

interface RivalryRecord {
  akronWins: number;
  kentWins: number;
}

type RecruitStatus = "commit" | "interest" | "lost";

interface RecruitEntry {
  team: string;
  prospect: string;
  stars: number;
  position: string;
  status: RecruitStatus;
}

// ---------- STATE (IN-MEMORY) ----------

const teams: Record<string, TeamStats> = {};
const rivalry: RivalryRecord = { akronWins: 0, kentWins: 0 };
const recruits: RecruitEntry[] = [];
const streaks: Record<string, number> = {}; // positive = win streak, negative = losing streak

// ---------- HELPERS ----------

function normalizeTeam(name: string): string {
  const n = name.trim().toLowerCase();
  if (["akron", "zips"].includes(n)) return "Akron";
  if (["kent", "kent state", "golden flashes"].includes(n)) return "Kent State";
  return name.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getTeamColor(team: string): ColorResolvable {
  const t = normalizeTeam(team);
  if (t === "Akron") return "#003366"; // dark blue
  if (t === "Kent State") return "#FFCC00"; // gold
  return "#888888"; // neutral gray for CPUs
}

function getTeamLogo(team: string): string | null {
  const t = normalizeTeam(team);
  // You can swap these URLs for any logo images you like
  if (t === "Akron") {
    return "https://upload.wikimedia.org/wikipedia/en/2/26/Akron_Zips_logo.svg";
  }
  if (t === "Kent State") {
    return "https://upload.wikimedia.org/wikipedia/en/4/4f/Kent_State_Golden_Flashes_logo.svg";
  }
  return null;
}

function updateStreaks(winner: string, loser: string) {
  const wPrev = streaks[winner] ?? 0;
  const lPrev = streaks[loser] ?? 0;

  // winner streak
  if (wPrev >= 0) streaks[winner] = wPrev + 1;
  else streaks[winner] = 1;

  // loser streak
  if (lPrev <= 0) streaks[loser] = lPrev - 1;
  else streaks[loser] = -1;
}

function updateStandings(winner: string, loser: string, wScore: number, lScore: number) {
  const pair: [string, number, number][] = [
    [winner, wScore, lScore],
    [loser, lScore, wScore],
  ];

  for (const [team, scored, allowed] of pair) {
    if (!teams[team]) {
      teams[team] = {
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
    }
    teams[team].pointsFor += scored;
    teams[team].pointsAgainst += allowed;
  }

  teams[winner].wins += 1;
  teams[loser].losses += 1;

  updateStreaks(winner, loser);
}

function updateRivalry(winner: string, loser: string) {
  const w = normalizeTeam(winner);
  const l = normalizeTeam(loser);
  if (new Set([w, l]).size === 2 && [w, l].includes("Akron") && [w, l].includes("Kent State")) {
    if (w === "Akron") rivalry.akronWins += 1;
    else rivalry.kentWins += 1;
  }
}

function classifyGame(
  winner: string,
  loser: string,
  wScore: number,
  lScore: number,
  prevWinner?: TeamStats,
  prevLoser?: TeamStats,
): string {
  const margin = wScore - lScore;

  const winnerNorm = normalizeTeam(winner);
  const loserNorm = normalizeTeam(loser);
  const isHumanRivalry =
    [winnerNorm, loserNorm].includes("Akron") && [winnerNorm, loserNorm].includes("Kent State");

  let label: string;

  if (margin >= 21) {
    label = "Blowout";
  } else if (margin <= 3) {
    label = "Classic";
  } else {
    label = "Solid Win";
  }

  // Upset detection: loser had more wins before this game
  if (prevWinner && prevLoser && prevLoser.wins > prevWinner.wins && margin >= 7) {
    label = "Upset";
  }

  if (isHumanRivalry && margin >= 17) {
    label = "Rivalry Beatdown";
  }

  return label;
}

function makeSavageSubtitle(
  gameType: string,
  winner: string,
  loser: string,
  wScore: number,
  lScore: number,
): string {
  const margin = wScore - lScore;
  const wNorm = normalizeTeam(winner);
  const lNorm = normalizeTeam(loser);
  const rivalryGame =
    [wNorm, lNorm].includes("Akron") && [wNorm, lNorm].includes("Kent State");

  const akronWin = wNorm === "Akron";
  const kentWin = wNorm === "Kent State";

  if (rivalryGame) {
    if (akronWin) {
      if (margin >= 21) {
        return "Akron just beat the absolute shit out of Kent. Booster club is partying; Kent fans are coping. 💀";
      }
      if (margin <= 3) {
        return "Akron survives a sweaty-ass rivalry game. Nick’s controller might be in pieces. 🧊";
      }
      return "Akron owns the Wagon Wheel again. Nick is on full excuse tour. 🔵";
    } else if (kentWin) {
      if (margin >= 21) {
        return "Kent State dragged Akron up and down the field. Kyle’s headset is under review. 💛";
      }
      if (margin <= 3) {
        return "Kent State sneaks out a rivalry win. Akron boosters are sending angry emails. ⚡";
      }
      return "Kent State actually showed up. Akron’s ‘dynasty’ is on fraud watch. 👀";
    }
  }

  switch (gameType) {
    case "Blowout":
      return `${winner} turned ${loser} into NPCs. That was a straight-up ass kicking.`;
    case "Classic":
      return `Instant classic. One of you clutched up, the other one is sick to their stomach.`;
    case "Upset":
      return `${winner} just ruined ${loser}'s season. That’s a ‘throw the controller’ type L.`;
    case "Rivalry Beatdown":
      return `That rivalry game wasn’t even close. Someone’s getting roasted in chat for days.`;
    default:
      if (margin >= 10) {
        return `${winner} controlled that shit. ${loser} never really had a shot.`;
      }
      return `${winner} did just enough. ${loser} will pretend it was ‘closer than the score’.`;
  }
}

function formatStandingsEmbed(): EmbedBuilder {
  const entries = Object.entries(teams);
  const embed = new EmbedBuilder().setTitle("Dynasty Standings").setColor("#1E88E5");

  if (entries.length === 0) {
    embed.setDescription(
      "No games reported yet. Use `/final` after a game to get things started.",
    );
    return embed;
  }

  const sorted = entries.sort(([, a], [, b]) => {
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    if (a.wins !== b.wins) return b.wins - a.wins;
    return diffB - diffA;
  });

  let rank = 1;
  for (const [name, data] of sorted) {
    const diff = data.pointsFor - data.pointsAgainst;
    const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
    const streakVal = streaks[name] ?? 0;
    let streakText = "—";
    if (streakVal > 0) streakText = `W${streakVal}`;
    if (streakVal < 0) streakText = `L${Math.abs(streakVal)}`;

    embed.addFields({
      name: `#${rank} ${name}`,
      value: `Record: **${data.wins}-${data.losses}**  |  PF: **${data.pointsFor}**  PA: **${data.pointsAgainst}**  |  Streak: **${streakText}**  |  Diff: **${diffStr}**`,
    });
    rank += 1;
  }

  return embed;
}

function formatStreaksEmbed(): EmbedBuilder {
  const entries = Object.entries(streaks).filter(([, v]) => v !== 0);
  const embed = new EmbedBuilder().setTitle("Current Streaks").setColor("#8E24AA");

  if (entries.length === 0) {
    embed.setDescription(
      "No active streaks yet. Somebody start stacking wins… or keep being hilariously bad.",
    );
    return embed;
  }

  for (const [team, value] of entries) {
    if (value > 0) {
      embed.addFields({
        name: team,
        value: `🔥 **${value}-game win streak**`,
      });
    } else {
      embed.addFields({
        name: team,
        value: `💀 **${Math.abs(value)}-game losing streak**`,
      });
    }
  }

  return embed;
}

// ---------- DISCORD CLIENT ----------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN is not set");
  process.exit(1);
}

// ---------- SLASH COMMANDS SETUP ----------

const slashCommands = [
  new SlashCommandBuilder()
    .setName("final")
    .setDescription("Report a final score")
    .addStringOption((opt) =>
      opt.setName("home_team").setDescription("Home team (e.g. Akron)").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("away_team").setDescription("Away team (e.g. Kent State)").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt.setName("home_score").setDescription("Home score").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt.setName("away_score").setDescription("Away score").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("standings")
    .setDescription("Show current dynasty standings"),

  new SlashCommandBuilder()
    .setName("rivalry")
    .setDescription("Show Akron vs Kent State rivalry record"),

  new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Log a recruiting outcome")
    .addStringOption((opt) =>
      opt.setName("team").setDescription("Team (Akron, Kent, etc.)").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("prospect_name").setDescription("Prospect name").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt.setName("stars").setDescription("Stars (3–5)").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("position").setDescription("Position (QB, HB, CB, etc.)").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("status")
        .setDescription("commit / interest / lost")
        .setRequired(true)
        .addChoices(
          { name: "commit", value: "commit" },
          { name: "interest", value: "interest" },
          { name: "lost", value: "lost" },
        ),
    ),

  new SlashCommandBuilder()
    .setName("streaks")
    .setDescription("Show current win/loss streaks"),
].map((cmd) => cmd.toJSON());

// ---------- READY / REGISTER COMMANDS ----------

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await c.application?.commands.set(slashCommands);
  console.log("Slash commands registered.");
});

// ---------- MESSAGE REACTIONS (SAVAGE CHAT) ----------

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const content = msg.content.toLowerCase();

  const mentionsKent =
    content.includes("kent") || content.includes("kent state") || content.includes("golden flashes");
  const mentionsAkron = content.includes("akron") || content.includes("zips");

  // Images / highlights
  if (msg.attachments.size > 0) {
    const hasImage = msg.attachments.some((att: Attachment) =>
      [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) =>
        att.name?.toLowerCase().endsWith(ext),
      ),
    );
    if (hasImage) {
      const lines = [
        "📸 Highlight saved. This WILL be used against someone later.",
        "Screenshot secured. Film room is gonna feast on this.",
        "That looks like either greatness or pure pain. Either way, I respect it. 😈",
        "Evidence logged. Trash talk fuel acquired.",
      ];
      await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
      return;
    }
  }

  // You win
  if (["i won", "we won", "got the dub", "big win", "huge dub"].some((p) => content.includes(p))) {
    const lines = [
      "Big f***ing dub. 🏆",
      "That’s how you shut everybody up. Statement win.",
      "That’s a franchise W. Schedule the parade.",
      "Dynasty stock: **way** up after that one. 📈",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // You lose
  if (
    ["i lost", "we lost", "got smoked", "got blown out", "got clapped"].some((p) =>
      content.includes(p),
    )
  ) {
    const lines = [
      "Yikes. That was rough. Take the L, hit the lab, come back meaner. 💪",
      "That was a character-building ass kicking.",
      "That loss smelled like pure pain and bad decisions.",
      "Tough scene. At least it wasn’t on national TV… oh wait, it’s in this Discord forever.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Someone else loses (Nick, etc.)
  if (
    ["he lost", "he choked", "he blew it", "nick lost", "nick choked"].some((p) =>
      content.includes(p),
    )
  ) {
    const lines = [
      "Nick fumbled the bag again. Sources say he’s day-to-day with bruised ego. 📉",
      "Nick’s playbook is just four verts and panic. Didn’t work, did it?",
      "That performance was straight-up trash. Cut the tape and start over.",
      "Nick playing like he’s trying to get fired from his own dynasty.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Direct shots at Nick
  if (
    [
      "nick sucks",
      "nick is trash",
      "nick is bad",
      "nick is ass",
      "nick can't play",
      "nick cant play",
    ].some((p) => content.includes(p))
  ) {
    const lines = [
      "Committee unanimously agrees: Nick is not him.",
      "Nick is putting up CPU-on-rookie numbers and still losing. Impressive in a bad way.",
      "Scouts have removed Nick from all serious consideration.",
      "If choking was a stat, Nick would lead the nation.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Rage / controller / lag / cheese / refs
  if (
    content.includes("rage quit") ||
    content.includes("ragequit") ||
    content.includes("quit out")
  ) {
    const lines = [
      "Rage quit detected. Mental toughness rating just dropped 10 points.",
      "That quit button got absolutely SMASHED. 💥",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (
    content.includes("controller") ||
    content.includes("batteries") ||
    content.includes("stick drift")
  ) {
    const lines = [
      "Controller officially on the injury report as ‘probable’.",
      "Sounds like the controller played better than the user, tbh.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (content.includes("lag") || content.includes("delay")) {
    const lines = [
      "Lag johns detected. Skill issue or WiFi issue? The world may never know.",
      "Blaming lag is valid exactly once per season. You might’ve used your free pass.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (content.includes("refs") || content.includes("referees") || content.includes("cheated")) {
    const lines = [
      "League office reviewed the call. Ruling: you still sold.",
      "Refs caught strays but the film says you were getting cooked anyway.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (content.includes("cheese") || content.includes("cheesing")) {
    const lines = [
      "Cheese detected. Defensive coordinator drawing up anti-BS plays as we speak.",
      "If you’re gonna cheese, at least win. Losing AND cheesing is crazy.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Generic hype
  if (
    ["let's go", "lets go", "huge game", "big game", "rivalry week"].some((p) =>
      content.includes(p),
    )
  ) {
    const lines = [
      "Vibes feel like a primetime ESPN game. 🎙️",
      "Commissioner has marked this as a must-watch matchup.",
      "This one’s going straight into dynasty lore.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Team / rivalry flavor
  if (content.includes("akron on top")) {
    await msg.reply("As destiny f***ing intended. 🔵🏈");
    return;
  }

  if (mentionsAkron) {
    const lines = [
      "Akron: certified main character energy.",
      "Zips are the program everybody loves or loves to hate.",
      "Akron boosters are locked in. Expectations are sky high.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (mentionsKent) {
    const lines = [
      "Kent State staying in their usual spot: chaos and pain.",
      "Golden Flashes? More like Golden Flashes-of-mediocrity.",
      "Every time Kent gets praised, Akron fans die a little inside.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Recruiting
  if (
    content.includes("recruit") ||
    content.includes("committed") ||
    content.includes("commit")
  ) {
    const lines = [
      "Recruiting board just lit the hell up. 📊",
      "Another kid on the big board. NIL whispers getting louder.",
      "Stars don’t guarantee wins, but they do make the graphics look sexy.",
      "Scouts are updating their spreadsheets and talking their shit.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }
  if (content.includes("5 star") || content.includes("five star")) {
    await msg.reply(
      "Five-star alert 🚨 — pressure just went way up. No more excuses with that kind of talent.",
    );
    return;
  }
  if (content.includes("4 star") || content.includes("four star")) {
    await msg.reply(
      "Rock-solid four-star. Future starter written all over that dude. 📈",
    );
    return;
  }

  // Standings / scores
  if (content.includes("standings")) {
    const lines = [
      "Polls are live. Feelings WILL be hurt.",
      "The standings don’t lie, but they absolutely talk shit.",
      "Power rankings committee is sharpening their knives.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }
  if (content.includes("score") || content.includes("final was")) {
    const lines = [
      "Score reported. History books updated. Someone’s night is ruined.",
      "Box score updated. Agenda pieces are being prepared.",
      "Another chapter in this unserious, very real rivalry has been written.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }
});

// ---------- SLASH COMMAND HANDLER ----------

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const i = interaction as ChatInputCommandInteraction;

  if (i.commandName === "final") {
    const homeTeamRaw = i.options.getString("home_team", true);
    const awayTeamRaw = i.options.getString("away_team", true);
    const homeTeam = normalizeTeam(homeTeamRaw);
    const awayTeam = normalizeTeam(awayTeamRaw);
    const homeScore = i.options.getInteger("home_score", true);
    const awayScore = i.options.getInteger("away_score", true);

    if (homeScore === awayScore) {
      await i.reply("No ties in this dynasty. OT that shit and report again. 😤");
      return;
    }

    // Grab pre-game stats for upset detection
    const prevHome = teams[homeTeam];
    const prevAway = teams[awayTeam];

    let winner = homeTeam;
    let loser = awayTeam;
    let wScore = homeScore;
    let lScore = awayScore;

    if (awayScore > homeScore) {
      winner = awayTeam;
      loser = homeTeam;
      wScore = awayScore;
      lScore = homeScore;
    }

    const gameType = classifyGame(
      winner,
      loser,
      wScore,
      lScore,
      winner === homeTeam ? prevHome : prevAway,
      winner === homeTeam ? prevAway : prevHome,
    );

    updateStandings(winner, loser, wScore, lScore);
    updateRivalry(winner, loser);

    const embed = new EmbedBuilder()
      .setTitle("FINAL")
      .setColor(getTeamColor(winner))
      .setDescription(`**${winner} ${wScore} – ${loser} ${lScore}**`)
      .addFields(
        {
          name: "Game Type",
          value: gameType,
          inline: true,
        },
        {
          name: "Winner Record",
          value: `${teams[winner].wins}-${teams[winner].losses}`,
          inline: true,
        },
        {
          name: "Loser Record",
          value: `${teams[loser].wins}-${teams[loser].losses}`,
          inline: true,
        },
      );

    const wStreak = streaks[winner] ?? 0;
    const lStreak = streaks[loser] ?? 0;
    let streakLine = "";

    if (wStreak >= 2) {
      streakLine += `🔥 **${winner}** on a **${wStreak}-game win streak**.\n`;
    }
    if (lStreak <= -2) {
      streakLine += `💀 **${loser}** on a **${Math.abs(lStreak)}-game losing streak**.\n`;
    }
    if (streakLine) {
      embed.addFields({
        name: "Streaks",
        value: streakLine,
      });
    }

    const subtitle = makeSavageSubtitle(gameType, winner, loser, wScore, lScore);
    embed.addFields({
      name: "Recap",
      value: subtitle,
    });

    const logo = getTeamLogo(winner);
    if (logo) {
      embed.setThumbnail(logo);
    }

    await i.reply({ embeds: [embed] });
  }

  if (i.commandName === "standings") {
    const embed = formatStandingsEmbed();
    await i.reply({ embeds: [embed] });
  }

  if (i.commandName === "rivalry") {
    const ak = rivalry.akronWins;
    const ks = rivalry.kentWins;
    const total = ak + ks;

    const embed = new EmbedBuilder()
      .setTitle("Akron vs Kent State – Wagon Wheel War")
      .setColor("#F4511E");

    if (total === 0) {
      embed.setDescription(
        "No rivalry games reported yet. Somebody boot up the matchup already.",
      );
    } else {
      let leader: string;
      if (ak > ks) leader = "Akron running the show right now. 🔵";
      else if (ks > ak) leader = "Kent State has the edge. Akron fans are coping. 💛";
      else leader = "All tied up. Maximum tension unlocked.";

      embed.setDescription(
        `Akron wins: **${ak}**\nKent State wins: **${ks}**\n\n${leader}`,
      );
    }

    const akLogo = getTeamLogo("Akron");
    if (akLogo) embed.setThumbnail(akLogo);

    await i.reply({ embeds: [embed] });
  }

  if (i.commandName === "recruit") {
    const teamRaw = i.options.getString("team", true);
    const prospect = i.options.getString("prospect_name", true);
    const stars = i.options.getInteger("stars", true);
    const position = i.options.getString("position", true);
    const status = i.options.getString("status", true) as RecruitStatus;

    const team = normalizeTeam(teamRaw);

    const entry: RecruitEntry = {
      team,
      prospect,
      stars,
      position: position.toUpperCase(),
      status,
    };
    recruits.push(entry);

    const embed = new EmbedBuilder()
      .setTitle("Recruiting Update")
      .setColor(getTeamColor(team))
      .addFields(
        { name: "Team", value: team, inline: true },
        { name: "Prospect", value: prospect, inline: true },
        { name: "Stars", value: `${stars}★`, inline: true },
        { name: "Position", value: entry.position, inline: true },
        { name: "Status", value: status.toUpperCase(), inline: true },
      );

    if (status === "commit") {
      embed.setDescription(
        `**${team}** just locked in a **${stars}★ ${entry.position}**. That’s a big-ass pickup.`,
      );
    } else if (status === "interest") {
      embed.setDescription(
        `${prospect} is flirting with **${team}**. Time to spam visits and NIL.`,
      );
    } else {
      embed.setDescription(
        `${team} whiffed on **${stars}★ ${entry.position} ${prospect}**. Time to find the next dog.`,
      );
    }

    const logo = getTeamLogo(team);
    if (logo) embed.setThumbnail(logo);

    await i.reply({ embeds: [embed] });
  }

  if (i.commandName === "streaks") {
    const embed = formatStreaksEmbed();
    await i.reply({ embeds: [embed] });
  }
});

// ---------- LOGIN ----------

client.login(token);
