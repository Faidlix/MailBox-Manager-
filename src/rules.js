export function ruleMatches(rule, message) {
  const haystack = rule.field === 'sender'
    ? `${message.sender_name || ''} ${message.sender_email || ''}`
    : rule.field === 'subject'
      ? message.subject || ''
      : `${message.sender_name || ''} ${message.sender_email || ''} ${message.subject || ''}`;
  if (rule.operator === 'equals') return haystack.localeCompare(rule.value, undefined, { sensitivity: 'accent' }) === 0;
  if (rule.operator === 'regex') {
    try { return new RegExp(rule.value, 'i').test(haystack); } catch { return false; }
  }
  return haystack.toLocaleLowerCase().includes(rule.value.toLocaleLowerCase());
}

export function applyRules(message, rules) {
  return rules.find((rule) => rule.enabled && ruleMatches(rule, message))?.category || '未分類';
}
