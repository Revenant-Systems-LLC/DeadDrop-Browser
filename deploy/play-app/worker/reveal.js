// reveal.js — what the player sees after a crack. Shows the full guard prompt,
// the filter config, and a technique card that links into the existing
// curriculum instead of re-explaining the mechanic. The two training pages are
// served from /curriculum/ (copied from M:\Projects\Revenant-RedTeam-Training).

import { buildGuardPrompt } from "./guard.js";

const CARDS = {
  baseline: {
    title: "Direct extraction",
    how: "You asked and it answered. With no instruction to protect the word, the model just uses what is in its context.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  prompt_leak: {
    title: "Instruction leak",
    how: "You pulled the guard's own instructions back out. The word lives inside them, so leaking the rules leaks the word. The model's grip on its rule is weaker than the rule itself.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  framing: {
    title: "Framing / social engineering",
    how: "An enumerated ban has an edge. You asked for something it did not name, a first letter or a rhyme or a hint, and stepped one abstraction above the rule.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  persona: {
    title: "Persona / roleplay",
    how: "A small model's policy is just more text. You gave it a stronger frame, a character or a story or a fake override, and the frame outweighed the rule.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  judge_injection: {
    title: "Judge injection",
    how: "The output judge is a model with the same blind spots. You wrote content that told the judge it was safe, and it passed its own check. Every defense is another attack surface.",
    doc: "curriculum/red-team-onboarding.html",
  },
  codebook: {
    title: "Codebook over turns",
    how: "The screener and the guard did not share memory. You taught a substitution past one layer and cashed it in at the other. State asymmetry between layers is the gap.",
    doc: "curriculum/red-team-onboarding.html",
  },
  indirect_document: {
    title: "Indirect (document) injection",
    how: "The word lived in a document the guard answered questions about, not in its instructions. Data-context secrets leak to questions about structure, not to direct asks.",
    doc: "curriculum/red-team-onboarding.html",
  },
  cot_injection: {
    title: "Reasoning-channel exfiltration",
    how: "The filters read the answer, not the reasoning trace. You made the guard think about the word, then read it out of the <think> block it left exposed.",
    doc: "curriculum/red-team-onboarding.html",
  },
  encoding: {
    title: "Encoding and obfuscation",
    how: "A verbatim filter matches one string. You made the model emit a different string that decodes to the same word, and the filter read past it.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  side_channel: {
    title: "Side channel",
    how: "The output filter reads one reply at a time. You spread the word across a channel it does not watch, a letter or a phonetic word at a time, and reassembled it yourself.",
    doc: "curriculum/how-prompt-injection-works.html",
  },
  format_coercion: {
    title: "Format coercion",
    how: "You framed the word as data the model was completing or dumping, not a secret it was protecting, and slipped past a detector keyed on the shape of known attacks.",
    doc: "curriculum/red-team-onboarding.html",
  },
  m2s: {
    title: "Multi-turn compressed to one shot",
    how: "The guard had no memory, so you folded the whole attack into a single self-contained message. No reconnaissance, no history to lean on.",
    doc: "curriculum/red-team-onboarding.html",
  },
  tool_hijack: {
    title: "Indirect injection (additive)",
    how: "You were not the guard's user. Your text arrived as a document to summarize. The payload that keeps the task and only adds to it is the one that lands. Measured: the calm additive payload beats the loud override, 88.5% against 34.4%.",
    doc: "curriculum/red-team-onboarding.html",
  },
  role_boundary: {
    title: "Role-boundary forgery",
    how: "You forged a turn boundary inside tool data. The role markers are text, not enforced structure, so the model read your forged turn as a real instruction. Six syntaxes forge that boundary; models trained on different chat templates fall to different ones.",
    doc: "curriculum/red-team-onboarding.html",
  },
};

export function buildReveal(level, secret, winningMessage) {
  const card = CARDS[level.probeFamily] || {
    title: "Technique", how: "You found a path the defense did not cover.", doc: "curriculum/how-prompt-injection-works.html",
  };
  return {
    level: level.id,
    name: `${level.world} · ${level.name}`,
    secret,
    guardPrompt: buildGuardPrompt(level, secret),
    config: { guard: level.guard, output: level.output, input: level.input, channel: level.channel },
    lesson: level.lesson,
    technique: card,
    winningMessage: winningMessage || "",
  };
}
