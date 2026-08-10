import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  TEMPLATE_GROUPS,
  templateSize,
  templatesByGroup,
} from './templates';

// The list is empty today: these tests are the CONTRACT any template registered
// later has to fulfill. They run over TEMPLATES, so they pass with zero items and
// start taking effect on their own once the first one lands.
describe('template registry', () => {
  it('the panel does not list empty groups', () => {
    const groups = templatesByGroup();
    for (const [, list] of groups) expect(list.length).toBeGreaterThan(0);
    const total = groups.reduce((n, [, list]) => n + list.length, 0);
    expect(total).toBe(TEMPLATES.length);
  });

  it('ids are unique and the group is one of the known ones', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(TEMPLATE_GROUPS, t.id).toContain(t.group);
      expect(t.name.trim().length, t.id).toBeGreaterThan(0);
    }
  });

  it('build produces valid elements, new ids and honors the anchor', () => {
    for (const t of TEMPLATES) {
      const els = t.build({ x: 0, y: 0 });
      expect(els.length, t.id).toBeGreaterThan(0);
      expect(new Set(els.map((e) => e.id)).size, `${t.id}: ids repetidos`).toBe(els.length);

      for (const e of els) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y), `${t.id}/${e.type}`).toBe(true);
        expect(Number.isFinite(e.width) && Number.isFinite(e.height), `${t.id}/${e.type}`).toBe(true);
      }

      // Inserting it twice must not collide on ids.
      const other = t.build({ x: 0, y: 0 }).map((e) => e.id);
      expect(els.some((e) => other.includes(e.id)), `${t.id}: ids reaproveitados`).toBe(false);

      // Shifting the anchor shifts the whole set.
      const moved = t.build({ x: 500, y: 300 });
      expect(Math.min(...moved.map((e) => e.x)) - Math.min(...els.map((e) => e.x)), t.id).toBe(500);
      expect(Math.min(...moved.map((e) => e.y)) - Math.min(...els.map((e) => e.y)), t.id).toBe(300);

      // templateSize has to cover everything (it is what centers it in the viewport).
      const { width, height } = templateSize(t);
      expect(width, t.id).toBeGreaterThanOrEqual(Math.max(...els.map((e) => e.x + Math.abs(e.width))));
      expect(height, t.id).toBeGreaterThanOrEqual(Math.max(...els.map((e) => e.y + Math.abs(e.height))));
    }
  });

  it('template arrows point at elements of their own set', () => {
    for (const t of TEMPLATES) {
      const els = t.build({ x: 0, y: 0 });
      const ids = new Set(els.map((e) => e.id));
      for (const e of els) {
        if (e.type !== 'arrow' && e.type !== 'line') continue;
        const l = e as typeof e & { sourceId?: string; targetId?: string };
        if (l.sourceId) expect(ids.has(l.sourceId), `${t.id} sourceId`).toBe(true);
        if (l.targetId) expect(ids.has(l.targetId), `${t.id} targetId`).toBe(true);
      }
    }
  });
});
