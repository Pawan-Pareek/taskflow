// Tests for js/quickparse.js. Run: node scripts/test-quickparse.js
const assert = require('assert');
require('../js/quickparse.js');
const Q = globalThis.QuickParse;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok   ' + name); }
// Friday 2026-11-06, 10:30 in the morning
const NOW = new Date(2026, 10, 6, 10, 30);
const one = (text, now) => Q.parse(text, now || NOW).tasks[0];

test('the example: call Jenis at 12 pm tomorrow', () => {
    const t = one('I want to call Jenis at 12 pm tomorrow');
    assert.strictEqual(t.title, 'Call Jenis');
    assert.strictEqual(t.date, '2026-11-07');
    assert.strictEqual(t.time, '12:00');
    assert.strictEqual(t.repeat, 'none');
});

test('word order does not matter', () => {
    const t = one('tomorrow at 12pm call Jenis');
    assert.strictEqual(t.title, 'Call Jenis');
    assert.strictEqual(t.date, '2026-11-07');
    assert.strictEqual(t.time, '12:00');
});

test('times: 5:30 pm, 17:00, at 5 (afternoon), noon, evening', () => {
    assert.strictEqual(one('Gym at 5:30 pm').time, '17:30');
    assert.strictEqual(one('Gym 17:00').time, '17:00');
    assert.strictEqual(one('Call mom at 5').time, '17:00');
    assert.strictEqual(one('Lunch with Ravi at noon').time, '12:00');
    assert.strictEqual(one('Walk in the evening').time, '18:00');
    assert.strictEqual(one('Pay rent 9am').time, '09:00');
});

test('a time already passed today moves to tomorrow', () => {
    assert.strictEqual(one('Take medicine at 9 am').date, '2026-11-07'); // it is 10:30 now
    assert.strictEqual(one('Take medicine at 11 am').date, '2026-11-06');
});

test('days of the week and next', () => {
    assert.strictEqual(one('Submit report on Monday').date, '2026-11-09');
    assert.strictEqual(one('Team lunch next friday').date, '2026-11-13');
    assert.strictEqual(one('Team lunch friday').date, '2026-11-06'); // today is Friday
    assert.strictEqual(one('Dentist day after tomorrow').date, '2026-11-08');
    assert.strictEqual(one('Renew passport in 3 days').date, '2026-11-09');
    assert.strictEqual(one('Plan trip in 2 weeks').date, '2026-11-20');
});

test('calendar dates', () => {
    assert.strictEqual(one('Mom birthday on 12 Nov').date, '2026-11-12');
    assert.strictEqual(one('Pay insurance Dec 3rd').date, '2026-12-03');
    assert.strictEqual(one('Tax filing 15/1').date, '2027-01-15'); // day/month, already passed this year
    assert.strictEqual(one('Mom birthday on 12 Nov').title, 'Mom birthday');
});

test('in 2 hours sets today and the time', () => {
    const t = one('Check the oven in 2 hours');
    assert.strictEqual(t.date, '2026-11-06');
    assert.strictEqual(t.time, '12:30');
    assert.strictEqual(t.title, 'Check the oven');
});

test('repeats and priority', () => {
    assert.strictEqual(one('Drink water every day at 8 am').repeat, 'daily');
    const w = one('Team sync every Monday at 10 am');
    assert.strictEqual(w.repeat, 'weekly');
    assert.strictEqual(w.date, '2026-11-09');
    assert.strictEqual(w.title, 'Team sync');
    assert.strictEqual(one('Pay rent monthly').repeat, 'monthly');
    assert.strictEqual(one('Urgent: send the invoice today').priority, 'urgent');
});

test('Hinglish basics: kal, baje', () => {
    const t = one('kal 12 baje Jenis ko call karna');
    assert.strictEqual(t.date, '2026-11-07');
    assert.strictEqual(t.time, '12:00');
});

test('tonight', () => {
    const t = one('Watch the match tonight');
    assert.strictEqual(t.date, '2026-11-06');
    assert.strictEqual(t.time, '21:00');
    assert.strictEqual(t.title, 'Watch the match');
});

test('plain tasks have no cues and keep their words', () => {
    assert.strictEqual(Q.hasCues('Buy milk'), false);
    assert.strictEqual(Q.hasCues('Review the budget'), false);
    assert.strictEqual(Q.hasCues('call Jenis at 12 pm tomorrow'), true);
    assert.strictEqual(Q.hasCues('Submit on 12 Nov'), true);
    const t = one('Buy milk');
    assert.strictEqual(t.title, 'Buy milk');
    assert.strictEqual(t.date, null);
    assert.strictEqual(t.time, null);
});

test('filler words are removed from the title', () => {
    assert.strictEqual(one('Remind me to pay the electricity bill tomorrow').title, 'Pay the electricity bill');
    assert.strictEqual(one("Don't forget to water the plants tonight").title, 'Water the plants');
    assert.strictEqual(one('I need to book flights on Monday').title, 'Book flights');
});

console.log('\n' + passed + ' tests passed');
