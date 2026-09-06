import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Field } from './field';

it('associates server validation errors with the labeled control and preserves its help text', () => {
  const html = renderToStaticMarkup(
    createElement(Field, {
      label: 'Employee number',
      error: 'Already used',
      children: createElement('input', { 'aria-describedby': 'number-help' }),
    }),
  );
  expect(html).toContain('aria-invalid="true"');
  const errorId = html.match(/<span id="([^"]+)"/)?.[1];
  expect(errorId).toBeTruthy();
  expect(html).toContain(`aria-describedby="number-help ${errorId}"`);
  expect(html).toContain('Already used');
});
