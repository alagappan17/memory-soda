const ADJECTIVES = [
  'amber', 'bold', 'brave', 'bright', 'calm', 'clever', 'cool', 'crisp',
  'daring', 'dark', 'dawn', 'eager', 'fast', 'fierce', 'gentle', 'golden',
  'happy', 'hidden', 'icy', 'jade', 'keen', 'kind', 'lazy', 'lively',
  'lucky', 'misty', 'noble', 'odd', 'plain', 'proud', 'quick', 'quiet',
  'rapid', 'rusty', 'sharp', 'shy', 'silent', 'silver', 'sleek', 'smart',
  'snowy', 'solar', 'stout', 'swift', 'teal', 'tiny', 'vivid', 'warm',
  'wild', 'witty',
];

const NOUNS = [
  'bear', 'bird', 'cloud', 'coast', 'crane', 'crow', 'dawn', 'deer',
  'dove', 'dusk', 'eagle', 'falcon', 'fern', 'finch', 'flame', 'fox',
  'frost', 'gale', 'grove', 'hawk', 'heron', 'hill', 'kite', 'lake',
  'leaf', 'lion', 'lynx', 'mist', 'moon', 'moth', 'oak', 'ocean',
  'otter', 'owl', 'peak', 'pine', 'raven', 'reef', 'ridge', 'river',
  'robin', 'sage', 'seal', 'snow', 'star', 'stone', 'storm', 'swan',
  'tide', 'wolf',
];

export function generateUserId(): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num  = Math.floor(Math.random() * 9000) + 1000; // 1000–9999
  return `${adj}-${noun}-${num}`;
}
