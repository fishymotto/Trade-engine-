import type { JSONContent } from "@tiptap/core";
import { hasJournalDocContent } from "../journal/journalContent";
import type { PlaybookRecord } from "../../types/playbook";

const PLAYBOOKS_STORAGE_KEY = "trade-engine-playbooks";
const DEFAULT_PLAYBOOK_ID = "wide-spread-open-drive";
const SEEDED_PLAYBOOK_NAMES = [
  "Earning",
  "Imbalance number NY/NQ Scalping",
  "Imbalance Number NY into MOC print",
  "Imbalance Number NQ into MOC print",
  "6/12 EMA Cross",
  "Range Trade",
  "Trend Trade",
  "Momentum Scalping",
  "Gap and Give",
  "Gap and GO",
  "Gap Give and Go",
  "Data Drop Drive",
  "Wiggle and Jiggle Big Size Tickle"
] as const;

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : undefined
});

const heading = (level: 2 | 3, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }]
});

const bulletList = (items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((item) => ({
    type: "listItem",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: item }]
      }
    ]
  }))
});

const checklist = (items: string[]): JSONContent => ({
  type: "taskList",
  content: items.map((item) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: item }]
      }
    ]
  }))
});

const doc = (...nodes: JSONContent[]): JSONContent => ({
  type: "doc",
  content: nodes
});

const isPlaybookRecord = (value: unknown): value is PlaybookRecord =>
  Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "name" in value &&
      "sections" in value &&
      Array.isArray((value as PlaybookRecord).sections)
  );

const normalizeName = (value: string): string => value.trim().toLowerCase();
const slugify = (value: string): string =>
  normalizeName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isLegacySection = (sectionId: string): boolean => sectionId === "performance-snapshot";

const createBlankPlaybookSections = (): PlaybookRecord["sections"] => [
  {
    id: "why-this-works",
    title: "Why This Works",
    description: "The underlying edge and what order-flow condition creates it.",
    content: doc(paragraph(""))
  },
  {
    id: "market-context",
    title: "Market Context",
    description: "What market, name, and time window make this play valid.",
    content: doc(paragraph(""))
  },
  {
    id: "entry-and-execution",
    title: "Entry And Execution",
    description: "How the setup is entered, managed, and confirmed.",
    content: doc(paragraph(""))
  },
  {
    id: "risk-and-exits",
    title: "Risk And Exits",
    description: "Invalidation, trade management, and where the play should pay.",
    content: doc(paragraph(""))
  }
];

const isBlankContent = (content: JSONContent): boolean => {
  if (!content || content.type !== "doc") {
    return true;
  }

  const nodes = content.content ?? [];
  if (nodes.length === 0) {
    return true;
  }

  return nodes.every((node) => {
    if (node.type !== "paragraph") {
      return false;
    }

    const childNodes = node.content ?? [];
    return childNodes.length === 0;
  });
};

const createPlaceholderPlaybook = (name: string): PlaybookRecord => {
  const timestamp = new Date().toISOString();

  return {
    id: slugify(name),
    name,
    aliases: [name],
    description: "Build this playbook out with your rules, examples, and chart notes.",
    focus: "Define the setup clearly, then connect tagged trades and examples over time.",
    screenshotUrls: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    sections: createBlankPlaybookSections()
  };
};

