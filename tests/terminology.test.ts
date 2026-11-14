import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe('British English & no retail terminology', () => {
  const src = files(join(__dirname, '..', 'src'));
  const lines = src.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l) => ({ f, l })));
  // Alias lists deliberately accept foreign spellings in *source* files being imported.
  const relevant = lines.filter(({ l }) => !/aliases|pick\(/.test(l));
  it('uses no retail terminology', () => {
    const hits = relevant.filter(({ l }) => /\b(SKU|SKUs|shopper|basket|checkout|retailer|merchandise)\b/i.test(l));
    expect(hits).toEqual([]);
  });
  it('uses British spellings', () => {
    const hits = relevant.filter(({ l }) => /\b(utilization|utilize|analyze|catalog|labor|dispatch)\b/i.test(l));
    expect(hits).toEqual([]);
  });
});
