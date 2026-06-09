export type TcgSlug = "pokemon" | "mtg";

export interface TcgConfig {
  slug: TcgSlug;
  displayName: string;
  shortName: string;
  accentColor: string;
  /** Folder name inside the tcg-drop-alert repo (e.g. "pokemon" → pokemon/state.json) */
  githubDataPath: string;
  /** Canonical retailer used as MSRP reference. Empty string = no MSRP calculation. */
  msrpRetailer: string;
  /** Known set names, sorted longest-first for greedy prefix matching. */
  knownSets: string[];
  /** Optional regex fallbacks run after knownSets lookup fails. */
  knownSetPatterns?: Array<[RegExp, string]>;
}

const POKEMON_KNOWN_SETS: string[] = ([
  // English Mega Evolution era
  "Pitch Black", "Mega Evolution",
  // English SV
  "Black Bolt & White Flare", "Destined Rivals", "Journey Together",
  "Prismatic Evolutions", "Surging Sparks", "Stellar Crown",
  "Shrouded Fable", "Twilight Masquerade", "Temporal Forces",
  "Paldean Fates", "Paradox Rift", "Obsidian Flames", "Paldea Evolved",
  // English SWSH
  "Crown Zenith", "Silver Tempest", "Lost Origin", "Astral Radiance",
  "Brilliant Stars", "Fusion Strike", "Evolving Skies", "Chilling Reign",
  "Battle Styles", "Shining Fates", "Vivid Voltage", "Champions Path",
  "Darkness Ablaze", "Rebel Clash", "Pokemon GO", "Celebrations",
  // Special
  "30th Celebration",
  // Japanese SV
  "Super Electric Breaker", "Glory of Team Rocket", "Terastal Festival",
  "Battle Partners", "Stellar Miracle", "Paradise Dragon", "Heat Wave Arena",
  "Night Wanderer", "Mask of Change", "Ancient Roar", "Future Flash",
  "Snow Hazard", "Clay Burst", "Raging Surf", "Wild Force", "Cyber Judge",
  "White Flare", "Black Bolt",
  // Japanese SWSH
  "Explosive Flame Walker", "Single Strike Master", "Rapid Strike Master",
  "Astonishing Volt Tackle", "Incandescent Arcana", "Legendary Heartbeat",
  "Paradigm Trigger", "Jet Black Spirit", "Vstar Universe",
  "Space Juggler", "Time Gazer", "Silver Lance", "Star Birth", "Lost Abyss",
  "Eevee Heroes", "Dark Phantasma", "Matchless Fighters", "Match Fighters",
  "Battle Region", "Vmax Rising", "Fusion Arts", "Shiny Star V",
  "Infinity Zone", "Blue Sky Stream", "Towering Perfection",
  // Japanese SV base
  "Shiny Treasure ex", "Scarlet ex", "Violet ex",
  // Mega Evolution sub-sets (checked before "Mega Evolution" fallback)
  "Phantasmal Flames", "Ascended Heroes", "Perfect Order", "Chaos Rising",
  "Mega Inferno X", "Mega Symphonia", "Mega Brave", "Nihil Zero", "Abyss Eye",
  // Chinese
  "Savage Blade Awakening", "Dark Crystal Blaze", "Eternity Island",
  "Blade Awakening", "Collect 151", "True Mystery",
  // Numeric set name — added last so it only matches after all longer names fail
  "151",
] as string[]).sort((a, b) => b.length - a.length);

