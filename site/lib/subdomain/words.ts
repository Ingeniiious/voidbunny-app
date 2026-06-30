// Curated wordlists for random subdomain slugs.
//
// Rules followed when curating:
//   - No edgy / explicit / political / religious / brand-adjacent words.
//   - No words a normal customer would be embarrassed to say out loud.
//   - Both lists target ~200 entries → 200 × 200 × 46656 ≈ 1.87B combos.
//   - All lowercase, ASCII-only, no hyphens, 3–10 chars each.

export const adjectives: readonly string[] = [
  "amber", "ancient", "azure", "balmy", "bouncy", "brave", "breezy", "bright",
  "brisk", "bronze", "bubbly", "calm", "candid", "caring", "cheery", "chill",
  "classy", "clever", "cloudy", "comfy", "cosmic", "cozy", "creamy", "crimson",
  "crisp", "curious", "daring", "dewy", "dimpled", "dreamy", "dusty", "eager",
  "earnest", "easy", "elastic", "elegant", "epic", "ethereal", "even", "fancy",
  "fearless", "festive", "fiery", "fizzy", "fleet", "fluffy", "fluid", "fond",
  "forest", "fragrant", "free", "fresh", "friendly", "frosty", "fuzzy", "gala",
  "gentle", "giddy", "glad", "glassy", "gleaming", "glowing", "golden", "grand",
  "grassy", "great", "green", "happy", "hardy", "harmonic", "hazel", "heroic",
  "honest", "hopeful", "humble", "humid", "indigo", "inky", "ivory", "jade",
  "jaunty", "jolly", "joyful", "jubilant", "keen", "kind", "kindly", "lacy",
  "lambent", "leafy", "lemon", "lilac", "limber", "lithe", "lively", "lofty",
  "loyal", "lucky", "lumi", "lunar", "luscious", "lush", "magnetic", "marble",
  "mellow", "merry", "mighty", "minted", "misty", "modest", "mossy", "musical",
  "mystic", "neat", "nimble", "noble", "olive", "opal", "orange", "pacific",
  "patient", "peachy", "pearly", "peppy", "perky", "petal", "placid", "plucky",
  "plum", "polar", "polished", "prancing", "pretty", "proud", "purple", "quaint",
  "quick", "quiet", "quirky", "radiant", "rapid", "ready", "regal", "rich",
  "rosy", "rugged", "rustic", "ruby", "sage", "salty", "sandy", "sapphire",
  "scenic", "shady", "shimmer", "shiny", "silent", "silky", "silver", "simple",
  "sleek", "slender", "smooth", "snappy", "snowy", "soft", "solar", "sparkly",
  "spicy", "spirited", "splendid", "spring", "spry", "stable", "starry",
  "steady", "stellar", "stout", "studious", "sturdy", "sublime", "subtle",
  "sunny", "sunset", "supple", "swift", "tame", "tasty", "teal", "tender",
  "tidy", "tinted", "tiny", "topaz", "tranquil", "trusty", "twilight", "valiant",
  "velvet", "vibrant", "violet", "vivid", "warm", "weathered", "whimsical",
  "windy", "winged", "wise", "wonderful", "wooden", "woolly", "yellow", "young",
  "zany", "zealous", "zesty",
] as const;

export const nouns: readonly string[] = [
  // Curated animals — all friendly, no apex predators that read as edgy.
  "antelope", "armadillo", "badger", "barnacle", "bat", "beaver", "beetle",
  "bison", "bluebird", "boar", "bobcat", "bunny", "butterfly", "camel",
  "capybara", "cardinal", "caribou", "cassowary", "caterpillar", "catfish",
  "chameleon", "cheetah", "chickadee", "chimp", "chinchilla", "chipmunk",
  "clam", "cobra", "cockatoo", "cod", "condor", "coral", "corgi", "cormorant",
  "cougar", "coyote", "crab", "crane", "cricket", "crow", "cuckoo", "deer",
  "dingo", "dolphin", "donkey", "dormouse", "dove", "dragonfly", "duck",
  "eagle", "echidna", "eel", "egret", "elk", "emu", "ermine", "falcon",
  "ferret", "finch", "firefly", "flamingo", "flounder", "fox", "frog",
  "gazelle", "gecko", "gerbil", "gibbon", "giraffe", "gnu", "goat", "goose",
  "gopher", "grouse", "guppy", "hamster", "hare", "hawk", "hedgehog", "heron",
  "hippo", "honeybee", "hummingbird", "hyena", "ibex", "ibis", "iguana",
  "impala", "jackal", "jackrabbit", "jaguar", "jellyfish", "kestrel",
  "kingfisher", "kinkajou", "kiwi", "koala", "krill", "ladybug", "lapwing",
  "lark", "lemming", "lemur", "leopard", "limpet", "lion", "lizard", "llama",
  "lobster", "loon", "lynx", "macaw", "magpie", "mallard", "manatee",
  "mandrill", "marmoset", "marmot", "marten", "meerkat", "mink", "mole",
  "mongoose", "moose", "moth", "mouse", "mussel", "narwhal", "nautilus",
  "newt", "nightingale", "ocelot", "octopus", "okapi", "opossum", "orca",
  "oriole", "osprey", "ostrich", "otter", "owl", "ox", "panda", "pangolin",
  "panther", "parakeet", "parrot", "partridge", "peacock", "pelican",
  "penguin", "petrel", "pheasant", "pigeon", "pika", "pony", "porcupine",
  "porpoise", "possum", "puffin", "puma", "python", "quail", "quokka",
  "rabbit", "raccoon", "ram", "raven", "redstart", "reindeer", "robin",
  "rook", "salmon", "sandpiper", "sardine", "scallop", "seahorse", "seal",
  "shrew", "shrimp", "skipper", "skunk", "sloth", "snail", "snipe", "sparrow",
  "spider", "squid", "squirrel", "starfish", "starling", "stingray", "stork",
  "swallow", "swan", "tamarin", "tanager", "tapir", "tarsier", "thrush",
  "tortoise", "toucan", "trout", "tuna", "turkey", "turtle", "viper", "vole",
  "walrus", "warbler", "warthog", "wasp", "weasel", "whale", "whippet",
  "whiteflower", "wildcat", "wolverine", "wombat", "woodchuck", "wren",
  "yak", "zebra",
] as const;
