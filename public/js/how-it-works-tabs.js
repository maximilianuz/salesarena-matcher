// "Cómo Funciona" — lista de pasos con auto-play y panel ilustrado que
// cambia con una transición vertical (adaptado del componente "Vertical
// Tabs" de 21st.dev/React a JS vanilla). Los paneles son gradientes de
// marca + ícono en vez de fotos, para no depender de imágenes externas.
(function () {
    'use strict';

    var tabsContainer = document.getElementById('vtabs-tabs');
    var gallery = document.getElementById('vtabs-gallery');
    if (!tabsContainer || !gallery) {
        return;
    }

    var tabs = Array.prototype.slice.call(tabsContainer.querySelectorAll('.vtabs-tab'));
    var panels = Array.prototype.slice.call(gallery.querySelectorAll('.vtabs-panel'));
    var count = tabs.length;
    if (count < 2 || panels.length !== count) {
        return;
    }

    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var AUTO_PLAY_MS = 5000;
    var active = 0;
    var timer = null;
    var paused = false;

    function resetFill(index) {
        var fill = tabs[index].querySelector('.vtabs-progress-fill');
        fill.classList.remove('is-filling');
        fill.style.height = '0%';
    }

    function startFill(index) {
        var fill = tabs[index].querySelector('.vtabs-progress-fill');
        if (prefersReducedMotion) {
            fill.style.height = '100%';
            return;
        }
        fill.style.height = '0%';
        void fill.offsetWidth;
        fill.classList.add('is-filling');
    }

    function setActive(index, dir) {
        if (index === active || index < 0 || index >= count) {
            return;
        }
        var goingForward = dir === undefined ? index > active : dir > 0;

        tabs[active].classList.remove('is-active');
        resetFill(active);

        panels[active].classList.remove('is-active');
        panels[active].style.transform = 'translateY(' + (goingForward ? '-100%' : '100%') + ')';

        panels[index].style.transition = 'none';
        panels[index].style.transform = 'translateY(' + (goingForward ? '100%' : '-100%') + ')';
        panels[index].style.opacity = '1';
        void panels[index].offsetHeight;
        panels[index].style.transition = '';

        requestAnimationFrame(function () {
            panels[index].classList.add('is-active');
            panels[index].style.transform = 'translateY(0)';
        });

        tabs[index].classList.add('is-active');
        active = index;
        startFill(active);
    }

    function next() {
        setActive((active + 1) % count, 1);
    }

    function prev() {
        setActive((active - 1 + count) % count, -1);
    }

    function stopTimer() {
        if (timer) {
            window.clearInterval(timer);
            timer = null;
        }
    }

    function startTimer() {
        if (prefersReducedMotion) {
            return;
        }
        stopTimer();
        timer = window.setInterval(function () {
            if (!paused) {
                next();
            }
        }, AUTO_PLAY_MS);
    }

    tabs.forEach(function (tab, index) {
        tab.addEventListener('click', function () {
            setActive(index);
            startTimer();
        });
    });

    var prevBtn = document.getElementById('vtabs-prev');
    var nextBtn = document.getElementById('vtabs-next');
    if (prevBtn) {
        prevBtn.addEventListener('click', function () { prev(); startTimer(); });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () { next(); startTimer(); });
    }

    gallery.addEventListener('mouseenter', function () {
        paused = true;
        tabsContainer.classList.add('vtabs-tabs--paused');
    });
    gallery.addEventListener('mouseleave', function () {
        paused = false;
        tabsContainer.classList.remove('vtabs-tabs--paused');
    });

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            var entry = entries[0];
            if (entry && entry.isIntersecting) {
                startTimer();
            } else {
                stopTimer();
            }
        }, { threshold: 0.3 }).observe(gallery);
    } else {
        startTimer();
    }

    startFill(0);
})();
