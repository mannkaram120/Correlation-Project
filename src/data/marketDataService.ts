/**
 * marketDataService.ts
 *
 * Fetches real daily closing prices from:
 *   - Finnhub REST API  (FX, Indices ETFs, Commodity ETFs)
 *   - FRED API          (US and international yield curves — free, no key needed)
 *
 * Falls back to the simulator for any ticker that fails (network error,
 * rate limit, weekend/holiday gap, or missing data).
 *
 * All results are cached in memory for the session to avoid redundant calls.
 * Call invalidateCache() on manual refresh to force a new fetch.
 */

import { SYMBOL_MAP } from './finnhubSymbols';
import type { LookbackWindow, PricePoint } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  returns:   number[];
  prices:    PricePoint[];
  fetchedAt: number; // ms timestamp
  source:    'live' | 'fallback';
}

// ─── Config ───────────────────────────────────────────────────────────────────

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY as string ?? '';
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const FRED_BASE    = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

/** Cache TTL in milliseconds — refresh live data at most every 15 minutes */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Total days of history to fetch from API (supports 1Y lookback + rolling calcs) */
const HISTORY_DAYS = 400;

// ─── In-memory cache ─────────────────────────────────────────────────────────

const _cache = new Map<string, CacheEntry>();

export function invalidateCache(): void {
  _cache.clear();
}

export function getCacheStatus(): { ticker: string; source: string; age: string }[] {
  const now = Date.now();
  return [..._cache.entries()].map(([ticker, e]) => ({
    ticker,
    source: e.source,
    age: `${Math.round((now - e.fetchedAt) / 1000)}s ago`,
  }));
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function daysAgoTimestamp(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toUnixTimestamp(d);
}

function formatDateYMD(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

// ─── Return computation ───────────────────────────────────────────────────────

function pricesToReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const curr = closes[i]!;
    if (prev > 0) {
      returns.push((curr - prev) / prev);
    }
  }
  return returns;
}

function pricesToPricePoints(closes: number[], timestamps: number[]): PricePoint[] {
  // Normalise to base 100
  const base = closes[0] ?? 1;
  return closes.map((c, i) => ({
    date:  formatDateYMD(timestamps[i]!),
    price: +((c / base) * 100).toFixed(4),
  }));
}

// ─── Finnhub fetchers ─────────────────────────────────────────────────────────

async function fetchFinnhubForex(symbol: string): Promise<{ closes: number[]; timestamps: number[] }> {
  const from = daysAgoTimestamp(HISTORY_DAYS);
  const to   = toUnixTimestamp(new Date());
  const url  = `${FINNHUB_BASE}/forex/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`;

  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub forex ${symbol}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.s !== 'ok' || !data.c?.length) throw new Error(`Finnhub forex ${symbol}: no data (status=${data.s})`);

  return { closes: data.c as number[], timestamps: data.t as number[] };
}

async function fetchFinnhubStock(symbol: string): Promise<{ closes: number[]; timestamps: number[] }> {
  const from = daysAgoTimestamp(HISTORY_DAYS);
  const to   = toUnixTimestamp(new Date());
  const url  = `${FINNHUB_BASE}/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`;

  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub stock ${symbol}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.s !== 'ok' || !data.c?.length) throw new Error(`Finnhub stock ${symbol}: no data (status=${data.s})`);

  return { closes: data.c as number[], timestamps: data.t as number[] };
}

// ─── FRED fetcher (yields — free, no key needed) ─────────────────────────────

