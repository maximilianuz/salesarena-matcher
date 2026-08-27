// Tests de las utilidades de presentación (src/utils/format.js).
// Son funciones chicas, pero su salida se muestra tal cual en pantalla —
// incluida la página pública— así que un caso borde mal resuelto se ve.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInitials,
  slugifyRoomName,
  nameFromEmail,
  escapeLikeLiteral,
  googleCalendarUrl,
  getAvatarColor,
  getAvatarInk,
  AVATAR_COLORS,
  AVATAR_INK_DARK,
  AVATAR_INK_LIGHT
} from '../src/utils/format.js';

// --- LEGIBILIDAD DE LAS INICIALES DEL AVATAR ---
//
// La paleta fija tiene ocho colores y antes las iniciales iban siempre en
// blanco: siete quedaban por debajo del mínimo de WCAG y sobre el amarillo el
// texto era invisible (1.41:1). El test recorre la paleta entera para que
// agregar un color nuevo no reintroduzca el problema en silencio.

const contraste = (hex, tinta) => {
  const lum = (h) => {
    const canal = (i) => {
      const c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  };
  const a = lum(hex);
  const b = lum(tinta);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test('tinta del avatar: ningún color de la paleta queda por debajo del mínimo legible', () => {
  for (const bg of AVATAR_COLORS) {
    const ratio = contraste(bg, getAvatarInk(bg));
    assert.ok(ratio >= 4.5, `${bg} da ${ratio.toFixed(2)}:1, necesita 4.5`);
  }
});

test('tinta del avatar: oscura sobre los claros, blanca sobre el violeta de marca', () => {
  assert.equal(getAvatarInk('#ffd60a'), AVATAR_INK_DARK, 'amarillo');
  assert.equal(getAvatarInk('#64d2ff'), AVATAR_INK_DARK, 'celeste');
  assert.equal(getAvatarInk('#30d158'), AVATAR_INK_DARK, 'verde');
  assert.equal(getAvatarInk('#5e5ce6'), AVATAR_INK_LIGHT, 'violeta primary');
});

test('tinta del avatar: un valor inservible no rompe el render', () => {
  for (const malo of [null, undefined, '', 'rojo', '#fff', 123, {}]) {
    assert.equal(getAvatarInk(malo), AVATAR_INK_LIGHT, `falló con ${JSON.stringify(malo)}`);
  }
});

test('tinta del avatar: cada color de la paleta tiene su tinta resuelta', () => {
  // getAvatarColor siempre devuelve un color de la paleta, así que la tinta
  // nunca cae en el caso de respaldo por un color inesperado.
  for (const nombre of ['Ana Rivas', 'Diego Molina', 'Sofía Paz', '']) {
    assert.ok(AVATAR_COLORS.includes(getAvatarColor(nombre)), nombre || '(vacío)');
  }
});

test('getInitials: nombre y apellido, una sola palabra, y espacios de más', () => {
  assert.equal(getInitials('Ana Pérez'), 'AP');
  assert.equal(getInitials('Ana'), 'A');
  assert.equal(getInitials('  ana   pérez  '), 'AP');
  assert.equal(getInitials('Ana María Pérez'), 'AM'); // máximo 2
});

test('getInitials: sin nombre utilizable devuelve "?" y nunca el texto "UNDEFINED"', () => {
  // Un nombre de solo espacios es truthy, así que el guard `!name` no lo
  // atrapaba: parts[0][0] daba undefined y el avatar mostraba "UNDEFINED"
  // como si fueran las iniciales de la persona.
  for (const vacio of ['', '   ', '\t', '\n  \n', null, undefined]) {
    assert.equal(getInitials(vacio), '?', `falló con ${JSON.stringify(vacio)}`);
  }
});

test('slugifyRoomName: acentos, símbolos y espacios → slug de URL', () => {
  assert.equal(slugifyRoomName('Equipo Comercial'), 'equipo-comercial');
  assert.equal(slugifyRoomName('Ventas & Marketing 2026'), 'ventas-marketing-2026');
  assert.equal(slugifyRoomName('  Rôle Plays  '), 'role-plays');
  assert.equal(slugifyRoomName('¿?¡!'), '', 'sin letras ni números no hay slug');
});

test('nameFromEmail: deriva un nombre presentable cuando Google no manda uno', () => {
  assert.equal(nameFromEmail('carlos.mendoza@gmail.com'), 'Carlos Mendoza');
  assert.equal(nameFromEmail('ana_perez@x.com'), 'Ana Perez');
  assert.equal(nameFromEmail(''), 'Invitado');
});

test('escapeLikeLiteral: los comodines de LIKE en un email se escapan', () => {
  // El guion bajo es válido en un email y en ILIKE significa "cualquier
  // carácter": sin escapar, un patrón podía dar por buena a otra persona.
  assert.equal(escapeLikeLiteral('ana_perez@x.com'), 'ana\\_perez@x.com');
  assert.equal(escapeLikeLiteral('a%b@x.com'), 'a\\%b@x.com');
});

test('googleCalendarUrl: arma el enlace con la fecha en el formato de Google', () => {
  const url = googleCalendarUrl({
    title: 'Roleplay — Ana · Ivo',
    startsAt: '2026-08-19T17:00:00.000Z',
    durationMin: 60,
    meetLink: 'https://meet.google.com/abc-defg-hij'
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get('action'), 'TEMPLATE');
  assert.equal(params.get('text'), 'Roleplay — Ana · Ivo');
  // Google espera YYYYMMDDTHHMMSSZ, sin guiones ni milisegundos.
  assert.equal(params.get('dates'), '20260819T170000Z/20260819T180000Z');
  assert.match(params.get('details'), /meet\.google\.com/);
});

test('googleCalendarUrl: la duración corre el fin, y sin duración asume una hora', () => {
  const media = googleCalendarUrl({ startsAt: '2026-08-19T17:00:00Z', durationMin: 30 });
  assert.equal(new URL(media).searchParams.get('dates'), '20260819T170000Z/20260819T173000Z');

  const porDefecto = googleCalendarUrl({ startsAt: '2026-08-19T17:00:00Z' });
  assert.equal(new URL(porDefecto).searchParams.get('dates'), '20260819T170000Z/20260819T180000Z');
});

test('googleCalendarUrl: sin fecha válida devuelve null y no un enlace roto', () => {
  // La tarjeta esconde el botón cuando esto es null: es preferible no ofrecerlo
  // a mandar a alguien a un calendario con una fecha inventada.
  for (const malo of ['', 'cualquier cosa', null, undefined]) {
    assert.equal(googleCalendarUrl({ startsAt: malo }), null);
  }
});
