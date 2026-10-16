import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesRatingRange } from '../src/lib/search/ratingFilter';

describe('Filtro por faixa de notas do Google', () => {
  it('preserva o comportamento sem filtro', () => {
    assert.equal(matchesRatingRange(undefined, { minRating: 0 }), true);
    assert.equal(matchesRatingRange(5, { minRating: 0 }), true);
  });
  it('encontra notas semelhantes a 3,5 (de 3,0 a 3,9, inclusive)', () => {
    const range = { minRating: 3, maxRating: 3.9 };
    for (const rating of [3, 3.2, 3.5, 3.9]) {
      assert.equal(matchesRatingRange(rating, range), true, String(rating));
    }
    for (const rating of [0, 2.9, 4, 4.8, undefined]) {
      assert.equal(matchesRatingRange(rating, range), false, String(rating));
    }
  });
  it('aceita apenas 3,5 quando o mínimo e o máximo são 3,5', () => {
    const range = { minRating: 3.5, maxRating: 3.5 };
    assert.equal(matchesRatingRange(3.5, range), true);
    assert.equal(matchesRatingRange(3.4, range), false);
    assert.equal(matchesRatingRange(3.6, range), false);
  });
  it('preserva o filtro original de nota mínima', () => {
    assert.equal(matchesRatingRange(4.9, { minRating: 3.5 }), true);
    assert.equal(matchesRatingRange(3.4, { minRating: 3.5 }), false);
  });
  it('não inclui empresas sem nota ao usar somente máximo', () => {
    assert.equal(matchesRatingRange(3.5, { minRating: 0, maxRating: 3.5 }), true);
    assert.equal(matchesRatingRange(4.8, { minRating: 0, maxRating: 3.5 }), false);
    assert.equal(matchesRatingRange(0, { minRating: 0, maxRating: 3.5 }), false);
    assert.equal(matchesRatingRange(undefined, { minRating: 0, maxRating: 3.5 }), false);
  });
});
