// Keep existing account IDs/messages on reconnect, and retain a refresh token
// only when it belongs to the same Google client. Never return sealed credentials.
export function connectGoogleAccount({ q, vault }, profile, settings) {
  if (!profile.verifiedEmail || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(profile.email || '') || !profile.tokens?.access_token) {
    throw new Error('Google 帳號驗證失敗');
  }
  const email = profile.email.toLowerCase();
  const existing = q.getAccountByEmail.get(email);
  if (existing && existing.provider !== 'gmail') throw new Error('此信箱已使用其他連線方式，請先確認原連線');
  if (profile.tokens.scope && !profile.tokens.scope.split(/\s+/).includes('https://www.googleapis.com/auth/gmail.modify')) throw new Error('尚未取得郵件存取授權');
  let previous = {};
  if (existing?.provider === 'gmail') {
    const saved = vault.open(existing.secret);
    if ((saved.managedClientId || saved.clientId) === settings.clientId) previous = saved.tokens || {};
  }
  const tokens = { ...previous, ...profile.tokens };
  if (!tokens.refresh_token) tokens.refresh_token = previous.refresh_token;
  if (!tokens.refresh_token) throw new Error('尚未取得持續授權，請重新同意授權');
  const encrypted = vault.seal({ oauthManaged: true, managedClientId: settings.clientId, tokens });
  if (existing) q.updateAccount.run('gmail', profile.displayName || '', encrypted, email);
  else q.insertAccount.run('gmail', email, profile.displayName || '', encrypted);
}
