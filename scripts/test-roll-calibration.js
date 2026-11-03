// The statistics in scripts/roll-calibration.js against textbook values. No game needed.
'use strict';
const { chi } = require('./roll-calibration.js');
let fail = 0;
const ok = (name, cond, extra) => { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 15 equal cells, 200 draws: a perfectly flat sample has chi2 0 and p 1
let r = chi(new Array(15).fill(200 / 15), new Array(15).fill(200 / 15));
ok('flat sample: chi2 0, p 1', r.x < 1e-9 && near(r.p, 1, 1e-9) && r.df === 14, JSON.stringify(r));
// chi2 = 26.086 with 14 degrees of freedom has p = 0.0252 (tables); build cells whose statistic is exactly that
const e = new Array(15).fill(10), o = e.slice(); o[0] = 10 + Math.sqrt(26.0861 * 10 * 1); o[1] = 10 - Math.sqrt(0); // one cell carries the whole statistic
r = chi(o, e);
ok('p of chi2 26.09, df 14 is about 0.025', near(r.p, 0.0252, 0.002) && r.df === 14, JSON.stringify(r));
// cells with a small expected count are pooled into one
r = chi([1, 1, 1, 1, 30], [1, 1, 1, 1, 30]);
ok('small cells pool', r.df === 1 || r.df === 0, JSON.stringify(r));
// known table value: chi2 = 3.841 with 1 degree of freedom has p = 0.05
const d1 = Math.sqrt(3.841 * 10 / 2); r = chi([10 + d1, 10 - d1], [10, 10]);
ok('p of chi2 3.84 at df 1 is 0.05', near(r.p, 0.05, 0.002) && r.df === 1, JSON.stringify(r));
console.log(fail ? fail + ' failed' : 'all passed');
process.exit(fail ? 1 : 0);
