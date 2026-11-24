// Gerado por tools/art/build_art.py a partir de assets/lpc. Não edite.

/** Versão do catálogo: muda quando uma aparência guardada pode deixar de valer. */
export const CATALOG_VERSION = 1;

export const BODIES = ["feminine", "masculine"] as const;

export const SKINS = ["Bronze", "Brown", "Coffee", "Honey", "Ivory", "Peach", "Porcelain", "Tan", "Tawny"] as const;

export const HAIR_COLORS = ["Ash Brown", "Black", "Blonde", "Blue", "Brown", "Charcoal", "Chestnut", "Gray", "Green", "Orange", "Pink", "Platinum", "Purple", "Raven", "Red", "Ruby", "Silver", "Teal", "Violet", "White"] as const;

export const CLOTHING_COLORS = ["Aegean", "Amber", "Amethyst", "Apple", "Apricot", "Azure", "Beige", "Black", "Blue", "Blue Violet", "Bronze", "Brown", "Cerise", "Cerulean", "Charcoal", "Chocolate", "Coffee", "Coral", "Cornflower", "Cyan", "Denim", "Dove", "Emerald", "Fern", "Forest", "Garnet", "Gray", "Green", "Heather", "Honey", "Ice", "Indigo", "Ivory", "Lavender", "Leather", "Lemon", "Linen", "Mauve", "Midnight", "Mint", "Mustard", "Navy", "Neptune", "Oak", "Ochre", "Olivine", "Orange", "Peach", "Pearl", "Periwinkle", "Pink", "Plum", "Porcelain", "Powder", "Purple", "Red", "Red Orange", "Royal", "Salmon", "Sepia", "Shadow", "Silver", "Sky", "Smoke", "Soot", "Spring", "Swamp", "Tan", "Tawny", "Teal", "Tumeric", "Umber", "White", "Wine", "Yellow"] as const;

export const METALS = ["Brass", "Bronze", "Copper", "Gold", "Iron", "Silver", "Steel"] as const;

export const HAIR_STYLES = ["medium-01", "medium-02", "medium-03", "medium-04", "medium-05", "medium-06", "medium-07", "medium-08", "medium-09", "medium-10", "short-01", "short-02", "short-03", "short-04", "short-05", "short-06", "short-07", "short-08"] as const;

export const BEARDS = ["facial-01", "facial-02", "facial-03", "facial-04", "facial-05", "facial-06", "facial-07"] as const;

export const BROWS = ["brows-01", "brows-02"] as const;

export const TOPS = ["shirt-01", "shirt-02", "shirt-03", "shirt-04", "shirt-05", "shirt-06", "shirt-07", "shirt-08", "shirt-09"] as const;

export const LEGS = ["pants-01", "pants-02", "pants-03", "pants-04", "pants-05", "shorts-01", "shorts-02"] as const;

export const FEET = ["shoes", "boots", "socks-ankle", "socks-high"] as const;

export const GLASSES = ["glasses-01", "glasses-02"] as const;

