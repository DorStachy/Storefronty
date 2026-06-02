import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classifier/index.js';

const intent = (t) => classify(t).intent;

test('opt-out: real unsubscribe commands', () => {
  assert.equal(intent('STOP'), 'opt_out');
  assert.equal(intent('please stop emailing me'), 'opt_out');
  assert.equal(intent('unsubscribe'), 'opt_out');
  assert.equal(intent('take me off your list'), 'opt_out');
  assert.equal(intent('not interested, thanks'), 'opt_out');
});

test('opt-out does NOT fire on "stop"/"remove" used as edit verbs', () => {
  assert.equal(intent('stop the red logo from blinking'), 'edit_request');   // the key bug
  assert.equal(intent('can you remove the giant logo?'), 'edit_request');
  assert.equal(intent('stop using comic sans please'), 'edit_request');
});

test('acknowledgements are NOT edit requests', () => {
  assert.equal(intent('thanks!'), 'other');
  assert.equal(intent('thank you'), 'other');
  assert.equal(intent('got it, ok'), 'other');
  // …but a thank-you with an actual ask is still an edit
  assert.equal(intent('thanks, can you make it navy?'), 'edit_request');
});

test('out-of-office / automatic replies are detected (and not acted on)', () => {
  assert.equal(intent('I am out of office until Monday'), 'auto_reply');
  assert.equal(intent('Automatic reply: currently on vacation'), 'auto_reply');
  assert.equal(intent('Thank you for your email. I am away from my desk.'), 'auto_reply');
});

test('angry / legal-ish replies', () => {
  assert.equal(intent('this is a scam, I will report you'), 'angry');
  assert.equal(intent('my lawyer will be in touch'), 'angry');
});

test('pricing questions', () => {
  assert.equal(intent('how much does this cost?'), 'question');
  assert.equal(intent('what are your prices'), 'question');
});

test('a genuine change is an edit_request, with the change text captured', () => {
  const r = classify('make the hero photo bigger and add our menu');
  assert.equal(r.intent, 'edit_request');
  assert.match(r.change, /hero photo bigger/);
});

test('empty / whitespace → other', () => {
  assert.equal(intent(''), 'other');
  assert.equal(intent('   \n  '), 'other');
});
