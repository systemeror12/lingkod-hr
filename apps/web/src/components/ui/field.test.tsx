import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Field, FormError } from './field';

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

it('announces a form error that callers can make focusable, and renders nothing without one', () => {
  const html = renderToStaticMarkup(
    createElement(FormError, { message: 'Could not save', tabIndex: -1 }),
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain('Could not save');
  expect(renderToStaticMarkup(createElement(FormError, { message: '' }))).toBe('');
});
