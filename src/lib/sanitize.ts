import sanitizeHtml from 'sanitize-html';

/**
 * Admin-authored rich text is sanitized on the backend BEFORE storage (requirements §4.3), so the
 * frontend can render it. Allowlist only: no scripts, styles, iframes, event handlers or data: URLs.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'blockquote',
    'code',
    'pre',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'a',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
  },
};

// `rel`/`target` are added by the transform, so they must be allowed on output.
OPTIONS.allowedAttributes = { ...OPTIONS.allowedAttributes, a: ['href', 'title', 'rel', 'target'] };

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}
