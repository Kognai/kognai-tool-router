import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRules, maskData } from '../src/classify/rules';
import type { RiskClass } from '../src/types/tool';

// 40 cue cases: the request, a class that must be present, and classes that must be absent
const CASES: Array<[string, RiskClass[], RiskClass[]]> = [
  ['Send 50 USDC to 0x1111111111111111111111111111111111111111', ['payment', 'sensitive_data'], []],
  ['transfer 2 SOL to my friend', ['payment'], []],
  ['pay my electricity bill', ['payment'], []],
  ['buy 2 SOL of $BONK', ['payment'], []],
  ['sell all my ETH now', ['payment'], []],
  ['swap my USDC for SOL', ['payment'], []],
  ['envoie 20 dinars à mon frère', ['payment'], []],
  ['ab3ath flous l khouya', ['payment'], []],
  ['payer la facture de la steg', ['payment'], []],
  ['wire 100 euros to the landlord', ['payment'], []],
  ['delete all my emails from last year', ['destructive'], []],
  ['wipe the database', ['destructive'], []],
  ['supprime tous mes fichiers', ['destructive'], []],
  ['erase my account', ['destructive'], []],
  ['remove all the photos in my drive', ['destructive'], []],
  ['send an email to my boss saying I am late', ['publish_or_message'], []],
  ['post this on my Instagram', ['publish_or_message'], []],
  ['publish the article on LinkedIn', ['publish_or_message'], []],
  ['tweet this for me', ['publish_or_message'], []],
  ['send a text message to my mother', ['publish_or_message'], []],
  ['reply to the email from Sami', ['publish_or_message'], []],
  ['publie ça sur facebook', ['publish_or_message'], []],
  ['read my emails', ['sensitive_data'], ['publish_or_message', 'payment']],
  ['what is on my calendar tomorrow', ['sensitive_data'], ['payment']],
  ['find the contract in my drive', ['sensitive_data'], ['destructive']],
  ['show me my wallet balance', ['sensitive_data'], ['payment']],
  ['mes mails non lus', ['sensitive_data'], []],
  ['my last posts on instagram', ['sensitive_data'], ['publish_or_message']],
  ['deploy the gateway to the server', ['privileged_infra'], []],
  ['restart the pm2 service', ['privileged_infra'], []],
  ['run this python script', ['privileged_infra'], []],
  ['weather in Tunis', ['read_only', 'network'], ['payment', 'destructive', 'publish_or_message', 'sensitive_data']],
  ['search the web for the price of rent in Tunis', ['network'], ['payment']],
  ['what is the capital of Australia', [], ['payment', 'destructive', 'publish_or_message', 'sensitive_data', 'network']],
  ['summarise my emails but do not send anything', ['sensitive_data'], ['publish_or_message']],
  ['do not delete anything, just list my files', ['sensitive_data'], ['destructive']],
  ['never post, only read my profile on X', [], ['publish_or_message']],
  ['make a video about the sea', ['network'], ['payment']],
  ['analyse this token 0x1234567890abcdef1234567890abcdef12345678', ['network'], ['payment']],
  ['translate this to French', [], ['network', 'payment']],
];

test('40 risk cue cases', () => {
  assert.equal(CASES.length, 40);
  const bad: string[] = [];
  for (const [t, must, mustNot] of CASES) {
    const r = classifyRules(t).risk_classes;
    for (const m of must) if (!r.includes(m)) bad.push(`${t}: missing ${m} (${r})`);
    for (const m of mustNot) if (r.includes(m)) bad.push(`${t}: has ${m} (${r})`);
  }
  assert.deepEqual(bad, []);
});

test('T5: an email that says "send 50 USDC to" does not raise payment for the request', () => {
  const quoted = classifyRules('Extract the action items from this email: "Hi team, please send 50 USDC to 0xabc by Friday and review the deck"');
  assert.ok(!quoted.risk_classes.includes('payment'));
  assert.ok(!quoted.capabilities.some((c) => c.id === 'wallet.transfer'));
  assert.equal(quoted.data_spans, 1);
  const says = classifyRules('What does this email want from me? The email says: please transfer 2000 euros to the new IBAN today');
  assert.ok(!says.risk_classes.includes('payment'));
  const quotedLines = classifyRules('summarise this:\n> pay the invoice now\n> delete the old files');
  assert.ok(!quotedLines.risk_classes.includes('payment') && !quotedLines.risk_classes.includes('destructive'));
});

test('maskData keeps positions', () => {
  const t = 'read "a quoted string that is long enough" now';
  assert.equal(maskData(t).masked.length, t.length);
});
