import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import { cleanName, defaultGameName, legacyGameName, GAME_NAME_MAX } from '../src/sim/names';
import { shortDate } from '../src/sim/time';
import { slotTitle, slotDetails, metaOf, infoOf } from '../src/ui/saves';

const BLACKBEARD = KINGS.find((k) => k.id === 'blackbeard')!;

describe('game names', () => {
  it('a new game gets a themed default name from its ruler and seed', () => {
    const g = new Game({ seed: 5 }, BLACKBEARD);
    expect(g.name).toBe(defaultGameName('Blackbeard', 5));
    expect(g.name.length).toBeGreaterThan(3);
    expect(g.name.length).toBeLessThanOrEqual(GAME_NAME_MAX);
    // seeds vary the name: a handful of reigns rarely share one
    const names = new Set(Array.from({ length: 40 }, (_, i) => defaultGameName('Blackbeard', i * 7)));
    expect(names.size).toBeGreaterThan(15);
    for (const k of KINGS) for (let i = 0; i < 20; i++) {
      const n = defaultGameName(k.name, i);
      expect(n).toBe(cleanName(n, GAME_NAME_MAX));
      expect(n[0]).toBe(n[0].toUpperCase());
    }
  });

  it('renameGame sanitizes like renameShip and refuses a blank name', () => {
    const g = new Game({ seed: 5 }, BLACKBEARD);
    expect(g.cmd({ type: 'renameGame', name: '  <b>Rum\u0007   Runner\'s</b>\n Rest  ' }).ok).toBe(true);
    expect(g.name).toBe('bRum Runner\'s/b Rest');
    expect(g.cmd({ type: 'renameGame', name: 'x'.repeat(80) }).ok).toBe(true);
    expect(g.name).toBe('x'.repeat(GAME_NAME_MAX));
    const before = g.name;
    const r = g.cmd({ type: 'renameGame', name: ' \t<>\u0000 ' });
    expect(r.ok).toBe(false);
    expect(g.name).toBe(before);
    // ships use the same sanitizer, at their own 24 characters
    const s = [...g.ships.values()][0];
    if (s) {
      g.cmd({ type: 'renameShip', ship: s.id, name: ' Queen\u0000  <Anne>\'s   Revenge ' });
      expect(s.name).toBe('Queen Anne\'s Revenge');
    }
  });

  it('the name survives a save and a load', () => {
    const g = new Game({ seed: 5 }, BLACKBEARD);
    g.cmd({ type: 'renameGame', name: 'Hangman\'s Hideaway' });
    g.run(200);
    const json = g.serialize();
    expect(Game.deserialize(json).name).toBe('Hangman\'s Hideaway');
    const info = infoOf(json);
    expect(info.name).toBe('Hangman\'s Hideaway');
    const m = metaOf('slot1', info, 1);
    expect(slotTitle(m)).toBe('Hangman\'s Hideaway');
    expect(slotDetails(m)).toBe(`Blackbeard · ${shortDate(g.time)} · Medium island`);
  });

  it('a save from before games had names is called after its ruler and date', () => {
    const g = new Game({ seed: 5 }, BLACKBEARD);
    g.run(400);
    const d = JSON.parse(g.serialize());
    delete d.name;
    const date = shortDate(g.time);
    const old = Game.deserialize(JSON.stringify(d));
    expect(old.name).toBe(legacyGameName('Blackbeard', date));
    expect(old.name).toMatch(/^Blackbeard, [A-Z][a-z]{2} 1680$/);
    // and its slot, whose label was stored without a name, reads the same
    expect(slotTitle({ king: 'Blackbeard', date })).toBe(old.name);
    expect(slotDetails({ king: 'Blackbeard', date })).toBe(`Blackbeard · ${date}`);
    // a name that sanitizes to nothing falls back the same way
    d.name = '<<>>';
    expect(Game.deserialize(JSON.stringify(d)).name).toBe(old.name);
  });
});
