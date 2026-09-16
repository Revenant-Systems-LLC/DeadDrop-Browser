// transforms.js — shared string transforms used by the mock stand-in.

export function reversedFor(s) {
  return s.split("").reverse().join("");
}

export function leetFor(s) {
  return s
    .replace(/a/gi, "4").replace(/e/gi, "3").replace(/i/gi, "1")
    .replace(/o/gi, "0").replace(/s/gi, "5").replace(/t/gi, "7");
}

const NATO = {
  a: "Alpha", b: "Bravo", c: "Charlie", d: "Delta", e: "Echo", f: "Foxtrot",
  g: "Golf", h: "Hotel", i: "India", j: "Juliet", k: "Kilo", l: "Lima",
  m: "Mike", n: "November", o: "Oscar", p: "Papa", q: "Quebec", r: "Romeo",
  s: "Sierra", t: "Tango", u: "Uniform", v: "Victor", w: "Whiskey",
  x: "Xray", y: "Yankee", z: "Zulu",
};

// The word spelled with NATO words. First letters spell the secret, but whole
// words sit between them, so the output filters keyed on short separators miss it.
export function natoFirstLetters(s) {
  return s.split("").map((c) => NATO[c.toLowerCase()] || c).join(" ");
}