const createDefaultWideSpreadOpenDrive = (): PlaybookRecord => {
  const timestamp = new Date().toISOString();

  return {
    id: DEFAULT_PLAYBOOK_ID,
    name: "Wide Spread Open Drive",
    aliases: [
      "Wide Spread Open Drive",
      "Wide-Spread Open Drive",
      "Opening Drive Wide Spread"
    ],
    description:
      "Catalyst-driven open trade where the spread widens, the bid holds and reloads, and price grinds higher through midpoint acceptance.",
    focus:
      "Trade the forced repricing around the open when thin liquidity meets real urgency, not a random chart pattern.",
    screenshotUrls: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    sections: [
      {
        id: "why-this-works",
        title: "Why This Works",
        description: "The underlying edge and what order-flow condition creates it.",
        content: doc(
          paragraph(
            "This is an open trade that shows up when liquidity is thin, and someone has urgency. We get a catalyst, usually crude pushing, sometimes news, and liquidity providers back up so the spread widens. The edge is when the spread widens, but the bid does not collapse. That is the tell that demand is real. Price rip in with speed, once the inventory has to get rebalanced, and the path of least resistance is up. We are trading order flow pressure during forced repricing, not a chart pattern."
          )
        )
      },
      {
        id: "market-context",
        title: "Market Context",
        description: "What market, name, and time window make this play valid.",
        content: doc(
          heading(3, "What I'm Looking For"),
          paragraph(
            "A catalyst driven open where the spread widens, the bid holds and reloads, and price grinds higher through midpoint acceptance."
          ),
          heading(3, "Universe"),
          paragraph("Primary name is CVE.NY"),
          paragraph(
            "This is designed for low liquidity names where the open is thin, and spreads can widen without the bid collapsing. ( still seeing if we can transfer this anywhere else)"
          ),
          heading(3, "Best Time of Day"),
          paragraph("09:30 to 09:35."),
          paragraph("entries after 09:31 have finished printing."),
          paragraph("After 09:35 this becomes a different trade. If you miss it, you miss it.")
        )
      },
      {
        id: "visual-tells-and-definitions",
        title: "Visual Tells And Definitions",
        description: "What the tape and spread should look like when the setup is real.",
        content: doc(
          heading(3, "Key Visual Tells"),
          bulletList([
            "Wide spread but stable, 3 to 15 cents.",
            "Bid holds the level, does not bleed down.",
            "Bid reloads, meaning size steps in and grows.",
            "Ask side is lightly posted, meaning a real buyer can move price without needing huge size.",
            "Midpoint prints show up closer to the ask.",
            "Tape is controlled and stubborn, not fast and violent."
          ]),
          heading(3, "Definitions"),
          bulletList([
            "Wide spread: 3 to 15 cents.",
            "Stable spread: bid holds for at least 15 seconds without slipping lower.",
            "Bid reload: size steps into the bid and grows after getting hit.",
            "Too fast: if already have liquidity pop, edge is gone because repricing has already happened."
          ])
        )
      },
      {
        id: "correlation-and-liquidity",
        title: "Correlation And Liquidity",
        description: "How XLE, CL, levels, and tape quality guide the trade.",
        content: doc(
          heading(3, "Correlation Rules"),
          bulletList([
            "XLE first.",
            "XLE carries more weight than CL.",
            "Ideal is correlation on the opening minute.",
            "If XLE disagrees, follow XLE."
          ]),
          heading(3, "Levels"),
          paragraph("Anchor level is premarket high on CVE."),
          paragraph("Low premarket volume means I still need tape confirmation."),
          paragraph("VWAP does not matter here, this is a first five minutes trade."),
          heading(3, "Liquidity"),
          paragraph(
            "This requires thin liquidity and controlled tape. If prints are aggressive off open and price is moving cleanly without resistance, the edge disappears."
          ),
          heading(3, "XLE Tape"),
          paragraph("Strong green flow in XLE with continuation."),
          paragraph(
            "Red prints can absorb or push lower, but must recover in 10 to 20 seconds."
          )
        )
      },
      {
        id: "entry-and-execution",
        title: "Entry And Execution",
        description: "The exact trigger and how orders should be managed.",
        content: doc(
          heading(3, "Entry Trigger"),
          paragraph("Primary entry midpoint or pegged midpoint after all are true:"),
          bulletList([
            "Bid holds for at least 15 seconds.",
            "Ask refreshes without sweeping the bid.",
            "XLE continues on tape in same direction and CL is not fighting it.",
            "Tape is controlled, not fast.",
            "I am waiting for acceptance, not momentum."
          ]),
          heading(3, "How I Execute"),
          bulletList([
            "Route SUPR, one cent above the bid.",
            "Order does not sit longer than 10 seconds.",
            "If not filled, cancel, reset, re wait.",
            "Max attempts per idea is 2.",
            "One clip only, no adds."
          ])
        )
      },
      {
        id: "risk-targets-and-stalling",
        title: "Risk, Targets, And Stalling",
        description: "How the setup fails, where it should pay, and when to tighten.",
        content: doc(
          heading(3, "Stop Rule"),
          paragraph(
            "Exit immediately if bid steps down and breaks entry level or if more than three consecutive 1000-share hits go into the bid with no reload."
          ),
          heading(3, "Targets"),
          paragraph("Higher of 09:29 candle high or opening minute candle high."),
          paragraph(
            "If that is not in play, next targets can be premarket high extension or yesterday's high."
          ),
          paragraph("Typical payout is 18 to 26 cents."),
          heading(3, "Time Check And Stalling"),
          paragraph("60 to 90 seconds."),
          paragraph(
            "If CVE is green but stalling, pull target down and take what the market offers."
          ),
          paragraph(
            "If CL or XLE lose the push and price stops progressing, punch out and do not let it turn into a slow drift."
          )
        )
      },
      {
        id: "routing-and-stay-out",
        title: "Routing Notes And Stay-Out Rules",
        description: "Operational notes and conditions that kill the setup.",
        content: doc(
          heading(3, "Routing Notes"),
          bulletList([
            "FREX emergency exits with far order 0.03.",
            "ARCA or NYSE for posting based on opening prints."
          ]),
          heading(3, "When To Stay Out"),
          bulletList([
            "Bid is slipping instead of holding.",
            "CL and XLE are messy or disagreeing.",
            "Repeated bid sweeps keep hitting without reload.",
            "You are chasing the midpoint instead of waiting for acceptance.",
            "There is a volume spike without actual advance.",
            "Tape is fast and violent instead of controlled."
          ]),
          heading(3, "Short Version"),
          paragraph("Same setup, inverted.")
        )
      },
      {
        id: "trade-criteria-checklist",
        title: "Trade Criteria Checklist",
        description: "Quick checklist for the setup before taking it.",
        content: doc(
          checklist([
            "CL trending cleanly on the 1 minute.",
            "XLE trending cleanly on the 1 minute.",
            "Wait for the breath into XLE.",
            "XLE must be trending and clearing price.",
            "Spread is wide but stable.",
            "Bid is holding the level or stepping up.",
            "Prints occurring at midpoint or closer to the ask.",
            "No aggressive bid sweeps.",
            "Tape is controlled, not fast."
          ])
        )
      },
    ]
  };
};

