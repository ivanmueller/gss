/**
 * Claude's email drafts (F-114 step 5b): the checks the Worker runs on a draft before the
 * person sees it. Claude writes the email from GSS's records; every number in it (a price, a
 * quantity, a phone number, a date or a time) must be found in what the Worker sent Claude, or
 * it is listed under "Check this" for the person to check before sending. A number Claude needed
 * and did not have is written as a placeholder in square brackets ("[price]"), which the person
 * must fill in before Send. Linear in the text's length.
 */

/** At most this many items under "Check this". */
export const CHECK_THIS_MAX = 20;
/** An item under "Check this" is cut to this many characters. */
const CHECK_ITEM_MAX = 40;

/** A placeholder Claude writes for what it did not have: "[price]", "[delivery date]". */
const PLACEHOLDER = /\[[^[\]\n]{1,40}\]/g;

/**
 * A North American phone number in any common layout: "(403) 555-0100", "403.555.0100",
 * "+1 403 555 0100", "4035550100". Fixed length, so linear.
 */
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

/** A number: digits, with thousands separators and one decimal part ("2,000", "300.50"). */
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Number words Claude was told not to use: one of them is a number it did not copy. */
const NUMBER_WORDS = new Set([
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'million',
  'dozen',
]);
const WORD = /[a-z]+/gi;

/** A phone number's digits, without the country code 1: "+1 (403) 555-0100" → "4035550100". */
function phoneDigits(text: string): string {
  const digits = text.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** A number as compared: "2,000" → "2000", "300.50" → "300.5", "300.00" → "300". */
export function plainNumber(text: string): string {
  const bare = text.replace(/,/g, '');
  if (!bare.includes('.')) return bare.replace(/^0+(?=\d)/, '');
  const [whole = '', fraction = ''] = bare.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const integer = whole.replace(/^0+(?=\d)/, '');
  return trimmed === '' ? integer : `${integer}.${trimmed}`;
}

interface Found {
  /** As written, for "Check this". */
  shown: string;
  /** As compared. */
  key: string;
}

/** The phone numbers and numbers of a text, in order of appearance. */
function numbersIn(text: string): Found[] {
  const found: { at: number; item: Found }[] = [];
  const phones = new Set<number>();
  for (const match of text.matchAll(PHONE)) {
    found.push({ at: match.index, item: { shown: match[0], key: `tel:${phoneDigits(match[0])}` } });
    for (let k = match.index; k < match.index + match[0].length; k += 1) phones.add(k);
  }
  for (const match of text.matchAll(NUMBER)) {
    if (phones.has(match.index)) continue;
    // A trailing comma ("2,000, then") is punctuation, not a separator.
    const shown = match[0].replace(/,+$/, '');
    found.push({ at: match.index, item: { shown, key: `n:${plainNumber(shown)}` } });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.item);
}

function wordsIn(text: string): string[] {
  return Array.from(text.matchAll(WORD), (match) => match[0]);
}

export interface EmailDraftCheck {
  /** Numbers and number words in the draft that are not in what Claude was given. */
  checkThis: string[];
  /** The placeholders in the draft, each once, in order: "[price]". */
  placeholders: string[];
}

/** Checks a draft's subject and message against the text the Worker sent Claude. */
export function checkEmailDraft(
  draft: { subject: string; message: string },
  source: string,
): EmailDraftCheck {
  const known = new Set(numbersIn(source).map((found) => found.key));
  const sourceWords = new Set(wordsIn(source).map((word) => word.toLowerCase()));
  const text = `${draft.subject}\n${draft.message}`;
  const checkThis: string[] = [];
  const add = (shown: string) => {
    const item = shown.slice(0, CHECK_ITEM_MAX);
    if (checkThis.length < CHECK_THIS_MAX && !checkThis.includes(item)) checkThis.push(item);
  };
  for (const found of numbersIn(text)) {
    if (!known.has(found.key)) add(found.shown);
  }
  // As written in the draft ("Twelve"), so the form finds it in the text (F-114-5b-R1-02).
  for (const word of wordsIn(text)) {
    const lower = word.toLowerCase();
    if (NUMBER_WORDS.has(lower) && !sourceWords.has(lower)) add(word);
  }
  const placeholders = [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => m[0]))];
  return { checkThis, placeholders };
}

/** The subject of a reply: "Re: " before the subject, an earlier "Re:" or "Fwd:" taken off once. */
export function replySubject(subject: string): string {
  const bare = subject
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/^(?:re|aw|fwd?|fw)\s*:\s*/i, '');
  return bare === '' ? 'Re:' : `Re: ${bare}`;
}

/**
 * A reminder's subject: the reply subject of the email reminded, at most `max` UTF-16 units, never
 * cutting a surrogate pair in half (a sent subject may be up to 998 characters; a draft's is at
 * most 200, F-114-5c2-D1-01).
 */
export function reminderSubject(subject: string, max: number): string {
  const full = replySubject(subject);
  if (full.length <= max) return full;
  let end = max;
  const last = full.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return full.slice(0, end).trimEnd();
}
