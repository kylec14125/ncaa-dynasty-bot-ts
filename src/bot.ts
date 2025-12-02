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

// ---------- CONSTANTS ----------

const HUMAN_AKRON = "Akron";
const HUMAN_KENT = "Kent State";
const HUMAN_TEAMS = new Set<string>([HUMAN_AKRON, HUMAN_KENT]);

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
  if (["akron", "zips"].includes(n)) return HUMAN_AKRON;
  if (["kent", "kent state", "golden flashes"].includes(n)) return HUMAN_KENT;
  return name.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDivision(team: string): string {
  const t = normalizeTeam(team);
  if (t === HUMAN_AKRON) return "MAC East";
  if (t === HUMAN_KENT) return "MAC West";
  return "CPU Land";
}

function getTeamColor(team: string): ColorResolvable {
  const t = normalizeTeam(team);
  if (t === HUMAN_AKRON) return "#0D47A1"; // vivid blue
  if (t === HUMAN_KENT) return "#FFB300"; // vivid gold
  return "#9E9E9E"; // neutral gray
}

function getTeamLogo(team: string): string | null {
  const t = normalizeTeam(team);
  if (t === HUMAN_AKRON) {
    return "https://upload.wikimedia.org/wikipedia/en/2/26/Akron_Zips_logo.svg";
  }
  if (t === HUMAN_KENT) {
    return "https://upload.wikimedia.org/wikipedia/en/4/4f/Kent_State_Golden_Flashes_logo.svg";
  }
  return null;
}

