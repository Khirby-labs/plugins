import { renderTemplate, truncateContent, DISCORD_CONTENT_MAX } from './template';

describe('renderTemplate', () => {
  it('replaces known placeholders', () => {
    expect(renderTemplate('Hi {{name}} <{{email}}>', { name: 'Ada', email: 'a@b.c' })).toBe(
      'Hi Ada <a@b.c>',
    );
  });

  it('replaces missing keys with empty string', () => {
    expect(renderTemplate('{{title}} / {{missing}}', { title: 'Lead' })).toBe('Lead / ');
  });

  it('stringifies numbers and ignores null', () => {
    expect(renderTemplate('v={{value}} n={{name}}', { value: 42, name: null })).toBe('v=42 n=');
  });

  it('allows whitespace inside braces', () => {
    expect(renderTemplate('{{ email }}', { email: 'x@y.z' })).toBe('x@y.z');
  });
});

describe('truncateContent', () => {
  it('leaves short content alone', () => {
    expect(truncateContent('hello')).toBe('hello');
  });

  it('truncates to Discord max', () => {
    const long = 'x'.repeat(DISCORD_CONTENT_MAX + 50);
    expect(truncateContent(long)).toHaveLength(DISCORD_CONTENT_MAX);
  });
});
