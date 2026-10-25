import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { evidenceLabel } from './attendance-corrections-workspace';

const render = (item: Parameters<typeof evidenceLabel>[0]) =>
  renderToStaticMarkup(<>{evidenceLabel(item)}</>);

describe('evidenceLabel', () => {
  it('names a Document Version the reader may identify', () => {
    const html = render({
      access: 'FULL',
      id: 'e1',
      documentVersionId: '33333333-3333-4333-8333-333333333333',
      documentNo: 'MC-2026-01',
      sourceType: null,
      sourceId: null,
      createdAt: '2026-09-08T01:00:00.000Z',
    });
    expect(html).toContain('Document MC-2026-01 version 33333333-3333-4333-8333-333333333333');
  });

  it('marks restricted evidence without identifying it', () => {
    const html = render({ access: 'RESTRICTED', id: 'e1', createdAt: '2026-09-08T01:00:00.000Z' });
    expect(html).toContain('Restricted evidence');
  });
});
