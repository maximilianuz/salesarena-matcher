// Sección "Comunidad" de la landing: testimonios aprobados + top 10 del mes.
// Corre en la página pública SIN sesión iniciada, así que solo puede llamar a
// las dos funciones que la migración 20260815100000 abrió a propósito a rol
// anon (public_testimonials / public_top_roleplayers) — todo lo demás en
// Supabase le sigue estando cerrado, exactamente como a cualquier visitante.
//
// DOM armado con createElement/textContent en vez de innerHTML con strings
// interpoladas: el nombre y el comentario son texto que escribió otra
// persona, y aunque pasan por moderación manual antes de llegar acá, un
// admin puede aprobar sin fijarse si el texto tiene < > o comillas. No hay
// que confiar en eso para decidir cómo se inyecta al DOM.
import { supabase } from './supabaseClient.js';
import { getInitials, getAvatarColor } from './utils/format.js';

const STAR_COUNT = 5;

function buildAvatar(name, avatarUrl, sizeClass) {
  const wrap = document.createElement('span');
  wrap.className = sizeClass;
  wrap.style.backgroundColor = getAvatarColor(name);

  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;';
    img.onerror = () => {
      img.remove();
      wrap.textContent = getInitials(name);
    };
    wrap.appendChild(img);
  } else {
    wrap.textContent = getInitials(name);
  }
  return wrap;
}

function buildStars(rating, sizeClass) {
  const row = document.createElement('span');
  row.className = sizeClass;
  row.setAttribute('aria-label', `${rating} de 5 estrellas`);
  for (let i = 1; i <= STAR_COUNT; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', i <= rating ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    if (i <= rating) svg.classList.add('filled');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z');
    svg.appendChild(path);
    row.appendChild(svg);
  }
  return row;
}

function buildTestimonialCard(t) {
  const card = document.createElement('article');
  card.className = 'testimonial-card';

  const head = document.createElement('div');
  head.className = 'testimonial-card-head';
  head.appendChild(buildAvatar(t.member_name, t.avatar_url, 'testimonial-avatar'));

  const nameCol = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'testimonial-name';
  name.textContent = t.member_name;
  nameCol.appendChild(name);
  nameCol.appendChild(buildStars(t.rating, 'testimonial-stars'));
  head.appendChild(nameCol);
  card.appendChild(head);

  const text = document.createElement('p');
  text.className = 'testimonial-text';
  text.textContent = t.comment;
  card.appendChild(text);

  return card;
}

function buildRankRow(entry, rank) {
  const li = document.createElement('li');
  li.className = 'top-roleplayer-row';

  const rankEl = document.createElement('span');
  rankEl.className = 'top-roleplayer-rank';
  rankEl.textContent = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : String(rank);
  li.appendChild(rankEl);

  li.appendChild(buildAvatar(entry.member_name, entry.avatar_url, 'top-roleplayer-avatar'));

  const info = document.createElement('div');
  info.className = 'top-roleplayer-info';
  const name = document.createElement('div');
  name.className = 'top-roleplayer-name';
  name.textContent = entry.member_name;
  info.appendChild(name);
  const count = document.createElement('div');
  count.className = 'top-roleplayer-count';
  const n = Number(entry.sessions_count);
  count.textContent = `${n} role-play${n === 1 ? '' : 's'} este mes`;
  info.appendChild(count);
  li.appendChild(info);

  return li;
}

async function renderTestimonials() {
  const marquee = document.getElementById('testimonials-marquee');
  const track = document.getElementById('testimonials-track');
  if (!marquee || !track) return false;

  const { data, error } = await supabase.rpc('public_testimonials', { p_limit: 12 });
  if (error || !data || data.length === 0) return false;

  // Se duplica el listado para que el loop del marquee sea continuo (la
  // animación recorre el 50% del ancho total, así que necesita 2 copias como
  // mínimo). Con pocos testimonios se duplica más para que no se note vacío.
  const copies = data.length <= 4 ? 4 : 2;
  for (let c = 0; c < copies; c++) {
    data.forEach(t => track.appendChild(buildTestimonialCard(t)));
  }

  marquee.hidden = false;
  return true;
}

async function renderTopRoleplayers() {
  const block = document.getElementById('top-roleplayers');
  const list = document.getElementById('top-roleplayers-list');
  if (!block || !list) return false;

  const { data, error } = await supabase.rpc('public_top_roleplayers', { p_limit: 10 });
  if (error || !data || data.length === 0) return false;

  data.forEach((entry, i) => list.appendChild(buildRankRow(entry, i + 1)));
  block.hidden = false;
  return true;
}

(async function init() {
  const section = document.getElementById('community-showcase');
  if (!section) return;

  const [hasTestimonials, hasRanking] = await Promise.all([
    renderTestimonials().catch(() => false),
    renderTopRoleplayers().catch(() => false)
  ]);

  // Nada que mostrar todavía (recién desplegado, o ningún testimonio
  // aprobado aún): se oculta la sección entera en vez de dejar un espacio
  // vacío entre "Cómo Funciona" y "Qué permiso de Google usamos".
  if (hasTestimonials || hasRanking) {
    section.hidden = false;
  }
})();
