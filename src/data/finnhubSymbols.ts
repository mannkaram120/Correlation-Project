/**
 * Maps NEXUS internal tickers to Finnhub API symbols.
 *
 * Coverage breakdown:
 *   FX          → Finnhub forex candles  (OANDA symbols)
 *   Indices     → Finnhub stock candles  (ETF proxies for SPX/NDX/DJI/DAX/FTSE/NKY/HSI + ^VIX)
 *   Commodities → Finnhub stock candles  (ETF proxies: GLD, SLV, USO, BNO, CPER, UNG)
 *   Rates       → FRED API              (no Finnhub coverage on free tier)
 *
 * ETF proxy rationale:
 *   SPX  → SPY  (SPDR S&P 500 ETF,     r > 0.999 with index)
 *   NDX  → QQQ  (Invesco NASDAQ 100,   r > 0.999)
 *   DJI  → DIA  (SPDR Dow Jones,       r > 0.999)
 *   DAX  → EWG  (iShares Germany ETF,  r > 0.97)
 *   FTSE → EWU  (iShares UK ETF,       r > 0.96)
 *   NKY  → EWJ  (iShares Japan ETF,    r > 0.95)
 *   HSI  → EWH  (iShares Hong Kong,    r > 0.94)
 *   XAU  → GLD  (SPDR Gold Shares,     r > 0.999)
 *   XAG  → SLV  (iShares Silver Trust, r > 0.999)
 *   WTI  → USO  (US Oil Fund,          r > 0.97)
 *   BRENT→ BNO  (Brent Oil Fund,       r > 0.96)
 *   COPPER→CPER (Copper ETF,           r > 0.95)
 *   NATGAS→UNG  (US Natural Gas Fund,  r > 0.93)
 */

export type DataSource = 'finnhub_forex' | 'finnhub_stock' | 'fred' | 'simulator';

export interface SymbolConfig {
  finnhubSymbol: string;
  source: DataSource;
  /** FRED series ID — only set when source = 'fred' */
  fredSeries?: string;
}

export const SYMBOL_MAP: Record<string, SymbolConfig> = {
  // ── FX ────────────────────────────────────────────────────────────────────
  EURUSD: { finnhubSymbol: 'OANDA:EUR_USD',  source: 'finnhub_forex' },
  GBPUSD: { finnhubSymbol: 'OANDA:GBP_USD',  source: 'finnhub_forex' },
  USDJPY: { finnhubSymbol: 'OANDA:USD_JPY',  source: 'finnhub_forex' },
  AUDUSD: { finnhubSymbol: 'OANDA:AUD_USD',  source: 'finnhub_forex' },
  USDCHF: { finnhubSymbol: 'OANDA:USD_CHF',  source: 'finnhub_forex' },
  USDCAD: { finnhubSymbol: 'OANDA:USD_CAD',  source: 'finnhub_forex' },
  USDCNH: { finnhubSymbol: 'OANDA:USD_CNH',  source: 'finnhub_forex' },

  // ── Indices (ETF proxies) ──────────────────────────────────────────────────
  SPX:    { finnhubSymbol: 'SPY',  source: 'finnhub_stock' },
  NDX:    { finnhubSymbol: 'QQQ',  source: 'finnhub_stock' },
  DJI:    { finnhubSymbol: 'DIA',  source: 'finnhub_stock' },
  DAX:    { finnhubSymbol: 'EWG',  source: 'finnhub_stock' },
  FTSE:   { finnhubSymbol: 'EWU',  source: 'finnhub_stock' },
  NKY:    { finnhubSymbol: 'EWJ',  source: 'finnhub_stock' },
  HSI:    { finnhubSymbol: 'EWH',  source: 'finnhub_stock' },
  VIX:    { finnhubSymbol: 'VIXY', source: 'finnhub_stock' }, // ProShares VIX ETF

  // ── Commodities (ETF proxies) ─────────────────────────────────────────────
  XAU:    { finnhubSymbol: 'GLD',  source: 'finnhub_stock' },
  XAG:    { finnhubSymbol: 'SLV',  source: 'finnhub_stock' },
  WTI:    { finnhubSymbol: 'USO',  source: 'finnhub_stock' },
  BRENT:  { finnhubSymbol: 'BNO',  source: 'finnhub_stock' },
  COPPER: { finnhubSymbol: 'CPER', source: 'finnhub_stock' },
  NATGAS: { finnhubSymbol: 'UNG',  source: 'finnhub_stock' },

  // ── Rates (FRED — free, no key required for daily series) ─────────────────
  US2Y:   { finnhubSymbol: '', source: 'fred', fredSeries: 'DGS2'  },
  US5Y:   { finnhubSymbol: '', source: 'fred', fredSeries: 'DGS5'  },
  US10Y:  { finnhubSymbol: '', source: 'fred', fredSeries: 'DGS10' },
  US30Y:  { finnhubSymbol: '', source: 'fred', fredSeries: 'DGS30' },
  BUND:   { finnhubSymbol: '', source: 'fred', fredSeries: 'IRLTLT01DEM156N' },
  JGB:    { finnhubSymbol: '', source: 'fred', fredSeries: 'IRLTLT01JPM156N' },
};
