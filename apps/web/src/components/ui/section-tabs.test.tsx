import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SectionTabLinks, SectionTabList, SectionTabPanel, SectionTabs } from './section-tabs';

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

it('renders page-switching tabs as a labelled navigation that marks the current page', () => {
  const html = renderToStaticMarkup(
    <SectionTabLinks
      label="Organization workspace"
      tabs={[
        { href: '/organization', label: 'Organization Units', current: false },
        { href: '/organization?workspace=agency', label: 'Agency Profile', current: true },
      ]}
    />,
  );
  expect(html).toMatch(/^<nav aria-label="Organization workspace"/);
  const links = [...html.matchAll(/<a[^>]*>[^<]*<\/a>/g)].map((match) => match[0]);
  expect(links).toHaveLength(2);
  expect(links[0]).toContain('href="/organization"');
  expect(links[0]).not.toContain('aria-current');
  expect(links[1]).toContain('aria-current="page"');
  expect(links[1]).toContain('Agency Profile');
});