const createDefaultImbalanceNumberScalping = (): PlaybookRecord => {
  const timestamp = new Date().toISOString();

  return {
    id: "imbalance-number-ny-nq-scalping",
    name: "Imbalance number NY/NQ Scalping",
    aliases: [
      "Imbalance number NY/NQ Scalping",
      "Imbalance Number NY/NQ Scalping",
      "Imbalance Numbers",
      "Broker Imbalance Numbers",
      "Buy Imbalance",
      "Sell Imbalance"
    ],
    description:
      "Large NYSE/Nasdaq closing imbalance trade focused on names where the imbalance is meaningful versus liquidity and cannot fully pair off before the close.",
    focus:
      "Use the 3:00 locator for idea generation, then react to the 3:50 and 3:55 imbalance windows only when the notional size is still real and the market has not fully paired it away.",
    screenshotUrls: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    sections: [
      {
        id: "why-this-works",
        title: "Why This Works",
        description: "The underlying edge and why a real imbalance can move price into the close.",
        content: doc(
          paragraph(
            "The ideal scenario is a stock showing a large imbalance print. The edge is in names where the notional size is meaningful relative to the name's normal liquidity and the imbalance cannot fully pair off before the close."
          ),
          paragraph(
            "If the imbalance stays large into the 3:50 and 3:55 updates, participants are forced to react. The move we want is the repricing that happens when the market still has real closing business left to match."
          )
        )
      },
      {
        id: "notional-size-that-matters",
        title: "Notional Size That Matters",
        description: "How to judge whether the imbalance is large enough to matter.",
        content: doc(
          paragraph(
            "Use the Closing Imbalance Notional Tracker as the main size reference."
          ),
          bulletList([
            "Large notional size gets top priority.",
            "The imbalance should be meaningful relative to the stock's normal liquidity.",
            "Ideally imbalance shares are near or above the stock's average daily volume.",
            "Current rough minimum is around 50 percent of average daily volume, though that can evolve with more data."
          ]),
          paragraph(
            "The more the imbalance pairs off, the less edge remains. If it fully pairs off early, expect less impact."
          ),
          paragraph(
            "If the imbalance flips at 3:55, priority shifts to another name that still has a real imbalance rather than forcing the original trade."
          )
        )
      },
      {
        id: "what-im-looking-for",
        title: "What I'm Looking For",
        description: "The core conditions that put a name on the focus list.",
        content: doc(
          bulletList([
            "Single name under $50 showing a large, persistent imbalance.",
            "First filter happens at 3:00 broker numbers to build the short list.",
            "If it is an event rebalance, prep the day before and have the names ready to plug in.",
            "Deletions are ideal because they are usually easier to trade.",
            "At 3:50 and 3:55, prioritize the names with enough notional size that they are hard to fully pair.",
            "If a name was not already on the short list but jumps to the top of the overall market list by CntPX*Sz, it can become the top focus idea."
          ])
        )
      },
      {
        id: "timing-rules",
        title: "Timing Rules",
        description: "When prep happens and when the windows are actually live.",
        content: doc(
          heading(3, "Time Of Day"),
          bulletList([
            "3:00 idea phase and imbalance locator setup",
            "3:50 to 3:55 first trade window",
            "3:55 to 3:59:30 second trade window"
          ]),
          heading(3, "Operational Rules"),
          bulletList([
            "Prep is done by 3:00 after the afternoon Zoom call.",
            "Focus list is built and all imbalance locators are set up before the trade window.",
            "Always flat before 3:50.",
            "Hard flat time is 3:59:35 with no exceptions."
          ])
        )
      },
      {
        id: "entry-and-execution",
        title: "How I Execute",
        description: "Routing, attempts, and how the trade is actually handled.",
        content: doc(
          paragraph(
            "Primary routing is a dark gateway with an aggressive order, using FREX or SUPR midpoint for entry, while posting on ARCA or the ticker exchange gateway."
          ),
          heading(3, "Attempts Per Window"),
          bulletList([
            "Up to two attempts off the 3:50 update",
            "Up to two attempts off the 3:55 update"
          ]),
          heading(3, "Execution Notes"),
          bulletList([
            "This is still a scalp, not a hold-into-close idea.",
            "If a name is pairing too fast, do not keep stabbing at it.",
            "The second window is there to react to fresh information, not to force a losing idea."
          ])
        )
      },
      {
        id: "risk-and-exits",
        title: "Stops, Targets, And Stay-Out Rules",
        description: "How the trade fails, what it should pay, and when to pass entirely.",
        content: doc(
          heading(3, "Stop Rule"),
          bulletList([
            "Price slams the other way with speed.",
            "The imbalance flips against the trade."
          ]),
          heading(3, "Targets"),
          bulletList([
            "Profit target is generally a 3 to 10 cent pop, adjusted to the name and its daily ATR or range high.",
            "B-size setup targets are tighter, around 3 to 4 cents.",
            "A-size setup targets can be 5 to 10 cents.",
            "Typical hold time is up to 3 minutes.",
            "Holding into 4:00 is not allowed right now."
          ]),
          heading(3, "When To Stay Out"),
          bulletList([
            "If the imbalance keeps pairing off, the impact will be reduced; do not force it.",
            "If the imbalance flips, the trade is invalid for the original direction."
          ])
        )
      },
      {
        id: "imbalance-locator-watchouts",
        title: "Imbalance Locator Watchouts",
        description: "Operational issues and edge cases to watch for in the locator itself.",
        content: doc(
          paragraph(
            "When CntPX shows 2147.48, treat it as a bug and do rough math manually because CntPX*Sz will be incorrect."
          ),
          paragraph(
            "In those cases, rely on the rough notional estimate and compare it against the actual stock price rather than blindly trusting the locator output."
          ),
          checklist([
            "Check whether CntPX looks broken",
            "Recalculate rough notional manually if needed",
            "Confirm the imbalance is still meaningful after correcting the bug",
            "Do not over-prioritize a name because of bad locator math"
          ])
        )
      }
    ]
  };
};

