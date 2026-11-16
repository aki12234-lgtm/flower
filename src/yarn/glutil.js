// Minimal WebGL2 helpers.
//
// No library: the rest of the project has no dependencies and no build step, and
// there is no reason for the renderer to be the exception. This is only the
// handful of things a small forward renderer needs — compile a program, hand it
// uniforms without caring about types, and make a framebuffer.

export function createGL(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    powerPreference: 'high-performance',
    // Costs real memory and bandwidth on some drivers, and only the pages that
    // read a frame back afterwards need it. The game does not.
    preserveDrawingBuffer: !!opts.preserve,
  });
  if (!gl) {
    throw new Error('This browser cannot open WebGL 2. '
      + 'That is usually hardware acceleration being switched off, or a very old browser.');
  }
  // Required, not optional: every colour target here is half-float.
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('This browser has WebGL 2 but cannot render to floating point textures '
      + '(EXT_color_buffer_float is missing), which this renderer needs.');
  }
  gl.getExtension('OES_texture_float_linear');
  // Lets the driver compile off its own thread rather than stalling this one.
  // It changes nothing about how programs are built here; it only means the
  // work can overlap instead of blocking the page.
  gl.getExtension('KHR_parallel_shader_compile');
  return gl;
}

/** What this machine can do, for the diagnostic page and for bug reports. */
export function support() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl2: true,
    colourBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    textureFloatLinear: !!gl.getExtension('OES_texture_float_linear'),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    dpr: window.devicePixelRatio || 1,
    screen: `${window.screen.width}x${window.screen.height}`,
  };
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`shader failed:\n${log}\n${numbered}`);
  }
  return sh;
}

export const ATTRIB_SLOTS = ['aPos', 'aNormal', 'aAlbedo', 'aParams'];

export function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  // fixed slots, so a mesh built for one program draws correctly under another
  ATTRIB_SLOTS.forEach((name, i) => gl.bindAttribLocation(p, i, name));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link failed: ' + gl.getProgramInfoLog(p));
  }
  const uniforms = new Map();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms.set(name, { loc: gl.getUniformLocation(p, name), type: info.type });
  }
  return { p, uniforms };
}

/** Set uniforms from a plain object; the type comes from the shader. */
export function setUniforms(gl, prog, values) {
  let unit = 0;
  for (const [name, v] of Object.entries(values)) {
    const u = prog.uniforms.get(name);
    if (!u) continue;
    switch (u.type) {
      case gl.FLOAT: gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v); break;
      case gl.SAMPLER_2D: case gl.SAMPLER_2D_SHADOW:
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v);
        gl.uniform1i(u.loc, unit);
        unit++;
        break;
      default: break;
    }
  }
}

/**
 * An interleaved static mesh. `layout` is [[attribName, size], ...] and must
 * match the order the data was packed in.
 */
export function mesh(gl, prog, data, indices, layout) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const stride = layout.reduce((a, [, size]) => a + size, 0) * 4;
  let offset = 0;
  for (const [name, size] of layout) {
    const loc = gl.getAttribLocation(prog.p, name);
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    offset += size * 4;
  }

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  return { vao, count: indices.length, vbo, ibo };
}

export function disposeMesh(gl, m) {
  if (!m) return;
  gl.deleteVertexArray(m.vao);
  gl.deleteBuffer(m.vbo);
  gl.deleteBuffer(m.ibo);
}

/** Colour target, optionally with a depth texture attached. */
export function framebuffer(gl, w, h, opts = {}) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  const colour = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colour);
  const internal = opts.float ? gl.RGBA16F : gl.RGBA8;
  const type = opts.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
  // Nearest, when the alpha channel is carrying data rather than coverage.
  //
  // The material id rides in alpha here, and a filtered tap that straddles a
  // silhouette returns a *blend* of two ids — which is not any material, and
  // decodes to a number low enough to look like ordinary lit geometry. Every
  // check of the form "is this pixel part of a drawing" then answered no on
  // exactly the pixels where it mattered, and the tap contributed half the
  // plant's raw colour to the background. That was the thread of green around
  // every flat shape, and no amount of guarding the *uses* could fix it while
  // the reads themselves were being interpolated.
  const filter = opts.nearest ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0);

  let depth = null;
  if (opts.depth) {
    depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, colour, depth, w, h };
}

/** Depth-only target, for the shadow map. */
export function shadowTarget(gl, size) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const depth = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, depth);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0,
    gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, depth, size };
}

/** A triangle that covers the screen, for post passes. */
export function fullscreenTriangle(gl, prog) {
  return mesh(gl,
    prog,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    new Uint16Array([0, 1, 2]),
    [['aPos', 2]]);
}

// ------------------------------------------------------------------- maths --

export const mat4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },

  ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l), 0, 0, 0,
      0, 2 / (t - b), 0, 0,
      0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
    ]);
  },

  lookAt(eye, target, up) {
    const z = norm3(sub3(eye, target));
    const x = norm3(cross3(up, z));
    const y = cross3(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
    ]);
  },

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        out[i * 4 + j] = s;
      }
    }
    return out;
  },
};

export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function norm3(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
