// Invariantes de seguridad del emparejador y guardas de robustez.
//
// Los tests de matcher.test.mjs verifican QUÉ dupla se elige en escenarios
// concretos. Acá se verifican propiedades que deben cumplirse SIEMPRE, sin
// importar el escenario: nadie emparejado consigo mismo, nadie con dos duplas
// a la vez, y el turno elegido realmente compartido por ambos. Un fallo acá
// significa que alguien quedaría doblemente agendado o citado a un horario
// que no marcó.
//
// Incluye además una guarda de deriva entre src/matcher.js y la Edge Function
// (supabase/functions/weekly-matcher): ambos archivos declaran que deben
// mantenerse alineados, y son dos implementaciones del mismo algoritmo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWeeklyPairs, CONFIRM_STEPS_MS, MIN_LEAD_MS } from '../src/matcher.js';
import { computeSlotSets, memberSlotSet, getOffsetMinutes } from '../src/slots.js';

const AR = 'America/Argentina/Buenos_Aires'; // UTC-3 fijo
const MX = 'America/Mexico_City';            // UTC-6 fijo
const EU2 = 'Etc/GMT-2';                     // UTC+2 fijo
const IN = 'Asia/Kolkata';                   // UTC+5:30 (offset fraccionario)

const NOW = new Date(Date.UTC(2026, 6, 16, 12, 0, 0)); // jueves determinista

const member = (email, name, tz) => ({ email, name, tz });
const rule = (user, dayIdx, startHour, endHour) => ({ user, dayIdx, startHour, endHour });

// Sala variada a propósito: distintos husos, distinta cantidad de horas
// marcadas y un miembro sin disponibilidad.
const buildRoom = () => {
  const members = [
    member('ana@x.com', 'Ana', AR),
    member('beto@x.com', 'Beto', AR),
    member('caro@x.com', 'Caro', MX),
    member('dani@x.com', 'Dani', EU2),
    member('eva@x.com', 'Eva', IN),
    member('fran@x.com', 'Fran', AR) // sin reglas: no debe entrar
  ];
  const avails = [
    rule('Ana', 0, 18, 22), rule('Ana', 2, 9, 12),
    rule('Beto', 0, 19, 23), rule('Beto', 3, 9, 11),
    rule('Caro', 0, 15, 20),
    rule('Dani', 1, 8, 14), rule('Dani', 2, 14, 18),
    rule('Eva', 2, 17, 21)
  ];
  return { members, slotSets: computeSlotSets(members, avails) };
};

test('invariante: nadie queda emparejado consigo mismo', () => {
  const { members, slotSets } = buildRoom();
  const { pairs } = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );
  for (const p of pairs) {
    assert.notEqual(p.a.email, p.b.email, 'una persona quedó emparejada consigo misma');
  }
});

test('invariante: nadie aparece en dos duplas de la misma semana', () => {
  const { members, slotSets } = buildRoom();
  const { pairs } = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );
  const seen = new Set();
  for (const p of pairs) {
    for (const email of [p.a.email, p.b.email]) {
      assert.ok(!seen.has(email), `${email} quedó en más de una dupla (doble agenda)`);
      seen.add(email);
    }
  }
});

test('invariante: el turno elegido lo tienen marcado LAS DOS personas', () => {
  const { members, slotSets } = buildRoom();
  const { pairs } = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );
  assert.ok(pairs.length > 0, 'el escenario debería producir al menos una dupla');
  for (const p of pairs) {
    assert.ok(slotSets.get(p.a.email).has(p.slot), `${p.a.email} no marcó el slot ${p.slot}`);
    assert.ok(slotSets.get(p.b.email).has(p.slot), `${p.b.email} no marcó el slot ${p.slot}`);
  }
});

test('invariante: quien no cargó disponibilidad no se empareja ni figura como sin asignar', () => {
  const { members, slotSets } = buildRoom();
  const { pairs, unmatched } = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );
  const emparejados = pairs.flatMap(p => [p.a.email, p.b.email]);
  // Fran no cargó horarios: el emparejador no puede proponerle nada, y tampoco
  // debe reportarlo como "sin compañero" (no es que falten candidatos, es que
  // todavía no participa).
  assert.ok(!emparejados.includes('fran@x.com'));
  assert.ok(!unmatched.includes('fran@x.com'));
});

test('invariante: emparejados y sin asignar no se solapan', () => {
  const { members, slotSets } = buildRoom();
  const { pairs, unmatched } = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );
  const emparejados = new Set(pairs.flatMap(p => [p.a.email, p.b.email]));
  for (const email of unmatched) {
    assert.ok(!emparejados.has(email), `${email} figura emparejado Y sin asignar`);
  }
});

test('robustez: una zona horaria inválida se trata como UTC en vez de romper', () => {
  assert.equal(getOffsetMinutes('No/Existe'), 0);
  assert.equal(getOffsetMinutes(''), 0);
  assert.equal(getOffsetMinutes(undefined), 0);
});

test('robustez: un bloque con fin <= inicio no genera horarios', () => {
  assert.equal(memberSlotSet([rule('Ana', 0, 10, 10)], AR).size, 0);
  assert.equal(memberSlotSet([rule('Ana', 0, 14, 9)], AR).size, 0);
});

test('la Edge Function y src/matcher.js declaran la MISMA ventana de confirmación', () => {
  // Los dos archivos implementan el mismo algoritmo por separado (uno corre en
  // el navegador, el otro en Deno) y ambos lo dicen en sus comentarios. Si uno
  // cambia sin el otro, el plazo que ve la persona en pantalla deja de ser el
  // que aplica el scheduler.
  const edgeSrc = readFileSync(
    new URL('../supabase/functions/weekly-matcher/index.ts', import.meta.url),
    'utf8'
  );
  const m = edgeSrc.match(/const CONFIRM_STEPS_MS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, 'no se encontró CONFIRM_STEPS_MS en la Edge Function');

  const edgeSteps = m[1].split(',').map(s => Number(s.trim()) * 3600e3);
  assert.deepEqual(
    edgeSteps,
    CONFIRM_STEPS_MS,
    'la ventana de confirmación divergió entre src/matcher.js y la Edge Function'
  );
  assert.equal(MIN_LEAD_MS, edgeSteps[edgeSteps.length - 1]);
});
