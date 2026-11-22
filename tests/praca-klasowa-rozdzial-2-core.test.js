const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { compileFunction } = require('node:vm');

const releasePaths = [
  join(__dirname, '../catalog/apps/praca-klasowa-rozdzial-2/1.0.0/index.html'),
  join(__dirname, '../deliverables/Praca_Klasowa_Rozdzial_2_v1.0.0.html'),
];
const releasePath = releasePaths.find(path => existsSync(path));
assert.ok(releasePath, `Release HTML not found at ${releasePaths.join(' or ')}`);
const html = readFileSync(releasePath, 'utf8');
const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu))
  .filter(([, attributes]) => /(?:^|\s)id\s*=\s*(["'])(.*?)\1/iu.exec(attributes)?.[2] === 'learning-core');
assert.equal(scripts.length, 1, 'Expected one inline script with the ID learning-core');

// Use the current realm so strict comparisons see the same array and object prototypes.
const bundledModule = { exports: {} };
const loadCore = compileFunction(scripts[0][2], ['module', 'globalThis'], { filename: `${releasePath}#learning-core` });
loadCore(bundledModule, {});
const core = bundledModule.exports;

const choice = { id: 'choice', topic: 'voice', type: 'choice', options: ['czynna', 'bierna'], answer: 0 };
const multi = { id: 'multi', topic: 'noun', type: 'multi', options: ['kot', 'biega', 'pies', 'wolno', 'ogród'], answers: [0, 2, 4] };
const fields = {
  id: 'fields', topic: 'capital', type: 'fields', fields: [
    { label: 'Miasto', answers: ['Łódź'], strictCase: true },
    { label: 'Przymiotnik', answers: ['łódzki', 'łódzka'] },
  ],
};
const match = {
  id: 'match', topic: 'case', type: 'match', rows: [
    { label: 'kogo? czego?', answer: 'dopełniacz' },
    { label: 'komu? czemu?', answer: 'celownik' },
  ],
};

test('each format starts with as many neutral slots as the form displays', () => {
  assert.deepEqual(core.initialValues(choice), ['']);
  assert.deepEqual(core.initialValues(multi), [false, false, false, false, false]);
  assert.deepEqual(core.initialValues(fields), ['', '']);
  assert.deepEqual(core.createAttempt(match), {
    values: ['', ''], marks: ['neutral', 'neutral'], phase: 'answer', checks: 0,
    hadError: false, revealed: false, done: false, score: null, hintUsed: false,
  });
});

test('a multiple selection correction keeps correctly selected and deselected slots', () => {
  const submitted = { ...core.createAttempt(multi), values: [true, true, false, false, false] };
  const checked = core.check(multi, submitted);
  assert.deepEqual(checked.marks, ['green', 'red', 'red', 'green', 'red']);
  assert.equal(checked.phase, 'feedback');
  assert.equal(checked.done, false);
  assert.equal(checked.hadError, true);
  const corrected = core.correct(multi, checked);
  assert.deepEqual(corrected.values, [true, false, false, false, false]);
  assert.deepEqual(corrected.marks, ['green', 'neutral', 'neutral', 'green', 'neutral']);
  assert.equal(corrected.phase, 'answer');
  const second = core.check(multi, { ...corrected, values: [true, false, true, false, false] });
  const third = core.correct(multi, second);
  assert.deepEqual(third.marks, ['green', 'green', 'green', 'green', 'neutral']);
  assert.deepEqual(third.values, [true, false, true, false, false]);
  assert.equal(core.check(multi, { ...third, values: [true, false, true, false, true] }).score, 1);
  assert.deepEqual(submitted.values, [true, true, false, false, false]);
  assert.deepEqual(checked.marks, ['green', 'red', 'red', 'green', 'red']);
});

test('a repaired incorrect choice earns one point even when the correct index is zero', () => {
  const wrong = core.check(choice, { ...core.createAttempt(choice), values: [1] });
  assert.deepEqual(wrong.marks, ['red']);
  const repaired = core.correct(choice, wrong);
  assert.deepEqual(repaired.values, ['']);
  const resolved = core.check(choice, { ...repaired, values: ['0'] });
  assert.equal(resolved.score, 1);
  assert.equal(resolved.phase, 'resolved');
  assert.equal(resolved.checks, 2);
});

test('fields accept declared alternative spellings, NFC equivalents, and case folding when allowed', () => {
  assert.deepEqual(core.evaluate(fields, [' Ło\u0301dz\u0301 ', ' ŁÓDZKA ']), [true, true]);
  assert.deepEqual(core.evaluate(fields, ['łódź', 'lodzki']), [false, false]);
  assert.deepEqual(core.evaluate(fields, ['Lódź', 'łódzki']), [false, true]);
});

test('typographic quotes, dashes and whitespace normalize without dropping other punctuation', () => {
  assert.equal(core.normalize('  „Nie  wiem” —\u00a0dodała. ', true), '"Nie wiem" - dodała.');
  assert.equal(core.normalize('«Żółć»'), '"żółć"');
  assert.equal(core.normalize('“A?”'), '"a?"');
  assert.notEqual(core.normalize('„Tak”.'), core.normalize('„Tak.”'));
  assert.notEqual(core.normalize('„tak”'), core.normalize('tak'));
});

test('a revealed answer keeps the correct rows green and fills only the incorrect rows', () => {
  const wrong = core.check(match, { ...core.createAttempt(match), values: ['DOPEŁNIACZ', 'biernik'] });
  const shown = core.reveal(match, wrong);
  assert.deepEqual(shown.values, ['DOPEŁNIACZ', 'celownik']);
  assert.deepEqual(shown.marks, ['green', 'yellow']);
  assert.equal(shown.done, true);
  assert.equal(shown.phase, 'resolved');
  assert.equal(shown.revealed, true);
  assert.equal(shown.hadError, true);
  assert.equal(shown.score, 0);
  assert.deepEqual(core.check(match, shown), shown);
});

test('reveal can resolve an untouched attempt in every answer format', () => {
  assert.deepEqual(core.reveal(choice, core.createAttempt(choice)).values, [0]);
  assert.deepEqual(core.reveal(multi, core.createAttempt(multi)).values, [true, false, true, false, true]);
  assert.deepEqual(core.reveal(fields, core.createAttempt(fields)).values, ['Łódź', 'łódzki']);
  assert.deepEqual(core.reveal(match, core.createAttempt(match)).marks, ['yellow', 'yellow']);
});

test('extra actions on a resolved attempt cannot change scoring or increment checks', () => {
  const resolved = core.check(choice, { ...core.createAttempt(choice), values: [0] });
  assert.equal(resolved.score, 2);
  assert.equal(resolved.checks, 1);
  assert.deepEqual(core.check(choice, resolved), resolved);
  assert.deepEqual(core.reveal(choice, resolved), resolved);
  assert.deepEqual(core.correct(choice, resolved), resolved);
});

test('incomplete submissions receive validation without producing check or error marks', () => {
  const incomplete = [
    [choice, [' '], ['neutral']],
    [multi, [false, false, false, false, false], ['neutral', 'neutral', 'neutral', 'neutral', 'neutral']],
    [fields, ['Łódź', ' '], ['neutral', 'neutral']],
    [match, [' ', 'celownik'], ['neutral', 'neutral']],
  ];
  for (const [question, values, marks] of incomplete) {
    const attempt = { ...core.createAttempt(question), values };
    const result = core.check(question, attempt);
    assert.equal(result.validation, 'Uzupełnij wszystkie odpowiedzi.');
    assert.deepEqual(result.marks, marks);
    assert.equal(result.checks, 0);
    assert.equal(result.hadError, false);
    assert.equal(result.score, null);
    assert.equal(result.phase, 'answer');
  }
});

const bank = Object.freeze(['voice', 'noun', 'case', 'capital', 'quote'].flatMap(topic =>
  Array.from({ length: 10 }, (_, index) => Object.freeze({ topic, id: `${topic}-${index}` }))
));

test('training spreads its slots among selected topics and rejects an empty selection', () => {
  const selected = core.selectQuestions(bank, { mode: 'training', topics: ['case', 'quote', 'quote'], count: 3, rng: () => 0 });
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map(question => question.id)).size, 3);
  assert.deepEqual([...new Set(selected.map(question => question.topic))].sort(), ['case', 'quote']);
  assert.deepEqual(core.selectQuestions(bank, { mode: 'training', topics: [], count: 3 }), []);
});

test('adventure draws 15 questions from all five topics', () => {
  const selected = core.selectQuestions(bank, { mode: 'adventure', topics: ['voice'], count: 1, rng: () => 0 });
  assert.equal(selected.length, 15);
  assert.equal(new Set(selected.map(question => question.id)).size, 15);
  assert.equal(new Set(selected.map(question => question.topic)).size, 5);
});

test('exam uses the five quotas even when a single topic and smaller count are supplied', () => {
  const selected = core.selectQuestions(bank, { mode: 'exam', topics: ['quote'], count: 1, rng: () => 0 });
  assert.equal(selected.length, 25);
  assert.equal(new Set(selected.map(question => question.id)).size, 25);
  const counts = selected.reduce((result, { topic }) => ({ ...result, [topic]: (result[topic] || 0) + 1 }), {});
  assert.deepEqual(counts, { voice: 5, noun: 4, case: 7, capital: 5, quote: 4 });
});

test('exam replaces a quota shortage with other available questions without duplicates', () => {
  const reduced = bank.filter(({ topic, id }) => topic !== 'case' || id === 'case-0');
  const selected = core.selectQuestions([...reduced, reduced[0]], { mode: 'exam', rng: () => 0.5 });
  assert.equal(selected.length, 25);
  assert.equal(selected.filter(question => question.topic === 'case').length, 1);
  assert.equal(new Set(selected.map(question => question.id)).size, 25);
});

test('retry resolves exactly the requested known IDs in supplied order, once each', () => {
  const options = { mode: 'retry', count: 1, topics: ['noun'], ids: ['quote-5', 'case-2', 'missing', 'quote-5'] };
  assert.deepEqual(core.selectQuestions(bank, options).map(question => question.id), ['quote-5', 'case-2']);
  assert.deepEqual(core.selectQuestions(bank, { mode: 'retry', ids: [] }), []);
});

test('summary counts resolved attempts and proposes a unique retry list only for errors', () => {
  const records = [
    { questionId: 'a', topic: 'case', score: 2, hadError: false, revealed: false },
    { questionId: 'b', topic: 'case', score: 1, hadError: true, revealed: false },
    { questionId: 'c', topic: 'quote', score: 0, hadError: true, revealed: true },
    { questionId: 'c', topic: 'quote', score: 1, hadError: true, revealed: false },
    { questionId: 'd', topic: 'quote', score: null, hadError: true, revealed: false },
  ];
  assert.deepEqual(core.summarize(records), {
    total: 4, maxScore: 8, score: 4, percent: 50, firstTry: 1, corrected: 2, shown: 1,
    retryIds: ['b', 'c'], byTopic: { case: { total: 2, score: 3, maxScore: 4 }, quote: { total: 2, score: 1, maxScore: 4 } },
  });
});

test('a perfect round has no retry questions and an empty round scores zero percent', () => {
  const records = [{ questionId: 'a', topic: 'voice', score: 2, hadError: false, revealed: false }];
  assert.deepEqual(core.summarize(records).retryIds, []);
  assert.equal(core.summarize(records).percent, 100);
  assert.equal(core.summarize([]).percent, 0);
});
