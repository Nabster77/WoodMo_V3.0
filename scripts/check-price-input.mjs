import assert from 'node:assert/strict';
import { parsePriceInput } from '../src/lib/priceInput.ts';

const ok = (input, value) => { const r = parsePriceInput(input); assert.equal(r.ok, true, input); assert.equal(r.value, value, input); };
const bad = (input) => assert.equal(parsePriceInput(input).ok, false, `muss abgelehnt werden: "${input}"`);

ok('5', 5); ok('4,5', 4.5); ok('4.50', 4.5); ok(' 12,00 € ', 12); ok('0', 0); ok('0,1', 0.1); ok('4,', 4); ok('99999', 99999);
for (const input of ['', '   ', 'abc', '-5', '-0,5', '1.234,50', '1,234.50', '1.234.567', '4,555', '4,5o', '4 5', '100000', '1e3', '0x10']) bad(input);
console.log('check-price-input: ok');
