// Fondo animado del hero: mesh gradient en WebGL (adaptado del "Shader
// Builder" de 21st.dev a JS vanilla, sin dependencias de React/shadcn).
// Colores tomados de la paleta de marca (indigo/purple/emerald). El
// seguimiento de cursor del original queda deshabilitado a propósito.
(function () {
    'use strict';

    var canvas = document.getElementById('hero-shader');
    if (!canvas || !window.WebGLRenderingContext) {
        return;
    }

    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var VERT = 'attribute vec2 a_position;\n' +
        'void main() {\n' +
        '  gl_Position = vec4(a_position, 0.0, 1.0);\n' +
        '}';

    var FRAG = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        '',
        'uniform vec3 u_colors[8];',
        'uniform vec4 u_scene;',
        'uniform vec4 u_shape;',
        'uniform vec4 u_surface;',
        'uniform vec4 u_finish;',
        'uniform vec4 u_transform;',
        'uniform vec4 u_space;',
        '',
        '#define u_resolution u_scene.xy',
        '#define u_time u_scene.z',
        '#define u_colorCount u_scene.w',
        '#define u_scale u_shape.x',
        '#define u_intensity u_shape.y',
        '#define u_warp u_shape.w',
        '#define u_detail u_surface.x',
        '#define u_contrast u_surface.y',
        '#define u_brightness u_surface.z',
        '#define u_saturation u_surface.w',
        '#define u_hue u_finish.x',
        '#define u_vignette u_finish.y',
        '#define u_blur u_finish.z',
        '#define u_grain u_finish.w',
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        '#define u_seed u_transform.x',
        '#else',
        '#define u_seed mod(u_transform.x, 31.0)',
        '#endif',
        '#define u_rotate u_transform.y',
        '#define u_drift u_transform.z',
        '#define u_offset u_space.xy',
        '',
        'float hash21(vec2 p) {',
        '#ifndef GL_FRAGMENT_PRECISION_HIGH',
        '  p = mod(p, 31.0);',
        '#endif',
        '  p = fract(p * vec2(234.34, 435.345));',
        '  p += dot(p, p + 34.23);',
        '  return fract(p.x * p.y);',
        '}',
        '',
        'float grainHash(vec2 p) {',
        '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
        '  p3 += dot(p3, p3.yzx + 33.33);',
        '  return fract((p3.x + p3.y) * p3.z);',
        '}',
        '',
        'float noise(vec2 p) {',
        '  vec2 i = floor(p);',
        '  vec2 f = fract(p);',
        '  vec2 u = f * f * (3.0 - 2.0 * f);',
        '  return mix(',
        '    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),',
        '    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),',
        '    u.y);',
        '}',
        '',
        'float fbm(vec2 p) {',
        '  float v = 0.0;',
        '  float a = 0.5;',
        '  for (int i = 0; i < 5; i++) {',
        '    v += a * noise(p);',
        '    p = p * 2.03 + vec2(17.0, 9.2);',
        '    a *= 0.5;',
        '  }',
        '  return v;',
        '}',
        '',
        'vec3 hueRotate(vec3 col, float a) {',
        '  const mat3 toYIQ = mat3(0.299, 0.596, 0.211,',
        '                          0.587, -0.274, -0.523,',
        '                          0.114, -0.322, 0.312);',
        '  const mat3 toRGB = mat3(1.0, 1.0, 1.0,',
        '                          0.956, -0.272, -1.106,',
        '                          0.621, -0.647, 1.703);',
        '  vec3 yiq = toYIQ * col;',
        '  float ca = cos(a), sa = sin(a);',
        '  yiq = vec3(yiq.x, yiq.y * ca - yiq.z * sa, yiq.y * sa + yiq.z * ca);',
        '  return toRGB * yiq;',
        '}',
        '',
        'vec3 shade(vec2 uv, vec2 p, float t) {',
        '  vec3 acc = u_colors[0] * 0.15;',
        '  float total = 0.15;',
        '  for (int i = 0; i < 8; i++) {',
        '    if (float(i) >= u_colorCount) break;',
        '    float fi = float(i);',
        '    vec2 c = vec2(',
        '      sin(t * (0.21 + fi * 0.071) + fi * 2.4 + u_seed),',
        '      cos(t * (0.17 + fi * 0.093) + fi * 1.7)) * (0.45 + u_intensity * 0.35);',
        '    float w = exp(-dot(p - c, p - c) * 6.0);',
        '    acc += u_colors[i] * w;',
        '    total += w;',
        '  }',
        '  return acc / total;',
        '}',
        '',
        'void main() {',
        '  vec2 uv = gl_FragCoord.xy / u_resolution.xy;',
        '  vec2 screenUv = uv;',
        '  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy)',
        '    / min(u_resolution.x, u_resolution.y);',
        '',
        '  uv = p * min(u_resolution.x, u_resolution.y) / u_resolution.xy + 0.5;',
        '  p *= u_scale;',
        '  if (abs(u_rotate) > 0.0001) {',
        '    float cr = cos(u_rotate), sr = sin(u_rotate);',
        '    p = mat2(cr, -sr, sr, cr) * p;',
        '  }',
        '  p += u_offset;',
        '  if (u_drift > 0.0001)',
        '    p += u_drift * vec2(sin(u_time * 0.31), cos(u_time * 0.23));',
        '  if (u_warp > 0.0) {',
        '    p += u_warp * (vec2(',
        '      fbm(p * u_detail + u_seed),',
        '      fbm(p * u_detail + vec2(5.2, 1.3))) - 0.5);',
        '  }',
        '  vec3 col;',
        '  if (u_blur > 0.0) {',
        '    float e = u_blur;',
        '    float pe = e * u_scale;',
        '    vec2 uvE = vec2(e) * min(u_resolution.x, u_resolution.y) / u_resolution.xy;',
        '    col  = shade(uv, p, u_time) * 0.36;',
        '    col += shade(uv + vec2(uvE.x, 0.0), p + vec2(pe, 0.0), u_time) * 0.16;',
        '    col += shade(uv - vec2(uvE.x, 0.0), p - vec2(pe, 0.0), u_time) * 0.16;',
        '    col += shade(uv + vec2(0.0, uvE.y), p + vec2(0.0, pe), u_time) * 0.16;',
        '    col += shade(uv - vec2(0.0, uvE.y), p - vec2(0.0, pe), u_time) * 0.16;',
        '  } else {',
        '    col = shade(uv, p, u_time);',
        '  }',
        '  if (abs(u_contrast - 1.0) > 0.0001)',
        '    col = (col - 0.5) * u_contrast + 0.5;',
        '  if (abs(u_saturation - 1.0) > 0.0001) {',
        '    float luma = dot(col, vec3(0.299, 0.587, 0.114));',
        '    col = mix(vec3(luma), col, u_saturation);',
        '  }',
        '  if (abs(u_hue) > 0.0001)',
        '    col = hueRotate(col, u_hue);',
        '  if (abs(u_brightness) > 0.0001)',
        '    col += u_brightness;',
        '  if (u_vignette > 0.0001) {',
        '    float vd = length(screenUv - 0.5) * 1.41421356;',
        '    col *= 1.0 - u_vignette * smoothstep(0.35, 1.0, vd);',
        '  }',
        '  if (u_grain > 0.0001)',
        '    col += (grainHash(',
        '      gl_FragCoord.xy + vec2(u_seed * 17.0, u_seed * 31.0)) - 0.5) * u_grain;',
        '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
        '}'
    ].join('\n');

    // Paleta de marca (indigo #4F46E5, purple #8B5CF6, emerald #10B981),
    // de un tono oscuro a un highlight claro. Los slots 5-7 repiten el
    // highlight, igual que hace el preset original con su color más claro.
    var UNIFORMS = {
        colors: [
            [0.043137254901961, 0.039215686274510, 0.121568627450980],
            [0.309803921568627, 0.274509803921569, 0.898039215686275],
            [0.545098039215686, 0.360784313725490, 0.964705882352941],
            [0.062745098039216, 0.725490196078431, 0.505882352941176],
            [0.945098039215686, 0.941176470588235, 0.984313725490196],
            [0.945098039215686, 0.941176470588235, 0.984313725490196],
            [0.945098039215686, 0.941176470588235, 0.984313725490196],
            [0.945098039215686, 0.941176470588235, 0.984313725490196]
        ],
        colorCount: 5,
        scale: 1.300,
        intensity: 0.560,
        warp: 0.192,
        detail: 2.016,
        contrast: 1.167,
        brightness: 0.000,
        saturation: 1.000,
        hue: 0.0000,
        vignette: 0.150,
        blur: 0.0072,
        grain: 0.06,
        seed: 5069.0,
        rotate: 2.7227,
        offsetX: 0.090,
        offsetY: 0.150,
        drift: 0.148,
        timeScale: -1.373
    };

    var gl = canvas.getContext('webgl', { antialias: false });
    if (!gl) {
        return;
    }

    function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }

    var program = gl.createProgram();
    var vertexShader = compile(gl.VERTEX_SHADER, VERT);
    var fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        return;
    }
    gl.useProgram(program);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uni = {
        colors: gl.getUniformLocation(program, 'u_colors'),
        scene: gl.getUniformLocation(program, 'u_scene'),
        shape: gl.getUniformLocation(program, 'u_shape'),
        surface: gl.getUniformLocation(program, 'u_surface'),
        finish: gl.getUniformLocation(program, 'u_finish'),
        transform: gl.getUniformLocation(program, 'u_transform'),
        space: gl.getUniformLocation(program, 'u_space')
    };

    var flatColors = [];
    for (var i = 0; i < UNIFORMS.colors.length; i++) {
        flatColors.push(UNIFORMS.colors[i][0], UNIFORMS.colors[i][1], UNIFORMS.colors[i][2]);
    }
    gl.uniform3fv(uni.colors, new Float32Array(flatColors));
    gl.uniform4f(uni.shape, UNIFORMS.scale, UNIFORMS.intensity, 0, UNIFORMS.warp);
    gl.uniform4f(uni.surface, UNIFORMS.detail, UNIFORMS.contrast, UNIFORMS.brightness, UNIFORMS.saturation);
    gl.uniform4f(uni.finish, UNIFORMS.hue, UNIFORMS.vignette, UNIFORMS.blur, UNIFORMS.grain);
    gl.uniform4f(uni.transform, UNIFORMS.seed, UNIFORMS.rotate, UNIFORMS.drift, 0);

    var raf = 0;
    var visible = document.visibilityState === 'visible';
    var inView = true;
    var start = performance.now();
    var timeAnimated = !prefersReducedMotion && Math.abs(UNIFORMS.timeScale) > 0.0001;

    function resizeCanvas() {
        var bounds = canvas.getBoundingClientRect();
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var rawWidth = Math.max(1, Math.round(bounds.width * dpr));
        var rawHeight = Math.max(1, Math.round(bounds.height * dpr));
        var pixelScale = Math.min(1, Math.sqrt(2000000 / Math.max(1, rawWidth * rawHeight)));
        var width = Math.max(1, Math.round(rawWidth * pixelScale));
        var height = Math.max(1, Math.round(rawHeight * pixelScale));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, width, height);
        }
    }

    function requestRender() {
        if (visible && inView && raf === 0) {
            raf = requestAnimationFrame(render);
        }
    }

    function render(now) {
        raf = 0;
        if (!visible || !inView) {
            return;
        }
        resizeCanvas();
        gl.uniform4f(uni.scene, canvas.width, canvas.height, ((now - start) / 1000) * UNIFORMS.timeScale, UNIFORMS.colorCount);
        gl.uniform4f(uni.space, UNIFORMS.offsetX, UNIFORMS.offsetY, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (timeAnimated) {
            requestRender();
        }
    }

    window.addEventListener('resize', function () {
        resizeCanvas();
        requestRender();
    });

    var resizeObserver = new ResizeObserver(function () {
        resizeCanvas();
        requestRender();
    });
    resizeObserver.observe(canvas);

    var intersectionObserver = new IntersectionObserver(function (entries) {
        var entry = entries[0];
        inView = entry ? entry.isIntersecting : true;
        if (inView) {
            requestRender();
        }
    });
    intersectionObserver.observe(canvas);

    document.addEventListener('visibilitychange', function () {
        visible = document.visibilityState === 'visible';
        if (visible) {
            requestRender();
        }
    });

    requestRender();
})();