const createDefault612EmaCross = (): PlaybookRecord => {
  const timestamp = new Date().toISOString();

  return {
    id: "6-12-ema-cross",
    name: "6/12 EMA Cross",
    aliases: ["6/12 EMA Cross", "6/12 EMA", "EMA Cross"],
    description:
      "A momentum continuation or reversal trigger built around the 6 EMA crossing the 12 EMA with price, tape, and context aligned.",
    focus:
      "Use the cross as confirmation, not the whole thesis. The setup works best when the EMAs line up with price structure, tape pressure, and a clear intraday context.",
    screenshotUrls: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    sections: [
      {
        id: "why-this-works",
        title: "Why This Works",
        description: "What the EMA cross is really telling you.",
        content: doc(
          paragraph(
            "The 6/12 cross is useful because it shows a short-term momentum handoff that is visible and repeatable. The real edge is not the indicator by itself. The edge is when the cross confirms a change in control that is already happening through structure, tape, and order flow."
          ),
          paragraph(
            "When the cross happens cleanly after a pullback, reclaim, or trend compression, it gives a simple way to join momentum without guessing too early."
          )
        )
      },
      {
        id: "market-context",
        title: "Market Context",
        description: "Where the setup works best and where it should be ignored.",
        content: doc(
          heading(3, "Best Uses"),
          bulletList([
            "Trend continuation after a pullback.",
            "Opening momentum names once the first consolidation is clear.",
            "Names reclaiming VWAP, premarket high/low, or a key intraday level."
          ]),
          heading(3, "Avoid When"),
          bulletList([
            "The chart is flat and choppy.",
            "The EMAs are crossing repeatedly in a tight range.",
            "There is no level, catalyst, or tape pressure behind the move."
          ]),
          heading(3, "Timeframes"),
          bulletList([
            "Best on the primary execution timeframe you already review on.",
            "Crosses matter more when the higher timeframe agrees with the direction."
          ])
        )
      },
      {
        id: "entry-and-execution",
        title: "Entry And Execution",
        description: "How to treat the cross like a trigger instead of a magic signal.",
        content: doc(
          heading(3, "Entry Logic"),
          bulletList([
            "Wait for the 6 EMA to cross and hold above the 12 EMA for longs, or below for shorts.",
            "Price should be accepting above the cross area, not instantly failing it.",
            "Tape should support the move instead of fighting it."
          ]),
          heading(3, "Good Confirmations"),
          bulletList([
            "Reclaim of VWAP or a known intraday level.",
            "A higher low before the bullish cross or lower high before the bearish cross.",
            "Volume expansion on the trigger candle."
          ]),
          heading(3, "Execution Notes"),
          bulletList([
            "Do not chase a cross after two or three extension bars.",
            "If entering on the first pullback after the cross, make sure the EMAs stay stacked correctly.",
            "Use the cross as a timing tool, not as the only reason to be in the trade."
          ])
        )
      },
      {
        id: "risk-and-exits",
        title: "Risk And Exits",
        description: "How the setup fails and how to manage it once you are in.",
        content: doc(
          heading(3, "Invalidation"),
          bulletList([
            "Price loses the cross area immediately.",
            "The 6 EMA rolls back through the 12 EMA without follow-through.",
            "The move stalls into a known resistance/support zone and tape dries up."
          ]),
          heading(3, "Management"),
          bulletList([
            "Take partials into the first clean extension when the trade is fast.",
            "Hold more only if the EMAs stay stacked and structure keeps trending.",
            "If the cross fails quickly, get out quickly."
          ]),
          heading(3, "Checklist"),
          checklist([
            "Cross is aligned with structure",
            "Cross is aligned with tape",
            "There is room to target",
            "Not chasing extension",
            "Clear invalidation level exists"
          ])
        )
      }
    ]
  };
};

