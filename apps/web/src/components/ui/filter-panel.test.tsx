import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FilterPanel, toggleFilter } from './filter-panel';

it('adds and removes one value without touching other groups', () => {
  const picked = toggleFilter({ status: ['ACTIVE'], unit: ['HRMO'] }, 'status', 'ON_LEAVE');
  expect(picked).toEqual({ status: ['ACTIVE', 'ON_LEAVE'], unit: ['HRMO'] });
  expect(toggleFilter(picked, 'status', 'ACTIVE')).toEqual({
    status: ['ON_LEAVE'],
    unit: ['HRMO'],
  });
  expect(toggleFilter({}, 'unit', 'HRMO')).toEqual({ unit: ['HRMO'] });
});

it('renders each group as a labelled fieldset with checked state and counts', () => {
  const html = renderToStaticMarkup(
    <FilterPanel
      groups={[
        {
          key: 'status',
          label: 'Service status',
          options: [
            { value: 'ACTIVE', label: 'Active', count: 12 },
            { value: 'SEPARATED', label: 'Separated', count: 3 },
          ],
        },
      ]}
      selected={{ status: ['SEPARATED'] }}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('<legend');
  expect(html).toContain('Service status');
  expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  expect(html.match(/checked=""/g)).toHaveLength(1);
  expect(html).toMatch(/Separated<\/span> <span[^>]*>3<\/span>/);
});