function updateStreaks(winner: string, loser: string) {
  const wPrev = streaks[winner] ?? 0;
  const lPrev = streaks[loser] ?? 0;

  if (wPrev >= 0) streaks[winner] = wPrev + 1;
  else streaks[winner] = 1;

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
  if (HUMAN_TEAMS.has(w) && HUMAN_TEAMS.has(l)) {
    if (w === HUMAN_AKRON) rivalry.akronWins += 1;
    else if (w === HUMAN_KENT) rivalry.kentWins += 1;
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

  const wNorm = normalizeTeam(winner);
  const lNorm = normalizeTeam(loser);
  const isHumanRivalry = HUMAN_TEAMS.has(wNorm) && HUMAN_TEAMS.has(lNorm);

  let label: string;

  if (margin >= 21) {
    label = "Blowout";
  } else if (margin <= 3) {
    label = "Classic";
  } else {
    label = "Solid Win";
  }

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
  const rivalryGame = HUMAN_TEAMS.has(wNorm) && HUMAN_TEAMS.has(lNorm);

  const akronWin = wNorm === HUMAN_AKRON;
  const kentWin = wNorm === HUMAN_KENT;

  if (rivalryGame) {
    if (akronWin) {
      if (margin >= 21) {
        return [
          "Akron just beat the absolute shit out of Kent. That wasn’t a game, that was a public execution.",
          "Nick’s west-side MAC ‘contender’ looked like a tutorial CPU. Booster club is looking at new leadership.",
        ].join(" ");
      }
      if (margin <= 3) {
        return [
          "Akron survives a sweaty-ass MAC rivalry in the worst conference in football.",
          "Nick had the upset right there and still fumbled his way back into poverty MAC reality.",
        ].join(" ");
      }
      return [
        "Akron keeps the Wagon Wheel and shoves Kent right back into mid-tier MAC hell.",
        "Over on the West, Nick’s ‘rebuild’ looks more like a demolition project.",
      ].join(" ");
    } else if (kentWin) {
      if (margin >= 21) {
        return [
          "Kent State turned Akron into a damn practice drill.",
          "Kyle’s MAC East ‘dynasty’ just got exposed on regional TV and in this Discord forever.",
        ].join(" ");
      }
      if (margin <= 3) {
        return [
          "Kent squeaks one out and acts like they just won a natty.",
          "Akron’s locker room is going to be pure silence and controller plastic.",
        ].join(" ");
      }
      return [
        "Kent State actually handled business. Akron boosters are asking if the dynasty is cooked already.",
        "Somebody in the MAC East is getting demoted to coaching special teams after that.",
      ].join(" ");
    }
  }

  switch (gameType) {
    case "Blowout":
      return [
        `${winner} turned ${loser} into a laugh track. That was a four-quarter-ass-kicking.`,
        "If this was real life, message boards would be melting down and the AD would be dodging phone calls.",
      ].join(" ");
    case "Classic":
      return [
        "Instant classic. One of you locked in, the other is staring at the ceiling questioning life choices.",
        "This is the kind of game MAC After Dark would replay at 2AM for sickos.",
      ].join(" ");
    case "Upset":
      return [
        `${winner} just torched ${loser}'s whole narrative. Whatever story they were telling about their season is dead now.`,
        "That’s a ‘throw the controller, pace the room, blame sliders’ type L.",
      ].join(" ");
    case "Rivalry Beatdown":
      return [
        "That rivalry game was not competitive. That was bullying with extra steps.",
        "Somewhere, a virtual AD is drafting a ‘we’re sticking with the coach’ statement no one believes.",
      ].join(" ");
    default:
      if (margin >= 10) {
        return [
          `${winner} controlled that shit from whistle to whistle.`,
          `${loser} can talk about ‘adjustments’ all they want, the scoreboard called them liars.`,
        ].join(" ");
      }
      return [
        `${winner} did just enough to not blow it.`,
        `${loser} is going to act like it was ‘basically a coin flip’ while the record says otherwise.`,
      ].join(" ");
  }
}

function formatStandingsEmbed(): EmbedBuilder {
  const entries = Object.entries(teams);
  const embed = new EmbedBuilder()
    .setTitle("🏈 MAC Dynasty Standings")
    .setColor("#1E88E5")
    .setDescription(
      "User teams: **Akron (Kyle) – MAC East**, **Kent State (Nick) – MAC West**.\nEveryone else is CPU fodder on the schedule.",
    );

  if (entries.length === 0) {
    embed.addFields({
      name: "No Data",
      value: "No games reported yet. Use `/final` after a game to get this circus started.",
    });
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

    const div = getDivision(name);
    const label =
      name === HUMAN_AKRON
        ? " (Kyle • MAC East)"
        : name === HUMAN_KENT
        ? " (Nick • MAC West)"
        : "";

    embed.addFields({
      name: `#${rank} ${name}${label}`,
      value:
        `Record: **${data.wins}-${data.losses}**  •  Div: **${div}**\n` +
        `PF: **${data.pointsFor}**  PA: **${data.pointsAgainst}**  •  Streak: **${streakText}**  •  Diff: **${diffStr}**`,
    });
    rank += 1;
  }

  return embed;
}

function formatStreaksEmbed(): EmbedBuilder {
  const entries = Object.entries(streaks).filter(([, v]) => v !== 0);
  const embed = new EmbedBuilder()
    .setTitle("🔥 Current Streaks")
    .setColor("#8E24AA")
    .setDescription(
      "Positive = cooking. Negative = MAC-bottom-feeder energy. Nobody is safe.",
    );

  if (entries.length === 0) {
    embed.addFields({
      name: "No Streaks Yet",
      value: "No active streaks. Somebody start stacking wins… or keep hilariously imploding.",
    });
    return embed;
  }

  for (const [team, value] of entries) {
    if (value > 0) {
      embed.addFields({
        name: team,
        value: `🔥 **${value}-game win streak** — they’re actually acting like they want out of poverty MAC.`,
      });
    } else {
      embed.addFields({
        name: team,
        value: `💀 **${Math.abs(value)}-game losing streak** — full-on tire fire, boosters in shambles.`,
      });
    }
  }

  return embed;
}

function buildRecruitBattleEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("🔥 Recruiting War: Akron vs Kent State")
    .setColor("#D81B60")
    .setDescription(
      "Only showing prospects that **both** Akron (Kyle) and Kent State (Nick) went after.\nWho bagged the dogs and who got cooked in the living room.",
    );

  // group recruits by prospect name (case-insensitive)
  const byProspect = new Map<string, RecruitEntry[]>();
  for (const r of recruits) {
    const key = r.prospect.trim().toLowerCase();
    if (!byProspect.has(key)) byProspect.set(key, []);
    byProspect.get(key)!.push(r);
  }

  let anyBattles = false;

  for (const [, entries] of byProspect.entries()) {
    const ak = entries.find((e) => normalizeTeam(e.team) === HUMAN_AKRON);
    const ks = entries.find((e) => normalizeTeam(e.team) === HUMAN_KENT);

    if (!ak || !ks) continue; // not a true Akron vs Kent battle
    anyBattles = true;

    const stars = Math.max(ak.stars, ks.stars);
    const position = (ak.position || ks.position).toUpperCase();
    const prospect = ak.prospect || ks.prospect;

    const akStatus = ak.status;
    const ksStatus = ks.status;

    let winner: "Akron" | "Kent" | "None" | "Chaos" = "None";

    if (akStatus === "commit" && ksStatus !== "commit") winner = "Akron";
    else if (ksStatus === "commit" && akStatus !== "commit") winner = "Kent";
    else if (akStatus === "commit" && ksStatus === "commit") winner = "Chaos";
    else if (akStatus === "interest" && ksStatus === "lost") winner = "Akron";
    else if (ksStatus === "interest" && akStatus === "lost") winner = "Kent";

    let battleLine = "";
    if (winner === "Akron") {
      battleLine =
        `Akron walked into that living room and **embarrassed** Kent's pitch. ` +
        `Kyle bagged this kid while Nick stood there holding a sad little MAC West offer.`;
    } else if (winner === "Kent") {
      battleLine =
        `Kent State actually won this one. Nick stole this recruit straight out of Akron's hands. ` +
        `Kyle’s staff just got pantsed in front of mom, dad, and the high school coach.`;
    } else if (winner === "Chaos") {
      battleLine =
        `Both of you somehow show this kid as a commit. This is pure **dynasty file corruption energy**. ` +
        `Somebody is lying, and it smells like slider abuse.`;
    } else {
      battleLine =
        `No clear winner yet. This recruit is just watching two MAC programs trip over themselves and weighing who’s less of a joke.`;
    }

    const akLine = `Akron (Kyle): **${akStatus.toUpperCase()}**`;
    const ksLine = `Kent State (Nick): **${ksStatus.toUpperCase()}**`;

    embed.addFields({
      name: `${prospect} — ${stars}★ ${position}`,
      value: `${akLine}\n${ksLine}\n${battleLine}`,
    });
  }

  if (!anyBattles) {
    embed.addFields({
      name: "No Battles Yet",
      value:
        "No shared targets yet. One of you is either scared to overlap or too busy losing games to recruit properly.",
    });
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

  new SlashCommandBuilder()
    .setName("recruitbattle")
    .setDescription("Show brutal recap of Akron vs Kent recruiting battles"),
].map((cmd) => cmd.toJSON());

// ---------- READY / REGISTER COMMANDS ----------

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await c.application?.commands.set(slashCommands);
  console.log("Slash commands registered.");
});

