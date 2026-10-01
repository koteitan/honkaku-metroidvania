// Game text: story lines (from story.md) and the logic that picks them.
import { STORY } from './text_data.js';

const strip = (s) => s.replace(/[【】]/g, '');

// All lines whose id is PREFIX_nn (in numeric order), optionally a range.
export function seq(prefix, from = 1, to = 99) {
  const out = [];
  for (let i = from; i <= to; i++) {
    const k = `${prefix}_${String(i).padStart(2, '0')}`;
    if (STORY[k] !== undefined) out.push(strip(STORY[k]));
    else if (STORY[`${prefix}_${i}`] !== undefined) out.push(strip(STORY[`${prefix}_${i}`]));
    else if (i > from + 1 && out.length) {
      // allow gaps like 15A/15B; stop after two misses
      if (STORY[`${prefix}_${String(i + 1).padStart(2, '0')}`] === undefined) break;
    }
  }
  return out;
}
export const S = (id) => strip(STORY[id] || id);

export const SPEAKER = {
  ORGO: 'オルゴ', MIMOSA: 'ミモザ', POLKA: 'ポルカ', YONA: 'ヨナ', CROCCA: 'クロッカ', IRMA: 'イルマ',
  VESPER: 'ヴェスパー', SCORE: 'セラ (記憶の譜面)', BOSS1: 'グスタフ', BOSS2: 'アデーレ', BOSS3: 'トーマ', BOSS4: 'ブラム', BOSS5: 'イルマ',
};

// Short UI strings.
export const TXT = {
  PROMPT_REST: '↑ 祠を鳴らす',
  PROMPT_TALK: '↑ 話す',
  PROMPT_READ: '↑ 調べる',
  SHRINE_SAVED: S('SHRINE_SAVE'),
  HPUP_TITLE: S('HEART_01'), HPUP_BODY: [S('HEART_02')],
  ATKUP_TITLE: S('MALLET_01'), ATKUP_BODY: [S('MALLET_02')],
  WS_DOOR: seq('WS_DOOR'), WS_DISH: seq('WS_DISH'), SHELL_CRACK: seq('SHELL_CRACK'), NAMEWALL: seq('NAMEWALL'),
  WS_SCORE_HINT: [S('WS_SCORE_HINT')], CROWN_FORK_SET: [S('CROWN_FORK_SET'), S('CROWN_FORK_SET'), S('CROWN_FORK_SET'), S('CROWN_FORK_SET'), S('CROWN_FORK_SET')], ERNA: seq('ERNA_EXAMINE'), CROWN_GATE: seq('CROWN_GATE'),
};

export const ABILITY_IDS = ['attack', 'dash', 'double', 'wall', 'pound', 'shot', 'glide', 'phase'];
export function abilityText(id) {
  const n = ABILITY_IDS.indexOf(id);
  return { name: S(`ABILITY_${n}_NAME`), desc: [S(`ABILITY_${n}_DESC_1`), S(`ABILITY_${n}_DESC_2`)] };
}

export const FORKS = {
  gear: { note: 'ド', key: 'FORK_DO' }, choir: { note: 'レ', key: 'FORK_RE' }, gardener: { note: 'ミ', key: 'FORK_MI' },
  wyrm: { note: 'ファ', key: 'FORK_FA' }, librarian: { note: 'ソ', key: 'FORK_SO' },
};
export function forkText(id) { return seq(FORKS[id].key); }

export function scoreText(n) {
  const k = `SCORE_${String(n).padStart(2, '0')}`;
  return { title: S(k + '_T'), lines: seq(k) };
}

// A "scene" is a list of steps: string | {speaker} | {choice:[{label, steps}]} | {fn}
const sp = (id) => ({ speaker: SPEAKER[id] || id });

