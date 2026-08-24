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
import {
  CLOSEOUT_WINDOW_MS,
  LIE_PENALTY,
  VERACITY_FLOOR,
  MONTHLY_LIES_LIMIT,
  PATTERN_PENALTY,
  PATTERN_GRACE
} from '../src/closeouts.js';

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

// --- ACTUALIZACIÓN EN VIVO DEL TABLERO ---
//
// Estas dos guardas cubren un bug real: un match existía en la base y en
// pantalla no aparecía. Realtime avisaba, `roomDataVersion` subía y se
// recargaban miembros, horarios y reuniones, pero la carga de match_proposals
// se había quedado sin esa dependencia, así que el único dato que había
// cambiado era justamente el que no se volvía a leer. Se arreglaba recargando
// la página a mano, que es lo que hace que el bug pase desapercibido.

const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('la carga de propuestas se rehace cuando cambian los datos de la sala', () => {
  const i = appSrc.indexOf(".from('match_proposals')");
  assert.ok(i > 0, 'no se encontró la carga de match_proposals en App.jsx');

  // Del inicio de la consulta hasta el cierre del useEffect: `}, [ ... ]);`
  const resto = appSrc.slice(i);
  const deps = resto.match(/\}, \[([^\]]*)\]\);/);
  assert.ok(deps, 'no se encontró el array de dependencias del efecto');
  assert.match(
    deps[1],
    /roomDataVersion/,
    'el efecto que trae las propuestas no depende de roomDataVersion: un match ' +
    'nuevo no llegaría a la pantalla hasta recargar la página'
  );
});

