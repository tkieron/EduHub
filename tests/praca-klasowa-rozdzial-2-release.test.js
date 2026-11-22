const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const releasePaths = [
  join(__dirname, '../catalog/apps/praca-klasowa-rozdzial-2/1.0.0/index.html'),
  join(__dirname, '../deliverables/Praca_Klasowa_Rozdzial_2_v1.0.0.html'),
];
const releasePath = releasePaths.find(path => existsSync(path));
assert.ok(releasePath, `Release HTML not found at ${releasePaths.join(' or ')}`);
const html = readFileSync(releasePath, 'utf8');

function inlineScript(id) {
  const matchingScripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu))
    .filter(([, attributes]) => /(?:^|\s)id\s*=\s*(["'])(.*?)\1/iu.exec(attributes)?.[2] === id);
  assert.equal(matchingScripts.length, 1, `Expected one inline script with the ID ${id}`);
  return matchingScripts[0][2];
}

const bank = JSON.parse(inlineScript('question-data'));
const sandbox = vm.createContext({});
vm.runInContext(inlineScript('learning-core'), sandbox, { filename: `${releasePath}#learning-core`, timeout: 1000 });
const core = sandbox.LearningCore;
assert.ok(core, 'The inline script must expose LearningCore in a browser-like context');

const quotas = { voice: 5, noun: 4, case: 7, capital: 5, quote: 4 };
const topics = Object.keys(quotas);
const types = ['choice', 'fields', 'match', 'multi'];
const nonEmptyText = value => typeof value === 'string' && value.trim().length > 0;

function assertOptions(options, location) {
  assert.ok(Array.isArray(options) && options.length >= 2 && options.every(nonEmptyText), `${location}: expected two or more text options`);
  assert.equal(new Set(options).size, options.length, `${location}: duplicate options`);
}

function assertOptionIndex(index, options, location) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < options.length, `${location}: option index ${index} is out of bounds`);
}

function canonicalValues(question) {
  switch (question.type) {
    case 'choice': return [question.answer];
    case 'multi': return question.options.map((_, index) => question.answers.includes(index));
    case 'fields': return question.fields.map(field => field.answers[0]);
    case 'match': return question.rows.map(row => row.answer);
    default: throw new Error(`Unknown question type: ${question.type}`);
  }
}

function oneWrongValue(question, correctValues) {
  const values = [...correctValues];
  let index = 0;
  const wrongText = '\u2603';

  switch (question.type) {
    case 'choice':
      values[0] = (question.answer + 1) % question.options.length;
      break;
    case 'multi':
      index = correctValues.indexOf(false);
      if (index < 0) index = 0;
      values[index] = !correctValues[index];
      break;
    case 'fields': {
      const field = question.fields[0];
      const accepted = new Set(field.answers.map(answer => core.normalize(answer, field.strictCase)));
      values[0] = field.options?.find(option => !accepted.has(core.normalize(option, field.strictCase))) ?? wrongText;
      break;
    }
    case 'match':
      values[0] = correctValues.find(answer => core.normalize(answer) !== core.normalize(correctValues[0])) ?? wrongText;
      break;
  }

  return { values, index };
}

test('the embedded bank contains unique questions with valid answer data across five topics', () => {
  assert.ok(Array.isArray(bank) && bank.length >= 90, 'Expected at least 90 practice questions');
  assert.deepEqual([...new Set(bank.map(question => question.topic))].sort(), [...topics].sort());
  assert.deepEqual([...new Set(bank.map(question => question.type))].sort(), types);
  const ids = new Set();

  for (const question of bank) {
    const { id, type } = question;
    assert.ok(nonEmptyText(id), 'Question ID must be nonempty text');
    assert.ok(!ids.has(id), `Duplicate question ID: ${id}`);
    ids.add(id);

    if (type === 'choice' || type === 'multi') assertOptions(question.options, id);
    if (type === 'choice') assertOptionIndex(question.answer, question.options, id);

    if (type === 'multi') {
      assert.ok(Array.isArray(question.answers) && question.answers.length > 0, `${id}: no multiple-selection answers`);
      assert.equal(new Set(question.answers).size, question.answers.length, `${id}: duplicate answer indices`);
      for (const index of question.answers) assertOptionIndex(index, question.options, id);
    }

    if (type === 'fields') {
      assert.ok(Array.isArray(question.fields) && question.fields.length > 0, `${id}: no answer fields`);
      question.fields.forEach((field, index) => {
        const location = `${id}, field ${index + 1}`;
        assert.ok(nonEmptyText(field.label), `${location}: missing label`);
        assert.ok(Array.isArray(field.answers) && field.answers.length > 0 && field.answers.every(nonEmptyText), `${location}: no text answers`);
        if (field.strictCase !== undefined) assert.equal(typeof field.strictCase, 'boolean', `${location}: invalid strictCase`);
        if (field.options !== undefined) {
          assertOptions(field.options, location);
          assert.ok(field.options.includes(field.answers[0]), `${location}: the displayed solution must be a selectable option`);
        }
      });
    }

    if (type === 'match') {
      assert.ok(Array.isArray(question.rows) && question.rows.length > 0, `${id}: no matching rows`);
      for (const row of question.rows) {
        assert.ok(nonEmptyText(row.label) && nonEmptyText(row.answer), `${id}: a matching row is missing a label or answer`);
      }
    }
  }
});