async function fetchFred(seriesId: string): Promise<{ closes: number[]; timestamps: number[] }> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - HISTORY_DAYS);
  const start = startDate.toISOString().slice(0, 10);

  // FRED serves CSV directly — no CORS issues from browser
  const url = `${FRED_BASE}?id=${seriesId}&vintage_date=${start}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);

  const text = await res.text();
  const lines = text.trim().split('\n').slice(1); // skip header

  const closes: number[] = [];
  const timestamps: number[] = [];

  for (const line of lines) {
    const [dateStr, valueStr] = line.split(',');
    if (!dateStr || !valueStr || valueStr.trim() === '.') continue; // FRED uses '.' for missing
    const val = parseFloat(valueStr.trim());
    if (isNaN(val)) continue;
    closes.push(val);
    timestamps.push(toUnixTimestamp(new Date(dateStr.trim())));
  }

  if (closes.length < 10) throw new Error(`FRED ${seriesId}: insufficient data (${closes.length} points)`);

  return { closes, timestamps };
}

// ─── Simulator fallback ───────────────────────────────────────────────────────

let _simModule: typeof import('./dataSimulator') | null = null;

async function getSimulator() {
  if (!_simModule) {
    _simModule = await import('./dataSimulator');
  }
  return _simModule;
}

async function fetchWithFallback(ticker: string): Promise<CacheEntry> {
  const config = SYMBOL_MAP[ticker];

  // No config — fall straight to simulator
  if (!config) {
    const sim = await getSimulator();
    return {
      returns:   sim.getAllReturns(ticker),
      prices:    sim.getPrices(ticker, '1Y'),
      fetchedAt: Date.now(),
      source:    'fallback',
    };
  }

  try {
    let closes: number[];
    let timestamps: number[];

    if (config.source === 'finnhub_forex') {
      ({ closes, timestamps } = await fetchFinnhubForex(config.finnhubSymbol));
    } else if (config.source === 'finnhub_stock') {
      ({ closes, timestamps } = await fetchFinnhubStock(config.finnhubSymbol));
    } else if (config.source === 'fred') {
      ({ closes, timestamps } = await fetchFred(config.fredSeries!));
    } else {
      throw new Error(`Unknown source: ${config.source}`);
    }

    return {
      returns:   pricesToReturns(closes),
      prices:    pricesToPricePoints(closes, timestamps),
      fetchedAt: Date.now(),
      source:    'live',
    };

  } catch (err) {
    console.warn(`[NEXUS] ${ticker} live fetch failed — using simulator fallback:`, err);
    const sim = await getSimulator();
    return {
      returns:   sim.getAllReturns(ticker),
      prices:    sim.getPrices(ticker, '1Y'),
      fetchedAt: Date.now(),
      source:    'fallback',
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch all tickers in parallel with a concurrency cap of 8.
 *  Call this once on app init. Returns a map of ticker → CacheEntry. */
export async function fetchAllTickers(tickers: string[]): Promise<Map<string, CacheEntry>> {
  const CONCURRENCY = 8; // Finnhub free tier: 60 req/min → 8 parallel is safe
  const result = new Map<string, CacheEntry>();

  // Process in batches
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const batch = tickers.slice(i, i + CONCURRENCY);
    const entries = await Promise.all(batch.map(t => fetchWithFallback(t)));
    batch.forEach((t, j) => {
      result.set(t, entries[j]!);
      _cache.set(t, entries[j]!);
    });
    // Small delay between batches to respect rate limits
    if (i + CONCURRENCY < tickers.length) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  return result;
}

/** Get returns for a single ticker — uses cache if fresh, fetches if stale. */
export async function getReturnsLive(ticker: string, window: LookbackWindow): Promise<number[]> {
  const cached = _cache.get(ticker);
  const now = Date.now();

  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return sliceReturns(cached.returns, window);
  }

  const entry = await fetchWithFallback(ticker);
  _cache.set(ticker, entry);
  return sliceReturns(entry.returns, window);
}

/** Get all returns (full history) for a ticker — used for rolling calculations. */
export function getAllReturnsLive(ticker: string): number[] {
  return _cache.get(ticker)?.returns ?? [];
}

/** Get normalised price series for a ticker. */
export function getPricesLive(ticker: string, window: LookbackWindow): PricePoint[] {
  const entry = _cache.get(ticker);
  if (!entry) return [];
  const n = lookbackDays(window);
  return entry.prices.slice(-Math.min(n, entry.prices.length));
}

/** Check whether a ticker is using live or fallback data. */
export function getDataSource(ticker: string): 'live' | 'fallback' | 'pending' {
  return _cache.get(ticker)?.source ?? 'pending';
}

/** Returns true if ALL requested tickers have live (non-fallback) data. */
export function allLive(tickers: string[]): boolean {
  return tickers.every(t => _cache.get(t)?.source === 'live');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lookbackDays(window: LookbackWindow): number {
  switch (window) {
    case '1D': return 1;
    case '1W': return 5;
    case '1M': return 21;
    case '3M': return 63;
    case '1Y': return 252;
  }
}

function sliceReturns(returns: number[], window: LookbackWindow): number[] {
  const n = lookbackDays(window);
  return returns.slice(-Math.min(n, returns.length));
}
