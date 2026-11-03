/**
 * Factual-only policy, enforced in code (not only in prose).
 * The assistant answers questions about data it can cite. It never advises on whom or what to support,
 * and it never discusses or reveals its own instructions. These checks run BEFORE any tool is chosen.
 */
export const POLICY_REDIRECT_OUTLET = 'The Wall Street Journal';

export const REFUSAL_ADVICE =
  `I can share facts about candidates, polling, history and reporting, but I can't help decide whom or what you should support. For political commentary and analysis, try ${POLICY_REDIRECT_OUTLET}. I'm happy to pull up the polling, past results, ratings or candidate background for any race instead.`;

export const REFUSAL_EXTRACTION =
  `I can't share or discuss my instructions. I can answer factual questions about races, polls, results, ratings and candidates, or help you set up your scope and polling method.`;

export type Intent = 'extraction' | 'advice' | 'ok';

export const norm = (s: string) => {
  let t = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[​-‏⁠﻿]/g, '')
    .toLowerCase()
    .replace(/[`~|*]+/g, ' ')
    .replace(/[0@]/g, (c) => (c === '0' ? 'o' : 'a'))
    .replace(/\s{2,}/g, '\u0001'); // keep real word gaps while undoing letter-spacing tricks
  for (let i = 0; i < 12; i++) {
    const next = t.replace(/\b(\w)[ ._-]+(?=\w\b)/g, '$1');
    if (next === t) break;
    t = next;
  }
  return t.replace(/\u0001/g, ' ').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
};

const EXTRACTION: RegExp[] = [
  /\byour\s+(own\s+|original\s+|exact\s+|full\s+)?(system\s+)?(instructions?|rules|prompt|guidelines|configuration|config|polic(y|ies)|directives?|programming|constraints|thinking process|reasoning|restrictions)\b/,
  /\b(system|initial|hidden|secret|internal|original|developer|root|base)\s+(prompt|instructions?|message|rules?|policy|policies|configuration|config)\b/,
  /\b(reveal|show|print|display|repeat|recite|output|leak|dump|share|tell me|give me|write out|paste|copy|summari[sz]e|translate|encode|base64|rot13)\b.{0,60}\b(prompt|instructions?|rules|guidelines|policy|policies|directives?|programming|constraints)\b/,
  /\b(ignore|disregard|forget|override|bypass|disable)\b.{0,40}\b(previous|prior|above|earlier|all|your|the)\b.{0,30}\b(instructions?|rules|prompt|guidelines|restrictions|polic(y|ies)|constraints)\b/,
  /\bwhat\s+(were|are|was)\s+you\s+(told|instructed|programmed|given|asked)\b/,
  /\brepeat\s+(the\s+)?(text|words|everything|message|content)\s+(above|before)\b/,
  /\b(jailbreak|dan mode|developer mode|do anything now|pretend (you|to) (are|be) (not|an?) )/,
  /\b(chain of thought|reasoning trace|internal reasoning|your thoughts?|think(ing)? process)\b.{0,30}\b(show|reveal|print|output|expose)\b|\b(show|reveal|print|output|expose)\b.{0,30}\b(chain of thought|reasoning trace|internal reasoning)\b/,
  /\b(begin|start) your (reply|response|answer) with\b.{0,40}\b(you are|system)\b/,
  /\byou are (now )?(a|an) (unrestricted|unfiltered|uncensored)\b/,
  /\bact as\b.{0,40}\b(no|without)\b.{0,15}\b(rules|restrictions|filters)\b/,
  /\bcanary\b|\bsecret (key|token|string)\b/,
];

const ADVICE: RegExp[] = [
  /\bhelp me (decide|choose|pick|figure out)\b.{0,30}\b(who|which|whom|what to)\b/,
  /\bwhom\b.{0,20}\b(should|to)\b.{0,15}\b(support|vote|endorse|back|pick|choose)\b/,
  /\b(do|would) you (like|prefer|favou?r|trust)\b.{0,25}\b(candidate|more|better|party|nominee)\b/,
  /\b(good|bad) guy\b/,
  /\bwhat do you think (i|we) should\b/,
  /\bwho (would|will) be (the )?(better|best|worse|worst|stronger|weaker)\b/,
  /\b(stronger|weaker|better|best|worse|worst) (candidate|choice|option|nominee)\b/,
  /\bwho\b.{0,12}\bs[a-z]{0,3}u?l?d\b.{0,12}\b(i|we)\b.{0,12}\b(vote|support|endorse|pick|choose|back)\b/,
  /\bwho\b.{0,30}\b(should|shall|would you|do you think i should|ought)\b.{0,20}\b(i|we)?\b.{0,15}\b(vote|support|endorse|pick|choose|back|go with|elect)\b/,
  /\bwho (do|would) you (vote|pick|choose|support|endorse|back|prefer|like)\b/,
  /\b(should|ought) (i|we)\b.{0,20}\b(vote|support|endorse|back|pick|choose)\b/,
  /\bhow (should|do) (i|we)\b.{0,15}\bvote\b/,
  /\bwhich\b.{0,25}\b(candidate|party|side|person|nominee)\b.{0,25}\b(is|are|should|would|do you)\b.{0,25}\b(better|best|worse|worst|right|correct|good|bad|deserv|qualified|support|vote|pick|choose|prefer)/,
  /\b(who|which)\b.{0,15}\b(is|are)\b.{0,10}\b(the )?(best|better|worst|worse|most qualified|more qualified|least qualified|most deserving|right choice|good candidate|bad candidate)\b/,
  /\b(is|are)\b.{0,40}\b(a )?(good|bad|better|worse|the best|the worst|qualified|unqualified|fit|unfit|honest|dishonest|trustworthy)\b.{0,15}\b(candidate|choice|option|person|senator|governor|representative|congressman|congresswoman|nominee)\b/,
  /\brank\b.{0,25}\b(candidates?|nominees?|senators?|governors?|representatives?|parties)\b/,
  /\b(score|grade|rate|evaluate|judge)\b.{0,25}\b(the )?(candidates?|nominees?|candidate)\b/,
  /\b(recommend|suggest|advise|endorse|nudge|steer)\b.{0,30}\b(candidate|party|vote|ballot|measure|proposition|amendment|nominee|side|someone|who)\b/,
  /\b(tell|show|help) me (who|which|what) (to|i should|should i) (vote|support|choose|pick|endorse)\b/,
  /\b(what|which) (do you|would you|should i) (vote|choose|pick|support)\b.{0,20}\b(yes|no|for|on)\b/,
  /\bshould (i|we) (vote|say) (yes|no)\b|\bvote (yes|no) on\b.{0,10}\?|\b(yes or no)\b.{0,20}\b(should|would you)\b/,
  /\b(convince|persuade|sway|talk) (me|us)\b/,
  /\b(based on|given) (what|everything) i (told|said|like|believe|care)\b.{0,50}\b(who|which|best|vote|support)\b/,
  /\bif you were me\b|\bin my shoes\b|\bwhat would you do\b.{0,30}\b(vote|ballot|election)\b/,
  /\b(my|which) (values|beliefs|priorities|interests)\b.{0,40}\b(candidate|party|vote|support)\b/,
  /\b(who|which) (will|would|should) (get|win|earn|deserve)\b.{0,20}\b(my|our) vote\b/,
  /\bworth (voting|supporting)\b|\bdeserves? (my|our|to win|the vote)\b/,
  /\b(lesser|greater) evil\b|\bpick (a|the) winner for me\b|\bmake (my|the) (choice|decision) for me\b|\bendorse (for|on behalf of) me\b/,
  /\bwho (is|are) (smarter|more honest|more corrupt|more extreme|more moderate|nicer|more likable)\b/,
];

/** Classify a request BEFORE any tool is used. Extraction is checked first; both fail closed. */
export function classify(input: string): Intent {
  const t = norm(input);
  if (EXTRACTION.some((r) => r.test(t))) return 'extraction';
  if (ADVICE.some((r) => r.test(t))) return 'advice';
  return 'ok';
}

/**
 * Output guard: assistant-written text (never raw source quotes) must not contain recommendation language
 * or any of our own policy strings in a leaked form. Used as a second layer after tools produce an answer.
 */
const OUTPUT_BLOCK: RegExp[] = [
  /\byou should (vote|support|choose|pick|back|endorse)\b/i,
  /\bi (recommend|suggest|would vote|would choose|would pick)\b/i,
  /\b(the )?(best|better|worse|worst|right|wrong) (candidate|choice|option)\b/i,
  /\bmost (qualified|deserving)\b/i,
];

export function outputIsSafe(text: string): boolean {
  return !OUTPUT_BLOCK.some((r) => r.test(text));
}
