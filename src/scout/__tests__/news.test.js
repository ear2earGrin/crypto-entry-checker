import { describe, it, expect } from "vitest";
import { parseFeed, buildMatchers, tagItem, gradeOf, eventTypes, mergeNews, decodeEntities } from "../news.js";
import { NARRATIVES } from "../config.js";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[The Clearing House selects Quant for tokenized deposits]]></title>
<link>https://news.test/1</link><pubDate>Wed, 24 Sep 2026 14:00:00 GMT</pubDate>
<description><![CDATA[<p>Banks pick Overledger &amp; QNT.</p>]]></description></item>
<item><title>XRP price prediction: could it hit $10?</title><link>https://news.test/2</link>
<pubDate>Wed, 24 Sep 2026 15:00:00 GMT</pubDate><description>Analysts weigh in.</description></item>
<item><title>No link here</title></item>
</channel></rss>`;

const ATOM = `<feed><entry><title>Solana mainnet upgrade goes live</title>
<link rel="alternate" href="https://news.test/3"/><updated>2026-09-25T10:00:00Z</updated>
<summary>Faster blocks.</summary></entry></feed>`;

const universe = [
  { id: "quant-network", symbol: "QNT", name: "Quant" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "near", symbol: "NEAR", name: "NEAR Protocol" },
];

describe("parseFeed", () => {
  it("reads RSS items, strips CDATA/HTML, skips items without links", () => {
    const items = parseFeed(RSS, "Test");
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("The Clearing House selects Quant for tokenized deposits");
    expect(items[0].summary).toBe("Banks pick Overledger & QNT.");
    expect(items[0].published).toBe("2026-09-24T14:00:00.000Z");
  });
  it("reads Atom entries with href links", () => {
    const [e] = parseFeed(ATOM, "Atom");
    expect(e.link).toBe("https://news.test/3");
    expect(e.published).toBe("2026-09-25T10:00:00.000Z");
  });
  it("decodes numeric entities", () => expect(decodeEntities("&#8217;&#x2014;")).toBe("’—"));
});

describe("tagItem", () => {
  const matchers = buildMatchers(universe);
  const [qnt, xrp] = parseFeed(RSS, "Test").map((it) => tagItem(it, matchers, NARRATIVES));

  it("finds the coin and the bank-rails narrative, grades a partnership A", () => {
    expect(qnt.coins).toEqual(["quant-network"]);
    expect(qnt.narratives).toContain("bank-rails");
    expect(qnt.types).toContain("partnership");
    expect(qnt.grade).toBe("A");
  });
  it("grades price predictions C", () => {
    expect(xrp.coins).toEqual(["ripple"]);
    expect(xrp.grade).toBe("C");
  });
  it("does not match ambiguous words like 'near'", () => {
    const t = tagItem({ title: "Bitcoin trades near record as ETF inflows grow", link: "x", summary: "" }, matchers, NARRATIVES);
    expect(t.coins).toEqual([]);
  });
  it("matches a ticker written as $TICK", () => {
    const t = tagItem({ title: "Whales load up on $SOL", link: "y", summary: "" }, matchers, NARRATIVES);
    expect(t.coins).toEqual(["solana"]);
  });
});

describe("grading", () => {
  it("concrete events are A, commentary B, opinion C", () => {
    expect(gradeOf(eventTypes("Coinbase will list Foo"))).toBe("A");
    expect(gradeOf(eventTypes("Weekly market wrap"))).toBe("B");
    expect(gradeOf(eventTypes("Why Foo could rally 50%"))).toBe("C");
  });
});

describe("mergeNews", () => {
  it("dedupes by link and drops items older than the window", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    const old = { link: "old", published: "2026-09-01T00:00:00Z" };
    const a = { link: "a", published: "2026-09-28T00:00:00Z" };
    const merged = mergeNews([a, old], [a, { link: "b", published: "2026-09-28T12:00:00Z" }], now);
    expect(merged.map((m) => m.link)).toEqual(["b", "a"]);
  });
});
