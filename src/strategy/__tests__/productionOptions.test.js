import { describe, it, expect } from "vitest";
import { PRESET_V2, PRODUCTION_PRESET, productionEngineOptions } from "../presets.js";

describe("productionEngineOptions", () => {
  it("carries the frozen v2 rules and the validated costs, not the engine defaults", () => {
    const o = productionEngineOptions();
    expect(PRODUCTION_PRESET).toBe(PRESET_V2);
    expect(o.signalParams).toEqual(PRESET_V2.signalParams);
    expect(o.regimeParams).toEqual(PRESET_V2.regimeParams);
    expect(o.exitOnRegimeFlip).toBe(false);
    expect(o.signalParams.allowShort).toBe(false);
    expect(o.regimeParams.use).toEqual({ sma: true, macd: false, rsi: false, adx: false });
    expect(o.feePct).toBe(0.08);
    expect(o.slippagePct).toBe(0.05);
  });
});
