// Optional plain-English coin explainer written by Claude from the project's
// own description and the Scout's measured numbers. Runs only when an API key
// is available (ANTHROPIC_API_KEY, or data/scout/anthropic.txt). Without one
// the Scout still works and shows CoinGecko's description instead.

const SYSTEM = `You explain crypto projects to an experienced trader who is not a programmer.
Write in plain English, short sentences, no hype. Use ONLY the source text and numbers provided.
If the source doesn't say something, write "not stated in the source" instead of guessing.
Never give a price target or a buy/sell recommendation.

Use exactly these five headings, each followed by 1-3 sentences:
What it is
Who pays for it
How the token captures value
What would have to be true for a 10x
Red flags and open questions`;

function fmtUsd(x) {
  if (x === null || x === undefined) return "unknown";
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  return `$${Math.round(x).toLocaleString("en-US")}`;
}

export function explainerPrompt(coin, detail) {
  const numbers = [
    `Market cap: ${fmtUsd(coin.mcap)}`,
    `Fully diluted value: ${fmtUsd(coin.fdv)}`,
    `Circulating share of total supply: ${coin.float === null ? "unknown" : `${(coin.float * 100).toFixed(0)}%`}`,
    `24h volume: ${fmtUsd(coin.vol)}`,
    `Performance vs BTC: 7d ${coin.rs7?.toFixed(1) ?? "?"}%, 30d ${coin.rs30?.toFixed(1) ?? "?"}%, 200d ${coin.rs200?.toFixed(1) ?? "?"}%`,
    `CoinGecko categories: ${(detail?.categories || []).join(", ") || "none listed"}`,
  ].join("\n");
  const description = String(detail?.description || "").slice(0, 6000) || "No description available.";
  return `Project: ${coin.name} (${coin.symbol})
Homepage: ${detail?.homepage || "unknown"}
Whitepaper: ${detail?.whitepaper || "not linked"}

Measured numbers:
${numbers}

Project description (from CoinGecko, written by or for the project):
${description}`;
}

let clientPromise = null;

async function getClient(apiKey) {
  if (!clientPromise) {
    clientPromise = import("@anthropic-ai/sdk").then(({ default: Anthropic }) => new Anthropic({ apiKey }));
  }
  return clientPromise;
}

/** Returns { text, model } or throws. */
export async function explainCoin(apiKey, coin, detail) {
  const client = await getClient(apiKey);
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [{ role: "user", content: explainerPrompt(coin, detail) }],
  });
  if (response.stop_reason === "refusal") throw new Error("explainer declined");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("empty explainer");
  return { text, model: response.model };
}
