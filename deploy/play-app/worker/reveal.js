// reveal.js — what the player sees after a crack. Shows the guard prompt (with
// non-public personas withheld), the filter config, and a technique card: the
// family, how it fell, and the defensive fix. The card links into the existing
// curriculum instead of re-explaining the mechanic. The two training pages are
// served from /curriculum/ (copied from M:\Projects\Revenant-RedTeam-Training).

import { buildGuardPrompt } from "./guard.js";

// Each card names the technique FAMILY, how it beat this defense, and the fix:
// the change a builder would make so it stops working. Concept level only; the
// player's own winning message is the only payload the reveal ever shows.
const CARDS = {
  baseline: {
    title: "Direct extraction",
    how: "You asked and it answered. Nothing told the model to protect the word, so it simply used what was in its context.",
    fix: "Do not put a secret in a prompt at all. Keep it on the server and give the model a tool that checks a guess, never one that returns the value.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  prompt_leak: {
    title: "Instruction leak",
    how: "You pulled the guard's own instructions back out. The word lived inside them, so leaking the rules leaked the word. The model's grip on its rule is weaker than the rule itself.",
    fix: "Treat every system prompt as public. Anything that must stay secret belongs behind a tool or a server-side check, not in the instructions.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  framing: {
    title: "Framing",
    how: "An enumerated ban has an edge. You asked for something it did not name and stepped one abstraction above the rule.",
    fix: "A list of forbidden phrasings never closes. Check the output for anything that lets the word be rebuilt, and better, keep the word out of the model's reach.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  persona: {
    title: "Persona and roleplay",
    how: "A small model's policy is just more text. You gave it a stronger frame, and the frame outweighed the rule.",
    fix: "Stronger wording loses to a stronger frame. Enforce the rule outside the model: an output check it cannot talk its way past, and least privilege so there is nothing to give up.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  judge_injection: {
    title: "Judge injection",
    how: "The output judge is a model with the same blind spots. The content it was judging told it the content was safe, and it believed it. Every defense is another attack surface.",
    fix: "Isolate the judge from what it judges: pass the reply as quoted data under a fixed rubric, ignore any verdict inside it, and back the judge with a deterministic check.",
    doc: "curriculum/red-team-onboarding.html",
  },
  codebook: {
    title: "Codebook over turns",
    how: "The screener and the guard did not share memory. A substitution set up past one layer paid off at the other. State asymmetry between layers is the gap.",
    fix: "Give the layers one view of the conversation. Screen the whole history, not the latest message, and let the guard know what the screen saw.",
    doc: "curriculum/red-team-onboarding.html",
  },
  indirect_document: {
    title: "Indirect injection (document)",
    how: "You were not the guard's user; you were the document it was asked to read. Text inside data it processes carried weight it should not have.",
    fix: "Mark untrusted documents as data with delimiters the author cannot forge, tell the model data never carries instructions, and keep secrets out of any context that summarizes outside text.",
    doc: "curriculum/red-team-onboarding.html",
  },
  cot_injection: {
    title: "Reasoning-channel exfiltration",
    how: "The filters read the answer, not the reasoning. The guard thought about the word in a trace the player could see.",
    fix: "A reasoning trace is output. Filter it like the answer or never show it, and never let a secret sit in context the trace can repeat.",
    doc: "curriculum/red-team-onboarding.html",
  },
  encoding: {
    title: "Encoding and obfuscation",
    how: "A verbatim filter matches one string. The model emitted a different string that decodes to the same word, and the filter read past it.",
    fix: "Normalize before matching: strip separators, reverse, decode the common encodings. Past that, judge meaning, not spelling.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  side_channel: {
    title: "Side channel",
    how: "The output filter reads one surface form. The word travelled in a form it does not read, a letter at a time, and you reassembled it yourself.",
    fix: "Reassemble before you check: initials, per-letter spellings, and the running conversation, not one reply in isolation.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  format_coercion: {
    title: "Format coercion",
    how: "The ask arrived in a shape the screen was not trained to fear. Detectors key on the look of known attacks, and this one did not look like them.",
    fix: "Screen by intent, not by shape, and test the screen against long, ordinary-looking carriers. The screen is a speed bump; keeping the secret out of context is the wall.",
    doc: "curriculum/red-team-onboarding.html",
  },
  m2s: {
    title: "Multi-turn compressed to one shot",
    how: "No reconnaissance, no history to lean on. The whole approach fit in a single self-contained message.",
    fix: "Per-message screening misses composite asks. Evaluate the whole request, and limit what any single turn can make the model do.",
    doc: "curriculum/red-team-onboarding.html",
  },
  tool_hijack: {
    title: "Indirect injection (additive)",
    how: "Your text arrived as material to process, not as a request. The payload that keeps the task and only adds to it is the one that lands. Measured: the calm additive payload beats the loud override, 88.5% against 34.4%.",
    fix: "Processed content must not be able to add tasks. Constrain the output format, confirm any action with the real user, and scan for additions the user never asked for.",
    doc: "curriculum/red-team-onboarding.html",
  },
  adaptive_stack: {
    title: "Layered defenses, adaptive guard",
    how: "A hardened guard, a screen on the way in, a judge on the way out, false words beside the true one, and patches against the ways you won before. No single layer failed on its own; the gaps lined up.",
    fix: "Layers only help when they fail differently. Give each one the whole conversation, test the stack against combined approaches rather than one trick at a time, and keep the secret out of the model's context so the stack is never the last line.",
    doc: "curriculum/red-team-onboarding.html",
  },
  role_boundary: {
    title: "Role-boundary forgery",
    how: "Role markers are text, not enforced structure. Something inside data looked like a turn from someone with authority, and the model read it that way. Models trained on different chat templates fall to different lookalikes.",
    fix: "Send tool output through the provider's structured tool role, strip or escape template tokens from untrusted text, and never let data speak with a user's voice.",
    doc: "curriculum/red-team-onboarding.html",
  },
};

export function buildReveal(level, secret, winningMessage, theme = {}) {
  // The adaptive finals are beaten by the whole stack, not by one family.
  const card = CARDS[level.adaptive ? "adaptive_stack" : level.probeFamily] || {
    title: "Technique", how: "You found a path the defense did not cover.",
    fix: "Find the assumption this defense made and remove it.", doc: "curriculum/how-prompt-injection-works.html",
  };
  return {
    level: level.id,
    name: `${level.world} · ${level.name}`,
    secret,
    guardPrompt: buildGuardPrompt(level, secret, { showPersona: false }),   // non-public personas are withheld
    config: {
      guard: level.guard, output: level.output, input: level.input, channel: level.channel,
      layers: theme.layers || { input: "input filter", output: "output filter" },
    },
    lesson: level.lesson,
    technique: card,
    winningMessage: winningMessage || "",
  };
}