export function npcScript(id, save, opts = {}) {
  const F = save.flags, forks = save.forks;
  const once = (flag) => { const had = F[flag]; F[flag] = true; return !had; };
  switch (id) {
    case 'orgo': {
      if (!F.orgo_met) {
        F.orgo_met = true;
        return { steps: [sp('ORGO'), ...seq('ORGO', 1, 14), { choice: [
          { label: S('CHOICE_ORGO_A'), steps: [S('ORGO_15A')] },
          { label: S('CHOICE_ORGO_B'), steps: [S('ORGO_15B')] },
        ] }, S('ORGO_16')] };
      }
      if (save.abilities.phase && forks.length >= 5 && once('orgo_last')) {
        return { steps: [sp('ORGO'), ...seq('ORGO_LAST', 1, 3), { choice: [
          { label: S('CHOICE_ORGO_LAST_A'), steps: [S('ORGO_LAST_04A'), S('ORGO_LAST_05A')] },
          { label: S('CHOICE_ORGO_LAST_B'), steps: [S('ORGO_LAST_04B')] },
        ] }, ...seq('ORGO_LAST', 6, 8)] };
      }
      if (forks.includes('librarian') && once('orgo_b5')) return { steps: [sp('ORGO'), ...seq('ORGO_B5')] };
      if (forks.includes('wyrm') && once('orgo_b4')) return { steps: [sp('ORGO'), ...seq('ORGO_B4')] };
      if (forks.includes('gardener') && once('orgo_b3')) return { steps: [sp('ORGO'), ...seq('ORGO_B3')] };
      if (forks.includes('choir') && once('orgo_b2')) {
        return { steps: [sp('ORGO'), ...seq('ORGO_B2', 1, 4), { choice: [
          { label: S('CHOICE_ORGO_B2_A'), steps: [S('ORGO_B2_05A'), S('ORGO_B2_06A')] },
          { label: S('CHOICE_ORGO_B2_B'), steps: [S('ORGO_B2_05B')] },
        ] }, S('ORGO_B2_07')] };
      }
      if (forks.includes('gear') && once('orgo_b1')) return { steps: [sp('ORGO'), ...seq('ORGO_B1')] };
      if (once('orgo_sera')) return { steps: [sp('ORGO'), ...seq('ORGO_SERA')] };
      const idle = seq('ORGO_IDLE');
      F.orgo_idle = ((F.orgo_idle || 0) + 1) % idle.length;
      return { steps: [sp('ORGO'), idle[F.orgo_idle]] };
    }
    case 'mimosa': {
      if (forks.includes('gardener')) {
        if (once('mimosa_after')) return { steps: [sp('MIMOSA'), ...seq('MIMOSA', 11, 21)] };
        return { steps: [S('MIMOSA_SLEEP')] };
      }
      if (once('mimosa_met')) {
        return { steps: [sp('MIMOSA'), ...seq('MIMOSA', 1, 8), { choice: [
          { label: S('CHOICE_MIMOSA_A'), steps: [S('MIMOSA_09A')] },
          { label: S('CHOICE_MIMOSA_B'), steps: [S('MIMOSA_09B')] },
        ] }, S('MIMOSA_10')] };
      }
      return { steps: [S('MIMOSA_SLEEP')] };
    }
    case 'polka': {
      const sc = opts.scene || 'C';
      const lines = seq('POLKA_' + sc);
      if (once('polka_' + sc)) return { steps: [sp('POLKA'), ...lines] };
      return { steps: [sp('POLKA'), lines[lines.length - 1]] };
    }
    case 'yona': {
      const ex = seq('YONA_EXAMINE', 1, 2);
      let line = S('YONA_01');
      if (forks.includes('choir')) {
        if (F.yona_home) return { steps: [S('YONA_EXAMINE_03')] };
        F.yona_home = true; line = S('YONA_03');
      } else if (save.visited && Object.keys(save.visited).some((k) => k.startsWith('NV'))) line = S('YONA_02');
      return { steps: [...ex, sp('YONA'), line] };
    }
    case 'erna': return { steps: seq('ERNA_EXAMINE') };
    case 'sera': {
      if (forks.includes('librarian')) return { steps: [S('WS_SERA_LATE')] };
      if (once('sera_seen')) return { steps: seq('WS_SERA') };
      return { steps: [S('WS_SERA_REPEAT')] };
    }
    case 'crocca': {
      if (save.abilities.phase) {
        if (once('crocca_after')) return { steps: [sp('CROCCA'), S('CROCCA_17')] };
        return { steps: [S('CROCCA_EXAMINE')] };
      }
      if (once('crocca_met')) return { steps: [sp('CROCCA'), ...seq('CROCCA', 1, 16)] };
      return { steps: [sp('CROCCA'), S('CROCCA_12')] };
    }
    case 'namewall': {
      const st = [...seq('NAMEWALL')];
      F.namewall = true;
      return { steps: st };
    }
    case 'statue': return { steps: [opts.text || '石になった人が立っている。かすかに、温かい。'] };
  }
  return null;
}
