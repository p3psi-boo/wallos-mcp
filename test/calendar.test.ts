import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { monthlyOccurrences } from '../src/domain/costs';
import { normalize } from '../src/domain/catalog';
import { loadContext } from '../src/domain/catalog';
import { WallosClient } from '../src/wallos/client';
import { Fixture, config, raw } from './fixture';
type Golden = { cycle: number; frequency: number; next_payment: string; month: string; occurrences: number };
const cases: Golden[] = JSON.parse(readFileSync('test/data/calendar.json', 'utf8'));
it('matches independently executed PHP golden fixtures for all calendar edges', async () => {
  const fixture = new Fixture(); const context = await loadContext(new WallosClient(config, fixture.fetch), config);
  for (const c of cases) {
    const subscription = await normalize(raw({ cycle: c.cycle, frequency: c.frequency, next_payment: c.next_payment }), context);
    expect(monthlyOccurrences(subscription, c.month), JSON.stringify(c)).toBe(c.occurrences);
  }
});
