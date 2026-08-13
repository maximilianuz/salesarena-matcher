// Carousel "coverflow" 3D para la sección de features (adaptado del
// componente React/shadcn de 21st.dev a JS vanilla, sin dependencias).
// Cada slide es una de nuestras feature-card existentes (icono + texto) en
// vez de una imagen. Si el navegador no soporta lo necesario, o si algo
// falla al medir, el track se queda como grid estático (fallback natural).
(function () {
    'use strict';

    var frame = document.getElementById('coverflow-frame');
    var track = document.getElementById('coverflow-track');
    if (!frame || !track) {
        return;
    }

    var cards = Array.prototype.slice.call(track.querySelectorAll('.coverflow-card'));
    var count = cards.length;
    if (count < 2) {
        return;
    }

    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var ROTATE = 40;
    var DEPTH = 0.6;
    var PERSPECTIVE = 3;
    var FALLOFF = 0.6;
    var FADE = 0.13;
    var GAP = 0.08;

    var posRef = 0;
    var targetRef = 0;
    var widthRef = 0;
    var rafRef = null;
    var selected = 0;
    var dotEls = [];

    function indexAt(pos) {
        return ((Math.round(pos) % count) + count) % count;
    }

    function paint() {
        var width = widthRef;
        if (!width) {
            return;
        }
        var pitch = width * (1 + GAP);
        var pos = posRef;

        cards.forEach(function (card, index) {
            var offset = index - pos;
            offset = ((offset % count) + count) % count;
            if (offset > count / 2) {
                offset -= count;
            }

            var distance = Math.abs(offset);
            var ramp = Math.pow(distance, FALLOFF);
            var tilt = Math.min(ROTATE * ramp, 82) * Math.sign(offset);

            card.style.transform =
                'translateX(calc(-50% + ' + (offset * pitch).toFixed(2) + 'px)) ' +
                'translateZ(' + (-DEPTH * width * ramp).toFixed(2) + 'px) rotateY(' + (-tilt).toFixed(2) + 'deg)';

            var edge = Math.min(1, Math.max(0, count / 2 - distance));
            card.style.opacity = String(Math.max(0, 1 - FADE * distance) * edge);
            card.style.zIndex = String(100 - Math.round(distance));
            card.setAttribute('aria-hidden', distance > 0.5 ? 'true' : 'false');
        });

        dotEls.forEach(function (dot, index) {
            var isSelected = index === selected;
            dot.classList.toggle('is-active', isSelected);
            dot.setAttribute('aria-current', isSelected ? 'true' : 'false');
        });
    }

    function settle(target) {
        if (rafRef !== null) {
            cancelAnimationFrame(rafRef);
        }
        targetRef = target;
        selected = indexAt(target);

        if (prefersReducedMotion) {
            posRef = target;
            paint();
            rafRef = null;
            return;
        }

        function step() {
            var remaining = target - posRef;
            if (Math.abs(remaining) < 0.0004) {
                posRef = target;
                paint();
                rafRef = null;
                return;
            }
            posRef += remaining * 0.16;
            paint();
            rafRef = requestAnimationFrame(step);
        }
        rafRef = requestAnimationFrame(step);
    }

    function goTo(index) {
        var target = index + Math.round((targetRef - index) / count) * count;
        settle(target);
    }

    function nudge(by) {
        settle(Math.round(targetRef) + by);
    }

    // Drag / swipe
    var drag = null;

    frame.addEventListener('pointerdown', function (event) {
        if (rafRef !== null) {
            cancelAnimationFrame(rafRef);
            rafRef = null;
        }
        frame.setPointerCapture(event.pointerId);
        targetRef = posRef;
        drag = { id: event.pointerId, x: event.clientX, pos: posRef, v: 0, t: performance.now() };
    });

    frame.addEventListener('pointermove', function (event) {
        if (!drag || drag.id !== event.pointerId) {
            return;
        }
        var pitch = widthRef * (1 + GAP);
        if (!pitch) {
            return;
        }
        var now = performance.now();
        var previous = posRef;
        posRef = drag.pos - (event.clientX - drag.x) / pitch;
        drag.v = ((posRef - previous) / Math.max(now - drag.t, 1)) * 1000;
        drag.t = now;
        selected = indexAt(posRef);
        paint();
    });

    function endDrag(event) {
        if (!drag || drag.id !== event.pointerId) {
            return;
        }
        var carried = Math.max(-2, Math.min(2, drag.v * 0.18));
        drag = null;
        settle(Math.round(posRef + carried));
    }
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);

    frame.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudge(-1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudge(1);
        }
    });

    var prevBtn = document.getElementById('coverflow-prev');
    var nextBtn = document.getElementById('coverflow-next');
    if (prevBtn) {
        prevBtn.addEventListener('click', function () { nudge(-1); });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () { nudge(1); });
    }

    var pagination = document.getElementById('coverflow-pagination');
    if (pagination) {
        cards.forEach(function (_, index) {
            var dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'coverflow-dot';
            dot.setAttribute('aria-label', 'Ir a la tarjeta ' + (index + 1) + ' de ' + count);
            dot.addEventListener('click', function () { goTo(index); });
            pagination.appendChild(dot);
            dotEls.push(dot);
        });
    }

    function measure() {
        widthRef = cards[0].offsetWidth;
        paint();
    }

    // Activar el layout 3D recién cuando ya podemos medir: evita un salto
    // visual si el usuario ve el fallback en grid por una fracción de segundo.
    track.classList.add('coverflow-track--active');
    measure();

    if ('ResizeObserver' in window) {
        new ResizeObserver(measure).observe(frame);
    } else {
        window.addEventListener('resize', measure);
    }

    settle(0);
})();
