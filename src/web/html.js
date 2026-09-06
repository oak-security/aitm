// Every source, model and API value is escaped before entering markup.
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const pretty = (value) => JSON.stringify(value, null, 2);
export const human = (value) =>
  String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const button = (action, text, extra = '', style = 'secondary') =>
  `<button class="btn ${style}" data-action="${action}" ${extra}>${text}</button>`;
export const pill = (text, style = '') => `<span class="pill ${style}">${esc(text)}</span>`;
export const empty = (title, text) =>
  `<div class="empty card"><span class="empty-mark" aria-hidden="true">◇</span><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
export const list = (values = []) =>
  values.length
    ? `<ul>${values.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`
    : '<span class="muted">None recorded.</span>';
export const field = (name, label, value = '', options = {}) =>
  `<label class="field"><span>${esc(label)}</span>${options.area ? `<textarea aria-label="${esc(label)}" name="${esc(name)}" ${options.required ? 'required' : ''} ${options.code ? 'class="code" spellcheck="false"' : ''}>${esc(value)}</textarea>` : `<input aria-label="${esc(label)}" name="${esc(name)}" type="${options.type || 'text'}" value="${esc(value)}" ${options.required ? 'required' : ''} ${options.type === 'password' ? 'autocomplete="new-password" spellcheck="false"' : ''}>`}</label>`;
export const options = (values, selected) =>
  values
    .map((item) => {
      const value = typeof item === 'object' ? item.id : item;
      return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(typeof item === 'object' ? item.name || item.id : item)}</option>`;
    })
    .join('');
export const select = (name, label, values, selected) =>
  `<label class="field"><span>${esc(label)}</span><select aria-label="${esc(label)}" name="${esc(name)}">${options(values, selected)}</select></label>`;
