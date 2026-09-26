import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SectionTabList, SectionTabPanel, SectionTabs } from './section-tabs';

it('renders a labelled tablist whose selected tab controls its panel', () => {
  const html = renderToStaticMarkup(
    <SectionTabs value="service" onValueChange={() => {}}>
      <SectionTabList
        label="Record sections"
        tabs={[
          { value: 'summary', label: 'Summary' },
          { value: 'service', label: 'Service record' },
        ]}
      />
      <SectionTabPanel value="service">Rows</SectionTabPanel>
    </SectionTabs>,
  );
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Record sections"');
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => match[0]);
  expect(tabs).toHaveLength(2);
  const selected = tabs.find((tab) => tab.includes('aria-selected="true"'));
  expect(selected).toContain('trigger-service');
  expect(tabs.filter((tab) => tab.includes('aria-selected="false"'))).toHaveLength(1);
  const panelId = selected?.match(/aria-controls="([^"]+)"/)?.[1];
  const tabId = selected?.match(/ id="([^"]+)"/)?.[1];
  expect(html).toMatch(
    new RegExp(`role="tabpanel"[^>]*aria-labelledby="${tabId}"[^>]*id="${panelId}"`),
  );
});
