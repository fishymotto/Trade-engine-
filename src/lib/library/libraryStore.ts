import { createEmptyJournalDoc } from "../journal/journalContent";
import type { JSONContent } from "@tiptap/core";
import type {
  LibraryCollectionDefinition,
  LibraryCollectionId,
  LibraryPageRecord
} from "../../types/library";

const STORAGE_KEY = "trade-engine-library-pages";
const SEED_VERSION_KEY = "trade-engine-library-seed-version";
const CURRENT_SEED_VERSION = "notion-book-club-v5";

export const libraryCollections: LibraryCollectionDefinition[] = [
  {
    id: "idea-inbox",
    name: "Idea Inbox",
    description: "Quick captures, future app ideas, and loose trading thoughts before they have a home.",
    accent: "Inbox"
  },
  {
    id: "book-club",
    name: "Book Club",
    description: "Book notes, takeaways, mental models, and lessons you want to bring back into trading.",
    accent: "Reading"
  },
  {
    id: "trading-notes",
    name: "Trading Notes",
    description: "Long-form notes, lessons, mental game work, and observations that are bigger than one day.",
    accent: "Notes"
  },
  {
    id: "replay",
    name: "Replay",
    description: "Replay sessions, what you saw, what you missed, and what should be repeated.",
    accent: "Review"
  },
  {
    id: "signal-mapping",
    name: "Signal Mapping",
    description: "Mapped signals, triggers, context clues, and the conditions that make them worth acting on.",
    accent: "Signals"
  }
];

const createId = () => `library-${Math.random().toString(36).slice(2, 10)}`;

const nowIso = () => new Date().toISOString();
const SEED_TIMESTAMP = "2026-04-11T00:00:00.000Z";

const normalizeCollectionId = (value: string): LibraryCollectionId =>
  libraryCollections.some((collection) => collection.id === value)
    ? (value as LibraryCollectionId)
    : "idea-inbox";

