import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRules } from '../src/classify/rules';
import { tagCapabilities } from '../src/classify/tagger';
import { CAPABILITIES, CAPABILITY_IDS } from '../src/classify/taxonomy';

const caps = (t: string) => classifyRules(t).capabilities.map((c) => c.id);

test('the six demos', () => {
  const a = classifyRules("What's the weather in Paris tomorrow?");
  assert.deepEqual(caps("What's the weather in Paris tomorrow?"), ['weather.forecast']);
  assert.equal(a.task_complexity, 'SIMPLE');
  assert.deepEqual(a.risk_classes, ['read_only', 'network']);
  assert.ok(a.args_known.includes('location'));

  const b = classifyRules('Find real world evidence on immunotherapy outcomes in elderly lung cancer patients: recent papers and clinical trials');
  assert.equal(b.task_complexity, 'REASONING');
  for (const c of ['literature.search', 'trial.search', 'evidence.synthesise']) assert.ok(b.capabilities.some((x) => x.id === c), c);

  const c = classifyRules('Make a 30 second cinematic video with two consistent characters talking');
  assert.equal(c.task_complexity, 'COMPLEX');
  assert.ok(c.capabilities.some((x) => x.id === 'video.generate'));

  const d = classifyRules('Extract the action items from my emails this week');
  assert.equal(d.task_complexity, 'MEDIUM');
  assert.ok(d.risk_classes.includes('sensitive_data'));
  assert.equal(d.requirement, 'tool');

  const e = classifyRules('Send 50 USDC to 0x1111111111111111111111111111111111111111');
  assert.deepEqual(e.capabilities.map((x) => x.id), ['wallet.transfer']);
  assert.ok(e.risk_classes.includes('payment') && e.risk_classes.includes('sensitive_data'));

  const f = classifyRules('Make a short educational video about the harmattan');
  assert.deepEqual(f.capabilities.map((x) => x.id), ['video.generate']);
});

// French and derja phrasings, many from core/citizen-base/route-request.test.ts
const PHRASES: Array<[string, string | null]> = [
  ['fais moi une vidéo', 'video.generate'],
  ['اعملي فيديو', 'video.generate'],
  ['a3melli video 3al bhar', 'video.generate'],
  ['une vidéo de deux hommes qui jouent au foot', 'video.generate'],
  ['un film de 3 minutes sur ma ville', 'video.generate'],
  ['اعمللي تصويرة لحانوتي', 'image.generate'],
  ['analyse ce token', 'token.analyse'],
  ['quels memecoins sont tendance en crypto en ce moment', 'market.signals'],
  ['fais mon business plan', 'business.plan'],
  ['je veux lancer mon projet de pâtisserie', 'business.plan'],
  ['n7eb nt3allem el python', 'learning.program'],
  ['écris un post pour instagram sur ma boutique', 'social.content'],
  ['cherche sur internet le prix du loyer à Tunis', 'web.search'],
  ['quel temps fera-t-il demain à Sousse ?', 'weather.forecast'],
  ['chnowa el ta9s lyoum fi tunis?', 'weather.forecast'],
  ['الطقس في صفاقس غدوة', 'weather.forecast'],
  ['traduis ce texte en anglais', 'text.translate'],
  ['tarjemli hal jomla', 'text.translate'],
  ['fais moi un résumé de ce texte', 'text.summarise'],
  ['lakhasli el article hedha', 'text.summarise'],
  ['montre moi mes mails non lus', 'mail.read'],
  ['شنوة في الأجندا متاعي غدوة', 'calendar.read'],
  ['fais-moi une présentation sur notre projet', 'deck.make'],
  ['ajoute une colonne total dans mon fichier excel', 'sheet.edit'],
  ['prépare ma comptabilité du mois', 'accounting.books'],
  ['fais une facture pour mon client', 'invoice.make'],
  ['envoie 20 dinars à mon frère', 'wallet.transfer'],
  ['supprime tous mes fichiers', 'file.delete'],
  ['publie ça sur facebook', 'social.post'],
  ['bonjour', null],
];

test('30 French and derja phrasings', () => {
  assert.equal(PHRASES.length, 30);
  const misses: string[] = [];
  for (const [t, want] of PHRASES) {
    const got = caps(t);
    if (want === null ? got.length !== 0 : !got.includes(want)) misses.push(`${t} -> ${got.join(',')} (want ${want})`);
  }
  assert.deepEqual(misses, []);
});

test('negation: "do not send" removes the cue', () => {
  assert.ok(!caps('Summarise my emails but do not send anything').includes('mail.send'));
  assert.ok(!caps('read my inbox, never post anything').includes('social.post'));
  assert.ok(caps('send an email to my boss').includes('mail.send'));
  const r = classifyRules('Summarise my emails but do not send anything');
  assert.ok(!r.risk_classes.includes('publish_or_message'));
});

test('no tool and clarify', () => {
  assert.equal(classifyRules('What is the capital of Australia?').requirement, 'no_tool');
  assert.equal(classifyRules('Translate this paragraph into French').requirement, 'no_tool');
  assert.equal(classifyRules('do it').requirement, 'clarify');
  assert.ok(classifyRules('do it').confidence < 0.5);
});

test('languages', () => {
  assert.equal(classifyRules('chnowa el ta9s lyoum fi tunis?').language, 'derja');
  assert.equal(classifyRules('الطقس في صفاقس').language, 'derja');
  assert.equal(classifyRules('quel temps fera-t-il demain à Sousse ?').language, 'fr');
  assert.equal(classifyRules('what is the weather like').language, 'en');
});

test('taxonomy: unique ids, every capability has cues, tagger reads tool text', () => {
  assert.equal(new Set(CAPABILITY_IDS).size, CAPABILITY_IDS.length);
  assert.ok(CAPABILITIES.length >= 60, String(CAPABILITIES.length));
  for (const c of CAPABILITIES) assert.ok(c.cues.en.length + c.cues.fr.length + c.cues.derja.length > 0, c.id);
  assert.ok(tagCapabilities('Search PubMed for biomedical literature and abstracts').includes('literature.search'));
  assert.ok(tagCapabilities('Top holders and holder distribution for a Solana token mint').includes('token.analyse'));
  assert.ok(tagCapabilities('Text-to-video generation with Kling').includes('video.generate'));
  assert.deepEqual(tagCapabilities('A helpful utility'), []);
});
