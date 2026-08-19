/**
 * Monochrome syntax themes.
 *
 * Filtering a colour theme to greyscale collapses most tokens onto the same
 * value — strings, keywords and identifiers all land within a few percent of
 * each other and code reads as an undifferentiated block. So the ramp is
 * authored directly: hue carries nothing, *lightness* carries everything.
 *
 * Ordered brightest → dimmest by how much the reader needs each token:
 *   functions and keywords  structure, read first
 *   plain text              identifiers
 *   strings and numbers     values
 *   punctuation             scaffolding
 *   comments                skippable
 */

const scope = (scopes, foreground, fontStyle) => ({
  scope: scopes,
  settings: fontStyle ? { foreground, fontStyle } : { foreground },
});

/** Dark ramp, sampled off the dashboard's neutral scale. */
export const monoDark = {
  name: 'memory-soda-mono-dark',
  type: 'dark',
  colors: {
    'editor.background': '#1c1c1c',
    'editor.foreground': '#d4d4d4',
  },
  tokenColors: [
    scope(['comment', 'punctuation.definition.comment'], '#6e6e6e', 'italic'),
    scope(['punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'], '#8a8a8a'),
    scope(['string', 'string.quoted', 'constant.other.symbol'], '#b0b0b0'),
    scope(['constant.numeric', 'constant.language', 'constant.character.escape'], '#c4c4c4'),
    scope(['variable', 'variable.other', 'meta.object-literal.key', 'support.variable'], '#d4d4d4'),
    scope(['entity.name.tag', 'support.type.property-name'], '#e0e0e0'),
    scope(['entity.name.function', 'support.function', 'meta.function-call'], '#f2f2f2'),
    scope(['keyword', 'storage', 'storage.type', 'keyword.control', 'keyword.operator'], '#ffffff'),
    scope(['entity.name.type', 'support.class', 'support.type'], '#ededed'),
    scope(['invalid'], '#ffffff', 'underline'),
  ],
};

/** Light ramp, same construction inverted. */
export const monoLight = {
  name: 'memory-soda-mono-light',
  type: 'light',
  colors: {
    'editor.background': '#fafafa',
    'editor.foreground': '#2e2e2e',
  },
  tokenColors: [
    scope(['comment', 'punctuation.definition.comment'], '#9b9b9b', 'italic'),
    scope(['punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'], '#8a8a8a'),
    scope(['string', 'string.quoted', 'constant.other.symbol'], '#5a5a5a'),
    scope(['constant.numeric', 'constant.language', 'constant.character.escape'], '#444444'),
    scope(['variable', 'variable.other', 'meta.object-literal.key', 'support.variable'], '#2e2e2e'),
    scope(['entity.name.tag', 'support.type.property-name'], '#242424'),
    scope(['entity.name.function', 'support.function', 'meta.function-call'], '#111111'),
    scope(['keyword', 'storage', 'storage.type', 'keyword.control', 'keyword.operator'], '#000000'),
    scope(['entity.name.type', 'support.class', 'support.type'], '#1a1a1a'),
    scope(['invalid'], '#000000', 'underline'),
  ],
};
