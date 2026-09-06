import { insist } from './errors.js';

// Validate without ever reflecting credential values in an error.
export function credentialPatch(input) {
  insist(
    input && typeof input === 'object' && !Array.isArray(input),
    'Invalid credential settings.',
  );
  const result = {};
  for (const [name, value] of Object.entries(input)) {
    insist(
      ['openai', 'anthropic', 'anthropicWorkspaceId'].includes(name),
      'Unknown credential setting.',
    );
    insist(typeof value === 'string', 'Credential settings must be text.');
    const text = value.trim();
    if (name === 'anthropicWorkspaceId') {
      insist(
        !text || /^wrkspc_[A-Za-z0-9]+$/.test(text),
        'Anthropic workspace ID must start with wrkspc_.',
      );
    } else {
      insist(
        text.length > 0 && text.length <= 2048 && /^[\x21-\x7e]+$/.test(text),
        'An API key must be nonempty text without spaces or control characters.',
      );
    }
    result[name] = text;
  }
  return result;
}