test('every embedded canonical answer resolves at two points exactly once', () => {
  for (const question of bank) {
    const values = canonicalValues(question);
    const attempt = { ...core.createAttempt(question), values };
    const resolved = core.check(question, attempt);
    assert.equal(resolved.done, true, question.id);
    assert.equal(resolved.phase, 'resolved', question.id);
    assert.equal(resolved.score, 2, question.id);
    assert.equal(resolved.checks, 1, question.id);
    assert.equal(resolved.hadError, false, question.id);
    assert.deepEqual(Array.from(resolved.marks), values.map(() => 'green'), question.id);
    assert.deepEqual(core.check(question, resolved), resolved, question.id);
  }
});

test('correcting one missed slot leaves the other answers green and awards one point', () => {
  for (const question of bank) {
    const canonical = canonicalValues(question);
    const { values, index } = oneWrongValue(question, canonical);
    const attempt = { ...core.createAttempt(question), values };
    const missed = core.check(question, attempt);
    assert.equal(missed.done, false, question.id);
    assert.equal(missed.hadError, true, question.id);
    assert.deepEqual(Array.from(missed.marks), values.map((_, slot) => slot === index ? 'red' : 'green'), question.id);

    const editing = core.correct(question, missed);
    const expectedValues = [...values];
    expectedValues[index] = question.type === 'multi' ? false : '';
    assert.deepEqual(Array.from(editing.values), expectedValues, question.id);
    assert.deepEqual(Array.from(editing.marks), values.map((_, slot) => slot === index ? 'neutral' : 'green'), question.id);
    const resolved = core.check(question, { ...editing, values: canonical });
    assert.equal(resolved.score, 1, question.id);
    assert.equal(resolved.checks, 2, question.id);
  }
});

test('revealing an answer for every missed question preserves green slots and marks the solution yellow', () => {
  for (const question of bank) {
    const canonical = canonicalValues(question);
    const { values, index } = oneWrongValue(question, canonical);
    const attempt = { ...core.createAttempt(question), values };
    const missed = core.check(question, attempt);
    const shown = core.reveal(question, missed);

    assert.equal(shown.done, true, question.id);
    assert.equal(shown.revealed, true, question.id);
    assert.equal(shown.hadError, true, question.id);
    assert.equal(shown.score, 0, question.id);
    assert.deepEqual(Array.from(shown.values), canonical, question.id);
    assert.deepEqual(Array.from(shown.marks), values.map((_, slot) => slot === index ? 'yellow' : 'green'), question.id);
    assert.deepEqual(core.check(question, shown), shown, question.id);
  }
});

test('blank and partially blank answers do not count as graded attempts', () => {
  for (const question of bank) {
    const attempt = core.createAttempt(question);
    const values = Array.from(attempt.values);
    if (question.type !== 'multi') {
      values.splice(0, values.length, ...canonicalValues(question));
      values[0] = '  ';
    }
    const result = core.check(question, { ...attempt, values });

    assert.ok(nonEmptyText(result.validation), question.id);
    assert.equal(result.checks, 0, question.id);
    assert.equal(result.score, null, question.id);
    assert.equal(result.hadError, false, question.id);
    assert.equal(result.done, false, question.id);
    assert.deepEqual(Array.from(result.marks), values.map(() => 'neutral'), question.id);
  }
});

test('the exam uses the intended quotas across all five topics despite a training filter', () => {
  const selected = core.selectQuestions(bank, { mode: 'exam', topics: ['quote'], count: 1, rng: () => 0.5 });
  assert.equal(selected.length, 25);
  assert.equal(new Set(selected.map(question => question.id)).size, 25);
  assert.deepEqual(Object.fromEntries(topics.map(topic => [topic, selected.filter(question => question.topic === topic).length])), quotas);
});

test('a retry contains only the distinct resolved questions that had errors', () => {
  const [correct, corrected, shown, incomplete] = bank;
  const firstTry = { questionId: correct.id, topic: correct.topic, score: 2, hadError: false, revealed: false };
  const records = [
    firstTry,
    { questionId: corrected.id, topic: corrected.topic, score: 1, hadError: true, revealed: false },
    { questionId: shown.id, topic: shown.topic, score: 0, hadError: true, revealed: true },
    { questionId: incomplete.id, topic: incomplete.topic, score: null, hadError: true, revealed: false },
  ];

  const summary = core.summarize(records);
  assert.equal(summary.total, 3);
  const requested = [...summary.retryIds, corrected.id, 'unknown-test-id'];
  const retry = core.selectQuestions(bank, { mode: 'retry', topics: ['quote'], count: 25, ids: requested });
  assert.deepEqual(Array.from(retry, question => question.id), [corrected.id, shown.id]);
  assert.deepEqual(Array.from(core.summarize([firstTry]).retryIds), []);
  assert.equal(core.selectQuestions(bank, { mode: 'retry', ids: [] }).length, 0);
});