const createStarterPage = (
  collectionId: LibraryCollectionId,
  title: string,
  tags: string[] = []
): LibraryPageRecord => {
  const timestamp = nowIso();
  return {
    id: createId(),
    collectionId,
    title,
    status: "Active",
    tags,
    sourceUrl: "",
    content: createEmptyJournalDoc(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const textNode = (text: string): JSONContent => ({
  type: "text",
  text
});

const paragraph = (text = ""): JSONContent => ({
  type: "paragraph",
  content: text ? [textNode(text)] : undefined
});

const heading = (level: 1 | 2 | 3, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [textNode(text)]
});

const bulletList = (items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((item) => ({
    type: "listItem",
    content: [paragraph(item)]
  }))
});

const orderedList = (items: string[]): JSONContent => ({
  type: "orderedList",
  content: items.map((item) => ({
    type: "listItem",
    content: [paragraph(item)]
  }))
});

const detailsBlock = (summary: string, content: JSONContent[]): JSONContent => ({
  type: "details",
  attrs: { open: true },
  content: [
    {
      type: "detailsSummary",
      content: [textNode(summary)]
    },
    {
      type: "detailsContent",
      content
    }
  ]
});

const doc = (content: JSONContent[]): JSONContent => ({
  type: "doc",
  content
});

const createSeedPage = (
  id: string,
  collectionId: LibraryCollectionId,
  title: string,
  tags: string[],
  sourceUrl: string,
  content: JSONContent,
  properties: LibraryPageRecord["properties"] = undefined
): LibraryPageRecord => ({
  id,
  collectionId,
  title,
  status: "Imported",
  tags,
  sourceUrl,
  properties,
  content,
  createdAt: SEED_TIMESTAMP,
  updatedAt: SEED_TIMESTAMP
});

const createBookRowPage = (
  notionId: string,
  title: string,
  author: string,
  readingStatus: string,
  rating: string,
  genres: string[],
  note = "",
  summary = ""
): LibraryPageRecord =>
  createSeedPage(
    `notion-book-row-${notionId}`,
    "book-club",
    title,
    ["book-row", "notion-import", ...genres.map((genre) => genre.toLowerCase())],
    `https://www.notion.so/${notionId}`,
    doc([
      heading(1, title),
      paragraph(author ? `Author: ${author}` : ""),
      paragraph(note || "Imported from the Trading and Poker Books database. Add review notes, takeaways, and trading applications here.")
    ]),
    {
      Author: author,
      "Reading Status": readingStatus,
      Rating: rating,
      Genre: genres,
      Review: note,
      Summary: summary
    }
  );

const notionBookRows: LibraryPageRecord[] = [
  createBookRowPage("269c45aecf49804cbd2efdb5ad934e73", "The Art of Thinking Clearly", "Rolf Dobelli", "Completed", "3", [
    "Psychology",
    "Behavioral Finance",
    "Light"
  ]),
  createBookRowPage("269c45aecf4980798124f721e9395ec9", "The Playbook", "Mike Bellafiore", "Completed", "5", [
    "Strategy & Tactics",
    "Execution"
  ]),
  createBookRowPage(
    "269c45aecf4980bd9c43edb02305255c",
    "Trading in the Zone",
    "Mark Douglas",
    "Completed",
    "2",
    ["Psychology", "Classic", "Mindset"],
    "A cornerstone trading psychology book. Your Notion review notes call out that the message is useful, but some analogies felt repetitive."
  ),
  createBookRowPage(
    "269c45aecf498092962cc7e4702f1a73",
    "Trading Psychology 2.0",
    "Brett N. Steenbarger",
    "Completed",
    "2",
    ["Psychology", "Performance", "Mindset"],
    "Useful process-focused trading psychology ideas, but your Notion review says it felt dense, repetitive, and less engaging than stronger books in the category."
  ),
  createBookRowPage("285c45aecf49801296caf29efac10adc", "The Gap and the Gain", "", "Completed", "", [
    "Mindset",
    "Psychology"
  ]),
  createBookRowPage("269c45aecf4980eeb2d4c7561258ae1d", "The Black Swan", "Nassim Taleb", "To Read", "", [
    "Macro & Fundamentals",
    "Market Philosophy",
    "Risk Management"
  ]),
  createBookRowPage("269c45aecf4980318b39fad4c9f61b6f", "The Mental Game of Poker", "Carter and Jared Tendler", "Completed", "5", [
    "Psychology",
    "Tilt Control",
    "Mindset"
  ], "A practical mental-game book that translated directly into trading, especially the Tilt Profile, A/B/C-game work, and the Inchworm learning model."),
  createBookRowPage("25dc45aecf4980a7833cdd913bce922f", "Atomic Habits", "James Clear", "Completed", "5", [
    "Habit Formation",
    "Psychology"
  ], "A practical habit-building book centered on systems over goals, identity-based habits, habit stacking, and making behavior change obvious, attractive, easy, and satisfying.", "Small consistent actions compound. Build systems that vote for the identity you want, then reduce friction with tools like habit stacking, the Two-Minute Rule, and visual tracking."),
  createBookRowPage("25dc45aecf498077a8a3dc557dd444d1", "Alpha Trader", "Brent Donnelly", "Completed", "5", [
    "Market History",
    "Behavioral Finance",
    "Classic"
  ], "A dense but highly recommended professional trading book. Your notes call it one of the better day-trading reads because it digs into mindset, process, execution, risk, preparation, and longevity.", "The book is organized around mindset, methodology, mathematics, adaptation, and attitude. Core ideas include self-awareness, process over outcome, expected value, microstructure, narrative, and continuous adaptation."),
  createBookRowPage("269c45aecf4980c9a2b5d8a172f2bf26", "Reminiscences of a Stock Operator", "Edwin Lefevre", "Completed", "6", [
    "Classic",
    "Psychology",
    "Biography"
  ], "A timeless trading classic built around Jesse Livermore/Larry Livingston. Your notes highlight patience, emotional control, adaptation, risk management, and the cost of hubris.", "Major lessons: sit tight when the trade is right, adapt as markets change, avoid tips and crowd thinking, manage risk first, and respect the psychological toll of speculation."),
  createBookRowPage("269c45aecf4980b98910f67739c7440b", "Technical Analysis Explained", "Martin J. Pring", "Completed", "3", [
    "Outdated",
    "Technical Analysis"
  ], "A comprehensive technical-analysis textbook. Your notes call it thorough and useful for historical/foundational context, but somewhat outdated for modern traders.", "Covers chart construction, trends, trendlines, reversals, continuation patterns, volume, moving averages, oscillators, relative strength, cycles, sentiment, point-and-figure, Elliott Wave, and intermarket analysis."),
  createBookRowPage("25dc45aecf4980138766c48904cd5f5b", "A Random Walk Down Wall Street", "Burton Malkiel", "Completed", "4", [
    "Strategy & Tactics",
    "Psychology",
    "Execution & Microstructure",
    "Classic"
  ], "A classic investing book that breaks down market efficiency, bubbles, investor psychology, diversification, indexing, and long-term discipline in an accessible way.", "Key ideas: markets are difficult to beat consistently, speculation repeats through history, diversification matters, low-cost index exposure is hard to beat, and emotional investing hurts returns."),
  createBookRowPage("269c45aecf4980ef8e68daf213dcf8d6", "Flash Boys: A Wall Street Revolt", "Michael Lewis", "Completed", "5", [
    "Microstructure",
    "Classic"
  ], "A gripping, hard-to-put-down look at high-frequency trading, market structure, speed, and fairness in modern markets."),
  createBookRowPage("269c45aecf49803195e5db8502c8a781", "The Hour Between Dog and Wolf", "John Coates", "Completed", "4", [
    "Behavioral Finance",
    "Psychology",
    "Strategy & Tactics"
  ], "A fascinating but dense book on how biology, hormones, stress, and risk-taking shape trader behavior."),
  createBookRowPage("25dc45aecf4980b39abec72c796904cf", "How to Day Trade for a Living", "Andrew Aziz", "Completed", "1", [
    "Outdated"
  ], "A beginner-friendly day trading intro, but your notes say it mostly rehashes basic concepts and lacks depth for someone past the very early stage.", "Covers basic terms, platform setup, beginner strategies, stop-losses, position sizing, and basic psychology, but does not go deep enough for advanced review."),
  createBookRowPage("269c45aecf49807eb221f7c54e0bb597", "Hold'em Wisdom for All Players", "Daniel Negreanu", "Completed", "3", [
    "Poker",
    "Strategy & Tactics",
    "Beginner-Friendly"
  ], "Your first poker book. Solid for beginners and useful for Texas Hold'em strategy even if it is not the most polished read."),
  createBookRowPage("269c45aecf4980d1a5c6fd122f8efc69", "Thinking in Bets", "Annie Duke", "Completed", "2", [
    "Decision-Making",
    "Poker",
    "Behavioral Finance"
  ], "Strong premise around probabilistic thinking, but your Notion review says the poker analogy becomes repetitive after the early chapters."),
  createBookRowPage("25dc45aecf498041a002f27305fdca3b", "One Good Trade", "Mike Bellafiore", "Completed", "4", [
    "Strategy & Tactics",
    "Execution"
  ], "A process-first trading book focused on making one high-quality decision at a time. Your notes highlight preparation, journaling, building a PlayBook, emotional control, and reps.", "Core framework: define one good trade, build a PlayBook, get repetitions, review daily, coach yourself, and compound quality execution instead of chasing outcomes."),
  createBookRowPage("269c45aecf4980dfbf55e79a9781131c", "Super System", "Doyle Brunson", "Completed", "5", [
    "Classic",
    "Poker Strategy",
    "Strategy & Tactics"
  ], "A classic poker strategy book and a gold-standard reference. Your notes mark selected chapters as the useful read path."),
  createBookRowPage("25dc45aecf4980598ac2c8502c63d156", "Liar's Poker", "Michael Lewis", "Completed", "5", [
    "Market Culture"
  ], "A sharp, funny, insider look at Salomon Brothers and 1980s Wall Street culture. Your notes frame it as educational, hilarious, and more about financial culture than trading strategy.", "The book uses Salomon's bond desk to show ego, status, risk-taking, mortgage-bond innovation, and the psychology of high-finance culture."),
  createBookRowPage("269c45aecf49802681fbec9d08a7362d", "The Psychology of Money", "Morgan Housel", "Completed", "3", [
    "Psychology",
    "Light"
  ], "Accessible and thoughtful money psychology notes with useful lessons on compounding, enough, behavior, and long-term thinking."),
  createBookRowPage("269c45aecf498050b2bcc4b824800938", "Best Loser Wins", "Tom Hougaard", "Completed", "3", [
    "Psychology",
    "Execution",
    "Mindset",
    "Performance"
  ], "An intense and raw trading psychology book. The central idea is valuable: win by becoming the best loser, though your notes say the tone can feel repetitive and dramatic."),
  createBookRowPage("25dc45aecf498065bff6f11c303fa6d5", "Options Trading Crash Course", "Frank Richmond", "Completed", "2", [
    "Technical"
  ], "One of your first options books. Useful as a simple beginner intro to calls, puts, chains, premiums, and basic risk, but too basic for deeper options work.", "Covers options basics, pricing, simple strategies, spreads, covered calls, risk management, options chains, psychology, and building a basic plan."),
  createBookRowPage("269c45aecf4980b2bb40dfdc650048f2", "Superforecasting", "Philip Tetlock & Dan Gardner", "Completed", "2.5", [
    "Forecasting",
    "Behavioral Finance"
  ], "A research-heavy book on improving predictions through probabilistic thinking, updating beliefs, humility, and measurement. Your notes say it is useful but dry and repetitive.", "Key forecasting habits: break problems down, think probabilistically, measure accuracy, update often, stay humble, challenge information, and keep improving in perpetual beta."),
  createBookRowPage("269c45aecf4980d0abfac030aece0e06", "The Quants", "Scott Patterson", "Completed", "3", [
    "Quant & Algo",
    "Market History"
  ], "A captivating look into the quant traders who reshaped Wall Street with math-based strategies and model-driven risk."),
  createBookRowPage("269c45aecf4980d4be7ae18d4e3ca36d", "The Market Wizards", "Jack D. Schwager", "Completed", "6", [
    "Biography",
    "Classic",
    "Interviews"
  ], "A major inspiration book for your trading path and journaling habit, built around interviews with elite traders and their risk/process lessons.")
];

const notionBookRowSeedMap = new Map(notionBookRows.map((page) => [page.id, page]));

const notionSeedPages: LibraryPageRecord[] = [
  createSeedPage(
    "notion-book-club-home",
    "book-club",
    "Book Club",
    ["notion-import", "reading"],
    "https://www.notion.so/Book-Club-31dc45aecf4980c29471e1243cf92301",
    doc([
      heading(1, "Book Club"),
      paragraph("A home base for trading books, mental game notes, replay work, and signal mapping."),
      heading(2, "Linked pages pulled from Notion"),
      bulletList([
        "The Mental Game of Trading Notes",
        "The Replay",
        "Mapping Your Signals",
        "Trading and Poker Books database",
        "Books Mentioned in Books database"
      ]),
      heading(2, "Use this inside Trade Engine"),
      paragraph(
        "Keep the long-form notes editable here, then connect the lessons back into journals, playbooks, reports, and trade review over time."
      )
    ])
  ),
  createSeedPage(
    "notion-mental-game-notes",
    "trading-notes",
    "The Mental Game of Trading Notes",
    ["mental-game", "book-notes", "notion-import"],
    "https://www.notion.so/The-Mental-Game-of-Trading-Notes-31cc45aecf4980fd9813f07c830c9c30",
    doc([
      heading(1, "The Mental Game of Trading Notes"),
      detailsBlock("Chapter 1: A System to Fix Mental Game Problems", [
        paragraph("Think of this as a playbook, but for emotions: A-game, B-game, and C-game."),
        heading(3, "A-Game"),
        paragraph(
          "When performing at an A-game level, emotions are clear and stable. You make high-quality decisions because there is no negative emotional interference with your process."
        ),
        heading(3, "B-Game"),
        paragraph(
          "In B-game, you may have the impulse to make a C-game mistake, like forcing a trade or chasing too early, but you still retain enough presence of mind to stop yourself."
        ),
        heading(3, "C-Game"),
        paragraph(
          "In C-game, emotions are too strong and you cannot stop yourself from forcing, chasing, or getting out too early."
        )
      ]),
      detailsBlock("Chapter 2: Map Your Pattern", [
        paragraph(
          "Emotions, thoughts, actions, and trading decisions are data. The goal is to follow the trail of clues until the real trigger and underlying flaw become visible."
        ),
        heading(3, "Two causes of emotion"),
        bulletList([
          "Accumulated emotions build over time from stress, fear, doubt, lack of sleep, small frustrations, and repeated mistakes. One small trigger can set off the pile underneath.",
          "Secondary emotions happen when you react to the first emotion, like getting angry that you feel fear or ashamed that you feel disappointed."
        ]),
        heading(3, "Things to capture"),
        bulletList([
          "Triggers",
          "Thoughts",
          "Emotions",
          "Behaviors",
          "Actions",
          "Changes to decision-making",
          "Changes to perception of the market",
          "Trading mistakes",
          "Body signals, like an antsy or nervous sensation",
          "Repeating thoughts, like not wanting to miss another one"
        ]),
        heading(3, "Accumulated emotion checks"),
        bulletList([
          "Is your reaction disproportionate to what happened?",
          "Are you making basic errors that feel hard to explain?",
          "Are you finding it harder to relax at the end of the day?",
          "Are thoughts swirling at night or interrupting sleep?",
          "Are you overreacting more easily than usual?"
        ]),
        heading(3, "Mapping tips"),
        bulletList([
          "Set an alarm to check in before the emotion gets too loud.",
          "Use meditation or a reset to notice earlier signals.",
          "Remember that recognition does not automatically equal control; spotting the pattern is the first rep."
        ])
      ]),
      detailsBlock("Chapter 3: Find The Root Of Your Problem", [
        paragraph("A team is only as strong as its weakest link. The real work is often raising the floor of your C-game."),
        paragraph(
          "The problem for a lot of traders is not that their best is too low; it is that their worst is too costly."
        ),
        heading(3, "Mental game range"),
        bulletList([
          "C-game: distracted, risk averse, forcing trades, impatient, negative self-talk, self-doubt, and trading P&L.",
          "B-game: overthinking, losing focus, missing obvious trades, looking at P&L, and reacting slower.",
          "A-game: very relaxed, decisive, patient, confident, and close to in the zone."
        ]),
        heading(3, "Tactical skill range"),
        bulletList([
          "C-game: chasing price, fading directional moves, ignoring loss limits, and reacting to one element.",
          "B-game: weaker context, correlation, or location read; too much attention on depth/tools/indicators; poor volatility read.",
          "A-game: clear context, correlations, location, price levels, tape patterns, patience, and spotting bigger players in the flow."
        ]),
        heading(3, "The Idea of Sucking Less"),
        orderedList([
          "Describe the problem in detail.",
          "Explain why it makes sense that you have this problem.",
          "Explain why that logic is flawed.",
          "Come up with a correction to that flawed logic.",
          "Explain why that correction is correct."
        ])
      ]),
      detailsBlock("Chapter 4: Greed", [
        paragraph(
          "Over the next few weeks, track signals and identify the buildup before the trigger happens."
        ),
        bulletList([
          "What situations typically cause greed or fear?",
          "How does your body react?",
          "When does ambition become excessive?",
          "What is going through your mind?",
          "How is decision-making different?",
          "What is the earliest sign greed or fear has become a problem?"
        ]),
        heading(3, "Signals to track"),
        bulletList([
          "Thoughts, emotions, out-loud comments, behaviors, actions, decision-making drift, market perception changes, and trading mistakes.",
          "Specific triggers like a few losses in a row, a big win, or a sudden sense of opportunity.",
          "Whether the urge is still manageable or has started turning into outcome fantasy."
        ])
      ]),
      detailsBlock("Chapter 5: Fear", [
        paragraph(
          "Fear shows up when risk stops being something you assess and starts being something that controls you."
        ),
        bulletList([
          "Risk aversion",
          "Overthinking",
          "Second-guessing",
          "Not trusting your gut",
          "Fear of missing out",
          "Fear of losing",
          "Fear of mistakes",
          "High expectations"
        ]),
        heading(3, "How fear distorts execution"),
        bulletList([
          "Risk aversion can make comfort more important than executing the edge.",
          "Overthinking adds extra scenarios until clarity disappears.",
          "Second-guessing turns healthy review into protection from loss or mistakes.",
          "FOMO is fear dressed up as urgency.",
          "Expecting perfection makes normal losses and imperfect reads feel like proof something is wrong."
        ])
      ]),
      detailsBlock("Chapter 6: Tilt", [
        paragraph(
          "Tilt is anger and frustration interfering with your ability to trade clearly. It is not random; it is triggered by something specific and then builds."
        ),
        heading(3, "Common signs"),
        bulletList([
          "Clicking too many trades out of frustration",
          "Forcing trades to recoup losses",
          "Deviating from strategy",
          "Taking a bad setup you know is wrong",
          "Chasing the market",
          "Taking trades one after another without enough thought"
        ]),
        heading(3, "Types of tilt"),
        bulletList([
          "Hating to lose: the loss itself becomes unacceptable and you start fighting it.",
          "Mistake tilt: one bad click, chase, or lazy trade turns into frustration at yourself.",
          "Injustice tilt: the market feels unfair after you thought you did the right thing.",
          "Revenge tilt: the focus becomes getting even instead of taking a quality setup.",
          "Entitlement tilt: effort or preparation makes you feel like the market owes you a win."
        ])
      ]),
      detailsBlock("Chapter 7: Confidence", [
        paragraph("Source page currently has the chapter heading as a placeholder. Use this section for confidence notes as you build them out.")
      ]),
      detailsBlock("Chapter 8: Discipline", [
        paragraph("Source page currently has the chapter heading as a placeholder. Use this section for discipline notes as you build them out.")
      ]),
      detailsBlock("Chapter 9: Correct Your Problem", [
        paragraph("Source page currently has the chapter heading as a placeholder. Use this section for correction scripts and repeatable reset language.")
      ]),
      detailsBlock("Chapter 10: Troubleshooting a Lack Of Progress", [
        paragraph("Source page currently has the chapter heading as a placeholder. Use this section for blockers, debugging notes, and next experiments.")
      ])
    ])
  ),
  createSeedPage(
    "notion-replay",
    "replay",
    "The Replay",
    ["replay", "mental-game", "notion-import"],
    "https://www.notion.so/The-Replay-32bc45aecf4980858ce4e889fb9e24dc",
    doc([
      heading(1, "The Replay"),
      detailsBlock("Replay Template", [
        orderedList([
          "Describe the problem in detail.",
          "Explain why it makes sense that you have this problem, or why you think, feel, or react that way.",
          "Explain why the logic in step two is flawed.",
          "Come up with a correction to that flawed logic.",
          "Explain why that correction is correct."
        ])
      ]),
      detailsBlock("PPro 8 Pending Order Frustration", [
        heading(3, "Problem"),
        paragraph(
          "When orders go pending because of a connection issue, I get flustered and start to panic. My first thought is that I am going to miss my best trade of the day."
        ),
        paragraph(
          "Instead of fixing the issue first by rebooting the platform, I sometimes take another trade, which creates even more stress. It also makes me feel like I have to refresh the blotter every time I place an order."
        ),
        paragraph(
          "That pulls focus away from managing the position because I am also trying to manage the blotter and figure out whether I got filled."
        ),
        heading(3, "Why it makes sense"),
        paragraph(
          "This comes from wanting everything to be perfect and from fear of missing the number one trade of the day, usually the opening drive on CVE. It also connects back to wanting the whole setup to be friction free before the session starts."
        ),
        heading(3, "Why the logic is flawed"),
        paragraph(
          "Things are going to happen and nothing will be perfect every time. This is not the only trade of the day, and there are still more hours to find opportunities."
        ),
        heading(3, "Correction"),
        bulletList([
          "This is a technical issue, not a trading edge problem.",
          "Step one: check and refresh the Summary Blotter.",
          "Step two: cancel outstanding orders, refresh again, confirm flat, then refresh the platform.",
          "Step three: step away for five to ten minutes before re-engaging."
        ]),
        heading(3, "Why the correction is correct"),
        paragraph(
          "Getting emotional does not solve the problem. The best response is to stay calm, work the process, reset mentally, and then return to trading with a clear head."
        )
      ]),
      detailsBlock("Book Example: Sizing Up", [
        heading(3, "Problem"),
        paragraph("Sizing up can feel like standing at the edge of a cliff, where failing means the whole path is in question."),
        heading(3, "Correction"),
        paragraph(
          "Regardless of size, every trade is just one opportunity to execute the edge. Sizing up is not an absolute final test."
        ),
        paragraph(
          "Win or lose, the journey keeps going. This is simply the next hurdle, one of many that have already been faced."
        )
      ]),
      detailsBlock("Book Example: Expecting to Make Money on Every Trade", [
        heading(3, "Problem"),
        paragraph("After a loss, the urge is to make the money back quickly and erase the discomfort."),
        heading(3, "Correction"),
        paragraph(
          "Losses are part of the strategy. They are not a sign that something is wrong and they do not need to be fixed immediately."
        ),
        paragraph(
          "A couple of normal losses usually do very little damage. The real damage comes when frustration pushes you into revenge trading and unnecessary risk."
        )
      ])
    ])
  ),
  createSeedPage(
    "notion-mapping-signals",
    "signal-mapping",
    "Mapping Your Signals",
    ["signals", "greed", "fear", "notion-import"],
    "https://www.notion.so/Mapping-Your-Signals-32bc45aecf498025aba8faf7ed10d0cb",
    doc([
      heading(1, "Mapping Your Signals"),
      paragraph("Assign a level of increasing severity using a scale from 1 to 10."),
      bulletList([
        "What triggers the initial urge to force profits at level 1?",
        "What are the signals that greed or fear is still manageable?",
        "What are the signs that greed or fear has become uncontrolled?",
        "How does perception of the market change as emotion rises?",
        "How does decision-making differ at Level 1 compared to Level 5 and 10?"
      ]),
      detailsBlock("Greed Map", [
        paragraph(
          "At Level 1, greed usually starts as a small internal push to make a good day a little bigger. The focus shifts from process toward outcome."
        ),
        heading(3, "Manageable greed"),
        paragraph(
          "Greed is manageable when the urge is noticed without acting immediately. You can still slow down, check levels, and stick to playbook trades."
        ),
        heading(3, "Uncontrolled greed"),
        paragraph(
          "Greed becomes uncontrolled when execution is driven by opportunity fantasy instead of evidence. You start seeing trades everywhere."
        ),
        heading(3, "Greed levels"),
        orderedList([
          "Feels a little extra motivated after a decent start, but still following the plan.",
          "Starts thinking about stretching the day bigger.",
          "Begins anticipating before confirmation is fully there.",
          "Starts thinking in terms of what the day could become.",
          "Noticeable process drift and rationalizing close-enough setups.",
          "Starts pressing and getting attached to a win.",
          "Forces profits, chases moves, and sees opportunity in noise.",
          "Takes trades because the market feels hot, not because the setup is there.",
          "Trading is driven by emotion and momentum fantasy.",
          "Full greed mode: trading blind, abandoning structure, no connection to edge."
        ]),
        heading(3, "Technical levels"),
        orderedList([
          "Trades remain tied to key levels, support, resistance, tape, and confirmation.",
          "Entries still make sense, but patience around the level starts slipping.",
          "Starts front-running confirmation near a known level.",
          "Takes a breakout or reclaim before volume fully confirms.",
          "Uses the level as an excuse rather than a true trigger; context gets weaker.",
          "Jams without full tape, volume, or cross-ticker confirmation.",
          "Takes setups outside best EV zones.",
          "Stops caring where price is in the overall structure.",
          "Ignores failed signals and keeps trading the same idea anyway.",
          "Technicals and tape are irrelevant; the trade is being driven by emotion."
        ])
      ]),
      detailsBlock("Fear Map", [
        paragraph(
          "Fear typically begins after pain, uncertainty, instability, an early loss, a series of small losses, execution errors, or choppy tape."
        ),
        heading(3, "Manageable fear"),
        paragraph(
          "Fear is manageable when you are cautious but can still act on the plan. It can keep you from being sloppy if it is not overriding evidence."
        ),
        heading(3, "Uncontrolled fear"),
        paragraph(
          "Fear becomes uncontrolled when hesitation and defensiveness dominate execution. You stop trusting entry signals, pass on obvious setups, and cut trades early."
        ),
        heading(3, "Fear levels"),
        orderedList([
          "Slight hesitation after a loss or messy tape, but still able to follow the plan.",
          "More cautious than normal and confidence is slightly lower.",
          "Starts hesitating on valid setups.",
          "Mild second-guessing and more worry about being wrong.",
          "Delays entries and may shrink size from emotion.",
          "Starts missing clean setups and walking profit targets down.",
          "Every trade feels riskier than it is.",
          "Freezes on obvious opportunities or exits too quickly.",
          "Confidence drops hard and market clarity fades.",
          "Full shutdown or reactive breakdown."
        ]),
        heading(3, "Technical levels"),
        orderedList([
          "Still uses levels, tape, and structure, just with slightly more caution.",
          "Waits for cleaner confirmation than usual, but still within reason.",
          "Passes on trades at planned levels because the entry feels uncomfortable.",
          "Lets minor noise around a level override the broader setup.",
          "Stops trusting levels.",
          "Exits before the setup has room to develop, even when the level holds.",
          "Ignores bias and cross-ticker context because fear is anchored to recent pain.",
          "Reads normal pullbacks as full failures.",
          "No longer sees technical structure clearly.",
          "Technicals lose usefulness because emotional state overrides interpretation."
        ])
      ])
    ])
  ),
  createSeedPage(
    "notion-trading-poker-books-db",
    "book-club",
    "Trading and Poker Books Database",
    ["database-blueprint", "books", "notion-import"],
    "https://www.notion.so/25dc45aecf4980459e91e3e7b4f5ade4",
    doc([
      heading(1, "Trading and Poker Books Database"),
      paragraph("Database structure pulled from Notion. Actual row import is still pending because the row query endpoint was not available in this connector session."),
      heading(2, "Properties"),
      bulletList([
        "Book Name",
        "Author",
        "Reading Status: Abandoned, Completed, In Progress, To Read",
        "Rating: 1, 2, 2.5, 3, 4, 5, 6",
        "Genre",
        "Review",
        "Summary"
      ]),
      heading(2, "Genre options"),
      bulletList([
        "Poker Strategy",
        "Game Theory & Math",
        "Risk Management",
        "Execution & Microstructure",
        "Market History",
        "Behavioral Finance",
        "Biographies & Memoirs",
        "Quant & Algo",
        "Technical Analysis",
        "Macro & Fundamentals",
        "Strategy & Tactics",
        "Psychology",
        "Classic",
        "Habit Formation",
        "Philosophy",
        "Biography",
        "Outdated",
        "Market Culture",
        "Technical",
        "Execution",
        "Forecasting",
        "Light",
        "Dense",
        "Interviews",
        "Decision-Making",
        "Poker",
        "Mindset",
        "Performance",
        "Microstructure",
        "Beginner-Friendly",
        "Tilt Control",
        "Market Philosophy"
      ])
    ])
  ),
  createSeedPage(
    "notion-books-mentioned-db",
    "book-club",
    "Books Mentioned in Books Database",
    ["database-blueprint", "books", "notion-import"],
    "https://www.notion.so/25ec45aecf4980d4a6b6ee3c51d82a48",
    doc([
      heading(1, "Books Mentioned in Books Database"),
      paragraph("Database structure pulled from Notion. This is useful as a future reading-list capture table inside Trade Engine."),
      heading(2, "Properties"),
      bulletList([
        "Title",
        "Author",
        "Source Book",
        "Mention Context",
        "Add to Reading List",
        "Genre"
      ]),
      heading(2, "Genre options"),
      bulletList([
        "Behavioral Finance",
        "Technical Analysis",
        "Finance History",
        "Risk Management",
        "Psychology",
        "Hedge Funds"
      ])
    ])
  ),
  ...notionBookRows
];

const notionSeedPageMap = new Map(notionSeedPages.map((page) => [page.id, page]));

export const createDefaultLibraryPages = (): LibraryPageRecord[] => [
  createStarterPage("idea-inbox", "New trading idea", ["idea"]),
  ...notionSeedPages
];

const normalizeLibraryPage = (page: Partial<LibraryPageRecord>): LibraryPageRecord => {
  const timestamp = nowIso();
  const normalizedPage: LibraryPageRecord = {
    id: page.id || createId(),
    collectionId: normalizeCollectionId(page.collectionId ?? "idea-inbox"),
    title: page.title || "Untitled",
    status: page.status || "Active",
    tags: Array.isArray(page.tags) ? page.tags.filter(Boolean) : [],
    sourceUrl: page.sourceUrl || "",
    properties: page.properties && typeof page.properties === "object" ? page.properties : undefined,
    content: page.content && page.content.type === "doc" ? page.content : createEmptyJournalDoc(),
    createdAt: page.createdAt || timestamp,
    updatedAt: page.updatedAt || timestamp
  };

  if (normalizedPage.tags.includes("book-row")) {
    const seedPage = notionBookRowSeedMap.get(normalizedPage.id);
    normalizedPage.properties = {
      ...(seedPage?.properties ?? {}),
      ...normalizedPage.properties,
      Author: normalizedPage.properties?.Author || seedPage?.properties?.Author || "",
      "Reading Status":
        !normalizedPage.properties?.["Reading Status"] || normalizedPage.properties["Reading Status"] === "Imported"
          ? seedPage?.properties?.["Reading Status"] ?? normalizedPage.properties?.["Reading Status"] ?? ""
          : normalizedPage.properties["Reading Status"],
      Rating: normalizedPage.properties?.Rating || seedPage?.properties?.Rating || "",
      Genre:
        Array.isArray(normalizedPage.properties?.Genre) && normalizedPage.properties.Genre.length > 0
          ? normalizedPage.properties.Genre
          : seedPage?.properties?.Genre ?? [],
      Review: normalizedPage.properties?.Review || seedPage?.properties?.Review || "",
      Summary: normalizedPage.properties?.Summary || seedPage?.properties?.Summary || ""
    };
  }

  return normalizedPage;
};

export const loadLibraryPages = (): LibraryPageRecord[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(SEED_VERSION_KEY, CURRENT_SEED_VERSION);
    return createDefaultLibraryPages();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LibraryPageRecord>[];
    if (!Array.isArray(parsed)) {
      return createDefaultLibraryPages();
    }

    const normalizedPages = parsed.map(normalizeLibraryPage);
    const seedVersion = localStorage.getItem(SEED_VERSION_KEY);
    const pagesWithSeedRefresh =
      seedVersion === CURRENT_SEED_VERSION
        ? normalizedPages
        : normalizedPages.map((page) => {
            const seedPage = notionSeedPageMap.get(page.id);
            if (seedPage && page.tags.includes("notion-import") && page.updatedAt === SEED_TIMESTAMP) {
              return seedPage;
            }

            return page;
          });

    const seededPages =
      seedVersion === CURRENT_SEED_VERSION
        ? pagesWithSeedRefresh
        : [
            ...notionSeedPages.filter((seedPage) =>
              pagesWithSeedRefresh.every((page) => page.id !== seedPage.id)
            ),
            ...pagesWithSeedRefresh
          ];

    if (seedVersion !== CURRENT_SEED_VERSION) {
      localStorage.setItem(SEED_VERSION_KEY, CURRENT_SEED_VERSION);
      saveLibraryPages(seededPages);
    }

    return seededPages.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    localStorage.setItem(SEED_VERSION_KEY, CURRENT_SEED_VERSION);
    return createDefaultLibraryPages();
  }
};

export const saveLibraryPages = (pages: LibraryPageRecord[]): void => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([...pages].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
  );
};

export const createLibraryPage = (collectionId: LibraryCollectionId): LibraryPageRecord => {
  const collection = libraryCollections.find((item) => item.id === collectionId);
  return createStarterPage(collectionId, collection ? `New ${collection.name} page` : "Untitled");
};
