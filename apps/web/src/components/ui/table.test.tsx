import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RowHeader } from './table';

it('names its row for assistive technology', () => {
  const html = renderToStaticMarkup(
    <table>
      <tbody>
        <tr>
          <RowHeader>Records Division</RowHeader>
        </tr>
      </tbody>
    </table>,
  );
  expect(html).toMatch(/<th scope="row"[^>]*>Records Division<\/th>/);
});
