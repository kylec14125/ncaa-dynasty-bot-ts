import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Attachment,
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

// ---------- HELPERS ----------

function normalizeTeam(name: string): string {
  const n = name.trim().toLowerCase();
  if (["akron", "zips"].includes(n)) return "Akron";
  if (["kent", "kent state", "golden flashes"].includes(n)) return "Kent State";
  return name.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
}

function updateRivalry(winner: string, loser: string) {
  const w = normalizeTeam(winner);
  const l = normalizeTeam(loser);
  if (new Set([w, l]).size === 2 && [w, l].includes("Akron") && [w, l].includes("Kent State")) {
    if (w === "Akron") rivalry.akronWins += 1;
    else rivalry.kentWins += 1;
  }
}

function makeRecap(winner: string, loser: string, wScore: number, lScore: number): string {
  const margin = wScore - lScore;
  const lines: string[] = [];

  if (margin <= 3) {
    lines.push("Absolute nail-biter. Someone’s controller has bite marks. 🧊");
  } else if (margin <= 10) {
    lines.push("Solid win with just enough drama to talk trash all week. 📈");
  } else {
    lines.push("That was a beatdown. Booster club is *concerned*. 💀");
  }

  const wNorm = normalizeTeam(winner);
  const lNorm = normalizeTeam(loser);

  if (
    new Set([wNorm, lNorm]).size === 2 &&
    [wNorm, lNorm].includes("Akron") &&
    [wNorm, lNorm].includes("Kent State")
  ) {
    if (wNorm === "Akron") {
      lines.push("Akron keeps the Wagon Wheel and Kent fans keep the excuses. 🔵");
    } else {
      lines.push("Kent State steals the Wagon Wheel – Akron boosters are on the phone. 💛");
    }
  } else {
    const extra = [
      "Momentum firmly on their side heading into next week.",
      "Rumors say extra wind sprints are coming for the losers. 🏃‍♂️",
      "Film room tomorrow is going to be *awkward* for somebody.",
    ];
    lines.push(extra[Math.floor(Math.random() * extra.length)]);
  }

  return `**FINAL SCORE**\n> **${winner} ${wScore} – ${loser} ${lScore}**\n\n${lines.join(" ")}`;
}

function formatStandings(): string {
  const entries = Object.entries(teams);
  if (entries.length === 0) {
    return "No games reported yet. Use `/final` after a game to get things started.";
  }

  const sorted = entries.sort(([, a], [, b]) => {
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    if (a.wins !== b.wins) return b.wins - a.wins;
    return diffB - diffA;
  });

  const out: string[] = ["**DYNASTY STANDINGS**"];
  let rank = 1;
  for (const [name, data] of sorted) {
    const diff = data.pointsFor - data.pointsAgainst;
    const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
    out.push(
      `\`#${rank}\` **${name}** — ${data.wins}-${data.losses} ` +
        `(PF: ${data.pointsFor}, PA: ${data.pointsAgainst}, DIFF: ${diffStr})`,
    );
    rank += 1;
  }
  return out.join("\n");
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
].map((cmd) => cmd.toJSON());

// ---------- READY / REGISTER COMMANDS ----------

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await c.application?.commands.set(slashCommands);
  console.log("Slash commands registered.");
});