const ensureDefaultPlaybook = (playbooks: PlaybookRecord[]): PlaybookRecord[] => {
  const seededPlaybooks = [
    createDefaultWideSpreadOpenDrive(),
    createDefaultImbalanceNumberScalping(),
    createDefault612EmaCross()
  ];

  const existingIds = new Set(playbooks.map((playbook) => playbook.id));
  const withDefaults = [
    ...seededPlaybooks.filter((playbook) => !existingIds.has(playbook.id)),
    ...playbooks
  ];

  const existingNames = new Set(withDefaults.map((playbook) => normalizeName(playbook.name)));
  const seededPlaceholders = SEEDED_PLAYBOOK_NAMES.filter(
    (name) => !existingNames.has(normalizeName(name))
  ).map((name) => createPlaceholderPlaybook(name));

  return [...withDefaults, ...seededPlaceholders];
};

const isPlaceholderDescription = (playbook: PlaybookRecord): boolean =>
  playbook.description ===
  "Build this playbook out with your rules, examples, and chart notes.";

const isMostlyBlankPlaybook = (playbook: PlaybookRecord): boolean =>
  playbook.sections.length > 0 && playbook.sections.every((section) => isBlankContent(section.content));

const hydrateSeededPlaybooks = (playbooks: PlaybookRecord[]): PlaybookRecord[] => {
  const seedMap = new Map<string, PlaybookRecord>([
    [DEFAULT_PLAYBOOK_ID, createDefaultWideSpreadOpenDrive()],
    ["imbalance-number-ny-nq-scalping", createDefaultImbalanceNumberScalping()],
    ["6-12-ema-cross", createDefault612EmaCross()]
  ]);

  return playbooks.map((playbook) => {
    const seeded = seedMap.get(playbook.id);
    if (!seeded) {
      return playbook;
    }

    if (!isPlaceholderDescription(playbook) && !isMostlyBlankPlaybook(playbook)) {
      return playbook;
    }

    return {
      ...seeded,
      createdAt: playbook.createdAt,
      updatedAt: playbook.updatedAt,
      screenshotUrls: playbook.screenshotUrls.length > 0 ? playbook.screenshotUrls : seeded.screenshotUrls
    };
  });
};

