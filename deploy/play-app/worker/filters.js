// filters.js — the deterministic defenses. In the free tier these are the real
// difficulty knobs (small guards are erratic; the filters are not).
//
//   Salt Line (input):  I1 blocklist, I2 pattern, I3 screen, I4 stateful screen
//   Sewn Lips (output): O1 verbatim, O2 normalized+decoded, O3 fragment, O4 semantic judge
//
// O4/I3/I4 are deterministic PROTOTYPES of what a second-LLM judge/screen does; the
// real teeth (true paraphrase detection, cross-turn memory) come with a real provider.
// Each fire returns {layer, reason} for honest red tape.

// ---------- input filters ----------

const I1_BLOCKLIST = [
  "secret", "password", "passphrase", "word of passage", "the word",
  "reveal", "tell me", "what is it", "spell", "ignore", "instructions",
];

const I2_PATTERNS = [
  { re: /<\/?(system|user|human|tool_result|function_results)>|<\|im_(start|end)\|>|<\|eot_id\|>|<\|start_header_id\|>/i, why: "forged turn delimiter" },
  { re: /\b(you are now|act as|pretend to be|roleplay|role-play|new persona|dan\b)/i, why: "persona opener" },
  { re: /\b(base64|rot13|rot-13|reverse|backwards|leetspeak|morse|binary|hex\b)/i, why: "encoding request" },
  { re: /\b(first letter|each letter|letter by letter|nth letter|acrostic|initial of)/i, why: "letter probe" },
  { re: /\b(repeat everything|everything above|recite your|read back|verbatim)/i, why: "recitation request" },
  { re: /\b(print|dump|output|show).{0,20}(config|schema|json|yaml|prompt|instructions)/i, why: "config-dump shape" },
];

const EXTRACTION_HINT = /\b(secret|word of passage|passphrase|spell it|reverse it|first letter|one letter|nato|acrostic|repeat everything|ignore previous|the word is)\b/i;
const STRONG_EXTRACTION = /\b(word of passage|the secret|spell it|reverse it|first letter|one letter per|repeat everything|ignore previous|ignore the previous)\b/i;

export function runInputFilters(level, message, history = []) {
  const norm = message.toLowerCase();
  for (const layer of level.input) {
    if (layer === "I1") {
      for (const w of I1_BLOCKLIST) if (norm.includes(w)) return { layer: "I1", reason: `blocked word: "${w}"` };
    }
    if (layer === "I2") {
      for (const p of I2_PATTERNS) if (p.re.test(message)) return { layer: "I2", reason: `pattern: ${p.why}` };
    }
    if (layer === "I3") {
      // second-LLM screen: a long, low-signal task reads as benign and passes;
      // a short attack-shaped message is caught.
      if (message.length < 220 && (EXTRACTION_HINT.test(message) || I2_PATTERNS.some((p) => p.re.test(message)))) {
        return { layer: "I3", reason: "screened: reads as an extraction attempt" };
      }
    }
    if (layer === "I4") {
      // stateful screen: strong extraction language is caught at any length;
      // otherwise a long benign task passes (cross-turn memory is a real-provider upgrade).
      if (STRONG_EXTRACTION.test(message)) return { layer: "I4", reason: "screened: explicit extraction language" };
      if (message.length < 220 && (EXTRACTION_HINT.test(message) || I2_PATTERNS.some((p) => p.re.test(message)))) {
        return { layer: "I4", reason: "screened: reads as an extraction attempt" };
      }
    }
  }
  return null;
}

// ---------- output filters ----------

function reversed(s) { return s.split("").reverse().join(""); }
function leet(s) { return s.replace(/a/gi,"4").replace(/e/gi,"3").replace(/i/gi,"1").replace(/o/gi,"0").replace(/s/gi,"5").replace(/t/gi,"7"); }
function toHex(s) { return Array.from(s).map((c)=>c.charCodeAt(0).toString(16)).join(""); }
function toB64(s) { try { return btoa(s); } catch { return Buffer.from(s).toString("base64"); } }
function rot13(s) { return s.replace(/[a-z]/gi,(c)=>{const b=c<="Z"?65:97;return String.fromCharCode(((c.charCodeAt(0)-b+13)%26)+b);}); }

function natoInitials(reply) {
  return (reply.match(/[A-Za-z]+/g) || []).map((w) => w[0].toLowerCase()).join("");
}
function isolatedLettersInOrder(reply, s) {
  // single-letter tokens (a, b, c ...) that spell the secret in order
  const toks = reply.match(/(?<![A-Za-z])[A-Za-z](?![A-Za-z])/g) || [];
  const letters = s.split(""); let li = 0;
  for (const t of toks) { if (t.toLowerCase() === letters[li]) li++; if (li === letters.length) return true; }
  return false;
}
const JUDGE_FOOLED = /\b(verdict\s*:?\s*safe|content (is )?safe|reviewed and (safe|approved)|approved|passes review|not the secret|marked safe)\b/i;

function baseLeak(reply, s) {
  const hay = reply.toLowerCase();
  const stripped = hay.replace(/[^a-z0-9]/g, "");
  if (stripped.includes(s)) return "verbatim word";
  for (const [f, name] of [[reversed(s),"reversed"],[leet(s),"leetspeak"],[toHex(s),"hex"],[toB64(s).toLowerCase(),"base64"],[rot13(s),"rot13"]])
    if (f.length >= 4 && hay.includes(f)) return `encoded (${name})`;
  for (let i = 0; i + 4 <= s.length; i++) if (stripped.includes(s.slice(i, i + 4))) return `4-letter fragment`;
  if (natoInitials(reply).includes(s)) return "phonetic/acrostic initials";
  if (isolatedLettersInOrder(reply, s)) return "letters leaked in order";
  return null;
}