// ---------- MESSAGE REACTIONS (SUPER SAVAGE CHAT) ----------

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const content = msg.content.toLowerCase();

  const mentionsKent =
    content.includes("kent") || content.includes("kent state") || content.includes("golden flashes");
  const mentionsAkron = content.includes("akron") || content.includes("zips");
  const mentionsNick = content.includes("nick");
  const mentionsKyle = content.includes("kyle");

  // Images / highlights
  if (msg.attachments.size > 0) {
    const hasImage = msg.attachments.some((att: Attachment) =>
      [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) =>
        att.name?.toLowerCase().endsWith(ext),
      ),
    );
    if (hasImage) {
      const lines = [
        "📸 Highlight saved. This WILL be used as evidence in future trash talk.",
        "Screenshot secured. Film room is going to absolutely cook somebody over this.",
        "That looks like either greatness or a career-ending choke. Either way, I approve. 😈",
        "Evidence logged. Next loss recap will reference this, don’t worry.",
      ];
      await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
      return;
    }
  }

  // You win
  if (["i won", "we won", "got the dub", "big win", "huge dub"].some((p) => content.includes(p))) {
    const lines = [
      "Big f***ing dub. 🏆 That’s the kind of win that makes you talk reckless in the group chat.",
      "That’s a statement win. Somewhere a digital AD just extended your contract in silence.",
      "That’s a ‘queue up the highlights and talk shit for 48 hours straight’ type W.",
      "Dynasty stock: **way** up. If you don’t spam the scoreboard in here, you’re doing it wrong.",
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
      "Oof. That was ugly. That’s a ‘don’t check the Discord for a bit’ type L.",
      "You didn’t just lose, you put out **horrible tape**. Coordinators on the hot seat.",
      "That performance smelled like bad reads, panic throws, and pure misery.",
      "That’s the kind of loss where you mute your mic and just stare at the menu for a minute.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Someone else loses (usually Nick)
  if (
    ["he lost", "he choked", "he blew it", "nick lost", "nick choked"].some((p) =>
      content.includes(p),
    )
  ) {
    const lines = [
      "Nick managed to turn a winnable MAC game into a full-blown comedy special.",
      "That’s vintage Nick: start okay, collapse spectacularly, blame something random.",
      "Nick’s game management is basically a live tutorial on how **not** to win football games.",
      "That loss is going straight into the ‘Nick is not him’ documentary.",
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
      "nick is terrible",
      "nick is awful",
    ].some((p) => content.includes(p))
  ) {
    const lines = [
      "Committee unanimously agrees: Nick is not just bad, he’s a walking coaching clinic on failure.",
      "Nick plays like he’s trying out for the MAC clown car division.",
      "If choking was a stat, Nick would be an All-American. Man is elite at collapsing.",
      "Nick’s game plan is just vibes and pain. Defenses read him like a children’s book.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Light roast for Kyle if name comes up
  if (mentionsKyle && !mentionsNick) {
    const lines = [
      "Kyle out here trying to drag Akron out of MAC poverty while still calling the dumbest plays possible.",
      "Akron is absolutely a dynasty-in-progress… if Kyle would stop throwing into triple coverage.",
      "Kyle’s ceiling is elite, floor is ‘what the hell was that throw’ every other drive.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Both names together: nuclear rivalry commentary
  if (mentionsKyle && mentionsNick) {
    const lines = [
      "Kyle vs Nick is basically MAC Thunderdome: two idiots enter, one idiot leaves slightly less embarrassed.",
      "Every Kyle vs Nick game belongs on MACtion Wednesday with drunk announcers and broken coverage.",
      "Both of you talking like blue bloods while fighting for respect in the **worst** conference in the game is incredible content.",
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
      "Rage quit confirmed. Mental toughness rating dropped into the MAC gutter.",
      "That quit button got absolutely slammed. Controller might be in witness protection now.",
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
      "Controller excuses logged. Committee still rules it a skill issue.",
      "If the controller could talk, it would request a transfer to a better user.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (content.includes("lag") || content.includes("delay")) {
    const lines = [
      "Lag johns detected. This will be cited in the postgame press conference, guaranteed.",
      "Blaming lag is valid once. After that, it’s just cope.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (content.includes("refs") || content.includes("referees") || content.includes("cheated")) {
    const lines = [
      "League office reviewed the footage. Ruling: you still played like shit.",
      "Refs caught strays, but the real criminal was your playcalling.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (content.includes("cheese") || content.includes("cheesing")) {
    const lines = [
      "Cheese detected. If you’re gonna cheese, at least win. Losing AND cheesing is insane.",
      "Whole gameplan built on bullshit and still couldn’t close it out. Tragic.",
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
      "Vibes feel like MAC Championship with ESPN2 commentary and drunk students.",
      "Commissioner has marked this as must-watch degeneracy.",
      "This has ‘season-defining meltdown or legend arc’ written all over it.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  // Team / rivalry flavor
  if (content.includes("akron on top")) {
    await msg.reply("As f***ing ordained. 🔵🏈 Akron trying to crawl out of MAC hell one body at a time.");
    return;
  }

  if (mentionsAkron) {
    const lines = [
      "Akron: main character in this broke-ass MAC cinematic universe.",
      "Zips are either cooking or imploding, there is no in-between.",
      "Akron carries the entire conference’s clout on its back while still playing on weeknight ESPN.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }

  if (mentionsKent) {
    const lines = [
      "Kent State living permanently on the edge between ‘upset threat’ and ‘laughingstock’.",
      "Golden Flashes? More like Golden Flashes-of-misery most weeks.",
      "Nick’s job is literally to make Kent look respectable in the worst conference in America. Tough assignment.",
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
      "Recruiting board just went nuclear. Somebody’s about to flex a graphic like they’re Bama.",
      "Another teenager held hostage on a MAC depth chart. NIL bag probably contained coupons and vibes.",
      "Stars don’t guarantee wins, but they guarantee louder shit talk in this chat.",
      "Scouts updating Excel sheets like this is a real front office job.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }
  if (content.includes("5 star") || content.includes("five star")) {
    await msg.reply(
      "Five-star alert 🚨 — in the MAC, that’s basically signing a god. If you fumble this kid, uninstall.",
    );
    return;
  }
  if (content.includes("4 star") || content.includes("four star")) {
    await msg.reply(
      "Four-star in the MAC is franchise-player territory. Blow that one and it’s a war crime against your fanbase.",
    );
    return;
  }

  // Standings / scores
  if (content.includes("standings")) {
    const lines = [
      "Standings coming in hot. Someone’s fraudulent record is about to get exposed.",
      "Polls don’t lie, but they absolutely do talk shit.",
      "Power rankings committee sharpening knives as we speak.",
    ];
    await msg.reply(lines[Math.floor(Math.random() * lines.length)]);
    return;
  }
  if (content.includes("score") || content.includes("final was")) {
    const lines = [
      "Score locked in. Narrative permanently altered. Pain or glory, no in-between.",
      "Box score updated. This will absolutely get weaponized later.",
      "Another chapter in the most unserious, deeply personal MAC rivalry ever created.",
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

    // pre-game stats for upset detection
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

    const winnerDiv = getDivision(winner);
    const loserDiv = getDivision(loser);

    const embed = new EmbedBuilder()
      .setTitle("📺 MAC DYNASTY FINAL")
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
          value: `${teams[winner].wins}-${teams[winner].losses} (${winnerDiv})`,
          inline: true,
        },
        {
          name: "Loser Record",
          value: `${teams[loser].wins}-${teams[loser].losses} (${loserDiv})`,
          inline: true,
        },
      )
      .setFooter({
        text: "Toxic ESPN: MAC Poverty Conference Edition",
      });

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
      .setTitle("⚔️ Akron vs Kent State – Wagon Wheel War")
      .setColor("#F4511E");

    if (total === 0) {
      embed.setDescription(
        "No rivalry games reported yet. Boot that shit up and let the MAC chaos commence.",
      );
    } else {
      let leader: string;
      if (ak > ks) {
        leader =
          "Akron (Kyle) is running the show right now. Nick’s side of the MAC is pure cope and excuses.";
      } else if (ks > ak) {
        leader =
          "Kent State (Nick) has the edge. Akron’s ‘dynasty’ might need a rebuild of the rebuild.";
      } else {
        leader = "Dead even. Maximum tension. Next matchup is a soul-destroyer for somebody.";
      }

      embed.setDescription(
        `Akron wins: **${ak}**\nKent State wins: **${ks}**\n\n${leader}`,
      );
    }

    const akLogo = getTeamLogo(HUMAN_AKRON);
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

    const div = getDivision(team);
    const embed = new EmbedBuilder()
      .setTitle("📝 Recruiting Update")
      .setColor(getTeamColor(team))
      .addFields(
        { name: "Team", value: `${team} (${div})`, inline: true },
        { name: "Prospect", value: prospect, inline: true },
        { name: "Stars", value: `${stars}★`, inline: true },
        { name: "Position", value: entry.position, inline: true },
        { name: "Status", value: status.toUpperCase(), inline: true },
      );

    const isAkron = team === HUMAN_AKRON;
    const isKent = team === HUMAN_KENT;

    if (status === "commit") {
      if (isAkron) {
        embed.setDescription(
          `**Akron (Kyle)** just bagged a **${stars}★ ${entry.position}**. ` +
            `MAC East just felt that. Nick better start panic dialing backups.`,
        );
      } else if (isKent) {
        embed.setDescription(
          `**Kent State (Nick)** actually landed a **${stars}★ ${entry.position}**. ` +
            `MAC West got less pathetic in one move. Kyle should be sweating a bit.`,
        );
      } else {
        embed.setDescription(
          `${team} landed a **${stars}★ ${entry.position}**. CPU just quietly got more annoying on the schedule.`,
        );
      }
    } else if (status === "interest") {
      embed.setDescription(
        `${prospect} is eyeing **${team}**. If you fumble this kid to the other user, you deserve every roast that’s coming.`,
      );
    } else {
      if (isAkron || isKent) {
        embed.setDescription(
          `${team} just **lost** on **${stars}★ ${entry.position} ${prospect}**. ` +
            `That’s the kind of miss you think about at 3AM staring at the depth chart.`,
        );
      } else {
        embed.setDescription(
          `${team} whiffed on **${stars}★ ${entry.position} ${prospect}**. CPU tears don’t count, but still funny.`,
        );
      }
    }

    const logo = getTeamLogo(team);
    if (logo) embed.setThumbnail(logo);

    await i.reply({ embeds: [embed] });
  }

  if (i.commandName === "streaks") {
    const embed = formatStreaksEmbed();
    await i.reply({ embeds: [embed] });
  }

  if (i.commandName === "recruitbattle") {
    const embed = buildRecruitBattleEmbed();
    await i.reply({ embeds: [embed] });
  }
});

// ---------- LOGIN ----------

client.login(token);