const MTG_KNOWN_SETS: string[] = ([
  // Standard (current + recent)
  "Aetherdrift",
  "Foundations",
  "Duskmourn: House of Horror",
  "Bloomburrow",
  "Outlaws of Thunder Junction",
  "Murders at Karlov Manor",
  "The Lost Caverns of Ixalan",
  "Wilds of Eldraine",
  "March of the Machine: The Aftermath",
  "March of the Machine",
  "Phyrexia: All Will Be One",
  "The Brothers' War",
  "Dominaria United",
  "Streets of New Capenna",
  "Kamigawa: Neon Dynasty",
  "Innistrad: Crimson Vow",
  "Innistrad: Midnight Hunt",
  "Adventures in the Forgotten Realms",
  "Strixhaven: School of Mages",
  "Kaldheim",
  "Zendikar Rising",
  "Throne of Eldraine",
  "War of the Spark",
  // Pioneer staples
  "Ravnica Allegiance",
  "Guilds of Ravnica",
  "Core Set 2021",
  "Core Set 2020",
  "Core Set 2019",
  "Ixalan",
  "Rivals of Ixalan",
  "Hour of Devastation",
  "Amonkhet",
  "Aether Revolt",
  "Kaladesh",
  "Eldritch Moon",
  "Shadows over Innistrad",
  "Oath of the Gatewatch",
  "Battle for Zendikar",
  "Magic Origins",
  // Modern / Remastered
  "Modern Horizons 3",
  "Modern Horizons 2",
  "Modern Horizons",
  "Ravnica Remastered",
  "Dominaria Remastered",
  "Double Masters 2022",
  "Double Masters",
  "Jumpstart 2022",
  "Jumpstart",
  // Commander / Masters
  "Commander Masters",
  "March of the Machine Commander",
  "Phyrexia Commander",
  "Dominaria United Commander",
  "Streets of New Capenna Commander",
  "Kamigawa Neon Dynasty Commander",
  "Innistrad Midnight Hunt Commander",
  "Commander Legends: Battle for Baldur's Gate",
  "Commander Legends",
  "Commander Collection: Green",
  "Commander Collection: Black",
  "Commander Anthology",
  // Universes Beyond / Crossover
  "The Lord of the Rings: Tales of Middle-earth",
  "Doctor Who",
  "Fallout",
  "Assassin's Creed",
  "Final Fantasy",
  "Spiderman",
  "Universes Beyond",
  "Secret Lair",
  // Legacy / Eternal staples
  "Eternal Masters",
  "Conspiracy: Take the Crown",
  "Conspiracy",
  "Battlebond",
  "Iconic Masters",
  "Masters 25",
  // Special sets
  "From the Vault",
  "Duel Decks",
  "Starter Kit",
  "Arena Starter Kit",
] as string[]).sort((a, b) => b.length - a.length);

export const TCG_CONFIGS: Record<TcgSlug, TcgConfig> = {
  pokemon: {
    slug: "pokemon",
    displayName: "Pokémon TCG",
    shortName: "Pokemon",
    accentColor: "#e53935",
    githubDataPath: "pokemon",
    msrpRetailer: "Pokemon Center CA",
    knownSets: POKEMON_KNOWN_SETS,
    knownSetPatterns: [
      [/mega.{0,5}evolution|ME0[1-9]/i, "Mega Evolution"],
    ],
  },
  mtg: {
    slug: "mtg",
    displayName: "Magic: The Gathering",
    shortName: "MTG",
    accentColor: "#7b5ea7",
    githubDataPath: "mtg",
    msrpRetailer: "",
    knownSets: MTG_KNOWN_SETS,
    knownSetPatterns: [
      [/commander\s+\d{4}/i,        "Commander"],
      [/secret\s+lair/i,             "Secret Lair"],
      [/duel\s+deck/i,               "Duel Decks"],
      [/from\s+the\s+vault/i,        "From the Vault"],
      [/modern\s+horizons\s+3/i,     "Modern Horizons 3"],
      [/modern\s+horizons\s+2/i,     "Modern Horizons 2"],
    ],
  },
};

export function getTcgConfig(slug: string): TcgConfig {
  if (slug in TCG_CONFIGS) return TCG_CONFIGS[slug as TcgSlug];
  throw new Error(`Unknown TCG slug: "${slug}". Valid values: ${Object.keys(TCG_CONFIGS).join(", ")}`);
}
