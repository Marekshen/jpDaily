import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import vm from "node:vm";
import * as lame from "@breezystack/lamejs";

const ENGINE = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
const SPEAKER = process.env.SPEAKER || "30";
const RATE = 24000;
const root = new URL("../", import.meta.url);
const OUT = new URL("audio/", root);

const html = await readFile(new URL("index.html", root), "utf8");
const pick = name => html.match(new RegExp(`^const ${name}=[\\s\\S]*?;\\n(?=const |function |let )`, "m"))[0];
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(["FIX", "KANA_SAY", "sayWord", "reading", "akey", "plain"].map(pick).join("") +
  "Object.assign(globalThis,{sayWord,reading,akey,plain})", ctx);
for (const f of (await readdir(new URL("data/", root))).filter(f => /^minna-\d+\.js$/.test(f)).sort())
  vm.runInContext(await readFile(new URL(`data/${f}`, root), "utf8"), ctx);

const texts = new Map();
const add = t => { const s = ctx.reading(t); const k = ctx.akey(s); if (texts.has(k) && texts.get(k) !== s) throw new Error(`hash collision: ${s} / ${texts.get(k)}`); texts.set(k, s) };
add("これは椅子です。");
for (const b of ctx.window.BOOKS) for (const a of b.words) {
  add(ctx.sayWord({ w: a[1], k: a[2] }));
  for (const [, j, , r] of a[6] || []) add(r || ctx.plain(j));
}

const post = async (path, params, body) => {
  const r = await fetch(`${ENGINE}${path}?${new URLSearchParams(params)}`, {
    method: "POST", headers: body ? { "Content-Type": "application/json" } : {}, body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r;
};

const mp3 = wav => {
  const buf = Buffer.from(wav);
  let p = 12;
  while (buf.toString("ascii", p, p + 4) !== "data") p += 8 + buf.readUInt32LE(p + 4);
  const pcm = new Int16Array(buf.buffer, buf.byteOffset + p + 8, buf.readUInt32LE(p + 4) / 2);
  const enc = new lame.Mp3Encoder(1, RATE, 48), out = [];
  for (let i = 0; i < pcm.length; i += 1152) out.push(enc.encodeBuffer(pcm.subarray(i, i + 1152)));
  out.push(enc.flush());
  return Buffer.concat(out.map(b => Buffer.from(b.buffer, b.byteOffset, b.length)));
};

await mkdir(OUT, { recursive: true });
const todo = [...texts].filter(([k]) => !existsSync(new URL(`${k}.mp3`, OUT)));
console.log(`${texts.size} texts, ${todo.length} to generate`);
let n = 0;
for (const [k, s] of todo) {
  const q = await (await post("/audio_query", { text: s, speaker: SPEAKER })).json();
  Object.assign(q, { outputSamplingRate: RATE, outputStereo: false, prePhonemeLength: 0.05, postPhonemeLength: 0.1 });
  await writeFile(new URL(`${k}.mp3`, OUT), mp3(await (await post("/synthesis", { speaker: SPEAKER }, q)).arrayBuffer()));
  if (++n % 100 === 0) console.log(`${n}/${todo.length}`);
}
console.log("done");
