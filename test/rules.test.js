import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, ruleMatches } from '../src/rules.js';

const message = { sender_name: 'Steam', sender_email: 'noreply@steampowered.com', subject: 'Wishlist item 特價通知' };

test('contains rules are case insensitive', () => {
  assert.equal(ruleMatches({ field: 'sender', operator: 'contains', value: 'STEAM' }, message), true);
});

test('invalid regular expressions do not break synchronization', () => {
  assert.equal(ruleMatches({ field: 'subject', operator: 'regex', value: '[' }, message), false);
});

test('first enabled matching rule supplies the category', () => {
  const rules = [
    { enabled: 0, field: 'both', operator: 'contains', value: 'Steam', category: '停用' },
    { enabled: 1, field: 'subject', operator: 'contains', value: '特價', category: '遊戲' },
  ];
  assert.equal(applyRules(message, rules), '遊戲');
});