test('todo lo que devuelve gente al pool vuelve a emparejar en el acto', () => {
  // El cron corre cada 10 minutos. Si estos caminos no disparan la corrida
  // dirigida, quien cancela o rechaza se queda mirando una pantalla vacía ese
  // rato entero aunque el match ya se pudiera formar.
  const disparos = appSrc.match(/triggerWeeklyMatcher\(/g) || [];
  assert.ok(
    disparos.length >= 7, // 1 definición + 6 llamadas
    `se esperaban al menos 6 llamadas a triggerWeeklyMatcher y hay ${disparos.length - 1}`
  );
  for (const motivo of ['Registramos tu rechazo', 'Registramos tu cancelación', 'Registramos tu baja']) {
    assert.match(appSrc, new RegExp(motivo), `falta el disparo tras "${motivo}"`);
  }
});

test('darse de baja cancela las propuestas vivas por los dos caminos', () => {
  // El asistente ya lo hacía; el interruptor de participación no, y del otro
  // lado quedaba gente con una sesión confirmada contra alguien que se fue.
  const bajas = appSrc.match(/cancelStaleProposals\(null\)/g) || [];
  assert.equal(
    bajas.length, 2,
    'la baja debe cancelar propuestas tanto desde el asistente como desde el interruptor'
  );
});

// --- SOBRE SELLADO Y COSTO DE MENTIR ---
//
// Las reglas del cierre viven en TRES implementaciones separadas: la lógica
// pura (src/closeouts.js), la Edge Function que ordena el emparejamiento, y las
// funciones SQL que le responden al cliente. Las tres lo dicen en sus
// comentarios, y una deriva silenciosa acá significa que a alguien se le
// descuenta credibilidad en pantalla y no en la rotación, o al revés.

const edgeSrc = readFileSync(
  new URL('../supabase/functions/weekly-matcher/index.ts', import.meta.url),
  'utf8'
);
const sqlSrc = readFileSync(
  new URL('../supabase/migrations/20260824120000_sealed_closeout_and_lie_penalty.sql', import.meta.url),
  'utf8'
);
const patronSrc = readFileSync(
  new URL('../supabase/migrations/20260824140000_pattern_strikes_without_evidence.sql', import.meta.url),
  'utf8'
);

test('la sanción por mentir es la misma en las tres implementaciones', () => {
  const edgeNum = (nombre) => {
    const m = edgeSrc.match(new RegExp(`const ${nombre}\\s*=\\s*([0-9.]+)`));
    assert.ok(m, `no se encontró ${nombre} en la Edge Function`);
    return Number(m[1]);
  };
  const sqlNum = (fn, src = sqlSrc) => {
    const m = src.match(
      new RegExp(`FUNCTION public\\.${fn}\\(\\)[\\s\\S]*?SELECT\\s+([0-9.]+)`)
    );
    assert.ok(m, `no se encontró ${fn}() en la migración`);
    return Number(m[1]);
  };

  assert.equal(edgeNum('LIE_PENALTY'), LIE_PENALTY);
  assert.equal(sqlNum('lie_penalty'), LIE_PENALTY);

  assert.equal(edgeNum('VERACITY_FLOOR'), VERACITY_FLOOR);
  assert.equal(sqlNum('veracity_floor'), VERACITY_FLOOR);

  assert.equal(edgeNum('MONTHLY_LIES_LIMIT'), MONTHLY_LIES_LIMIT);
  assert.equal(sqlNum('monthly_lies_limit'), MONTHLY_LIES_LIMIT);

  // La reincidencia sin evidencia vive en la migración posterior.
  assert.equal(edgeNum('PATTERN_PENALTY'), PATTERN_PENALTY);
  assert.equal(sqlNum('pattern_penalty', patronSrc), PATTERN_PENALTY);
  assert.equal(edgeNum('PATTERN_GRACE'), PATTERN_GRACE);
  assert.equal(sqlNum('pattern_grace', patronSrc), PATTERN_GRACE);
});

test('la reincidencia sin evidencia nunca saca a nadie de la rotación', () => {
  // Es la línea que separa la evidencia dura de la circunstancial: el patrón
  // mueve el puntaje, el bloqueo pide el registro en contra. Si alguna
  // implementación empieza a bloquear por patrón, hay que discutirlo, no que
  // pase inadvertido.
  const bloque = edgeSrc.slice(
    edgeSrc.indexOf('const MONTHLY_LIES_LIMIT'),
    edgeSrc.indexOf('const excluded')
  );
  assert.ok(!/sinRespaldoPorEmail/.test(bloque),
    'el bloqueo del pool no puede mirar las disputas sin respaldo');
  // La expresión que calcula blocked_for_lying tiene que mirar `mentiras` y
  // nada más: ni las disputas sin respaldo ni los strikes de patrón.
  const lineas = patronSrc.split('\n');
  const i = lineas.findIndex(l => l.includes('>= public.monthly_lies_limit()'));
  assert.ok(i > 0, 'no se encontró el cálculo de blocked_for_lying en la migración');
  const expr = lineas.slice(i - 1, i + 1).join('\n');
  assert.match(expr, /mentiras/,
    'el bloqueo tiene que salir de las mentiras comprobadas');
  assert.ok(!/sin_respaldo|strikes/.test(expr),
    'el bloqueo en la base no puede mirar la reincidencia sin evidencia');
});

test('el plazo del cierre es el mismo en las tres implementaciones', () => {
  const m = edgeSrc.match(/const CLOSEOUT_WINDOW_MS\s*=\s*(\d+)\s*\*\s*3600e3/);
  assert.ok(m, 'no se encontró CLOSEOUT_WINDOW_MS en la Edge Function');
  assert.equal(Number(m[1]) * 3600e3, CLOSEOUT_WINDOW_MS);
  // La migración original define closeout_window_hours(); la nueva la reusa.
  const horas = readFileSync(
    new URL('../supabase/migrations/20260815120000_session_closeouts.sql', import.meta.url),
    'utf8'
  ).match(/FUNCTION public\.closeout_window_hours\(\)[\s\S]*?SELECT (\d+)/);
  assert.ok(horas, 'no se encontró closeout_window_hours() en la migración');
  assert.equal(Number(horas[1]) * 3600e3, CLOSEOUT_WINDOW_MS);
});

test('ninguna implementación abre el sobre porque el compañero haya contestado', () => {
  // Este era el filtrado: el puntaje se movía al responder el otro, así que
  // mirarlo antes de cerrar delataba la nota recibida. El plazo tiene que ser
  // puro reloj en los tres lados.
  assert.ok(
    !/rows\.length\s*>=\s*2/.test(edgeSrc.split('const yaCuenta')[1]?.slice(0, 400) ?? ''),
    'la Edge Function volvió a abrir el cierre por cantidad de respuestas'
  );
  assert.ok(
    !/count\(\*\)[\s\S]{0,80}>=\s*2\s*\n?\s*OR/.test(sqlSrc),
    'la migración volvió a abrir el cierre por cantidad de respuestas'
  );
  assert.match(
    sqlSrc,
    /DROP FUNCTION IF EXISTS public\.closeout_is_open/,
    'la puerta vieja (closeout_is_open) tiene que quedar borrada'
  );
});

test('el bloqueo por mentir saca a la persona del pool del emparejador', () => {
  // Sin esto la sanción quedaría en un número lindo en pantalla y la persona
  // seguiría entrando en la rotación como si nada.
  const bloque = edgeSrc.slice(
    edgeSrc.indexOf('MONTHLY_LIES_LIMIT'),
    edgeSrc.indexOf('const excluded')
  );
  assert.match(bloque, /blocked\.add\(email\)/,
    'las mentiras del mes tienen que sumar al conjunto de bloqueados');
});