export const RAMPS = {
  "skin": {
    "reference": ["#2a1722", "#95381c", "#ae6b3f", "#d38b59", "#edc5a8", "#f9d5ba", "#f2f7f8", "#ffffff"],
    "named": {
      "Bronze": ["#000000", "#3e111a", "#442725", "#603429", "#7f4c31", "#965b38", "#f2f7f8", "#ffffff"],
      "Brown": ["#000000", "#1a1213", "#2e1f1c", "#442725", "#6b3c2e", "#7f4c31", "#f2f7f8", "#ffffff"],
      "Coffee": ["#000000", "#1a1213", "#2a1722", "#2e1f1c", "#442725", "#603429", "#faece7", "#faece7"],
      "Honey": ["#1a1213", "#3e111a", "#603429", "#7f4c31", "#ae6b3f", "#d38b59", "#f2f7f8", "#ffffff"],
      "Ivory": ["#2a1722", "#99423c", "#cc8665", "#e4a47c", "#f9d5ba", "#faece7", "#f2f7f8", "#ffffff"],
      "Peach": ["#2a1722", "#95381c", "#ae6b3f", "#d38b59", "#edc5a8", "#f9d5ba", "#f2f7f8", "#ffffff"],
      "Porcelain": ["#2a1722", "#99423c", "#e4a47c", "#edc5a8", "#faece7", "#ffffff", "#f2f7f8", "#ffffff"],
      "Tan": ["#2a1722", "#6a1d16", "#965b38", "#c07a4b", "#e4a47c", "#edc5a8", "#f2f7f8", "#ffffff"],
      "Tawny": ["#1a1213", "#6a1d16", "#7f4c31", "#ae6b3f", "#d38b59", "#e4a47c", "#f2f7f8", "#ffffff"],
    },
  },
  "hair": {
    "reference": ["#1a1213", "#2e1f1c", "#442725", "#603429", "#6b3c2e", "#7f4c31"],
    "named": {
      "Ash Brown": ["#2b2511", "#40361d", "#61482c", "#75502d", "#946b44", "#ad844f"],
      "Black": ["#000000", "#0f1218", "#1b192b", "#251f25", "#382b33", "#484152"],
      "Blonde": ["#442725", "#794117", "#a16018", "#d19428", "#f3c35f", "#fdd082"],
      "Blue": ["#101025", "#181842", "#1d2560", "#293982", "#324f9a", "#4273c9"],
      "Brown": ["#1a1213", "#2e1f1c", "#442725", "#603429", "#6b3c2e", "#7f4c31"],
      "Charcoal": ["#000000", "#0f1218", "#251f25", "#382b33", "#52414b", "#5b4f55"],
      "Chestnut": ["#2e1f1c", "#442725", "#603429", "#7f4c31", "#ae6b3f", "#d38b59"],
      "Gray": ["#0f1218", "#1b192b", "#343043", "#4b4b60", "#595e70", "#6a7587"],
      "Green": ["#0d283e", "#19332d", "#25562e", "#468232", "#75a743", "#a8ca58"],
      "Orange": ["#3e111a", "#95381c", "#b54936", "#cf6f30", "#e09c4c", "#f8bc76"],
      "Pink": ["#481945", "#792a53", "#bd5169", "#ef747e", "#ffad97", "#edc5a8"],
      "Platinum": ["#40361d", "#836332", "#af8a35", "#eecc8c", "#f4d7a0", "#fdf5cc"],
      "Purple": ["#101025", "#181842", "#2c2452", "#4c3b64", "#655789", "#7c6ea6"],
      "Raven": ["#000000", "#0f1218", "#1b192b", "#29253a", "#343043", "#484152"],
      "Red": ["#3e111a", "#6a1d16", "#7b2008", "#95381c", "#b54936", "#cf6f30"],
      "Ruby": ["#2a1722", "#3e111a", "#6a1d16", "#7b2008", "#a42600", "#c7341b"],
      "Silver": ["#343043", "#4b4b60", "#6a7587", "#818e97", "#a8b3b8", "#c7cfcc"],
      "Teal": ["#101025", "#0d283e", "#18506f", "#217087", "#2a8598", "#3aafc2"],
      "Violet": ["#2a1722", "#481945", "#5e2043", "#792a53", "#aa3a6a", "#bd5169"],
      "White": ["#484152", "#6f6464", "#958080", "#c4b59f", "#e3e7d3", "#ebede9"],
    },
  },
  "clothing": {
    "reference": ["#172038", "#253a5e", "#3c5e8b", "#4f8fba", "#73bed3", "#a4dddb"],
    "named": {
      "Aegean": ["#0f1218", "#172038", "#253a5e", "#3a5a72", "#4f899d", "#6ca3b3"],
      "Amber": ["#1a1213", "#442725", "#794117", "#a16018", "#d19428", "#f3c35f"],
      "Amethyst": ["#1a1213", "#4c3b64", "#7c6ea6", "#988fba", "#a4b0dc", "#d2d8ef"],
      "Apple": ["#1b192b", "#1c4525", "#30642f", "#468232", "#75a743", "#a8ca58"],
      "Apricot": ["#2a1722", "#99423c", "#ec7456", "#ff8c68", "#ffb186", "#edc5a8"],
      "Azure": ["#1d2560", "#293982", "#324f9a", "#4273c9", "#588de2", "#6bb3f5"],
      "Beige": ["#2a1722", "#99423c", "#e09c4c", "#f8bc76", "#f4d7a0", "#fdf5cc"],
      "Black": ["#000000", "#0f1218", "#1b192b", "#29253a", "#343043", "#484152"],
      "Blue": ["#101025", "#1d2560", "#293982", "#324f9a", "#4273c9", "#588de2"],
      "Blue Violet": ["#2c2452", "#3b428e", "#324f9a", "#636fc7", "#838ad1", "#a4b0dc"],
      "Bronze": ["#000000", "#3e111a", "#442725", "#603429", "#7f4c31", "#965b38"],
      "Brown": ["#000000", "#1a1213", "#2e1f1c", "#442725", "#6b3c2e", "#7f4c31"],
      "Cerise": ["#1a1213", "#481945", "#792a53", "#aa3a6a", "#bd5169", "#ef747e"],
      "Cerulean": ["#0f1218", "#0d283e", "#18506f", "#217087", "#2a8598", "#3aafc2"],
      "Charcoal": ["#000000", "#0f1218", "#251f25", "#382b33", "#52414b", "#5b4f55"],
      "Chocolate": ["#1a1213", "#2b2511", "#40361d", "#61482c", "#75502d", "#946b44"],
      "Coffee": ["#000000", "#1a1213", "#2a1722", "#2e1f1c", "#442725", "#603429"],
      "Coral": ["#1a1213", "#3e111a", "#6a1d16", "#99423c", "#cd543d", "#ec7456"],
      "Cornflower": ["#172038", "#253a5e", "#3c5e8b", "#4f8fba", "#73bed3", "#a4dddb"],
      "Cyan": ["#0d283e", "#18506f", "#217087", "#2a8598", "#3aafc2", "#6cdce7"],
      "Denim": ["#000000", "#0f1218", "#172038", "#253a5e", "#3a5a72", "#4f899d"],
      "Dove": ["#2a1722", "#6f6464", "#958080", "#c4b59f", "#e3e7d3", "#ebede9"],
      "Emerald": ["#0f1218", "#172038", "#19332d", "#1c4525", "#25562e", "#30642f"],
      "Fern": ["#1b192b", "#19332d", "#314829", "#456238", "#5f874d", "#86b278"],
      "Forest": ["#000000", "#0f1218", "#172038", "#19332d", "#314829", "#456238"],
      "Garnet": ["#000000", "#1a1213", "#3e111a", "#591515", "#7b2008", "#95381c"],
      "Gray": ["#1b192b", "#343043", "#4b4b60", "#6a7587", "#818e97", "#a8b3b8"],
      "Green": ["#1b192b", "#19332d", "#1c4525", "#30642f", "#468232", "#5c9a2a"],
      "Heather": ["#2a1722", "#5e3349", "#914d68", "#a1626b", "#ae7771", "#be9694"],
      "Honey": ["#1a1213", "#3e111a", "#603429", "#7f4c31", "#ae6b3f", "#d38b59"],
      "Ice": ["#29253a", "#595e70", "#818e97", "#c7cfcc", "#e0f2f3", "#ffffff"],
      "Indigo": ["#1a1213", "#29253a", "#4c3b64", "#655789", "#7c6ea6", "#988fba"],
      "Ivory": ["#2a1722", "#99423c", "#cc8665", "#e4a47c", "#f9d5ba", "#faece7"],
      "Lavender": ["#1a1213", "#4c3b64", "#988fba", "#a4b0dc", "#d2d8ef", "#e0f2f3"],
      "Leather": ["#1a1213", "#40361d", "#61482c", "#75502d", "#946b44", "#ad844f"],
      "Lemon": ["#2b2511", "#61482c", "#af8a35", "#dbbd00", "#f0e059", "#f4e48d"],
      "Linen": ["#2a1722", "#794117", "#a16018", "#e09c4c", "#f8bc76", "#f4d7a0"],
      "Mauve": ["#1a1213", "#2a1722", "#5e3349", "#914d68", "#a1626b", "#ae7771"],
      "Midnight": ["#000000", "#0f1218", "#172038", "#0d283e", "#253a5e", "#3a5a72"],
      "Mint": ["#19332d", "#456238", "#5f874d", "#86b278", "#adcca6", "#d9f1d8"],
      "Mustard": ["#2b2511", "#40361d", "#61482c", "#836332", "#af8a35", "#bca51c"],
      "Navy": ["#000000", "#0f1218", "#101025", "#1d2560", "#293982", "#324f9a"],
      "Neptune": ["#172038", "#253a5e", "#3a5a72", "#4f899d", "#6ca3b3", "#8abec9"],
      "Oak": ["#1a1213", "#40361d", "#75502d", "#946b44", "#ad844f", "#bf9d5b"],
      "Ochre": ["#2b2511", "#61482c", "#af8a35", "#bca51c", "#dbbd00", "#f0e059"],
      "Olivine": ["#1b192b", "#314829", "#456238", "#5f874d", "#86b278", "#adcca6"],
      "Orange": ["#3e111a", "#95381c", "#b54936", "#cf6f30", "#e09c4c", "#f8bc76"],
      "Peach": ["#2a1722", "#95381c", "#ae6b3f", "#d38b59", "#edc5a8", "#f9d5ba"],
      "Pearl": ["#2a1722", "#6f6464", "#958080", "#ad988e", "#c4b59f", "#d8d4c0"],
      "Periwinkle": ["#2a1722", "#5e3349", "#a1626b", "#ae7771", "#be9694", "#d9ada9"],
      "Pink": ["#2a1722", "#792a53", "#bd5169", "#ef747e", "#f78f8a", "#ffad97"],
      "Plum": ["#1a1213", "#2a1722", "#481945", "#5e2043", "#792a53", "#aa3a6a"],
      "Porcelain": ["#2a1722", "#99423c", "#e4a47c", "#edc5a8", "#faece7", "#ffffff"],
      "Powder": ["#0f1218", "#172038", "#253a5e", "#3c5e8b", "#4f8fba", "#73bed3"],
      "Purple": ["#000000", "#1b192b", "#29253a", "#4c3b64", "#655789", "#7c6ea6"],
      "Red": ["#1a1213", "#3e111a", "#591515", "#7b2008", "#95381c", "#b54936"],
      "Red Orange": ["#3e111a", "#6a1d16", "#95381c", "#b54936", "#cf6f30", "#ff8a00"],
      "Royal": ["#000000", "#101025", "#1d2560", "#293982", "#324f9a", "#4273c9"],
      "Salmon": ["#2a1722", "#6a1d16", "#99423c", "#cd543d", "#ec7456", "#ff8c68"],
      "Sepia": ["#1a1213", "#603429", "#7f4c31", "#ae6b3f", "#e09c4c", "#f8bc76"],
      "Shadow": ["#0f1218", "#29253a", "#343043", "#4b4b60", "#595e70", "#6a7587"],
      "Silver": ["#29253a", "#4b4b60", "#6a7587", "#818e97", "#a8b3b8", "#c7cfcc"],
      "Sky": ["#1d2560", "#324f9a", "#4273c9", "#588de2", "#6bb3f5", "#91cfff"],
      "Smoke": ["#0f1218", "#52414b", "#5b4f55", "#6f6464", "#958080", "#ad988e"],
      "Soot": ["#000000", "#0f1218", "#1a1213", "#2b2511", "#40361d", "#61482c"],
      "Spring": ["#1b192b", "#25562e", "#468232", "#75a743", "#a8ca58", "#d0da91"],
      "Swamp": ["#0f1218", "#172038", "#19332d", "#314829", "#456238", "#5f874d"],
      "Tan": ["#2a1722", "#6a1d16", "#965b38", "#c07a4b", "#e4a47c", "#edc5a8"],
      "Tawny": ["#1a1213", "#6a1d16", "#7f4c31", "#ae6b3f", "#d38b59", "#e4a47c"],
      "Teal": ["#000000", "#172038", "#173a55", "#18506f", "#217087", "#2a8598"],
      "Tumeric": ["#2a1722", "#603429", "#a16018", "#d19428", "#f3c35f", "#f4e48d"],
      "Umber": ["#000000", "#1a1213", "#2b2511", "#40361d", "#61482c", "#75502d"],
      "White": ["#382b33", "#6f6464", "#ad988e", "#d8d4c0", "#ebede9", "#ffffff"],
      "Wine": ["#000000", "#1a1213", "#2a1722", "#3e111a", "#591515", "#6a1d16"],
      "Yellow": ["#442725", "#a16018", "#d19428", "#f3c35f", "#f4e48d", "#fdf5cc"],
    },
  },
  "metal": {
    "reference": ["#1b192b", "#484152", "#726b7e", "#867e7f", "#a8b3b8"],
    "named": {
      "Brass": ["#1b1313", "#3f371e", "#60492c", "#b08a36", "#fcd081"],
      "Bronze": ["#1b1313", "#462825", "#603429", "#794118", "#a26118"],
      "Copper": ["#1b1313", "#6b1d16", "#94381d", "#b54936", "#eb7129"],
      "Gold": ["#291821", "#794118", "#a26118", "#d19529", "#efcd8c"],
      "Iron": ["#000000", "#252025", "#392b34", "#52414a", "#6f6563"],
      "Silver": ["#182039", "#4a4c60", "#6b7588", "#a8b3b8", "#e1f3f4"],
      "Steel": ["#1b192b", "#484152", "#726b7e", "#867e7f", "#a8b3b8"],
    },
  },
} as const;