// ---------- MESSAGE REACTIONS (LIFE-LIKE CHAT) ----------

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const content = msg.content.toLowerCase();

  // Images / highlights
  if (msg.attachments.size > 0) {
    const hasImage = msg.attachments.some((att: Attachment) =>
      [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) =>
        att.name?.toLowerCase().endsWith(ext),
      ),
    );
    if (hasImage) {
      const lines = [
        "📸 Highlight submitted to the selection committee.",
        "Screenshot secured. Film room will review this play. 🎥",
        "That looks like either greatness or pain. Either way, I approve. 😎",
        "Evidence has been logged. This will be used in future trash talk.",
      ];
      await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
      return;
    }
  }

  // You win
  if (["i won", "we won", "got the dub", "big win", "huge dub"].some((p) => content.includes(p))) {
    const lines = [
      "Locker room vibes: immaculate. 🏆",
      "Coaches call it execution. Twitter calls it a **statement**.",
      "That’s a program-building W right there. 📈",
      "Committee took notes. Respect earned.",
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
      "Tough one. Film doesn’t lie, but bounce-backs do happen. 💪",
      "Every great dynasty has a ‘what happened there?’ week.",
      "Rumor: extra conditioning is on tomorrow’s schedule. 🏃‍♂️",
      "The committee calls that a ‘character-building experience.’",
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
      "League sources confirm: he is now ‘week-to-week’ with pride issues. 📉",
      "Rumor: he’s entered the transfer portal to the Sun Belt. 👀",
      "Analysts grading that performance: D– with upside if he finds the end zone someday.",
      "Scouts say his controller might be eligible for early retirement.",
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
      "Energy feels like a College GameDay broadcast. 🎙️",
      "Commissioner has been notified: stakes officially raised.",
      "This one goes straight into the rivalry lore book.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Team / rivalry flavor
  if (content.includes("akron on top")) {
    await msg.reply("As destiny intended. 🔵🏈");
    return;
  }
  if (content.includes("go akron") || content.includes("zips")) {
    await msg.reply("Akron boosters are smiling. 📣");
    return;
  }
  if (content.includes("go kent") || content.includes("golden flashes")) {
    await msg.reply("Kent State trying to flip the Wagon Wheel script. ⚡");
    return;
  }
  if (content.includes("kent state") && content.includes("upset")) {
    await msg.reply("Vegas did NOT have that on the board. 💰");
    return;
  }

  // Recruiting
  if (
    content.includes("recruit") ||
    content.includes("committed") ||
    content.includes("commit")
  ) {
    const lines = [
      "Recruiting board just lit up. 📊",
      "Another name on the big board. NIL bag allegedly delivered. 💼",
      "Stars don’t guarantee wins, but they do make the graphics look nicer.",
      "Scouts are updating their spreadsheets as we speak.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }
  if (content.includes("5 star") || content.includes("five star")) {
    await msg.reply("Five-star alert 🚨 – expectations just went through the roof.");
    return;
  }
  if (content.includes("4 star") || content.includes("four star")) {
    await msg.reply("Rock-solid four-star. Future starter written all over it. 📈");
    return;
  }

  // Standings / scores
  if (content.includes("standings")) {
    const lines = [
      "Polls are live. Some egos may not survive the refresh.",
      "The standings don’t lie, but they can definitely hurt feelings. 📉",
      "Power rankings committee is watching closely.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }
  if (content.includes("score") || content.includes("final was")) {
    const lines = [
      "Score reported. Historians have logged the result. 📜",
      "Box score updated. Narrative officially changed.",
      "Another chapter written in this extremely unserious but very real rivalry.",
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
    const homeTeam = normalizeTeam(i.options.getString("home_team", true));
    const awayTeam = normalizeTeam(i.options.getString("away_team", true));
    const homeScore = i.options.getInteger("home_score", true);
    const awayScore = i.options.getInteger("away_score", true);

    if (homeScore === awayScore) {
      await i.reply("No ties in this dynasty. OT that thing and report again. 😤");
      return;
    }

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

    updateStandings(winner, loser, wScore, lScore);
    updateRivalry(winner, loser);

    const recap = makeRecap(winner, loser, wScore, lScore);
    await i.reply(recap);
  }

  if (i.commandName === "standings") {
    const text = formatStandings();
    await i.reply(text);
  }

  if (i.commandName === "rivalry") {
    const ak = rivalry.akronWins;
    const ks = rivalry.kentWins;
    const total = ak + ks;

    if (total === 0) {
      await i.reply(
        "**AKRON VS KENT STATE RIVALRY**\nNo games reported yet. Someone fire up a kickoff.",
      );
      return;
    }

    let leader: string;
    if (ak > ks) leader = "Akron leads the Wagon Wheel war. 🔵";
    else if (ks > ak) leader = "Kent State holds the edge in the Wagon Wheel showdown. 💛";
    else leader = "All square — tension rising.";

    await i.reply(
      `**AKRON VS KENT STATE RIVALRY**\nAkron wins: **${ak}**\nKent State wins: **${ks}**\n\n${leader}`,
    );
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

    let msg: string;
    if (status === "commit") {
      msg =
        `**RECRUITING NEWS 📝**\n` +
        `${team} lands a **${stars}★ ${entry.position} ${prospect}**.\n` +
        `Scouts say this might shift the balance of power. 👀`;
    } else if (status === "interest") {
      msg =
        `**RECRUITING RUMORS 🔍**\n` +
        `${prospect} (**${stars}★ ${entry.position}**) is showing interest in **${team}**.\n` +
        `Keep the visits and NIL pitches coming.`;
    } else {
      msg =
        `**RECRUITING LOSS 🚫**\n` +
        `${team} misses out on **${stars}★ ${entry.position} ${prospect}**.\n` +
        `Time to hit the tape and find the next gem.`;
    }

    await i.reply(msg);
  }
});

// ---------- LOGIN ----------

client.login(token);
