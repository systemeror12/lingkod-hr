import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

it('renders an open record Form in the page with its accessible heading and description', () => {
  const html = renderToStaticMarkup(
    createElement(Dialog, {
      open: true,
      presentation: 'form',
      children: createElement(DialogContent, {
        'aria-describedby': 'record-description',
        children: [
          createElement(DialogTitle, { key: 'title' }, 'Employee record'),
          createElement(
            DialogDescription,
            { key: 'description', id: 'record-description' },
            'Selected Employee',
          ),
        ],
      }),
    }),
  );
  expect(html).toContain('role="region"');
  expect(html).toContain('aria-describedby="record-description"');
  const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
  expect(titleId).toBeTruthy();
  expect(html).toContain(`id="${titleId}"`);
  expect(html).toContain('Employee record');
  expect(html).not.toContain('role="dialog"');
});