export const PARTS = {
  "body": {
    "family": "skin",
    "byBody": {
      "feminine": "feminine-body.png",
      "masculine": "masculine-body.png",
    },
  },
  "head": {
    "family": "skin",
    "byBody": {
      "feminine": "feminine-head.png",
      "masculine": "masculine-head.png",
    },
  },
  "medium-01": {
    "family": "hair",
    "file": "medium-01.png",
    "behind": "medium-01-behind.png",
  },
  "medium-02": {
    "family": "hair",
    "file": "medium-02.png",
    "behind": "medium-02-behind.png",
  },
  "medium-03": {
    "family": "hair",
    "file": "medium-03.png",
  },
  "medium-04": {
    "family": "hair",
    "file": "medium-04.png",
  },
  "medium-05": {
    "family": "hair",
    "file": "medium-05.png",
  },
  "medium-06": {
    "family": "hair",
    "file": "medium-06.png",
  },
  "medium-07": {
    "family": "hair",
    "file": "medium-07.png",
  },
  "medium-08": {
    "family": "hair",
    "file": "medium-08.png",
  },
  "medium-09": {
    "family": "hair",
    "file": "medium-09.png",
  },
  "medium-10": {
    "family": "hair",
    "file": "medium-10.png",
  },
  "short-01": {
    "family": "hair",
    "file": "short-01.png",
  },
  "short-02": {
    "family": "hair",
    "file": "short-02.png",
  },
  "short-03": {
    "family": "hair",
    "file": "short-03.png",
  },
  "short-04": {
    "family": "hair",
    "file": "short-04.png",
  },
  "short-05": {
    "family": "hair",
    "file": "short-05.png",
  },
  "short-06": {
    "family": "hair",
    "file": "short-06.png",
  },
  "short-07": {
    "family": "hair",
    "file": "short-07.png",
  },
  "short-08": {
    "family": "hair",
    "file": "short-08.png",
  },
  "facial-01": {
    "family": "hair",
    "file": "facial-01.png",
  },
  "facial-02": {
    "family": "hair",
    "file": "facial-02.png",
  },
  "facial-03": {
    "family": "hair",
    "file": "facial-03.png",
  },
  "facial-04": {
    "family": "hair",
    "file": "facial-04.png",
  },
  "facial-05": {
    "family": "hair",
    "file": "facial-05.png",
  },
  "facial-06": {
    "family": "hair",
    "file": "facial-06.png",
  },
  "facial-07": {
    "family": "hair",
    "file": "facial-07.png",
  },
  "brows-01": {
    "family": "hair",
    "file": "brows-01.png",
  },
  "brows-02": {
    "family": "hair",
    "file": "brows-02.png",
  },
  "shirt-01": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-01.png",
      "masculine": "masculine-shirt-01.png",
    },
  },
  "shirt-02": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-02.png",
      "masculine": "masculine-shirt-02.png",
    },
  },
  "shirt-03": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-03.png",
      "masculine": "masculine-shirt-03.png",
    },
  },
  "shirt-04": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-04.png",
      "masculine": "masculine-shirt-04.png",
    },
  },
  "shirt-05": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-05.png",
      "masculine": "masculine-shirt-05.png",
    },
  },
  "shirt-06": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-06.png",
      "masculine": "masculine-shirt-06.png",
    },
  },
  "shirt-07": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-07.png",
      "masculine": "masculine-shirt-07.png",
    },
  },
  "shirt-08": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-08.png",
      "masculine": "masculine-shirt-08.png",
    },
  },
  "shirt-09": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shirt-09.png",
      "masculine": "masculine-shirt-09.png",
    },
  },
  "cardigan": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-cardigan.png",
      "masculine": "masculine-cardigan.png",
    },
  },
  "suspenders": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-suspenders.png",
      "masculine": "masculine-suspenders.png",
    },
  },
  "pants-01": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-pants-01.png",
      "masculine": "masculine-pants-01.png",
    },
  },
  "pants-02": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-pants-02.png",
      "masculine": "masculine-pants-02.png",
    },
  },
  "pants-03": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-pants-03.png",
      "masculine": "masculine-pants-03.png",
    },
  },
  "pants-04": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-pants-04.png",
      "masculine": "masculine-pants-04.png",
    },
  },
  "pants-05": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-pants-05.png",
      "masculine": "masculine-pants-05.png",
    },
  },
  "shorts-01": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shorts-01.png",
      "masculine": "masculine-shorts-01.png",
    },
  },
  "shorts-02": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shorts-02.png",
      "masculine": "masculine-shorts-02.png",
    },
  },
  "shoes": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-shoes.png",
      "masculine": "masculine-shoes.png",
    },
  },
  "boots": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-boots.png",
      "masculine": "masculine-boots.png",
    },
  },
  "socks-ankle": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-socks-ankle.png",
      "masculine": "masculine-socks-ankle.png",
    },
  },
  "socks-high": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-socks-high.png",
      "masculine": "masculine-socks-high.png",
    },
  },
  "bowtie": {
    "family": "clothing",
    "byBody": {
      "feminine": "feminine-bowtie.png",
      "masculine": "masculine-bowtie.png",
    },
  },
  "glasses-01": {
    "family": "metal",
    "file": "glasses-01.png",
  },
  "glasses-02": {
    "family": "metal",
    "file": "glasses-02.png",
  },
} as const;