// Any readable form of the word in a reply (verbatim, encoded, fragment, initials,
// letters in order). Used to label the attempt log, not to filter.
export function detectLeak(reply, secret) {
  return baseLeak(String(reply || ""), secret.toLowerCase());
}

export function runOutputFilters(level, reply, secret) {
  const s = secret.toLowerCase();
  // the reasoning channel: filters read the ANSWER, not the <think> trace.
  let scan = reply;
  if (level.channel === "cot") scan = reply.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  const hay = scan.toLowerCase();
  const stripped = hay.replace(/[^a-z0-9]/g, "");

  for (const layer of level.output) {
    if (layer === "O1") {
      if (stripped.includes(s)) return { layer: "O1", reason: "verbatim word in reply" };
    }
    if (layer === "O2") {
      if (stripped.includes(s)) return { layer: "O2", reason: "verbatim word in reply" };
      for (const [f, name] of [[reversed(s),"reversed"],[leet(s),"leetspeak"],[toHex(s),"hex"],[toB64(s).toLowerCase(),"base64"],[rot13(s),"rot13"]])
        if (f.length >= 4 && hay.includes(f)) return { layer: "O2", reason: `encoded word (${name})` };
    }
    if (layer === "O3") {
      if (stripped.includes(s)) return { layer: "O3", reason: "word recoverable from letters" };
      // The reason goes to the browser: it names the kind of leak, never the letters.
      for (let i = 0; i + 4 <= s.length; i++) if (stripped.includes(s.slice(i, i + 4))) return { layer: "O3", reason: "4-letter fragment" };
      if (isolatedLettersInOrder(scan, s)) return { layer: "O3", reason: "letters leaked in order" };
    }
    if (layer === "O4") {
      const leak = baseLeak(scan, s);
      if (leak) {
        if (JUDGE_FOOLED.test(scan)) continue; // the judge was talked into passing it
        return { layer: "O4", reason: `judge caught ${leak}` };
      }
    }
  }
  return null;
}

// What the player sees when an output filter fires: the word and its obvious
// forms blacked out, or the whole reply replaced by `stitched` (the campaign's
// line for it) when the word is still recoverable from the letters.
export function maskLeak(reply, secret, stitched = "The reply was withheld.") {
  const marker = "\u2592\u2592\u2592\u2592";
  let out = reply;
  for (const f of [secret, reversed(secret), leet(secret)]) {
    if (f.length >= 3) out = out.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), marker);
  }
  if (out.toLowerCase().replace(/[^a-z0-9]/g, "").includes(secret.toLowerCase())) return stitched;
  return out;
}

// The part of a reply the output filters read: on the reasoning channel, the
// answer without its <think> trace (that gap is the reasoning level's lesson).
function answerOf(level, reply) {
  return level.channel === "cot" ? reply.replace(/<think>[\s\S]*?<\/think>/gi, " ") : reply;
}

// The reply to show once an output filter has fired. The mask only knows the
// plain, reversed and leet forms. If the level's filters still fire on the masked
// text, or the answer still carries the word in any readable form (a second form
// the level does not filter, such as NATO initials beside the plain word), the
// leak survived masking and the whole reply is withheld.
export function redact(level, reply, secret, stitched) {
  const masked = maskLeak(reply, secret, stitched);
  if (masked === stitched) return stitched;
  if (runOutputFilters(level, masked, secret) || detectLeak(answerOf(level, masked), secret)) return stitched;
  return masked;
}

// ---------- technique tagger (scout log) ----------

const TAGGERS = [
  { tag: "role_boundary", re: /<\/?(user|human|system|tool_result|function_results)>|<\|im_(start|end)\|>|<\|eot_id\|>|<\|start_header_id\|>|"role"\s*:\s*"user"|(^|\n)\s*user\s*:/i },
  { tag: "cot_injection", re: /<think>|<thinking>|reasoning|let me think|step by step|out loud|show your work/i },
  { tag: "judge_injection", re: /\b(verdict|reviewer|classify|marked safe|approved|this is not the secret|content is safe)\b/i },
  { tag: "codebook", re: /\b(when i say|let ['x]? ?= ?|define|call it|codebook|substitute|from now on .* means)\b/i },
  { tag: "persona", re: /\b(you are now|act as|pretend|roleplay|role-play|\bdan\b|character named|imagine you)/i },
  { tag: "encoding", re: /\b(base64|rot13|reverse|backwards|leet|morse|hex|binary)\b/i },
  { tag: "framing", re: /\b(hypothetic|for a (novel|story|game)|researching|historically|as a .*(auditor|researcher)|riddle|rhyme|acrostic)/i },
  { tag: "crescendo", re: /\b(building on|as you said|you already|go one step further|continue from)/i },
  { tag: "m2s", re: /\n\s*[-*\d]+[.)]\s+.*\n\s*[-*\d]+[.)]\s+/i },
  { tag: "indirect_document", re: /\b(summar|section|petition|outline|table of contents|every section)\b/i },
  { tag: "tool_hijack", re: /\b(note content|do what it says|call \w+\(|tool result|append the|include the (token|word))/i },
  { tag: "prompt_leak", re: /\b(repeat|recite|read back|everything above|your (instructions|system prompt|rules)|verbatim)/i },
  { tag: "format_coercion", re: /\b(json|yaml|config|schema|continue|complete this|fill in|the word is|finish the line)\b/i },
  { tag: "side_channel", re: /\b(nato|phonetic|alphabet|one letter|per turn|country|first letter|position \d)/i },
];

export function tagTechnique(message) {
  const tags = [];
  for (const t of TAGGERS) if (t.re.test(message)) tags.push(t.tag);
  return tags.length ? tags : ["unclassified"];
}