export const loadPlaybooks = (): PlaybookRecord[] => {
  if (typeof window === "undefined") {
    return [createDefaultWideSpreadOpenDrive()];
  }

  try {
    const rawValue = window.localStorage.getItem(PLAYBOOKS_STORAGE_KEY);
    if (!rawValue) {
      return [createDefaultWideSpreadOpenDrive()];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [createDefaultWideSpreadOpenDrive()];
    }

    const playbooks = parsed
      .filter(isPlaybookRecord)
      .map((playbook) => ({
        ...playbook,
        screenshotUrls: Array.isArray((playbook as { screenshotUrls?: unknown }).screenshotUrls)
          ? ((playbook as { screenshotUrls?: unknown[] }).screenshotUrls ?? []).filter(
              (value): value is string => typeof value === "string"
            )
          : [],
        sections: playbook.sections
          .filter((section) => !isLegacySection(section.id))
          .map((section) => ({
            ...section,
            content: hasJournalDocContent(section.content)
              ? section.content
              : paragraph("")
          }))
      }));

    return hydrateSeededPlaybooks(ensureDefaultPlaybook(playbooks));
  } catch {
    return [createDefaultWideSpreadOpenDrive()];
  }
};

export const savePlaybooks = (playbooks: PlaybookRecord[]) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PLAYBOOKS_STORAGE_KEY, JSON.stringify(playbooks));
};

export const updatePlaybookSectionContent = (
  playbooks: PlaybookRecord[],
  playbookId: string,
  sectionId: string,
  content: JSONContent
): PlaybookRecord[] =>
  playbooks.map((playbook) => {
    if (playbook.id !== playbookId) {
      return playbook;
    }

    return {
      ...playbook,
      updatedAt: new Date().toISOString(),
      sections: playbook.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              content
            }
          : section
      )
    };
  });

export const updatePlaybookScreenshotUrls = (
  playbooks: PlaybookRecord[],
  playbookId: string,
  screenshotUrls: string[]
): PlaybookRecord[] =>
  playbooks.map((playbook) => {
    if (playbook.id !== playbookId) {
      return playbook;
    }

    return {
      ...playbook,
      updatedAt: new Date().toISOString(),
      screenshotUrls
    };
  });

export const addPlaybookRecord = (
  playbooks: PlaybookRecord[],
  name: string
): { playbooks: PlaybookRecord[]; playbookId: string } => {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { playbooks, playbookId: "" };
  }

  const existing = playbooks.find(
    (playbook) => normalizeName(playbook.name) === normalizeName(trimmedName)
  );
  if (existing) {
    return { playbooks, playbookId: existing.id };
  }

  const newPlaybook = createPlaceholderPlaybook(trimmedName);
  return {
    playbooks: [newPlaybook, ...playbooks],
    playbookId: newPlaybook.id
  };
};