export const LAYER_ORDER = ["hair-behind", "body", "feet", "legs", "top", "suspenders", "cardigan", "bowtie", "head", "brows", "beard", "glasses", "hair"] as const;

export const LEGACY = [
  {
    "v": 1,
    "body": "masculine",
    "skin": "Peach",
    "hair": {
      "style": "short-02",
      "color": "Brown",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-09",
      "color": "Cornflower",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Denim",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "feminine",
    "skin": "Bronze",
    "hair": {
      "style": "medium-07",
      "color": "Black",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-07",
      "color": "Coral",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Charcoal",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "masculine",
    "skin": "Coffee",
    "hair": {
      "style": "short-05",
      "color": "Black",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-04",
      "color": "Emerald",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Charcoal",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "feminine",
    "skin": "Peach",
    "hair": {
      "style": "medium-03",
      "color": "Blonde",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-04",
      "color": "Lavender",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Denim",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "masculine",
    "skin": "Tan",
    "hair": {
      "style": "short-04",
      "color": "Chestnut",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-08",
      "color": "Amber",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-04",
      "color": "Charcoal",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "feminine",
    "skin": "Honey",
    "hair": {
      "style": "medium-02",
      "color": "Raven",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-05",
      "color": "Cerulean",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-02",
      "color": "Black",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "masculine",
    "skin": "Ivory",
    "hair": {
      "style": "short-07",
      "color": "Black",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-01",
      "color": "Charcoal",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Beige",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "feminine",
    "skin": "Brown",
    "hair": {
      "style": "medium-09",
      "color": "Black",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-06",
      "color": "Cerise",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Denim",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "masculine",
    "skin": "Porcelain",
    "hair": {
      "style": "short-03",
      "color": "Orange",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-09",
      "color": "Apple",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Charcoal",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "feminine",
    "skin": "Tawny",
    "hair": {
      "style": "medium-04",
      "color": "Brown",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-02",
      "color": "Azure",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-04",
      "color": "Charcoal",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "masculine",
    "skin": "Brown",
    "hair": {
      "style": "medium-06",
      "color": "Black",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-04",
      "color": "Amber",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Denim",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
  {
    "v": 1,
    "body": "feminine",
    "skin": "Porcelain",
    "hair": {
      "style": "medium-08",
      "color": "Pink",
    },
    "brows": null,
    "beard": null,
    "top": {
      "style": "shirt-09",
      "color": "Aegean",
    },
    "cardigan": null,
    "suspenders": null,
    "legs": {
      "style": "pants-03",
      "color": "Black",
    },
    "feet": {
      "style": "shoes",
      "color": "Black",
    },
    "glasses": null,
    "bowtie": null,
  },
] as const;
