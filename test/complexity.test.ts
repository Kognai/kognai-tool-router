import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRules } from '../src/classify/rules';

const cx = (t: string) => classifyRules(t).task_complexity;

test('SIMPLE: one capability, arguments present; also no tool answers', () => {
  assert.equal(cx('weather in Tunis today'), 'SIMPLE');
  assert.equal(cx('make me a logo for my bakery'), 'SIMPLE');
  assert.equal(cx('what is the capital of Australia'), 'SIMPLE');
});

test('MEDIUM: two capabilities, or a missing argument', () => {
  assert.equal(cx('summarise my emails'), 'MEDIUM');
  assert.equal(cx('what will the weather be'), 'MEDIUM');
  assert.equal(cx('make a video and a poster for the launch'), 'MEDIUM');
});

test('COMPLEX: three or more capabilities, or a chain', () => {
  assert.equal(cx('make a video with music and a voice over'), 'COMPLEX');
  assert.equal(cx('make a poster then post it on Instagram'), 'COMPLEX');
});

test('REASONING: analysis, comparison or synthesis cues, whatever the tool count', () => {
  assert.equal(cx('compare the two vaccines'), 'REASONING');
  assert.equal(cx('why is the sky blue'), 'REASONING');
  assert.equal(cx('find papers and assess the evidence on fasting'), 'REASONING');
  assert.equal(cx('quels sont les avantages et inconvenients du solaire'), 'REASONING');
});
