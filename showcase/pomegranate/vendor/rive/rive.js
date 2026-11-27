(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["rive"] = factory();
	else
		root["rive"] = factory();
})(this, () => {
return /******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */,
/* 1 */
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });

var Rive = (() => {
  var _scriptDir = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : undefined;
  
  return (
function(moduleArg = {}) {

var h = moduleArg, aa, ba;
h.ready = new Promise((b, a) => {
  aa = b;
  ba = a;
});
function ca() {
  function b(m) {
    const k = d;
    c = a = 0;
    d = new Map();
    k.forEach(n => {
      try {
        n(m);
      } catch (l) {
        console.error(l);
      }
    });
    this.xa();
    e && e.Ta();
  }
  let a = 0, c = 0, d = new Map(), e = null, f = null;
  this.requestAnimationFrame = function(m) {
    a || (a = requestAnimationFrame(b.bind(this)));
    const k = ++c;
    d.set(k, m);
    return k;
  };
  this.cancelAnimationFrame = function(m) {
    d.delete(m);
    a && 0 == d.size && (cancelAnimationFrame(a), a = 0);
  };
  this.Ra = function(m) {
    f && (document.body.remove(f), f = null);
    m || (f = document.createElement("div"), f.style.backgroundColor = "black", f.style.position = "fixed", f.style.right = 0, f.style.top = 0, f.style.color = "white", f.style.padding = "4px", f.innerHTML = "RIVE FPS", m = function(k) {
      f.innerHTML = "RIVE FPS " + k.toFixed(1);
    }, document.body.appendChild(f));
    e = new function() {
      let k = 0, n = 0;
      this.Ta = function() {
        var l = performance.now();
        n ? (++k, l -= n, 1000 < l && (m(1000 * k / l), k = n = 0)) : (n = l, k = 0);
      };
    }();
  };
  this.Oa = function() {
    f && (document.body.remove(f), f = null);
    e = null;
  };
  this.xa = function() {
  };
}
function da(b) {
  console.assert(!0);
  const a = new Map();
  let c = -Infinity;
  this.push = function(d) {
    d = d + ((1 << b) - 1) >> b;
    a.has(d) && clearTimeout(a.get(d));
    a.set(d, setTimeout(function() {
      a.delete(d);
      0 == a.length ? c = -Infinity : d == c && (c = Math.max(...a.keys()), console.assert(c < d));
    }, 1000));
    c = Math.max(d, c);
    return c << b;
  };
}
const ea = h.onRuntimeInitialized;
h.onRuntimeInitialized = function() {
  ea && ea();
  let b = h.decodeAudio;
  h.decodeAudio = function(e, f) {
    e = b(e);
    f(e);
  };
  let a = h.decodeFont;
  h.decodeFont = function(e, f) {
    e = a(e);
    f(e);
  };
  const c = h.FileAssetLoader;
  h.ptrToAsset = e => {
    let f = h.ptrToFileAsset(e);
    return f.isImage ? h.ptrToImageAsset(e) : f.isFont ? h.ptrToFontAsset(e) : f.isAudio ? h.ptrToAudioAsset(e) : f;
  };
  h.CustomFileAssetLoader = c.extend("CustomFileAssetLoader", {__construct:function({loadContents:e}) {
    this.__parent.__construct.call(this);
    this.Ha = e;
  }, loadContents:function(e, f) {
    e = h.ptrToAsset(e);
    return this.Ha(e, f);
  },});
  h.CDNFileAssetLoader = c.extend("CDNFileAssetLoader", {__construct:function() {
    this.__parent.__construct.call(this);
  }, loadContents:function(e) {
    let f = h.ptrToAsset(e);
    e = f.cdnUuid;
    if ("" === e) {
      return !1;
    }
    (function(m, k) {
      var n = new XMLHttpRequest();
      n.responseType = "arraybuffer";
      n.onreadystatechange = function() {
        4 == n.readyState && 200 == n.status && k(n);
      };
      n.open("GET", m, !0);
      n.send(null);
    })(f.cdnBaseUrl + "/" + e, m => {
      f.decode(new Uint8Array(m.response));
    });
    return !0;
  },});
  h.FallbackFileAssetLoader = c.extend("FallbackFileAssetLoader", {__construct:function() {
    this.__parent.__construct.call(this);
    this.wa = [];
  }, addLoader:function(e) {
    this.wa.push(e);
  }, loadContents:function(e, f) {
    for (let m of this.wa) {
      if (m.loadContents(e, f)) {
        return !0;
      }
    }
    return !1;
  },});
  let d = h.computeAlignment;
  h.computeAlignment = function(e, f, m, k, n = 1.0) {
    return d.call(this, e, f, m, k, n);
  };
};
const fa = "createConicGradient createImageData createLinearGradient createPattern createRadialGradient getContextAttributes getImageData getLineDash getTransform isContextLost isPointInPath isPointInStroke measureText".split(" "), ha = new function() {
  function b() {
    if (!a) {
      var g = document.createElement("canvas"), r = {alpha:1, depth:0, stencil:0, antialias:0, premultipliedAlpha:1, preserveDrawingBuffer:0, powerPreference:"high-performance", failIfMajorPerformanceCaveat:0, enableExtensionsByDefault:1, explicitSwapControl:1, renderViaOffscreenBackBuffer:1,};
      let q;
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        if (q = g.getContext("webgl", r), c = 1, !q) {
          return console.log("No WebGL support. Image mesh will not be drawn."), !1;
        }
      } else {
        if (q = g.getContext("webgl2", r)) {
          c = 2;
        } else {
          if (q = g.getContext("webgl", r)) {
            c = 1;
          } else {
            return console.log("No WebGL support. Image mesh will not be drawn."), !1;
          }
        }
      }
      q = new Proxy(q, {get(D, v) {
        if (D.isContextLost()) {
          if (n || (console.error("Cannot render the mesh because the GL Context was lost. Tried to invoke ", v), n = !0), "function" === typeof D[v]) {
            return function() {
            };
          }
        } else {
          return "function" === typeof D[v] ? function(...I) {
            return D[v].apply(D, I);
          } : D[v];
        }
      }, set(D, v, I) {
        if (D.isContextLost()) {
          n || (console.error("Cannot render the mesh because the GL Context was lost. Tried to set property " + v), n = !0);
        } else {
          return D[v] = I, !0;
        }
      },});
      d = Math.min(q.getParameter(q.MAX_RENDERBUFFER_SIZE), q.getParameter(q.MAX_TEXTURE_SIZE));
      function G(D, v, I) {
        v = q.createShader(v);
        q.shaderSource(v, I);
        q.compileShader(v);
        I = q.getShaderInfoLog(v);
        if (0 < (I || "").length) {
          throw I;
        }
        q.attachShader(D, v);
      }
      g = q.createProgram();
      G(g, q.VERTEX_SHADER, "attribute vec2 vertex;\n                attribute vec2 uv;\n                uniform vec4 mat;\n                uniform vec2 translate;\n                varying vec2 st;\n                void main() {\n                    st = uv;\n                    gl_Position = vec4(mat2(mat) * vertex + translate, 0, 1);\n                }");
      G(g, q.FRAGMENT_SHADER, "precision highp float;\n                uniform sampler2D image;\n                varying vec2 st;\n                void main() {\n                    gl_FragColor = texture2D(image, st);\n                }");
      q.bindAttribLocation(g, 0, "vertex");
      q.bindAttribLocation(g, 1, "uv");
      q.linkProgram(g);
      r = q.getProgramInfoLog(g);
      if (0 < (r || "").trim().length) {
        throw r;
      }
      e = q.getUniformLocation(g, "mat");
      f = q.getUniformLocation(g, "translate");
      q.useProgram(g);
      q.bindBuffer(q.ARRAY_BUFFER, q.createBuffer());
      q.enableVertexAttribArray(0);
      q.enableVertexAttribArray(1);
      q.bindBuffer(q.ELEMENT_ARRAY_BUFFER, q.createBuffer());
      q.uniform1i(q.getUniformLocation(g, "image"), 0);
      q.pixelStorei(q.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !0);
      a = q;
    }
    return !0;
  }
  let a = null, c = 0, d = 0, e = null, f = null, m = 0, k = 0, n = !1;
  b();
  this.eb = function() {
    b();
    return d;
  };
  this.Ma = function(g) {
    a.deleteTexture && a.deleteTexture(g);
  };
  this.La = function(g) {
    if (!b()) {
      return null;
    }
    const r = a.createTexture();
    if (!r) {
      return null;
    }
    a.bindTexture(a.TEXTURE_2D, r);
    a.texImage2D(a.TEXTURE_2D, 0, a.RGBA, a.RGBA, a.UNSIGNED_BYTE, g);
    a.texParameteri(a.TEXTURE_2D, a.TEXTURE_WRAP_S, a.CLAMP_TO_EDGE);
    a.texParameteri(a.TEXTURE_2D, a.TEXTURE_WRAP_T, a.CLAMP_TO_EDGE);
    a.texParameteri(a.TEXTURE_2D, a.TEXTURE_MAG_FILTER, a.LINEAR);
    2 == c ? (a.texParameteri(a.TEXTURE_2D, a.TEXTURE_MIN_FILTER, a.LINEAR_MIPMAP_LINEAR), a.generateMipmap(a.TEXTURE_2D)) : a.texParameteri(a.TEXTURE_2D, a.TEXTURE_MIN_FILTER, a.LINEAR);
    return r;
  };
  const l = new da(8), t = new da(8), w = new da(10), x = new da(10);
  this.Qa = function(g, r, q, G, D) {
    if (b()) {
      var v = l.push(g), I = t.push(r);
      if (a.canvas) {
        if (a.canvas.width != v || a.canvas.height != I) {
          a.canvas.width = v, a.canvas.height = I;
        }
        a.viewport(0, I - r, g, r);
        a.disable(a.SCISSOR_TEST);
        a.clearColor(0, 0, 0, 0);
        a.clear(a.COLOR_BUFFER_BIT);
        a.enable(a.SCISSOR_TEST);
        q.sort((C, X) => X.Ba - C.Ba);
        v = w.push(G);
        m != v && (a.bufferData(a.ARRAY_BUFFER, 8 * v, a.DYNAMIC_DRAW), m = v);
        v = 0;
        for (var O of q) {
          a.bufferSubData(a.ARRAY_BUFFER, v, O.ia), v += 4 * O.ia.length;
        }
        console.assert(v == 4 * G);
        for (var Y of q) {
          a.bufferSubData(a.ARRAY_BUFFER, v, Y.Ea), v += 4 * Y.Ea.length;
        }
        console.assert(v == 8 * G);
        v = x.push(D);
        k != v && (a.bufferData(a.ELEMENT_ARRAY_BUFFER, 2 * v, a.DYNAMIC_DRAW), k = v);
        O = 0;
        for (var ia of q) {
          a.bufferSubData(a.ELEMENT_ARRAY_BUFFER, O, ia.indices), O += 2 * ia.indices.length;
        }
        console.assert(O == 2 * D);
        ia = 0;
        Y = !0;
        v = O = 0;
        for (const C of q) {
          C.image.da != ia && (a.bindTexture(a.TEXTURE_2D, C.image.ca || null), ia = C.image.da);
          C.hb ? (a.scissor(C.na, I - C.oa - C.va, C.sb, C.va), Y = !0) : Y && (a.scissor(0, I - r, g, r), Y = !1);
          q = 2 / g;
          const X = -2 / r;
          a.uniform4f(e, C.N[0] * q * C.X, C.N[1] * X * C.Y, C.N[2] * q * C.X, C.N[3] * X * C.Y);
          a.uniform2f(f, C.N[4] * q * C.X + q * (C.na - C.fb * C.X) - 1, C.N[5] * X * C.Y + X * (C.oa - C.gb * C.Y) + 1);
          a.vertexAttribPointer(0, 2, a.FLOAT, !1, 0, v);
          a.vertexAttribPointer(1, 2, a.FLOAT, !1, 0, v + 4 * G);
          a.drawElements(a.TRIANGLES, C.indices.length, a.UNSIGNED_SHORT, O);
          v += 4 * C.ia.length;
          O += 2 * C.indices.length;
        }
        console.assert(v == 4 * G);
        console.assert(O == 2 * D);
      }
    }
  };
  this.canvas = function() {
    return b() && a.canvas;
  };
}(), la = h.onRuntimeInitialized;
h.onRuntimeInitialized = function() {
  function b(p) {
    switch(p) {
      case l.srcOver:
        return "source-over";
      case l.screen:
        return "screen";
      case l.overlay:
        return "overlay";
      case l.darken:
        return "darken";
      case l.lighten:
        return "lighten";
      case l.colorDodge:
        return "color-dodge";
      case l.colorBurn:
        return "color-burn";
      case l.hardLight:
        return "hard-light";
      case l.softLight:
        return "soft-light";
      case l.difference:
        return "difference";
      case l.exclusion:
        return "exclusion";
      case l.multiply:
        return "multiply";
      case l.hue:
        return "hue";
      case l.saturation:
        return "saturation";
      case l.color:
        return "color";
      case l.luminosity:
        return "luminosity";
    }
  }
  function a(p) {
    return "rgba(" + ((16711680 & p) >>> 16) + "," + ((65280 & p) >>> 8) + "," + ((255 & p) >>> 0) + "," + ((4278190080 & p) >>> 24) / 255 + ")";
  }
  function c() {
    0 < I.length && (ha.Qa(v.drawWidth(), v.drawHeight(), I, O, Y), I = [], Y = O = 0, v.reset(512, 512));
    for (const p of D) {
      for (const u of p.u) {
        u();
      }
      p.u = [];
    }
    D.clear();
  }
  la && la();
  var d = h.RenderPaintStyle;
  const e = h.RenderPath, f = h.RenderPaint, m = h.Renderer, k = h.StrokeCap, n = h.StrokeJoin, l = h.BlendMode, t = d.fill, w = d.stroke, x = h.FillRule.evenOdd;
  let g = 1;
  var r = h.RenderImage.extend("CanvasRenderImage", {__construct:function({R:p, W:u} = {}) {
    this.__parent.__construct.call(this);
    this.da = g;
    g = g + 1 & 2147483647 || 1;
    this.R = p;
    this.W = u;
  }, __destruct:function() {
    this.ca && (ha.Ma(this.ca), URL.revokeObjectURL(this.la));
    this.__parent.__destruct.call(this);
  }, decode:function(p) {
    var u = this;
    u.W && u.W(u);
    var A = new Image();
    u.la = URL.createObjectURL(new Blob([p], {type:"image/png",}));
    A.onload = function() {
      u.Ga = A;
      u.ca = ha.La(A);
      u.size(A.width, A.height);
      u.R && u.R(u);
    };
    A.src = u.la;
  },}), q = e.extend("CanvasRenderPath", {__construct:function() {
    this.__parent.__construct.call(this);
    this.F = new Path2D();
  }, rewind:function() {
    this.F = new Path2D();
  }, addPath:function(p, u, A, B, y, E, F) {
    var H = this.F, T = H.addPath;
    p = p.F;
    const K = new DOMMatrix();
    K.a = u;
    K.b = A;
    K.c = B;
    K.d = y;
    K.e = E;
    K.f = F;
    T.call(H, p, K);
  }, fillRule:function(p) {
    this.ka = p;
  }, moveTo:function(p, u) {
    this.F.moveTo(p, u);
  }, lineTo:function(p, u) {
    this.F.lineTo(p, u);
  }, cubicTo:function(p, u, A, B, y, E) {
    this.F.bezierCurveTo(p, u, A, B, y, E);
  }, close:function() {
    this.F.closePath();
  },}), G = f.extend("CanvasRenderPaint", {color:function(p) {
    this.ma = a(p);
  }, thickness:function(p) {
    this.Ja = p;
  }, join:function(p) {
    switch(p) {
      case n.miter:
        this.ba = "miter";
        break;
      case n.round:
        this.ba = "round";
        break;
      case n.bevel:
        this.ba = "bevel";
    }
  }, cap:function(p) {
    switch(p) {
      case k.butt:
        this.aa = "butt";
        break;
      case k.round:
        this.aa = "round";
        break;
      case k.square:
        this.aa = "square";
    }
  }, style:function(p) {
    this.Ia = p;
  }, blendMode:function(p) {
    this.Fa = b(p);
  }, clearGradient:function() {
    this.P = null;
  }, linearGradient:function(p, u, A, B) {
    this.P = {Ca:p, Da:u, qa:A, ra:B, ga:[],};
  }, radialGradient:function(p, u, A, B) {
    this.P = {Ca:p, Da:u, qa:A, ra:B, ga:[], bb:!0,};
  }, addStop:function(p, u) {
    this.P.ga.push({color:p, stop:u,});
  }, completeGradient:function() {
  }, draw:function(p, u, A) {
    let B = this.Ia;
    var y = this.ma, E = this.P;
    p.globalCompositeOperation = this.Fa;
    if (null != E) {
      y = E.Ca;
      var F = E.Da;
      const T = E.qa;
      var H = E.ra;
      const K = E.ga;
      E.bb ? (E = T - y, H -= F, y = p.createRadialGradient(y, F, 0, y, F, Math.sqrt(E * E + H * H))) : y = p.createLinearGradient(y, F, T, H);
      for (let Z = 0, N = K.length; Z < N; Z++) {
        F = K[Z], y.addColorStop(F.stop, a(F.color));
      }
      this.ma = y;
      this.P = null;
    }
    switch(B) {
      case w:
        p.strokeStyle = y;
        p.lineWidth = this.Ja;
        p.lineCap = this.aa;
        p.lineJoin = this.ba;
        p.stroke(u);
        break;
      case t:
        p.fillStyle = y, p.fill(u, A);
    }
  },});
  const D = new Set();
  let v = null, I = [], O = 0, Y = 0;
  var ia = h.CanvasRenderer = m.extend("Renderer", {__construct:function(p) {
    this.__parent.__construct.call(this);
    this.D = [1, 0, 0, 1, 0, 0];
    this.o = p.getContext("2d");
    this.ja = p;
    this.u = [];
  }, save:function() {
    this.D.push(...this.D.slice(this.D.length - 6));
    this.u.push(this.o.save.bind(this.o));
  }, restore:function() {
    const p = this.D.length - 6;
    if (6 > p) {
      throw "restore() called without matching save().";
    }
    this.D.splice(p);
    this.u.push(this.o.restore.bind(this.o));
  }, transform:function(p, u, A, B, y, E) {
    const F = this.D, H = F.length - 6;
    F.splice(H, 6, F[H] * p + F[H + 2] * u, F[H + 1] * p + F[H + 3] * u, F[H] * A + F[H + 2] * B, F[H + 1] * A + F[H + 3] * B, F[H] * y + F[H + 2] * E + F[H + 4], F[H + 1] * y + F[H + 3] * E + F[H + 5]);
    this.u.push(this.o.transform.bind(this.o, p, u, A, B, y, E));
  }, rotate:function(p) {
    const u = Math.sin(p);
    p = Math.cos(p);
    this.transform(p, u, -u, p, 0, 0);
  }, _drawPath:function(p, u) {
    this.u.push(u.draw.bind(u, this.o, p.F, p.ka === x ? "evenodd" : "nonzero"));
  }, _drawRiveImage:function(p, u, A) {
    var B = p.Ga;
    if (B) {
      var y = this.o, E = b(u);
      this.u.push(function() {
        y.globalCompositeOperation = E;
        y.globalAlpha = A;
        y.drawImage(B, 0, 0);
        y.globalAlpha = 1;
      });
    }
  }, _getMatrix:function(p) {
    const u = this.D, A = u.length - 6;
    for (let B = 0; 6 > B; ++B) {
      p[B] = u[A + B];
    }
  }, _drawImageMesh:function(p, u, A, B, y, E, F, H, T, K) {
    var Z = this.o.canvas.width, N = this.o.canvas.height;
    const tb = T - F, ub = K - H;
    F = Math.max(F, 0);
    H = Math.max(H, 0);
    T = Math.min(T, Z);
    K = Math.min(K, N);
    const wa = T - F, xa = K - H;
    console.assert(wa <= Math.min(tb, Z));
    console.assert(xa <= Math.min(ub, N));
    if (!(0 >= wa || 0 >= xa)) {
      T = wa < tb || xa < ub;
      Z = K = 1;
      var ja = Math.ceil(wa * K), ka = Math.ceil(xa * Z);
      N = ha.eb();
      ja > N && (K *= N / ja, ja = N);
      ka > N && (Z *= N / ka, ka = N);
      v || (v = new h.DynamicRectanizer(N), v.reset(512, 512));
      N = v.addRect(ja, ka);
      0 > N && (c(), D.add(this), N = v.addRect(ja, ka), console.assert(0 <= N));
      var vb = N & 65535, wb = N >> 16;
      I.push({N:this.D.slice(this.D.length - 6), image:p, na:vb, oa:wb, fb:F, gb:H, sb:ja, va:ka, X:K, Y:Z, ia:new Float32Array(B), Ea:new Float32Array(y), indices:new Uint16Array(E), hb:T, Ba:p.da << 1 | (T ? 1 : 0),});
      O += B.length;
      Y += E.length;
      var pa = this.o, oc = b(u);
      this.u.push(function() {
        pa.save();
        pa.resetTransform();
        pa.globalCompositeOperation = oc;
        pa.globalAlpha = A;
        const xb = ha.canvas();
        xb && pa.drawImage(xb, vb, wb, ja, ka, F, H, wa, xa);
        pa.restore();
      });
    }
  }, _clipPath:function(p) {
    this.u.push(this.o.clip.bind(this.o, p.F, p.ka === x ? "evenodd" : "nonzero"));
  }, clear:function() {
    D.add(this);
    this.u.push(this.o.clearRect.bind(this.o, 0, 0, this.ja.width, this.ja.height));
  }, flush:function() {
  }, translate:function(p, u) {
    this.transform(1, 0, 0, 1, p, u);
  },});
  h.makeRenderer = function(p) {
    const u = new ia(p), A = u.o;
    return new Proxy(u, {get(B, y) {
      if ("function" === typeof B[y]) {
        return function(...E) {
          return B[y].apply(B, E);
        };
      }
      if ("function" === typeof A[y]) {
        if (-1 < fa.indexOf(y)) {
          throw Error("RiveException: Method call to '" + y + "()' is not allowed, as the renderer cannot immediately pass through the return                 values of any canvas 2d context methods.");
        }
        return function(...E) {
          u.u.push(A[y].bind(A, ...E));
        };
      }
      return B[y];
    }, set(B, y, E) {
      if (y in A) {
        return u.u.push(() => {
          A[y] = E;
        }), !0;
      }
    },});
  };
  h.decodeImage = function(p, u) {
    (new r({R:u})).decode(p);
  };
  h.renderFactory = {makeRenderPaint:function() {
    return new G();
  }, makeRenderPath:function() {
    return new q();
  }, makeRenderImage:function() {
    let p = X;
    return new r({W:() => {
      p.total++;
    }, R:() => {
      p.loaded++;
      if (p.loaded === p.total) {
        const u = p.ready;
        u && (u(), p.ready = null);
      }
    },});
  },};
  let C = h.load, X = null;
  h.load = function(p, u, A = !0) {
    const B = new h.FallbackFileAssetLoader();
    void 0 !== u && B.addLoader(u);
    A && (u = new h.CDNFileAssetLoader(), B.addLoader(u));
    return new Promise(function(y) {
      let E = null;
      X = {total:0, loaded:0, ready:function() {
        y(E);
      },};
      E = C(p, B);
      0 == X.total && y(E);
    });
  };
  let pc = h.RendererWrapper.prototype.align;
  h.RendererWrapper.prototype.align = function(p, u, A, B, y = 1.0) {
    pc.call(this, p, u, A, B, y);
  };
  d = new ca();
  h.requestAnimationFrame = d.requestAnimationFrame.bind(d);
  h.cancelAnimationFrame = d.cancelAnimationFrame.bind(d);
  h.enableFPSCounter = d.Ra.bind(d);
  h.disableFPSCounter = d.Oa;
  d.xa = c;
  h.resolveAnimationFrame = c;
  h.cleanup = function() {
    v && v.delete();
  };
};
var ma = Object.assign({}, h), na = "./this.program", oa = "object" == typeof window, qa = "function" == typeof importScripts, ra = "", sa, ta;
if (oa || qa) {
  qa ? ra = self.location.href : "undefined" != typeof document && document.currentScript && (ra = document.currentScript.src), _scriptDir && (ra = _scriptDir), 0 !== ra.indexOf("blob:") ? ra = ra.substr(0, ra.replace(/[?#].*/, "").lastIndexOf("/") + 1) : ra = "", qa && (ta = b => {
    var a = new XMLHttpRequest();
    a.open("GET", b, !1);
    a.responseType = "arraybuffer";
    a.send(null);
    return new Uint8Array(a.response);
  }), sa = (b, a, c) => {
    var d = new XMLHttpRequest();
    d.open("GET", b, !0);
    d.responseType = "arraybuffer";
    d.onload = () => {
      200 == d.status || 0 == d.status && d.response ? a(d.response) : c();
    };
    d.onerror = c;
    d.send(null);
  };
}
var ua = h.print || console.log.bind(console), va = h.printErr || console.error.bind(console);
Object.assign(h, ma);
ma = null;
h.thisProgram && (na = h.thisProgram);
var ya;
h.wasmBinary && (ya = h.wasmBinary);
var noExitRuntime = h.noExitRuntime || !0;
"object" != typeof WebAssembly && za("no native wasm support detected");
var Aa, z, Ba = !1, Ca, J, Da, Ea, L, M, Fa, Ga;
function Ha() {
  var b = Aa.buffer;
  h.HEAP8 = Ca = new Int8Array(b);
  h.HEAP16 = Da = new Int16Array(b);
  h.HEAP32 = L = new Int32Array(b);
  h.HEAPU8 = J = new Uint8Array(b);
  h.HEAPU16 = Ea = new Uint16Array(b);
  h.HEAPU32 = M = new Uint32Array(b);
  h.HEAPF32 = Fa = new Float32Array(b);
  h.HEAPF64 = Ga = new Float64Array(b);
}
var Ia, Ja = [], Ka = [], La = [];
function Ma() {
  var b = h.preRun.shift();
  Ja.unshift(b);
}
var Na = 0, Oa = null, Pa = null;
function za(b) {
  if (h.onAbort) {
    h.onAbort(b);
  }
  b = "Aborted(" + b + ")";
  va(b);
  Ba = !0;
  b = new WebAssembly.RuntimeError(b + ". Build with -sASSERTIONS for more info.");
  ba(b);
  throw b;
}
function Qa(b) {
  return b.startsWith("data:application/octet-stream;base64,");
}
var Ra;
Ra = "canvas_advanced.wasm";
if (!Qa(Ra)) {
  var Sa = Ra;
  Ra = h.locateFile ? h.locateFile(Sa, ra) : ra + Sa;
}
function Ta(b) {
  if (b == Ra && ya) {
    return new Uint8Array(ya);
  }
  if (ta) {
    return ta(b);
  }
  throw "both async and sync fetching of the wasm failed";
}
function Ua(b) {
  if (!ya && (oa || qa)) {
    if ("function" == typeof fetch && !b.startsWith("file://")) {
      return fetch(b, {credentials:"same-origin"}).then(a => {
        if (!a.ok) {
          throw "failed to load wasm binary file at '" + b + "'";
        }
        return a.arrayBuffer();
      }).catch(() => Ta(b));
    }
    if (sa) {
      return new Promise((a, c) => {
        sa(b, d => a(new Uint8Array(d)), c);
      });
    }
  }
  return Promise.resolve().then(() => Ta(b));
}
function Va(b, a, c) {
  return Ua(b).then(d => WebAssembly.instantiate(d, a)).then(d => d).then(c, d => {
    va("failed to asynchronously prepare wasm: " + d);
    za(d);
  });
}
function Wa(b, a) {
  var c = Ra;
  return ya || "function" != typeof WebAssembly.instantiateStreaming || Qa(c) || c.startsWith("file://") || "function" != typeof fetch ? Va(c, b, a) : fetch(c, {credentials:"same-origin"}).then(d => WebAssembly.instantiateStreaming(d, b).then(a, function(e) {
    va("wasm streaming compile failed: " + e);
    va("falling back to ArrayBuffer instantiation");
    return Va(c, b, a);
  }));
}
var Xa = b => {
  for (; 0 < b.length;) {
    b.shift()(h);
  }
};
function Ya(b) {
  if (void 0 === b) {
    return "_unknown";
  }
  b = b.replace(/[^a-zA-Z0-9_]/g, "$");
  var a = b.charCodeAt(0);
  return 48 <= a && 57 >= a ? `_${b}` : b;
}
function Za(b, a) {
  b = Ya(b);
  return {[b]:function() {
    return a.apply(this, arguments);
  }}[b];
}
function $a() {
  this.G = [void 0];
  this.ta = [];
}
var P = new $a(), ab = void 0;
function Q(b) {
  throw new ab(b);
}
var R = b => {
  b || Q("Cannot use deleted val. handle = " + b);
  return P.get(b).value;
}, S = b => {
  switch(b) {
    case void 0:
      return 1;
    case null:
      return 2;
    case !0:
      return 3;
    case !1:
      return 4;
    default:
      return P.Za({Aa:1, value:b});
  }
};
function bb(b) {
  var a = Error, c = Za(b, function(d) {
    this.name = b;
    this.message = d;
    d = Error(d).stack;
    void 0 !== d && (this.stack = this.toString() + "\n" + d.replace(/^Error(:[^\n]*)?\n/, ""));
  });
  c.prototype = Object.create(a.prototype);
  c.prototype.constructor = c;
  c.prototype.toString = function() {
    return void 0 === this.message ? this.name : `${this.name}: ${this.message}`;
  };
  return c;
}
var cb = void 0, db = void 0;
function U(b) {
  for (var a = ""; J[b];) {
    a += db[J[b++]];
  }
  return a;
}
var eb = [];
function fb() {
  for (; eb.length;) {
    var b = eb.pop();
    b.g.M = !1;
    b["delete"]();
  }
}
var gb = void 0, hb = {};
function ib(b, a) {
  for (void 0 === a && Q("ptr should not be undefined"); b.l;) {
    a = b.S(a), b = b.l;
  }
  return a;
}
var jb = {};
function kb(b) {
  b = lb(b);
  var a = U(b);
  mb(b);
  return a;
}
function nb(b, a) {
  var c = jb[b];
  void 0 === c && Q(a + " has unknown type " + kb(b));
  return c;
}
function ob() {
}
var pb = !1;
function qb(b) {
  --b.count.value;
  0 === b.count.value && (b.s ? b.A.H(b.s) : b.j.h.H(b.i));
}
function rb(b, a, c) {
  if (a === c) {
    return b;
  }
  if (void 0 === c.l) {
    return null;
  }
  b = rb(b, a, c.l);
  return null === b ? null : c.Pa(b);
}
var sb = {};
function yb(b, a) {
  a = ib(b, a);
  return hb[a];
}
var zb = void 0;
function Ab(b) {
  throw new zb(b);
}
function Bb(b, a) {
  a.j && a.i || Ab("makeClassHandle requires ptr and ptrType");
  !!a.A !== !!a.s && Ab("Both smartPtrType and smartPtr must be specified");
  a.count = {value:1};
  return Cb(Object.create(b, {g:{value:a,},}));
}
function Cb(b) {
  if ("undefined" === typeof FinalizationRegistry) {
    return Cb = a => a, b;
  }
  pb = new FinalizationRegistry(a => {
    qb(a.g);
  });
  Cb = a => {
    var c = a.g;
    c.s && pb.register(a, {g:c}, a);
    return a;
  };
  ob = a => {
    pb.unregister(a);
  };
  return Cb(b);
}
var Db = {};
function Eb(b) {
  for (; b.length;) {
    var a = b.pop();
    b.pop()(a);
  }
}
function Fb(b) {
  return this.fromWireType(L[b >> 2]);
}
var Gb = {}, Hb = {};
function V(b, a, c) {
  function d(k) {
    k = c(k);
    k.length !== b.length && Ab("Mismatched type converter count");
    for (var n = 0; n < b.length; ++n) {
      Ib(b[n], k[n]);
    }
  }
  b.forEach(function(k) {
    Hb[k] = a;
  });
  var e = Array(a.length), f = [], m = 0;
  a.forEach((k, n) => {
    jb.hasOwnProperty(k) ? e[n] = jb[k] : (f.push(k), Gb.hasOwnProperty(k) || (Gb[k] = []), Gb[k].push(() => {
      e[n] = jb[k];
      ++m;
      m === f.length && d(e);
    }));
  });
  0 === f.length && d(e);
}
function Jb(b) {
  switch(b) {
    case 1:
      return 0;
    case 2:
      return 1;
    case 4:
      return 2;
    case 8:
      return 3;
    default:
      throw new TypeError(`Unknown type size: ${b}`);
  }
}
function Kb(b, a, c = {}) {
  var d = a.name;
  b || Q(`type "${d}" must have a positive integer typeid pointer`);
  if (jb.hasOwnProperty(b)) {
    if (c.ab) {
      return;
    }
    Q(`Cannot register type '${d}' twice`);
  }
  jb[b] = a;
  delete Hb[b];
  Gb.hasOwnProperty(b) && (a = Gb[b], delete Gb[b], a.forEach(e => e()));
}
function Ib(b, a, c = {}) {
  if (!("argPackAdvance" in a)) {
    throw new TypeError("registerType registeredInstance requires argPackAdvance");
  }
  Kb(b, a, c);
}
function Lb(b) {
  Q(b.g.j.h.name + " instance already deleted");
}
function Mb() {
}
function Nb(b, a, c) {
  if (void 0 === b[a].m) {
    var d = b[a];
    b[a] = function() {
      b[a].m.hasOwnProperty(arguments.length) || Q(`Function '${c}' called with an invalid number of arguments (${arguments.length}) - expects one of (${b[a].m})!`);
      return b[a].m[arguments.length].apply(this, arguments);
    };
    b[a].m = [];
    b[a].m[d.L] = d;
  }
}
function Ob(b, a, c) {
  h.hasOwnProperty(b) ? ((void 0 === c || void 0 !== h[b].m && void 0 !== h[b].m[c]) && Q(`Cannot register public name '${b}' twice`), Nb(h, b, b), h.hasOwnProperty(c) && Q(`Cannot register multiple overloads of a function with the same number of arguments (${c})!`), h[b].m[c] = a) : (h[b] = a, void 0 !== c && (h[b].tb = c));
}
function Pb(b, a, c, d, e, f, m, k) {
  this.name = b;
  this.constructor = a;
  this.B = c;
  this.H = d;
  this.l = e;
  this.Ua = f;
  this.S = m;
  this.Pa = k;
  this.ya = [];
}
function Qb(b, a, c) {
  for (; a !== c;) {
    a.S || Q(`Expected null or instance of ${c.name}, got an instance of ${a.name}`), b = a.S(b), a = a.l;
  }
  return b;
}
function Rb(b, a) {
  if (null === a) {
    return this.ea && Q(`null is not a valid ${this.name}`), 0;
  }
  a.g || Q(`Cannot pass "${Sb(a)}" as a ${this.name}`);
  a.g.i || Q(`Cannot pass deleted object as a pointer of type ${this.name}`);
  return Qb(a.g.i, a.g.j.h, this.h);
}
function Tb(b, a) {
  if (null === a) {
    this.ea && Q(`null is not a valid ${this.name}`);
    if (this.V) {
      var c = this.fa();
      null !== b && b.push(this.H, c);
      return c;
    }
    return 0;
  }
  a.g || Q(`Cannot pass "${Sb(a)}" as a ${this.name}`);
  a.g.i || Q(`Cannot pass deleted object as a pointer of type ${this.name}`);
  !this.U && a.g.j.U && Q(`Cannot convert argument of type ${a.g.A ? a.g.A.name : a.g.j.name} to parameter type ${this.name}`);
  c = Qb(a.g.i, a.g.j.h, this.h);
  if (this.V) {
    switch(void 0 === a.g.s && Q("Passing raw pointer to smart pointer is illegal"), this.nb) {
      case 0:
        a.g.A === this ? c = a.g.s : Q(`Cannot convert argument of type ${a.g.A ? a.g.A.name : a.g.j.name} to parameter type ${this.name}`);
        break;
      case 1:
        c = a.g.s;
        break;
      case 2:
        if (a.g.A === this) {
          c = a.g.s;
        } else {
          var d = a.clone();
          c = this.jb(c, S(function() {
            d["delete"]();
          }));
          null !== b && b.push(this.H, c);
        }
        break;
      default:
        Q("Unsupporting sharing policy");
    }
  }
  return c;
}
function Ub(b, a) {
  if (null === a) {
    return this.ea && Q(`null is not a valid ${this.name}`), 0;
  }
  a.g || Q(`Cannot pass "${Sb(a)}" as a ${this.name}`);
  a.g.i || Q(`Cannot pass deleted object as a pointer of type ${this.name}`);
  a.g.j.U && Q(`Cannot convert argument of type ${a.g.j.name} to parameter type ${this.name}`);
  return Qb(a.g.i, a.g.j.h, this.h);
}
function Vb(b, a, c, d) {
  this.name = b;
  this.h = a;
  this.ea = c;
  this.U = d;
  this.V = !1;
  this.H = this.jb = this.fa = this.za = this.nb = this.ib = void 0;
  void 0 !== a.l ? this.toWireType = Tb : (this.toWireType = d ? Rb : Ub, this.v = null);
}
function Wb(b, a, c) {
  h.hasOwnProperty(b) || Ab("Replacing nonexistant public symbol");
  void 0 !== h[b].m && void 0 !== c ? h[b].m[c] = a : (h[b] = a, h[b].L = c);
}
var Xb = [], Yb = b => {
  var a = Xb[b];
  a || (b >= Xb.length && (Xb.length = b + 1), Xb[b] = a = Ia.get(b));
  return a;
}, Zb = (b, a) => {
  var c = [];
  return function() {
    c.length = 0;
    Object.assign(c, arguments);
    if (b.includes("j")) {
      var d = h["dynCall_" + b];
      d = c && c.length ? d.apply(null, [a].concat(c)) : d.call(null, a);
    } else {
      d = Yb(a).apply(null, c);
    }
    return d;
  };
};
function W(b, a) {
  b = U(b);
  var c = b.includes("j") ? Zb(b, a) : Yb(a);
  "function" != typeof c && Q(`unknown function pointer with signature ${b}: ${a}`);
  return c;
}
var $b = void 0;
function ac(b, a) {
  function c(f) {
    e[f] || jb[f] || (Hb[f] ? Hb[f].forEach(c) : (d.push(f), e[f] = !0));
  }
  var d = [], e = {};
  a.forEach(c);
  throw new $b(`${b}: ` + d.map(kb).join([", "]));
}
function bc(b, a, c, d, e) {
  var f = a.length;
  2 > f && Q("argTypes array size mismatch! Must at least get return value and 'this' types!");
  var m = null !== a[1] && null !== c, k = !1;
  for (c = 1; c < a.length; ++c) {
    if (null !== a[c] && void 0 === a[c].v) {
      k = !0;
      break;
    }
  }
  var n = "void" !== a[0].name, l = f - 2, t = Array(l), w = [], x = [];
  return function() {
    arguments.length !== l && Q(`function ${b} called with ${arguments.length} arguments, expected ${l} args!`);
    x.length = 0;
    w.length = m ? 2 : 1;
    w[0] = e;
    if (m) {
      var g = a[1].toWireType(x, this);
      w[1] = g;
    }
    for (var r = 0; r < l; ++r) {
      t[r] = a[r + 2].toWireType(x, arguments[r]), w.push(t[r]);
    }
    r = d.apply(null, w);
    if (k) {
      Eb(x);
    } else {
      for (var q = m ? 1 : 2; q < a.length; q++) {
        var G = 1 === q ? g : t[q - 2];
        null !== a[q].v && a[q].v(G);
      }
    }
    g = n ? a[0].fromWireType(r) : void 0;
    return g;
  };
}
function cc(b, a) {
  for (var c = [], d = 0; d < b; d++) {
    c.push(M[a + 4 * d >> 2]);
  }
  return c;
}
function dc(b, a, c) {
  b instanceof Object || Q(`${c} with invalid "this": ${b}`);
  b instanceof a.h.constructor || Q(`${c} incompatible with "this" of type ${b.constructor.name}`);
  b.g.i || Q(`cannot call emscripten binding method ${c} on deleted object`);
  return Qb(b.g.i, b.g.j.h, a.h);
}
function ec(b) {
  b >= P.ua && 0 === --P.get(b).Aa && P.$a(b);
}
function fc(b, a, c) {
  switch(a) {
    case 0:
      return function(d) {
        return this.fromWireType((c ? Ca : J)[d]);
      };
    case 1:
      return function(d) {
        return this.fromWireType((c ? Da : Ea)[d >> 1]);
      };
    case 2:
      return function(d) {
        return this.fromWireType((c ? L : M)[d >> 2]);
      };
    default:
      throw new TypeError("Unknown integer type: " + b);
  }
}
function Sb(b) {
  if (null === b) {
    return "null";
  }
  var a = typeof b;
  return "object" === a || "array" === a || "function" === a ? b.toString() : "" + b;
}
function gc(b, a) {
  switch(a) {
    case 2:
      return function(c) {
        return this.fromWireType(Fa[c >> 2]);
      };
    case 3:
      return function(c) {
        return this.fromWireType(Ga[c >> 3]);
      };
    default:
      throw new TypeError("Unknown float type: " + b);
  }
}
function hc(b, a, c) {
  switch(a) {
    case 0:
      return c ? function(d) {
        return Ca[d];
      } : function(d) {
        return J[d];
      };
    case 1:
      return c ? function(d) {
        return Da[d >> 1];
      } : function(d) {
        return Ea[d >> 1];
      };
    case 2:
      return c ? function(d) {
        return L[d >> 2];
      } : function(d) {
        return M[d >> 2];
      };
    default:
      throw new TypeError("Unknown integer type: " + b);
  }
}
var ic = (b, a, c, d) => {
  if (0 < d) {
    d = c + d - 1;
    for (var e = 0; e < b.length; ++e) {
      var f = b.charCodeAt(e);
      if (55296 <= f && 57343 >= f) {
        var m = b.charCodeAt(++e);
        f = 65536 + ((f & 1023) << 10) | m & 1023;
      }
      if (127 >= f) {
        if (c >= d) {
          break;
        }
        a[c++] = f;
      } else {
        if (2047 >= f) {
          if (c + 1 >= d) {
            break;
          }
          a[c++] = 192 | f >> 6;
        } else {
          if (65535 >= f) {
            if (c + 2 >= d) {
              break;
            }
            a[c++] = 224 | f >> 12;
          } else {
            if (c + 3 >= d) {
              break;
            }
            a[c++] = 240 | f >> 18;
            a[c++] = 128 | f >> 12 & 63;
          }
          a[c++] = 128 | f >> 6 & 63;
        }
        a[c++] = 128 | f & 63;
      }
    }
    a[c] = 0;
  }
}, jc = b => {
  for (var a = 0, c = 0; c < b.length; ++c) {
    var d = b.charCodeAt(c);
    127 >= d ? a++ : 2047 >= d ? a += 2 : 55296 <= d && 57343 >= d ? (a += 4, ++c) : a += 3;
  }
  return a;
}, kc = "undefined" != typeof TextDecoder ? new TextDecoder("utf8") : void 0, lc = (b, a, c) => {
  var d = a + c;
  for (c = a; b[c] && !(c >= d);) {
    ++c;
  }
  if (16 < c - a && b.buffer && kc) {
    return kc.decode(b.subarray(a, c));
  }
  for (d = ""; a < c;) {
    var e = b[a++];
    if (e & 128) {
      var f = b[a++] & 63;
      if (192 == (e & 224)) {
        d += String.fromCharCode((e & 31) << 6 | f);
      } else {
        var m = b[a++] & 63;
        e = 224 == (e & 240) ? (e & 15) << 12 | f << 6 | m : (e & 7) << 18 | f << 12 | m << 6 | b[a++] & 63;
        65536 > e ? d += String.fromCharCode(e) : (e -= 65536, d += String.fromCharCode(55296 | e >> 10, 56320 | e & 1023));
      }
    } else {
      d += String.fromCharCode(e);
    }
  }
  return d;
}, mc = "undefined" != typeof TextDecoder ? new TextDecoder("utf-16le") : void 0, nc = (b, a) => {
  var c = b >> 1;
  for (var d = c + a / 2; !(c >= d) && Ea[c];) {
    ++c;
  }
  c <<= 1;
  if (32 < c - b && mc) {
    return mc.decode(J.subarray(b, c));
  }
  c = "";
  for (d = 0; !(d >= a / 2); ++d) {
    var e = Da[b + 2 * d >> 1];
    if (0 == e) {
      break;
    }
    c += String.fromCharCode(e);
  }
  return c;
}, qc = (b, a, c) => {
  void 0 === c && (c = 2147483647);
  if (2 > c) {
    return 0;
  }
  c -= 2;
  var d = a;
  c = c < 2 * b.length ? c / 2 : b.length;
  for (var e = 0; e < c; ++e) {
    Da[a >> 1] = b.charCodeAt(e), a += 2;
  }
  Da[a >> 1] = 0;
  return a - d;
}, rc = b => 2 * b.length, sc = (b, a) => {
  for (var c = 0, d = ""; !(c >= a / 4);) {
    var e = L[b + 4 * c >> 2];
    if (0 == e) {
      break;
    }
    ++c;
    65536 <= e ? (e -= 65536, d += String.fromCharCode(55296 | e >> 10, 56320 | e & 1023)) : d += String.fromCharCode(e);
  }
  return d;
}, tc = (b, a, c) => {
  void 0 === c && (c = 2147483647);
  if (4 > c) {
    return 0;
  }
  var d = a;
  c = d + c - 4;
  for (var e = 0; e < b.length; ++e) {
    var f = b.charCodeAt(e);
    if (55296 <= f && 57343 >= f) {
      var m = b.charCodeAt(++e);
      f = 65536 + ((f & 1023) << 10) | m & 1023;
    }
    L[a >> 2] = f;
    a += 4;
    if (a + 4 > c) {
      break;
    }
  }
  L[a >> 2] = 0;
  return a - d;
}, uc = b => {
  for (var a = 0, c = 0; c < b.length; ++c) {
    var d = b.charCodeAt(c);
    55296 <= d && 57343 >= d && ++c;
    a += 4;
  }
  return a;
}, vc = {};
function wc(b) {
  var a = vc[b];
  return void 0 === a ? U(b) : a;
}
var xc = [];
function yc(b) {
  var a = xc.length;
  xc.push(b);
  return a;
}
function zc(b, a) {
  for (var c = Array(b), d = 0; d < b; ++d) {
    c[d] = nb(M[a + 4 * d >> 2], "parameter " + d);
  }
  return c;
}
var Ac = [], Bc = {}, Dc = () => {
  if (!Cc) {
    var b = {USER:"web_user", LOGNAME:"web_user", PATH:"/", PWD:"/", HOME:"/home/web_user", LANG:("object" == typeof navigator && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", _:na || "./this.program"}, a;
    for (a in Bc) {
      void 0 === Bc[a] ? delete b[a] : b[a] = Bc[a];
    }
    var c = [];
    for (a in b) {
      c.push(`${a}=${b[a]}`);
    }
    Cc = c;
  }
  return Cc;
}, Cc, Ec = [null, [], []], Fc = b => 0 === b % 4 && (0 !== b % 100 || 0 === b % 400), Gc = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], Hc = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function Ic(b) {
  var a = Array(jc(b) + 1);
  ic(b, a, 0, a.length);
  return a;
}
var Jc = (b, a, c, d) => {
  function e(g, r, q) {
    for (g = "number" == typeof g ? g.toString() : g || ""; g.length < r;) {
      g = q[0] + g;
    }
    return g;
  }
  function f(g, r) {
    return e(g, r, "0");
  }
  function m(g, r) {
    function q(D) {
      return 0 > D ? -1 : 0 < D ? 1 : 0;
    }
    var G;
    0 === (G = q(g.getFullYear() - r.getFullYear())) && 0 === (G = q(g.getMonth() - r.getMonth())) && (G = q(g.getDate() - r.getDate()));
    return G;
  }
  function k(g) {
    switch(g.getDay()) {
      case 0:
        return new Date(g.getFullYear() - 1, 11, 29);
      case 1:
        return g;
      case 2:
        return new Date(g.getFullYear(), 0, 3);
      case 3:
        return new Date(g.getFullYear(), 0, 2);
      case 4:
        return new Date(g.getFullYear(), 0, 1);
      case 5:
        return new Date(g.getFullYear() - 1, 11, 31);
      case 6:
        return new Date(g.getFullYear() - 1, 11, 30);
    }
  }
  function n(g) {
    var r = g.J;
    for (g = new Date((new Date(g.K + 1900, 0, 1)).getTime()); 0 < r;) {
      var q = g.getMonth(), G = (Fc(g.getFullYear()) ? Gc : Hc)[q];
      if (r > G - g.getDate()) {
        r -= G - g.getDate() + 1, g.setDate(1), 11 > q ? g.setMonth(q + 1) : (g.setMonth(0), g.setFullYear(g.getFullYear() + 1));
      } else {
        g.setDate(g.getDate() + r);
        break;
      }
    }
    q = new Date(g.getFullYear() + 1, 0, 4);
    r = k(new Date(g.getFullYear(), 0, 4));
    q = k(q);
    return 0 >= m(r, g) ? 0 >= m(q, g) ? g.getFullYear() + 1 : g.getFullYear() : g.getFullYear() - 1;
  }
  var l = L[d + 40 >> 2];
  d = {qb:L[d >> 2], pb:L[d + 4 >> 2], Z:L[d + 8 >> 2], ha:L[d + 12 >> 2], $:L[d + 16 >> 2], K:L[d + 20 >> 2], C:L[d + 24 >> 2], J:L[d + 28 >> 2], ub:L[d + 32 >> 2], ob:L[d + 36 >> 2], rb:l ? l ? lc(J, l) : "" : ""};
  c = c ? lc(J, c) : "";
  l = {"%c":"%a %b %d %H:%M:%S %Y", "%D":"%m/%d/%y", "%F":"%Y-%m-%d", "%h":"%b", "%r":"%I:%M:%S %p", "%R":"%H:%M", "%T":"%H:%M:%S", "%x":"%m/%d/%y", "%X":"%H:%M:%S", "%Ec":"%c", "%EC":"%C", "%Ex":"%m/%d/%y", "%EX":"%H:%M:%S", "%Ey":"%y", "%EY":"%Y", "%Od":"%d", "%Oe":"%e", "%OH":"%H", "%OI":"%I", "%Om":"%m", "%OM":"%M", "%OS":"%S", "%Ou":"%u", "%OU":"%U", "%OV":"%V", "%Ow":"%w", "%OW":"%W", "%Oy":"%y",};
  for (var t in l) {
    c = c.replace(new RegExp(t, "g"), l[t]);
  }
  var w = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "), x = "January February March April May June July August September October November December".split(" ");
  l = {"%a":g => w[g.C].substring(0, 3), "%A":g => w[g.C], "%b":g => x[g.$].substring(0, 3), "%B":g => x[g.$], "%C":g => f((g.K + 1900) / 100 | 0, 2), "%d":g => f(g.ha, 2), "%e":g => e(g.ha, 2, " "), "%g":g => n(g).toString().substring(2), "%G":g => n(g), "%H":g => f(g.Z, 2), "%I":g => {
    g = g.Z;
    0 == g ? g = 12 : 12 < g && (g -= 12);
    return f(g, 2);
  }, "%j":g => {
    for (var r = 0, q = 0; q <= g.$ - 1; r += (Fc(g.K + 1900) ? Gc : Hc)[q++]) {
    }
    return f(g.ha + r, 3);
  }, "%m":g => f(g.$ + 1, 2), "%M":g => f(g.pb, 2), "%n":() => "\n", "%p":g => 0 <= g.Z && 12 > g.Z ? "AM" : "PM", "%S":g => f(g.qb, 2), "%t":() => "\t", "%u":g => g.C || 7, "%U":g => f(Math.floor((g.J + 7 - g.C) / 7), 2), "%V":g => {
    var r = Math.floor((g.J + 7 - (g.C + 6) % 7) / 7);
    2 >= (g.C + 371 - g.J - 2) % 7 && r++;
    if (r) {
      53 == r && (q = (g.C + 371 - g.J) % 7, 4 == q || 3 == q && Fc(g.K) || (r = 1));
    } else {
      r = 52;
      var q = (g.C + 7 - g.J - 1) % 7;
      (4 == q || 5 == q && Fc(g.K % 400 - 1)) && r++;
    }
    return f(r, 2);
  }, "%w":g => g.C, "%W":g => f(Math.floor((g.J + 7 - (g.C + 6) % 7) / 7), 2), "%y":g => (g.K + 1900).toString().substring(2), "%Y":g => g.K + 1900, "%z":g => {
    g = g.ob;
    var r = 0 <= g;
    g = Math.abs(g) / 60;
    return (r ? "+" : "-") + String("0000" + (g / 60 * 100 + g % 60)).slice(-4);
  }, "%Z":g => g.rb, "%%":() => "%"};
  c = c.replace(/%%/g, "\x00\x00");
  for (t in l) {
    c.includes(t) && (c = c.replace(new RegExp(t, "g"), l[t](d)));
  }
  c = c.replace(/\0\0/g, "%");
  t = Ic(c);
  if (t.length > a) {
    return 0;
  }
  Ca.set(t, b);
  return t.length - 1;
};
Object.assign($a.prototype, {get(b) {
  return this.G[b];
}, has(b) {
  return void 0 !== this.G[b];
}, Za(b) {
  var a = this.ta.pop() || this.G.length;
  this.G[a] = b;
  return a;
}, $a(b) {
  this.G[b] = void 0;
  this.ta.push(b);
}});
ab = h.BindingError = class extends Error {
  constructor(b) {
    super(b);
    this.name = "BindingError";
  }
};
P.G.push({value:void 0}, {value:null}, {value:!0}, {value:!1},);
P.ua = P.G.length;
h.count_emval_handles = function() {
  for (var b = 0, a = P.ua; a < P.G.length; ++a) {
    void 0 !== P.G[a] && ++b;
  }
  return b;
};
cb = h.PureVirtualError = bb("PureVirtualError");
for (var Kc = Array(256), Lc = 0; 256 > Lc; ++Lc) {
  Kc[Lc] = String.fromCharCode(Lc);
}
db = Kc;
h.getInheritedInstanceCount = function() {
  return Object.keys(hb).length;
};
h.getLiveInheritedInstances = function() {
  var b = [], a;
  for (a in hb) {
    hb.hasOwnProperty(a) && b.push(hb[a]);
  }
  return b;
};
h.flushPendingDeletes = fb;
h.setDelayFunction = function(b) {
  gb = b;
  eb.length && gb && gb(fb);
};
zb = h.InternalError = class extends Error {
  constructor(b) {
    super(b);
    this.name = "InternalError";
  }
};
Mb.prototype.isAliasOf = function(b) {
  if (!(this instanceof Mb && b instanceof Mb)) {
    return !1;
  }
  var a = this.g.j.h, c = this.g.i, d = b.g.j.h;
  for (b = b.g.i; a.l;) {
    c = a.S(c), a = a.l;
  }
  for (; d.l;) {
    b = d.S(b), d = d.l;
  }
  return a === d && c === b;
};
Mb.prototype.clone = function() {
  this.g.i || Lb(this);
  if (this.g.O) {
    return this.g.count.value += 1, this;
  }
  var b = Cb, a = Object, c = a.create, d = Object.getPrototypeOf(this), e = this.g;
  b = b(c.call(a, d, {g:{value:{count:e.count, M:e.M, O:e.O, i:e.i, j:e.j, s:e.s, A:e.A,},}}));
  b.g.count.value += 1;
  b.g.M = !1;
  return b;
};
Mb.prototype["delete"] = function() {
  this.g.i || Lb(this);
  this.g.M && !this.g.O && Q("Object already scheduled for deletion");
  ob(this);
  qb(this.g);
  this.g.O || (this.g.s = void 0, this.g.i = void 0);
};
Mb.prototype.isDeleted = function() {
  return !this.g.i;
};
Mb.prototype.deleteLater = function() {
  this.g.i || Lb(this);
  this.g.M && !this.g.O && Q("Object already scheduled for deletion");
  eb.push(this);
  1 === eb.length && gb && gb(fb);
  this.g.M = !0;
  return this;
};
Vb.prototype.Va = function(b) {
  this.za && (b = this.za(b));
  return b;
};
Vb.prototype.pa = function(b) {
  this.H && this.H(b);
};
Vb.prototype.argPackAdvance = 8;
Vb.prototype.readValueFromPointer = Fb;
Vb.prototype.deleteObject = function(b) {
  if (null !== b) {
    b["delete"]();
  }
};
Vb.prototype.fromWireType = function(b) {
  function a() {
    return this.V ? Bb(this.h.B, {j:this.ib, i:c, A:this, s:b,}) : Bb(this.h.B, {j:this, i:b,});
  }
  var c = this.Va(b);
  if (!c) {
    return this.pa(b), null;
  }
  var d = yb(this.h, c);
  if (void 0 !== d) {
    if (0 === d.g.count.value) {
      return d.g.i = c, d.g.s = b, d.clone();
    }
    d = d.clone();
    this.pa(b);
    return d;
  }
  d = this.h.Ua(c);
  d = sb[d];
  if (!d) {
    return a.call(this);
  }
  d = this.U ? d.Ka : d.pointerType;
  var e = rb(c, this.h, d.h);
  return null === e ? a.call(this) : this.V ? Bb(d.h.B, {j:d, i:e, A:this, s:b,}) : Bb(d.h.B, {j:d, i:e,});
};
$b = h.UnboundTypeError = bb("UnboundTypeError");
var Nc = {_embind_create_inheriting_constructor:function(b, a, c) {
  b = U(b);
  a = nb(a, "wrapper");
  c = R(c);
  var d = [].slice, e = a.h, f = e.B, m = e.l.B, k = e.l.constructor;
  b = Za(b, function() {
    e.l.ya.forEach(function(l) {
      if (this[l] === m[l]) {
        throw new cb(`Pure virtual function ${l} must be implemented in JavaScript`);
      }
    }.bind(this));
    Object.defineProperty(this, "__parent", {value:f});
    this.__construct.apply(this, d.call(arguments));
  });
  f.__construct = function() {
    this === f && Q("Pass correct 'this' to __construct");
    var l = k.implement.apply(void 0, [this].concat(d.call(arguments)));
    ob(l);
    var t = l.g;
    l.notifyOnDestruction();
    t.O = !0;
    Object.defineProperties(this, {g:{value:t}});
    Cb(this);
    l = t.i;
    l = ib(e, l);
    hb.hasOwnProperty(l) ? Q(`Tried to register registered instance: ${l}`) : hb[l] = this;
  };
  f.__destruct = function() {
    this === f && Q("Pass correct 'this' to __destruct");
    ob(this);
    var l = this.g.i;
    l = ib(e, l);
    hb.hasOwnProperty(l) ? delete hb[l] : Q(`Tried to unregister unregistered instance: ${l}`);
  };
  b.prototype = Object.create(f);
  for (var n in c) {
    b.prototype[n] = c[n];
  }
  return S(b);
}, _embind_finalize_value_object:function(b) {
  var a = Db[b];
  delete Db[b];
  var c = a.fa, d = a.H, e = a.sa, f = e.map(m => m.Ya).concat(e.map(m => m.lb));
  V([b], f, m => {
    var k = {};
    e.forEach((n, l) => {
      var t = m[l], w = n.Wa, x = n.Xa, g = m[l + e.length], r = n.kb, q = n.mb;
      k[n.Sa] = {read:G => t.fromWireType(w(x, G)), write:(G, D) => {
        var v = [];
        r(q, G, g.toWireType(v, D));
        Eb(v);
      }};
    });
    return [{name:a.name, fromWireType:function(n) {
      var l = {}, t;
      for (t in k) {
        l[t] = k[t].read(n);
      }
      d(n);
      return l;
    }, toWireType:function(n, l) {
      for (var t in k) {
        if (!(t in l)) {
          throw new TypeError(`Missing field: "${t}"`);
        }
      }
      var w = c();
      for (t in k) {
        k[t].write(w, l[t]);
      }
      null !== n && n.push(d, w);
      return w;
    }, argPackAdvance:8, readValueFromPointer:Fb, v:d,}];
  });
}, _embind_register_bigint:function() {
}, _embind_register_bool:function(b, a, c, d, e) {
  var f = Jb(c);
  a = U(a);
  Ib(b, {name:a, fromWireType:function(m) {
    return !!m;
  }, toWireType:function(m, k) {
    return k ? d : e;
  }, argPackAdvance:8, readValueFromPointer:function(m) {
    if (1 === c) {
      var k = Ca;
    } else if (2 === c) {
      k = Da;
    } else if (4 === c) {
      k = L;
    } else {
      throw new TypeError("Unknown boolean type size: " + a);
    }
    return this.fromWireType(k[m >> f]);
  }, v:null,});
}, _embind_register_class:function(b, a, c, d, e, f, m, k, n, l, t, w, x) {
  t = U(t);
  f = W(e, f);
  k && (k = W(m, k));
  l && (l = W(n, l));
  x = W(w, x);
  var g = Ya(t);
  Ob(g, function() {
    ac(`Cannot construct ${t} due to unbound types`, [d]);
  });
  V([b, a, c], d ? [d] : [], function(r) {
    r = r[0];
    if (d) {
      var q = r.h;
      var G = q.B;
    } else {
      G = Mb.prototype;
    }
    r = Za(g, function() {
      if (Object.getPrototypeOf(this) !== D) {
        throw new ab("Use 'new' to construct " + t);
      }
      if (void 0 === v.I) {
        throw new ab(t + " has no accessible constructor");
      }
      var O = v.I[arguments.length];
      if (void 0 === O) {
        throw new ab(`Tried to invoke ctor of ${t} with invalid number of parameters (${arguments.length}) - expected (${Object.keys(v.I).toString()}) parameters instead!`);
      }
      return O.apply(this, arguments);
    });
    var D = Object.create(G, {constructor:{value:r},});
    r.prototype = D;
    var v = new Pb(t, r, D, x, q, f, k, l);
    v.l && (void 0 === v.l.T && (v.l.T = []), v.l.T.push(v));
    q = new Vb(t, v, !0, !1);
    G = new Vb(t + "*", v, !1, !1);
    var I = new Vb(t + " const*", v, !1, !0);
    sb[b] = {pointerType:G, Ka:I};
    Wb(g, r);
    return [q, G, I];
  });
}, _embind_register_class_class_function:function(b, a, c, d, e, f, m) {
  var k = cc(c, d);
  a = U(a);
  f = W(e, f);
  V([], [b], function(n) {
    function l() {
      ac(`Cannot call ${t} due to unbound types`, k);
    }
    n = n[0];
    var t = `${n.name}.${a}`;
    a.startsWith("@@") && (a = Symbol[a.substring(2)]);
    var w = n.h.constructor;
    void 0 === w[a] ? (l.L = c - 1, w[a] = l) : (Nb(w, a, t), w[a].m[c - 1] = l);
    V([], k, function(x) {
      x = bc(t, [x[0], null].concat(x.slice(1)), null, f, m);
      void 0 === w[a].m ? (x.L = c - 1, w[a] = x) : w[a].m[c - 1] = x;
      if (n.h.T) {
        for (const g of n.h.T) {
          g.constructor.hasOwnProperty(a) || (g.constructor[a] = x);
        }
      }
      return [];
    });
    return [];
  });
}, _embind_register_class_class_property:function(b, a, c, d, e, f, m, k) {
  a = U(a);
  f = W(e, f);
  V([], [b], function(n) {
    n = n[0];
    var l = `${n.name}.${a}`, t = {get() {
      ac(`Cannot access ${l} due to unbound types`, [c]);
    }, enumerable:!0, configurable:!0};
    t.set = k ? () => {
      ac(`Cannot access ${l} due to unbound types`, [c]);
    } : () => {
      Q(`${l} is a read-only property`);
    };
    Object.defineProperty(n.h.constructor, a, t);
    V([], [c], function(w) {
      w = w[0];
      var x = {get() {
        return w.fromWireType(f(d));
      }, enumerable:!0};
      k && (k = W(m, k), x.set = g => {
        var r = [];
        k(d, w.toWireType(r, g));
        Eb(r);
      });
      Object.defineProperty(n.h.constructor, a, x);
      return [];
    });
    return [];
  });
}, _embind_register_class_constructor:function(b, a, c, d, e, f) {
  var m = cc(a, c);
  e = W(d, e);
  V([], [b], function(k) {
    k = k[0];
    var n = `constructor ${k.name}`;
    void 0 === k.h.I && (k.h.I = []);
    if (void 0 !== k.h.I[a - 1]) {
      throw new ab(`Cannot register multiple constructors with identical number of parameters (${a - 1}) for class '${k.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);
    }
    k.h.I[a - 1] = () => {
      ac(`Cannot construct ${k.name} due to unbound types`, m);
    };
    V([], m, function(l) {
      l.splice(1, 0, null);
      k.h.I[a - 1] = bc(n, l, null, e, f);
      return [];
    });
    return [];
  });
}, _embind_register_class_function:function(b, a, c, d, e, f, m, k) {
  var n = cc(c, d);
  a = U(a);
  f = W(e, f);
  V([], [b], function(l) {
    function t() {
      ac(`Cannot call ${w} due to unbound types`, n);
    }
    l = l[0];
    var w = `${l.name}.${a}`;
    a.startsWith("@@") && (a = Symbol[a.substring(2)]);
    k && l.h.ya.push(a);
    var x = l.h.B, g = x[a];
    void 0 === g || void 0 === g.m && g.className !== l.name && g.L === c - 2 ? (t.L = c - 2, t.className = l.name, x[a] = t) : (Nb(x, a, w), x[a].m[c - 2] = t);
    V([], n, function(r) {
      r = bc(w, r, l, f, m);
      void 0 === x[a].m ? (r.L = c - 2, x[a] = r) : x[a].m[c - 2] = r;
      return [];
    });
    return [];
  });
}, _embind_register_class_property:function(b, a, c, d, e, f, m, k, n, l) {
  a = U(a);
  e = W(d, e);
  V([], [b], function(t) {
    t = t[0];
    var w = `${t.name}.${a}`, x = {get() {
      ac(`Cannot access ${w} due to unbound types`, [c, m]);
    }, enumerable:!0, configurable:!0};
    x.set = n ? () => {
      ac(`Cannot access ${w} due to unbound types`, [c, m]);
    } : () => {
      Q(w + " is a read-only property");
    };
    Object.defineProperty(t.h.B, a, x);
    V([], n ? [c, m] : [c], function(g) {
      var r = g[0], q = {get() {
        var D = dc(this, t, w + " getter");
        return r.fromWireType(e(f, D));
      }, enumerable:!0};
      if (n) {
        n = W(k, n);
        var G = g[1];
        q.set = function(D) {
          var v = dc(this, t, w + " setter"), I = [];
          n(l, v, G.toWireType(I, D));
          Eb(I);
        };
      }
      Object.defineProperty(t.h.B, a, q);
      return [];
    });
    return [];
  });
}, _embind_register_emval:function(b, a) {
  a = U(a);
  Ib(b, {name:a, fromWireType:function(c) {
    var d = R(c);
    ec(c);
    return d;
  }, toWireType:function(c, d) {
    return S(d);
  }, argPackAdvance:8, readValueFromPointer:Fb, v:null,});
}, _embind_register_enum:function(b, a, c, d) {
  function e() {
  }
  c = Jb(c);
  a = U(a);
  e.values = {};
  Ib(b, {name:a, constructor:e, fromWireType:function(f) {
    return this.constructor.values[f];
  }, toWireType:function(f, m) {
    return m.value;
  }, argPackAdvance:8, readValueFromPointer:fc(a, c, d), v:null,});
  Ob(a, e);
}, _embind_register_enum_value:function(b, a, c) {
  var d = nb(b, "enum");
  a = U(a);
  b = d.constructor;
  d = Object.create(d.constructor.prototype, {value:{value:c}, constructor:{value:Za(`${d.name}_${a}`, function() {
  })},});
  b.values[c] = d;
  b[a] = d;
}, _embind_register_float:function(b, a, c) {
  c = Jb(c);
  a = U(a);
  Ib(b, {name:a, fromWireType:function(d) {
    return d;
  }, toWireType:function(d, e) {
    return e;
  }, argPackAdvance:8, readValueFromPointer:gc(a, c), v:null,});
}, _embind_register_function:function(b, a, c, d, e, f) {
  var m = cc(a, c);
  b = U(b);
  e = W(d, e);
  Ob(b, function() {
    ac(`Cannot call ${b} due to unbound types`, m);
  }, a - 1);
  V([], m, function(k) {
    Wb(b, bc(b, [k[0], null].concat(k.slice(1)), null, e, f), a - 1);
    return [];
  });
}, _embind_register_integer:function(b, a, c, d, e) {
  a = U(a);
  -1 === e && (e = 4294967295);
  e = Jb(c);
  var f = k => k;
  if (0 === d) {
    var m = 32 - 8 * c;
    f = k => k << m >>> m;
  }
  c = a.includes("unsigned") ? function(k, n) {
    return n >>> 0;
  } : function(k, n) {
    return n;
  };
  Ib(b, {name:a, fromWireType:f, toWireType:c, argPackAdvance:8, readValueFromPointer:hc(a, e, 0 !== d), v:null,});
}, _embind_register_memory_view:function(b, a, c) {
  function d(f) {
    f >>= 2;
    var m = M;
    return new e(m.buffer, m[f + 1], m[f]);
  }
  var e = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,][a];
  c = U(c);
  Ib(b, {name:c, fromWireType:d, argPackAdvance:8, readValueFromPointer:d,}, {ab:!0,});
}, _embind_register_std_string:function(b, a) {
  a = U(a);
  var c = "std::string" === a;
  Ib(b, {name:a, fromWireType:function(d) {
    var e = M[d >> 2], f = d + 4;
    if (c) {
      for (var m = f, k = 0; k <= e; ++k) {
        var n = f + k;
        if (k == e || 0 == J[n]) {
          m = m ? lc(J, m, n - m) : "";
          if (void 0 === l) {
            var l = m;
          } else {
            l += String.fromCharCode(0), l += m;
          }
          m = n + 1;
        }
      }
    } else {
      l = Array(e);
      for (k = 0; k < e; ++k) {
        l[k] = String.fromCharCode(J[f + k]);
      }
      l = l.join("");
    }
    mb(d);
    return l;
  }, toWireType:function(d, e) {
    e instanceof ArrayBuffer && (e = new Uint8Array(e));
    var f = "string" == typeof e;
    f || e instanceof Uint8Array || e instanceof Uint8ClampedArray || e instanceof Int8Array || Q("Cannot pass non-string to std::string");
    var m = c && f ? jc(e) : e.length;
    var k = Mc(4 + m + 1), n = k + 4;
    M[k >> 2] = m;
    if (c && f) {
      ic(e, J, n, m + 1);
    } else {
      if (f) {
        for (f = 0; f < m; ++f) {
          var l = e.charCodeAt(f);
          255 < l && (mb(n), Q("String has UTF-16 code units that do not fit in 8 bits"));
          J[n + f] = l;
        }
      } else {
        for (f = 0; f < m; ++f) {
          J[n + f] = e[f];
        }
      }
    }
    null !== d && d.push(mb, k);
    return k;
  }, argPackAdvance:8, readValueFromPointer:Fb, v:function(d) {
    mb(d);
  },});
}, _embind_register_std_wstring:function(b, a, c) {
  c = U(c);
  if (2 === a) {
    var d = nc;
    var e = qc;
    var f = rc;
    var m = () => Ea;
    var k = 1;
  } else {
    4 === a && (d = sc, e = tc, f = uc, m = () => M, k = 2);
  }
  Ib(b, {name:c, fromWireType:function(n) {
    for (var l = M[n >> 2], t = m(), w, x = n + 4, g = 0; g <= l; ++g) {
      var r = n + 4 + g * a;
      if (g == l || 0 == t[r >> k]) {
        x = d(x, r - x), void 0 === w ? w = x : (w += String.fromCharCode(0), w += x), x = r + a;
      }
    }
    mb(n);
    return w;
  }, toWireType:function(n, l) {
    "string" != typeof l && Q(`Cannot pass non-string to C++ string type ${c}`);
    var t = f(l), w = Mc(4 + t + a);
    M[w >> 2] = t >> k;
    e(l, w + 4, t + a);
    null !== n && n.push(mb, w);
    return w;
  }, argPackAdvance:8, readValueFromPointer:Fb, v:function(n) {
    mb(n);
  },});
}, _embind_register_value_object:function(b, a, c, d, e, f) {
  Db[b] = {name:U(a), fa:W(c, d), H:W(e, f), sa:[],};
}, _embind_register_value_object_field:function(b, a, c, d, e, f, m, k, n, l) {
  Db[b].sa.push({Sa:U(a), Ya:c, Wa:W(d, e), Xa:f, lb:m, kb:W(k, n), mb:l,});
}, _embind_register_void:function(b, a) {
  a = U(a);
  Ib(b, {cb:!0, name:a, argPackAdvance:0, fromWireType:function() {
  }, toWireType:function() {
  },});
}, _emscripten_get_now_is_monotonic:() => !0, _emval_as:function(b, a, c) {
  b = R(b);
  a = nb(a, "emval::as");
  var d = [], e = S(d);
  M[c >> 2] = e;
  return a.toWireType(d, b);
}, _emval_call_method:function(b, a, c, d, e) {
  b = xc[b];
  a = R(a);
  c = wc(c);
  var f = [];
  M[d >> 2] = S(f);
  return b(a, c, f, e);
}, _emval_call_void_method:function(b, a, c, d) {
  b = xc[b];
  a = R(a);
  c = wc(c);
  b(a, c, null, d);
}, _emval_decref:ec, _emval_get_method_caller:function(b, a) {
  var c = zc(b, a), d = c[0];
  a = d.name + "_$" + c.slice(1).map(function(m) {
    return m.name;
  }).join("_") + "$";
  var e = Ac[a];
  if (void 0 !== e) {
    return e;
  }
  var f = Array(b - 1);
  e = yc((m, k, n, l) => {
    for (var t = 0, w = 0; w < b - 1; ++w) {
      f[w] = c[w + 1].readValueFromPointer(l + t), t += c[w + 1].argPackAdvance;
    }
    m = m[k].apply(m, f);
    for (w = 0; w < b - 1; ++w) {
      c[w + 1].Na && c[w + 1].Na(f[w]);
    }
    if (!d.cb) {
      return d.toWireType(n, m);
    }
  });
  return Ac[a] = e;
}, _emval_get_module_property:function(b) {
  b = wc(b);
  return S(h[b]);
}, _emval_get_property:function(b, a) {
  b = R(b);
  a = R(a);
  return S(b[a]);
}, _emval_incref:function(b) {
  4 < b && (P.get(b).Aa += 1);
}, _emval_new_array:function() {
  return S([]);
}, _emval_new_cstring:function(b) {
  return S(wc(b));
}, _emval_new_object:function() {
  return S({});
}, _emval_run_destructors:function(b) {
  var a = R(b);
  Eb(a);
  ec(b);
}, _emval_set_property:function(b, a, c) {
  b = R(b);
  a = R(a);
  c = R(c);
  b[a] = c;
}, _emval_take_value:function(b, a) {
  b = nb(b, "_emval_take_value");
  b = b.readValueFromPointer(a);
  return S(b);
}, abort:() => {
  za("");
}, emscripten_date_now:function() {
  return Date.now();
}, emscripten_get_now:() => performance.now(), emscripten_memcpy_big:(b, a, c) => J.copyWithin(b, a, a + c), emscripten_resize_heap:b => {
  var a = J.length;
  b >>>= 0;
  if (2147483648 < b) {
    return !1;
  }
  for (var c = 1; 4 >= c; c *= 2) {
    var d = a * (1 + 0.2 / c);
    d = Math.min(d, b + 100663296);
    var e = Math;
    d = Math.max(b, d);
    a: {
      e = e.min.call(e, 2147483648, d + (65536 - d % 65536) % 65536) - Aa.buffer.byteLength + 65535 >>> 16;
      try {
        Aa.grow(e);
        Ha();
        var f = 1;
        break a;
      } catch (m) {
      }
      f = void 0;
    }
    if (f) {
      return !0;
    }
  }
  return !1;
}, environ_get:(b, a) => {
  var c = 0;
  Dc().forEach(function(d, e) {
    var f = a + c;
    e = M[b + 4 * e >> 2] = f;
    for (f = 0; f < d.length; ++f) {
      Ca[e++ >> 0] = d.charCodeAt(f);
    }
    Ca[e >> 0] = 0;
    c += d.length + 1;
  });
  return 0;
}, environ_sizes_get:(b, a) => {
  var c = Dc();
  M[b >> 2] = c.length;
  var d = 0;
  c.forEach(function(e) {
    d += e.length + 1;
  });
  M[a >> 2] = d;
  return 0;
}, fd_close:() => 52, fd_seek:function() {
  return 70;
}, fd_write:(b, a, c, d) => {
  for (var e = 0, f = 0; f < c; f++) {
    var m = M[a >> 2], k = M[a + 4 >> 2];
    a += 8;
    for (var n = 0; n < k; n++) {
      var l = J[m + n], t = Ec[b];
      0 === l || 10 === l ? ((1 === b ? ua : va)(lc(t, 0)), t.length = 0) : t.push(l);
    }
    e += k;
  }
  M[d >> 2] = e;
  return 0;
}, strftime_l:(b, a, c, d) => Jc(b, a, c, d)};
(function() {
  function b(c) {
    z = c = c.exports;
    Aa = z.memory;
    Ha();
    Ia = z.__indirect_function_table;
    Ka.unshift(z.__wasm_call_ctors);
    Na--;
    h.monitorRunDependencies && h.monitorRunDependencies(Na);
    if (0 == Na && (null !== Oa && (clearInterval(Oa), Oa = null), Pa)) {
      var d = Pa;
      Pa = null;
      d();
    }
    return c;
  }
  var a = {env:Nc, wasi_snapshot_preview1:Nc,};
  Na++;
  h.monitorRunDependencies && h.monitorRunDependencies(Na);
  if (h.instantiateWasm) {
    try {
      return h.instantiateWasm(a, b);
    } catch (c) {
      va("Module.instantiateWasm callback failed with error: " + c), ba(c);
    }
  }
  Wa(a, function(c) {
    b(c.instance);
  }).catch(ba);
  return {};
})();
var mb = b => (mb = z.free)(b), Mc = b => (Mc = z.malloc)(b), lb = b => (lb = z.__getTypeName)(b);
h.__embind_initialize_bindings = () => (h.__embind_initialize_bindings = z._embind_initialize_bindings)();
h.dynCall_jiji = (b, a, c, d, e) => (h.dynCall_jiji = z.dynCall_jiji)(b, a, c, d, e);
h.dynCall_viijii = (b, a, c, d, e, f, m) => (h.dynCall_viijii = z.dynCall_viijii)(b, a, c, d, e, f, m);
h.dynCall_iiiiij = (b, a, c, d, e, f, m) => (h.dynCall_iiiiij = z.dynCall_iiiiij)(b, a, c, d, e, f, m);
h.dynCall_iiiiijj = (b, a, c, d, e, f, m, k, n) => (h.dynCall_iiiiijj = z.dynCall_iiiiijj)(b, a, c, d, e, f, m, k, n);
h.dynCall_iiiiiijj = (b, a, c, d, e, f, m, k, n, l) => (h.dynCall_iiiiiijj = z.dynCall_iiiiiijj)(b, a, c, d, e, f, m, k, n, l);
var Oc;
Pa = function Pc() {
  Oc || Qc();
  Oc || (Pa = Pc);
};
function Qc() {
  function b() {
    if (!Oc && (Oc = !0, h.calledRun = !0, !Ba)) {
      Xa(Ka);
      aa(h);
      if (h.onRuntimeInitialized) {
        h.onRuntimeInitialized();
      }
      if (h.postRun) {
        for ("function" == typeof h.postRun && (h.postRun = [h.postRun]); h.postRun.length;) {
          var a = h.postRun.shift();
          La.unshift(a);
        }
      }
      Xa(La);
    }
  }
  if (!(0 < Na)) {
    if (h.preRun) {
      for ("function" == typeof h.preRun && (h.preRun = [h.preRun]); h.preRun.length;) {
        Ma();
      }
    }
    Xa(Ja);
    0 < Na || (h.setStatus ? (h.setStatus("Running..."), setTimeout(function() {
      setTimeout(function() {
        h.setStatus("");
      }, 1);
      b();
    }, 1)) : b());
  }
}
if (h.preInit) {
  for ("function" == typeof h.preInit && (h.preInit = [h.preInit]); 0 < h.preInit.length;) {
    h.preInit.pop()();
  }
}
Qc();



  return moduleArg.ready
}

);
})();
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Rive);

/***/ }),
/* 2 */
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"name":"@rive-app/canvas-lite","version":"2.27.2","description":"A lite version of Rive\'s canvas based web api.","main":"rive.js","homepage":"https://rive.app","repository":{"type":"git","url":"https://github.com/rive-app/rive-wasm/tree/master/js"},"keywords":["rive","animation"],"author":"Rive","contributors":["Luigi Rosso <luigi@rive.app> (https://rive.app)","Maxwell Talbot <max@rive.app> (https://rive.app)","Arthur Vivian <arthur@rive.app> (https://rive.app)","Umberto Sonnino <umberto@rive.app> (https://rive.app)","Matthew Sullivan <matt.j.sullivan@gmail.com> (mailto:matt.j.sullivan@gmail.com)"],"license":"MIT","files":["rive.js","rive.js.map","rive.wasm","rive_fallback.wasm","rive.d.ts","rive_advanced.mjs.d.ts"],"typings":"rive.d.ts","dependencies":{},"browser":{"fs":false,"path":false}}');

/***/ }),
/* 3 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Animation: () => (/* reexport safe */ _Animation__WEBPACK_IMPORTED_MODULE_0__.Animation)
/* harmony export */ });
/* harmony import */ var _Animation__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(4);



/***/ }),
/* 4 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Animation: () => (/* binding */ Animation)
/* harmony export */ });
/**
 * Represents an animation that can be played on an Artboard.
 * Wraps animations and instances from the runtime and keeps track of playback state.
 *
 * The `Animation` class manages the state and behavior of a single animation instance,
 * including its current time, loop count, and ability to scrub to a specific time.
 *
 * The class provides methods to advance the animation, apply its interpolated keyframe
 * values to the Artboard, and clean up the underlying animation instance when the
 * animation is no longer needed.
 */
var Animation = /** @class */ (function () {
    /**
     * Constructs a new animation
     * @constructor
     * @param {any} animation: runtime animation object
     * @param {any} instance: runtime animation instance object
     */
    function Animation(animation, artboard, runtime, playing) {
        this.animation = animation;
        this.artboard = artboard;
        this.playing = playing;
        this.loopCount = 0;
        /**
         * The time to which the animation should move to on the next render.
         * If not null, the animation will scrub to this time instead of advancing by the given time.
         */
        this.scrubTo = null;
        this.instance = new runtime.LinearAnimationInstance(animation, artboard);
    }
    Object.defineProperty(Animation.prototype, "name", {
        /**
         * Returns the animation's name
         */
        get: function () {
            return this.animation.name;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Animation.prototype, "time", {
        /**
         * Returns the animation's name
         */
        get: function () {
            return this.instance.time;
        },
        /**
         * Sets the animation's current time
         */
        set: function (value) {
            this.instance.time = value;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Animation.prototype, "loopValue", {
        /**
         * Returns the animation's loop type
         */
        get: function () {
            return this.animation.loopValue;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Animation.prototype, "needsScrub", {
        /**
         * Indicates whether the animation needs to be scrubbed.
         * @returns `true` if the animation needs to be scrubbed, `false` otherwise.
         */
        get: function () {
            return this.scrubTo !== null;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Advances the animation by the give time. If the animation needs scrubbing,
     * time is ignored and the stored scrub value is used.
     * @param time the time to advance the animation by if no scrubbing required
     */
    Animation.prototype.advance = function (time) {
        if (this.scrubTo === null) {
            this.instance.advance(time);
        }
        else {
            this.instance.time = 0;
            this.instance.advance(this.scrubTo);
            this.scrubTo = null;
        }
    };
    /**
     * Apply interpolated keyframe values to the artboard. This should be called after calling
     * .advance() on an animation instance so that new values are applied to properties.
     *
     * Note: This does not advance the artboard, which updates all objects on the artboard
     * @param mix - Mix value for the animation from 0 to 1
     */
    Animation.prototype.apply = function (mix) {
        this.instance.apply(mix);
    };
    /**
     * Deletes the backing Wasm animation instance; once this is called, this
     * animation is no more.
     */
    Animation.prototype.cleanup = function () {
        this.instance.delete();
    };
    return Animation;
}());



/***/ }),
/* 5 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BLANK_URL: () => (/* reexport safe */ _sanitizeUrl__WEBPACK_IMPORTED_MODULE_1__.BLANK_URL),
/* harmony export */   registerTouchInteractions: () => (/* reexport safe */ _registerTouchInteractions__WEBPACK_IMPORTED_MODULE_0__.registerTouchInteractions),
/* harmony export */   sanitizeUrl: () => (/* reexport safe */ _sanitizeUrl__WEBPACK_IMPORTED_MODULE_1__.sanitizeUrl)
/* harmony export */ });
/* harmony import */ var _registerTouchInteractions__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(6);
/* harmony import */ var _sanitizeUrl__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(7);




/***/ }),
/* 6 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   registerTouchInteractions: () => (/* binding */ registerTouchInteractions)
/* harmony export */ });
var _this = undefined;
/**
 * Returns the clientX and clientY properties from touch or mouse events. Also
 * calls preventDefault() on the event if it is a touchstart or touchmove to prevent
 * scrolling the page on mobile devices
 * @param event - Either a TouchEvent or a MouseEvent
 * @returns - Coordinates of the clientX and clientY properties from the touch/mouse event
 */
var getClientCoordinates = function (event, isTouchScrollEnabled) {
    var _a, _b;
    if (["touchstart", "touchmove"].indexOf(event.type) > -1 &&
        ((_a = event.touches) === null || _a === void 0 ? void 0 : _a.length)) {
        // This flag, if false, prevents touch events on the canvas default behavior
        // which may prevent scrolling if a drag motion on the canvas is performed
        if (!isTouchScrollEnabled) {
            event.preventDefault();
        }
        return {
            clientX: event.touches[0].clientX,
            clientY: event.touches[0].clientY,
        };
    }
    else if (event.type === "touchend" &&
        ((_b = event.changedTouches) === null || _b === void 0 ? void 0 : _b.length)) {
        return {
            clientX: event.changedTouches[0].clientX,
            clientY: event.changedTouches[0].clientY,
        };
    }
    else {
        return {
            clientX: event.clientX,
            clientY: event.clientY,
        };
    }
};
/**
 * Registers mouse move/up/down callback handlers on the canvas to send meaningful coordinates to
 * the state machine pointer move/up/down functions based on cursor interaction
 */
var registerTouchInteractions = function (_a) {
    var canvas = _a.canvas, artboard = _a.artboard, _b = _a.stateMachines, stateMachines = _b === void 0 ? [] : _b, renderer = _a.renderer, rive = _a.rive, fit = _a.fit, alignment = _a.alignment, _c = _a.isTouchScrollEnabled, isTouchScrollEnabled = _c === void 0 ? false : _c, _d = _a.layoutScaleFactor, layoutScaleFactor = _d === void 0 ? 1.0 : _d;
    if (!canvas ||
        !stateMachines.length ||
        !renderer ||
        !rive ||
        !artboard ||
        typeof window === "undefined") {
        return null;
    }
    /**
     * After a touchend event, some browsers may fire synthetic mouse events
     * (mouseover, mousedown, mousemove, mouseup) if the touch interaction did not cause
     * any default action (such as scrolling).
     *
     * This is done to simulate the behavior of a mouse for applications that do not support
     * touch events.
     *
     * We're keeping track of the previous event to not send the synthetic mouse events if the
     * touch event was a click (touchstart -> touchend).
     *
     * This is only needed when `isTouchScrollEnabled` is false
     * When true, `preventDefault()` is called which prevents this behaviour.
     **/
    var _prevEventType = null;
    var _syntheticEventsActive = false;
    var processEventCallback = function (event) {
        // Exit early out of all synthetic mouse events
        // https://stackoverflow.com/questions/9656990/how-to-prevent-simulated-mouse-events-in-mobile-browsers
        // https://stackoverflow.com/questions/25572070/javascript-touchend-versus-click-dilemma
        if (_syntheticEventsActive && event instanceof MouseEvent) {
            // Synthetic event finished
            if (event.type == "mouseup") {
                _syntheticEventsActive = false;
            }
            return;
        }
        // Test if it's a "touch click". This could cause the browser to send
        // synthetic mouse events.
        _syntheticEventsActive =
            isTouchScrollEnabled &&
                event.type === "touchend" &&
                _prevEventType === "touchstart";
        _prevEventType = event.type;
        var boundingRect = event.currentTarget.getBoundingClientRect();
        var _a = getClientCoordinates(event, isTouchScrollEnabled), clientX = _a.clientX, clientY = _a.clientY;
        if (!clientX && !clientY) {
            return;
        }
        var canvasX = clientX - boundingRect.left;
        var canvasY = clientY - boundingRect.top;
        var forwardMatrix = rive.computeAlignment(fit, alignment, {
            minX: 0,
            minY: 0,
            maxX: boundingRect.width,
            maxY: boundingRect.height,
        }, artboard.bounds, layoutScaleFactor);
        var invertedMatrix = new rive.Mat2D();
        forwardMatrix.invert(invertedMatrix);
        var canvasCoordinatesVector = new rive.Vec2D(canvasX, canvasY);
        var transformedVector = rive.mapXY(invertedMatrix, canvasCoordinatesVector);
        var transformedX = transformedVector.x();
        var transformedY = transformedVector.y();
        transformedVector.delete();
        invertedMatrix.delete();
        canvasCoordinatesVector.delete();
        forwardMatrix.delete();
        switch (event.type) {
            /**
             * There's a 2px buffer for a hitRadius when translating the pointer coordinates
             * down to the state machine. In cases where the hitbox is about that much away
             * from the Artboard border, we don't have exact precision on determining pointer
             * exit. We're therefore adding to the translated coordinates on mouseout of a canvas
             * to ensure that we report the mouse has truly exited the hitarea.
             * https://github.com/rive-app/rive-cpp/blob/master/src/animation/state_machine_instance.cpp#L336
             *
             * We add/subtract 10000 to account for when the graphic goes beyond the canvas bound
             * due to for example, a fit: 'cover'. Not perfect, but helps reliably (for now) ensure
             * we report going out of bounds when the mouse is out of the canvas
             */
            case "mouseout":
                for (var _i = 0, stateMachines_1 = stateMachines; _i < stateMachines_1.length; _i++) {
                    var stateMachine = stateMachines_1[_i];
                    stateMachine.pointerMove(transformedX, transformedY);
                }
                break;
            // Pointer moving/hovering on the canvas
            case "touchmove":
            case "mouseover":
            case "mousemove": {
                for (var _b = 0, stateMachines_2 = stateMachines; _b < stateMachines_2.length; _b++) {
                    var stateMachine = stateMachines_2[_b];
                    stateMachine.pointerMove(transformedX, transformedY);
                }
                break;
            }
            // Pointer click initiated but not released yet on the canvas
            case "touchstart":
            case "mousedown": {
                for (var _c = 0, stateMachines_3 = stateMachines; _c < stateMachines_3.length; _c++) {
                    var stateMachine = stateMachines_3[_c];
                    stateMachine.pointerDown(transformedX, transformedY);
                }
                break;
            }
            // Pointer click released on the canvas
            case "touchend":
            case "mouseup": {
                for (var _d = 0, stateMachines_4 = stateMachines; _d < stateMachines_4.length; _d++) {
                    var stateMachine = stateMachines_4[_d];
                    stateMachine.pointerUp(transformedX, transformedY);
                }
                break;
            }
            default:
        }
    };
    var callback = processEventCallback.bind(_this);
    canvas.addEventListener("mouseover", callback);
    canvas.addEventListener("mouseout", callback);
    canvas.addEventListener("mousemove", callback);
    canvas.addEventListener("mousedown", callback);
    canvas.addEventListener("mouseup", callback);
    canvas.addEventListener("touchmove", callback, {
        passive: isTouchScrollEnabled,
    });
    canvas.addEventListener("touchstart", callback, {
        passive: isTouchScrollEnabled,
    });
    canvas.addEventListener("touchend", callback);
    return function () {
        canvas.removeEventListener("mouseover", callback);
        canvas.removeEventListener("mouseout", callback);
        canvas.removeEventListener("mousemove", callback);
        canvas.removeEventListener("mousedown", callback);
        canvas.removeEventListener("mouseup", callback);
        canvas.removeEventListener("touchmove", callback);
        canvas.removeEventListener("touchstart", callback);
        canvas.removeEventListener("touchend", callback);
    };
};


/***/ }),
/* 7 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BLANK_URL: () => (/* binding */ BLANK_URL),
/* harmony export */   sanitizeUrl: () => (/* binding */ sanitizeUrl)
/* harmony export */ });
// Reference: https://github.com/braintree/sanitize-url/tree/main
var invalidProtocolRegex = /^([^\w]*)(javascript|data|vbscript)/im;
var htmlEntitiesRegex = /&#(\w+)(^\w|;)?/g;
var htmlCtrlEntityRegex = /&(newline|tab);/gi;
var ctrlCharactersRegex = /[\u0000-\u001F\u007F-\u009F\u2000-\u200D\uFEFF]/gim;
var urlSchemeRegex = /^.+(:|&colon;)/gim;
var relativeFirstCharacters = [".", "/"];
var BLANK_URL = "about:blank";
function isRelativeUrlWithoutProtocol(url) {
    return relativeFirstCharacters.indexOf(url[0]) > -1;
}
// adapted from https://stackoverflow.com/a/29824550/2601552
function decodeHtmlCharacters(str) {
    var removedNullByte = str.replace(ctrlCharactersRegex, "");
    return removedNullByte.replace(htmlEntitiesRegex, function (match, dec) {
        return String.fromCharCode(dec);
    });
}
function sanitizeUrl(url) {
    if (!url) {
        return BLANK_URL;
    }
    var sanitizedUrl = decodeHtmlCharacters(url)
        .replace(htmlCtrlEntityRegex, "")
        .replace(ctrlCharactersRegex, "")
        .trim();
    if (!sanitizedUrl) {
        return BLANK_URL;
    }
    if (isRelativeUrlWithoutProtocol(sanitizedUrl)) {
        return sanitizedUrl;
    }
    var urlSchemeParseResults = sanitizedUrl.match(urlSchemeRegex);
    if (!urlSchemeParseResults) {
        return sanitizedUrl;
    }
    var urlScheme = urlSchemeParseResults[0];
    if (invalidProtocolRegex.test(urlScheme)) {
        return BLANK_URL;
    }
    return sanitizedUrl;
}


/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Alignment: () => (/* binding */ Alignment),
/* harmony export */   DataEnum: () => (/* binding */ DataEnum),
/* harmony export */   EventType: () => (/* binding */ EventType),
/* harmony export */   Fit: () => (/* binding */ Fit),
/* harmony export */   Layout: () => (/* binding */ Layout),
/* harmony export */   LoopType: () => (/* binding */ LoopType),
/* harmony export */   Rive: () => (/* binding */ Rive),
/* harmony export */   RiveEventType: () => (/* binding */ RiveEventType),
/* harmony export */   RiveFile: () => (/* binding */ RiveFile),
/* harmony export */   RuntimeLoader: () => (/* binding */ RuntimeLoader),
/* harmony export */   StateMachineInput: () => (/* binding */ StateMachineInput),
/* harmony export */   StateMachineInputType: () => (/* binding */ StateMachineInputType),
/* harmony export */   Testing: () => (/* binding */ Testing),
/* harmony export */   ViewModel: () => (/* binding */ ViewModel),
/* harmony export */   ViewModelInstance: () => (/* binding */ ViewModelInstance),
/* harmony export */   ViewModelInstanceBoolean: () => (/* binding */ ViewModelInstanceBoolean),
/* harmony export */   ViewModelInstanceColor: () => (/* binding */ ViewModelInstanceColor),
/* harmony export */   ViewModelInstanceEnum: () => (/* binding */ ViewModelInstanceEnum),
/* harmony export */   ViewModelInstanceList: () => (/* binding */ ViewModelInstanceList),
/* harmony export */   ViewModelInstanceNumber: () => (/* binding */ ViewModelInstanceNumber),
/* harmony export */   ViewModelInstanceString: () => (/* binding */ ViewModelInstanceString),
/* harmony export */   ViewModelInstanceTrigger: () => (/* binding */ ViewModelInstanceTrigger),
/* harmony export */   ViewModelInstanceValue: () => (/* binding */ ViewModelInstanceValue),
/* harmony export */   decodeAudio: () => (/* binding */ decodeAudio),
/* harmony export */   decodeFont: () => (/* binding */ decodeFont),
/* harmony export */   decodeImage: () => (/* binding */ decodeImage)
/* harmony export */ });
/* harmony import */ var _rive_advanced_mjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1);
/* harmony import */ var package_json__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(2);
/* harmony import */ var _animation__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(3);
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5);
var __extends = (undefined && undefined.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (undefined && undefined.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (undefined && undefined.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (undefined && undefined.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};




var RiveError = /** @class */ (function (_super) {
    __extends(RiveError, _super);
    function RiveError() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this.isHandledError = true;
        return _this;
    }
    return RiveError;
}(Error));
// #regions helpers
var resolveErrorMessage = function (error) {
    return error && error.isHandledError
        ? error.message
        : "Problem loading file; may be corrupt!";
};
// #region layout
// Fit options for the canvas
var Fit;
(function (Fit) {
    Fit["Cover"] = "cover";
    Fit["Contain"] = "contain";
    Fit["Fill"] = "fill";
    Fit["FitWidth"] = "fitWidth";
    Fit["FitHeight"] = "fitHeight";
    Fit["None"] = "none";
    Fit["ScaleDown"] = "scaleDown";
    Fit["Layout"] = "layout";
})(Fit || (Fit = {}));
// Alignment options for the canvas
var Alignment;
(function (Alignment) {
    Alignment["Center"] = "center";
    Alignment["TopLeft"] = "topLeft";
    Alignment["TopCenter"] = "topCenter";
    Alignment["TopRight"] = "topRight";
    Alignment["CenterLeft"] = "centerLeft";
    Alignment["CenterRight"] = "centerRight";
    Alignment["BottomLeft"] = "bottomLeft";
    Alignment["BottomCenter"] = "bottomCenter";
    Alignment["BottomRight"] = "bottomRight";
})(Alignment || (Alignment = {}));
// Alignment options for Rive animations in a HTML canvas
var Layout = /** @class */ (function () {
    function Layout(params) {
        var _a, _b, _c, _d, _e, _f, _g;
        this.fit = (_a = params === null || params === void 0 ? void 0 : params.fit) !== null && _a !== void 0 ? _a : Fit.Contain;
        this.alignment = (_b = params === null || params === void 0 ? void 0 : params.alignment) !== null && _b !== void 0 ? _b : Alignment.Center;
        this.layoutScaleFactor = (_c = params === null || params === void 0 ? void 0 : params.layoutScaleFactor) !== null && _c !== void 0 ? _c : 1;
        this.minX = (_d = params === null || params === void 0 ? void 0 : params.minX) !== null && _d !== void 0 ? _d : 0;
        this.minY = (_e = params === null || params === void 0 ? void 0 : params.minY) !== null && _e !== void 0 ? _e : 0;
        this.maxX = (_f = params === null || params === void 0 ? void 0 : params.maxX) !== null && _f !== void 0 ? _f : 0;
        this.maxY = (_g = params === null || params === void 0 ? void 0 : params.maxY) !== null && _g !== void 0 ? _g : 0;
    }
    // Alternative constructor to build a Layout from an interface/object
    Layout.new = function (_a) {
        var fit = _a.fit, alignment = _a.alignment, minX = _a.minX, minY = _a.minY, maxX = _a.maxX, maxY = _a.maxY;
        console.warn("This function is deprecated: please use `new Layout({})` instead");
        return new Layout({ fit: fit, alignment: alignment, minX: minX, minY: minY, maxX: maxX, maxY: maxY });
    };
    /**
     * Makes a copy of the layout, replacing any specified parameters
     */
    Layout.prototype.copyWith = function (_a) {
        var fit = _a.fit, alignment = _a.alignment, layoutScaleFactor = _a.layoutScaleFactor, minX = _a.minX, minY = _a.minY, maxX = _a.maxX, maxY = _a.maxY;
        return new Layout({
            fit: fit !== null && fit !== void 0 ? fit : this.fit,
            alignment: alignment !== null && alignment !== void 0 ? alignment : this.alignment,
            layoutScaleFactor: layoutScaleFactor !== null && layoutScaleFactor !== void 0 ? layoutScaleFactor : this.layoutScaleFactor,
            minX: minX !== null && minX !== void 0 ? minX : this.minX,
            minY: minY !== null && minY !== void 0 ? minY : this.minY,
            maxX: maxX !== null && maxX !== void 0 ? maxX : this.maxX,
            maxY: maxY !== null && maxY !== void 0 ? maxY : this.maxY,
        });
    };
    // Returns fit for the Wasm runtime format
    Layout.prototype.runtimeFit = function (rive) {
        if (this.cachedRuntimeFit)
            return this.cachedRuntimeFit;
        var fit;
        if (this.fit === Fit.Cover)
            fit = rive.Fit.cover;
        else if (this.fit === Fit.Contain)
            fit = rive.Fit.contain;
        else if (this.fit === Fit.Fill)
            fit = rive.Fit.fill;
        else if (this.fit === Fit.FitWidth)
            fit = rive.Fit.fitWidth;
        else if (this.fit === Fit.FitHeight)
            fit = rive.Fit.fitHeight;
        else if (this.fit === Fit.ScaleDown)
            fit = rive.Fit.scaleDown;
        else if (this.fit === Fit.Layout)
            fit = rive.Fit.layout;
        else
            fit = rive.Fit.none;
        this.cachedRuntimeFit = fit;
        return fit;
    };
    // Returns alignment for the Wasm runtime format
    Layout.prototype.runtimeAlignment = function (rive) {
        if (this.cachedRuntimeAlignment)
            return this.cachedRuntimeAlignment;
        var alignment;
        if (this.alignment === Alignment.TopLeft)
            alignment = rive.Alignment.topLeft;
        else if (this.alignment === Alignment.TopCenter)
            alignment = rive.Alignment.topCenter;
        else if (this.alignment === Alignment.TopRight)
            alignment = rive.Alignment.topRight;
        else if (this.alignment === Alignment.CenterLeft)
            alignment = rive.Alignment.centerLeft;
        else if (this.alignment === Alignment.CenterRight)
            alignment = rive.Alignment.centerRight;
        else if (this.alignment === Alignment.BottomLeft)
            alignment = rive.Alignment.bottomLeft;
        else if (this.alignment === Alignment.BottomCenter)
            alignment = rive.Alignment.bottomCenter;
        else if (this.alignment === Alignment.BottomRight)
            alignment = rive.Alignment.bottomRight;
        else
            alignment = rive.Alignment.center;
        this.cachedRuntimeAlignment = alignment;
        return alignment;
    };
    return Layout;
}());

// Runtime singleton; use getInstance to provide a callback that returns the
// Rive runtime
var RuntimeLoader = /** @class */ (function () {
    // Class is never instantiated
    function RuntimeLoader() {
    }
    // Loads the runtime
    RuntimeLoader.loadRuntime = function () {
        _rive_advanced_mjs__WEBPACK_IMPORTED_MODULE_0__["default"]({
            // Loads Wasm bundle
            locateFile: function () { return RuntimeLoader.wasmURL; },
        })
            .then(function (rive) {
            var _a;
            RuntimeLoader.runtime = rive;
            // Fire all the callbacks
            while (RuntimeLoader.callBackQueue.length > 0) {
                (_a = RuntimeLoader.callBackQueue.shift()) === null || _a === void 0 ? void 0 : _a(RuntimeLoader.runtime);
            }
        })
            .catch(function (error) {
            // Capture specific error details
            var errorDetails = {
                message: (error === null || error === void 0 ? void 0 : error.message) || "Unknown error",
                type: (error === null || error === void 0 ? void 0 : error.name) || "Error",
                // Some browsers may provide additional WebAssembly-specific details
                wasmError: error instanceof WebAssembly.CompileError ||
                    error instanceof WebAssembly.RuntimeError,
                originalError: error,
            };
            // Log detailed error for debugging
            console.debug("Rive WASM load error details:", errorDetails);
            // In case unpkg fails, or the wasm was not supported, we try to load the fallback module from jsdelivr.
            // This `rive_fallback.wasm` is compiled to support older architecture.
            // TODO: (Gordon): preemptively test browser support and load the correct wasm file. Then use jsdelvr only if unpkg fails.
            var backupJsdelivrUrl = "https://cdn.jsdelivr.net/npm/".concat(package_json__WEBPACK_IMPORTED_MODULE_1__.name, "@").concat(package_json__WEBPACK_IMPORTED_MODULE_1__.version, "/rive_fallback.wasm");
            if (RuntimeLoader.wasmURL.toLowerCase() !== backupJsdelivrUrl) {
                console.warn("Failed to load WASM from ".concat(RuntimeLoader.wasmURL, " (").concat(errorDetails.message, "), trying jsdelivr as a backup"));
                RuntimeLoader.setWasmUrl(backupJsdelivrUrl);
                RuntimeLoader.loadRuntime();
            }
            else {
                var errorMessage = [
                    "Could not load Rive WASM file from ".concat(RuntimeLoader.wasmURL, " or ").concat(backupJsdelivrUrl, "."),
                    "Possible reasons:",
                    "- Network connection is down",
                    "- WebAssembly is not supported in this environment",
                    "- The WASM file is corrupted or incompatible",
                    "\nError details:",
                    "- Type: ".concat(errorDetails.type),
                    "- Message: ".concat(errorDetails.message),
                    "- WebAssembly-specific error: ".concat(errorDetails.wasmError),
                    "\nTo resolve, you may need to:",
                    "1. Check your network connection",
                    "2. Set a new WASM source via RuntimeLoader.setWasmUrl()",
                    "3. Call RuntimeLoader.loadRuntime() again",
                ].join("\n");
                console.error(errorMessage);
            }
        });
    };
    // Provides a runtime instance via a callback
    RuntimeLoader.getInstance = function (callback) {
        // If it's not loading, start loading runtime
        if (!RuntimeLoader.isLoading) {
            RuntimeLoader.isLoading = true;
            RuntimeLoader.loadRuntime();
        }
        if (!RuntimeLoader.runtime) {
            RuntimeLoader.callBackQueue.push(callback);
        }
        else {
            callback(RuntimeLoader.runtime);
        }
    };
    // Provides a runtime instance via a promise
    RuntimeLoader.awaitInstance = function () {
        return new Promise(function (resolve) {
            return RuntimeLoader.getInstance(function (rive) { return resolve(rive); });
        });
    };
    // Manually sets the wasm url
    RuntimeLoader.setWasmUrl = function (url) {
        RuntimeLoader.wasmURL = url;
    };
    // Gets the current wasm url
    RuntimeLoader.getWasmUrl = function () {
        return RuntimeLoader.wasmURL;
    };
    // Flag to indicate that loading has started/completed
    RuntimeLoader.isLoading = false;
    // List of callbacks for the runtime that come in while loading
    RuntimeLoader.callBackQueue = [];
    // Path to the Wasm file; default path works for testing only;
    // if embedded wasm is used then this is never used.
    RuntimeLoader.wasmURL = "https://unpkg.com/".concat(package_json__WEBPACK_IMPORTED_MODULE_1__.name, "@").concat(package_json__WEBPACK_IMPORTED_MODULE_1__.version, "/rive.wasm");
    return RuntimeLoader;
}());

// #endregion
// #region state machines
var StateMachineInputType;
(function (StateMachineInputType) {
    StateMachineInputType[StateMachineInputType["Number"] = 56] = "Number";
    StateMachineInputType[StateMachineInputType["Trigger"] = 58] = "Trigger";
    StateMachineInputType[StateMachineInputType["Boolean"] = 59] = "Boolean";
})(StateMachineInputType || (StateMachineInputType = {}));
/**
 * An input for a state machine
 */
var StateMachineInput = /** @class */ (function () {
    function StateMachineInput(type, runtimeInput) {
        this.type = type;
        this.runtimeInput = runtimeInput;
    }
    Object.defineProperty(StateMachineInput.prototype, "name", {
        /**
         * Returns the name of the input
         */
        get: function () {
            return this.runtimeInput.name;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(StateMachineInput.prototype, "value", {
        /**
         * Returns the current value of the input
         */
        get: function () {
            return this.runtimeInput.value;
        },
        /**
         * Sets the value of the input
         */
        set: function (value) {
            this.runtimeInput.value = value;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Fires a trigger; does nothing on Number or Boolean input types
     */
    StateMachineInput.prototype.fire = function () {
        if (this.type === StateMachineInputType.Trigger) {
            this.runtimeInput.fire();
        }
    };
    /**
     * Deletes the input
     */
    StateMachineInput.prototype.delete = function () {
        this.runtimeInput = null;
    };
    return StateMachineInput;
}());

var RiveEventType;
(function (RiveEventType) {
    RiveEventType[RiveEventType["General"] = 128] = "General";
    RiveEventType[RiveEventType["OpenUrl"] = 131] = "OpenUrl";
})(RiveEventType || (RiveEventType = {}));
var StateMachine = /** @class */ (function () {
    /**
     * @constructor
     * @param stateMachine runtime state machine object
     * @param instance runtime state machine instance object
     */
    function StateMachine(stateMachine, runtime, playing, artboard) {
        this.stateMachine = stateMachine;
        this.playing = playing;
        this.artboard = artboard;
        /**
         * Caches the inputs from the runtime
         */
        this.inputs = [];
        this.instance = new runtime.StateMachineInstance(stateMachine, artboard);
        this.initInputs(runtime);
    }
    Object.defineProperty(StateMachine.prototype, "name", {
        get: function () {
            return this.stateMachine.name;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(StateMachine.prototype, "statesChanged", {
        /**
         * Returns a list of state names that have changed on this frame
         */
        get: function () {
            var names = [];
            for (var i = 0; i < this.instance.stateChangedCount(); i++) {
                names.push(this.instance.stateChangedNameByIndex(i));
            }
            return names;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Advances the state machine instance by a given time.
     * @param time - the time to advance the animation by in seconds
     */
    StateMachine.prototype.advance = function (time) {
        this.instance.advance(time);
    };
    /**
     * Advances the state machine instance by a given time and apply changes to artboard.
     * @param time - the time to advance the animation by in seconds
     */
    StateMachine.prototype.advanceAndApply = function (time) {
        this.instance.advanceAndApply(time);
    };
    /**
     * Returns the number of events reported from the last advance call
     * @returns Number of events reported
     */
    StateMachine.prototype.reportedEventCount = function () {
        return this.instance.reportedEventCount();
    };
    /**
     * Returns a RiveEvent object emitted from the last advance call at the given index
     * of a list of potentially multiple events. If an event at the index is not found,
     * undefined is returned.
     * @param i index of the event reported in a list of potentially multiple events
     * @returns RiveEvent or extended RiveEvent object returned, or undefined
     */
    StateMachine.prototype.reportedEventAt = function (i) {
        return this.instance.reportedEventAt(i);
    };
    /**
     * Fetches references to the state machine's inputs and caches them
     * @param runtime an instance of the runtime; needed for the SMIInput types
     */
    StateMachine.prototype.initInputs = function (runtime) {
        // Fetch the inputs from the runtime if we don't have them
        for (var i = 0; i < this.instance.inputCount(); i++) {
            var input = this.instance.input(i);
            this.inputs.push(this.mapRuntimeInput(input, runtime));
        }
    };
    /**
     * Maps a runtime input to it's appropriate type
     * @param input
     */
    StateMachine.prototype.mapRuntimeInput = function (input, runtime) {
        if (input.type === runtime.SMIInput.bool) {
            return new StateMachineInput(StateMachineInputType.Boolean, input.asBool());
        }
        else if (input.type === runtime.SMIInput.number) {
            return new StateMachineInput(StateMachineInputType.Number, input.asNumber());
        }
        else if (input.type === runtime.SMIInput.trigger) {
            return new StateMachineInput(StateMachineInputType.Trigger, input.asTrigger());
        }
    };
    /**
     * Deletes the backing Wasm state machine instance; once this is called, this
     * state machine is no more.
     */
    StateMachine.prototype.cleanup = function () {
        this.inputs.forEach(function (input) {
            input.delete();
        });
        this.inputs.length = 0;
        this.instance.delete();
    };
    StateMachine.prototype.bindViewModelInstance = function (viewModelInstance) {
        if (viewModelInstance.runtimeInstance != null) {
            this.instance.bindViewModelInstance(viewModelInstance.runtimeInstance);
        }
    };
    return StateMachine;
}());
// #endregion
// #region animator
/**
 * Manages animation
 */
var Animator = /** @class */ (function () {
    /**
     * Constructs a new animator
     * @constructor
     * @param runtime Rive runtime; needed to instance animations & state machines
     * @param artboard the artboard that holds all animations and state machines
     * @param animations optional list of animations
     * @param stateMachines optional list of state machines
     */
    function Animator(runtime, artboard, eventManager, animations, stateMachines) {
        if (animations === void 0) { animations = []; }
        if (stateMachines === void 0) { stateMachines = []; }
        this.runtime = runtime;
        this.artboard = artboard;
        this.eventManager = eventManager;
        this.animations = animations;
        this.stateMachines = stateMachines;
    }
    /**
     * Adds animations and state machines by their names. If names are shared
     * between animations & state machines, then the first one found will be
     * created. Best not to use the same names for these in your Rive file.
     * @param animatable the name(s) of animations and state machines to add
     * @returns a list of names of the playing animations and state machines
     */
    Animator.prototype.add = function (animatables, playing, fireEvent) {
        if (fireEvent === void 0) { fireEvent = true; }
        animatables = mapToStringArray(animatables);
        // If animatables is empty, play or pause everything
        if (animatables.length === 0) {
            this.animations.forEach(function (a) { return (a.playing = playing); });
            this.stateMachines.forEach(function (m) { return (m.playing = playing); });
        }
        else {
            // Play/pause already instanced items, or create new instances
            var instancedAnimationNames = this.animations.map(function (a) { return a.name; });
            var instancedMachineNames = this.stateMachines.map(function (m) { return m.name; });
            for (var i = 0; i < animatables.length; i++) {
                var aIndex = instancedAnimationNames.indexOf(animatables[i]);
                var mIndex = instancedMachineNames.indexOf(animatables[i]);
                if (aIndex >= 0 || mIndex >= 0) {
                    if (aIndex >= 0) {
                        // Animation is instanced, play/pause it
                        this.animations[aIndex].playing = playing;
                    }
                    else {
                        // State machine is instanced, play/pause it
                        this.stateMachines[mIndex].playing = playing;
                    }
                }
                else {
                    // Try to create a new animation instance
                    var anim = this.artboard.animationByName(animatables[i]);
                    if (anim) {
                        var newAnimation = new _animation__WEBPACK_IMPORTED_MODULE_2__.Animation(anim, this.artboard, this.runtime, playing);
                        // Display the first frame of the specified animation
                        newAnimation.advance(0);
                        newAnimation.apply(1.0);
                        this.animations.push(newAnimation);
                    }
                    else {
                        // Try to create a new state machine instance
                        var sm = this.artboard.stateMachineByName(animatables[i]);
                        if (sm) {
                            var newStateMachine = new StateMachine(sm, this.runtime, playing, this.artboard);
                            this.stateMachines.push(newStateMachine);
                        }
                    }
                }
            }
        }
        // Fire play/paused events for animations
        if (fireEvent) {
            if (playing) {
                this.eventManager.fire({
                    type: EventType.Play,
                    data: this.playing,
                });
            }
            else {
                this.eventManager.fire({
                    type: EventType.Pause,
                    data: this.paused,
                });
            }
        }
        return playing ? this.playing : this.paused;
    };
    /**
     * Adds linear animations by their names.
     * @param animatables the name(s) of animations to add
     * @param playing whether animations should play on instantiation
     */
    Animator.prototype.initLinearAnimations = function (animatables, playing) {
        // Play/pause already instanced items, or create new instances
        // This validation is kept to maintain compatibility with current behavior.
        // But given that it this is called during artboard initialization
        // it should probably be safe to remove.
        var instancedAnimationNames = this.animations.map(function (a) { return a.name; });
        for (var i = 0; i < animatables.length; i++) {
            var aIndex = instancedAnimationNames.indexOf(animatables[i]);
            if (aIndex >= 0) {
                this.animations[aIndex].playing = playing;
            }
            else {
                // Try to create a new animation instance
                var anim = this.artboard.animationByName(animatables[i]);
                if (anim) {
                    var newAnimation = new _animation__WEBPACK_IMPORTED_MODULE_2__.Animation(anim, this.artboard, this.runtime, playing);
                    // Display the first frame of the specified animation
                    newAnimation.advance(0);
                    newAnimation.apply(1.0);
                    this.animations.push(newAnimation);
                }
                else {
                    console.error("Animation with name ".concat(animatables[i], " not found."));
                }
            }
        }
    };
    /**
     * Adds state machines by their names.
     * @param animatables the name(s) of state machines to add
     * @param playing whether state machines should play on instantiation
     */
    Animator.prototype.initStateMachines = function (animatables, playing) {
        // Play/pause already instanced items, or create new instances
        // This validation is kept to maintain compatibility with current behavior.
        // But given that it this is called during artboard initialization
        // it should probably be safe to remove.
        var instancedStateMachineNames = this.stateMachines.map(function (a) { return a.name; });
        for (var i = 0; i < animatables.length; i++) {
            var aIndex = instancedStateMachineNames.indexOf(animatables[i]);
            if (aIndex >= 0) {
                this.stateMachines[aIndex].playing = playing;
            }
            else {
                // Try to create a new state machine instance
                var sm = this.artboard.stateMachineByName(animatables[i]);
                if (sm) {
                    var newStateMachine = new StateMachine(sm, this.runtime, playing, this.artboard);
                    this.stateMachines.push(newStateMachine);
                    if (!playing) {
                        newStateMachine.advanceAndApply(0);
                    }
                }
                else {
                    console.warn("State Machine with name ".concat(animatables[i], " not found."));
                    // In order to maintain compatibility with current behavior, if a state machine is not found
                    // we look for an animation with the same name
                    this.initLinearAnimations([animatables[i]], playing);
                }
            }
        }
    };
    /**
     * Play the named animations/state machines
     * @param animatables the names of the animations/machines to play; plays all if empty
     * @returns a list of the playing items
     */
    Animator.prototype.play = function (animatables) {
        return this.add(animatables, true);
    };
    /**
     * Pauses named animations and state machines, or everything if nothing is
     * specified
     * @param animatables names of the animations and state machines to pause
     * @returns a list of names of the animations and state machines paused
     */
    Animator.prototype.pause = function (animatables) {
        return this.add(animatables, false);
    };
    /**
     * Set time of named animations
     * @param animations names of the animations to scrub
     * @param value time scrub value, a floating point number to which the playhead is jumped
     * @returns a list of names of the animations that were scrubbed
     */
    Animator.prototype.scrub = function (animatables, value) {
        var forScrubbing = this.animations.filter(function (a) {
            return animatables.includes(a.name);
        });
        forScrubbing.forEach(function (a) { return (a.scrubTo = value); });
        return forScrubbing.map(function (a) { return a.name; });
    };
    Object.defineProperty(Animator.prototype, "playing", {
        /**
         * Returns a list of names of all animations and state machines currently
         * playing
         */
        get: function () {
            return this.animations
                .filter(function (a) { return a.playing; })
                .map(function (a) { return a.name; })
                .concat(this.stateMachines.filter(function (m) { return m.playing; }).map(function (m) { return m.name; }));
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Animator.prototype, "paused", {
        /**
         * Returns a list of names of all animations and state machines currently
         * paused
         */
        get: function () {
            return this.animations
                .filter(function (a) { return !a.playing; })
                .map(function (a) { return a.name; })
                .concat(this.stateMachines.filter(function (m) { return !m.playing; }).map(function (m) { return m.name; }));
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Stops and removes all named animations and state machines
     * @param animatables animations and state machines to remove
     * @returns a list of names of removed items
     */
    Animator.prototype.stop = function (animatables) {
        var _this = this;
        animatables = mapToStringArray(animatables);
        // If nothing's specified, wipe them out, all of them
        var removedNames = [];
        // Stop everything
        if (animatables.length === 0) {
            removedNames = this.animations
                .map(function (a) { return a.name; })
                .concat(this.stateMachines.map(function (m) { return m.name; }));
            // Clean up before emptying the arrays
            this.animations.forEach(function (a) { return a.cleanup(); });
            this.stateMachines.forEach(function (m) { return m.cleanup(); });
            // Empty out the arrays
            this.animations.splice(0, this.animations.length);
            this.stateMachines.splice(0, this.stateMachines.length);
        }
        else {
            // Remove only the named animations/state machines
            var animationsToRemove = this.animations.filter(function (a) {
                return animatables.includes(a.name);
            });
            animationsToRemove.forEach(function (a) {
                a.cleanup();
                _this.animations.splice(_this.animations.indexOf(a), 1);
            });
            var machinesToRemove = this.stateMachines.filter(function (m) {
                return animatables.includes(m.name);
            });
            machinesToRemove.forEach(function (m) {
                m.cleanup();
                _this.stateMachines.splice(_this.stateMachines.indexOf(m), 1);
            });
            removedNames = animationsToRemove
                .map(function (a) { return a.name; })
                .concat(machinesToRemove.map(function (m) { return m.name; }));
        }
        this.eventManager.fire({
            type: EventType.Stop,
            data: removedNames,
        });
        // Return the list of animations removed
        return removedNames;
    };
    Object.defineProperty(Animator.prototype, "isPlaying", {
        /**
         * Returns true if at least one animation is active
         */
        get: function () {
            return (this.animations.reduce(function (acc, curr) { return acc || curr.playing; }, false) ||
                this.stateMachines.reduce(function (acc, curr) { return acc || curr.playing; }, false));
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Animator.prototype, "isPaused", {
        /**
         * Returns true if all animations are paused and there's at least one animation
         */
        get: function () {
            return (!this.isPlaying &&
                (this.animations.length > 0 || this.stateMachines.length > 0));
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Animator.prototype, "isStopped", {
        /**
         * Returns true if there are no playing or paused animations/state machines
         */
        get: function () {
            return this.animations.length === 0 && this.stateMachines.length === 0;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * If there are no animations or state machines, add the first one found
     * @returns the name of the animation or state machine instanced
     */
    Animator.prototype.atLeastOne = function (playing, fireEvent) {
        if (fireEvent === void 0) { fireEvent = true; }
        var instancedName;
        if (this.animations.length === 0 && this.stateMachines.length === 0) {
            if (this.artboard.animationCount() > 0) {
                // Add the first animation
                this.add([(instancedName = this.artboard.animationByIndex(0).name)], playing, fireEvent);
            }
            else if (this.artboard.stateMachineCount() > 0) {
                // Add the first state machine
                this.add([(instancedName = this.artboard.stateMachineByIndex(0).name)], playing, fireEvent);
            }
        }
        return instancedName;
    };
    /**
     * Checks if any animations have looped and if so, fire the appropriate event
     */
    Animator.prototype.handleLooping = function () {
        for (var _i = 0, _a = this.animations.filter(function (a) { return a.playing; }); _i < _a.length; _i++) {
            var animation = _a[_i];
            // Emit if the animation looped
            if (animation.loopValue === 0 && animation.loopCount) {
                animation.loopCount = 0;
                // This is a one-shot; if it has ended, delete the instance
                this.stop(animation.name);
            }
            else if (animation.loopValue === 1 && animation.loopCount) {
                this.eventManager.fire({
                    type: EventType.Loop,
                    data: { animation: animation.name, type: LoopType.Loop },
                });
                animation.loopCount = 0;
            }
            // Wasm indicates a loop at each time the animation
            // changes direction, so a full loop/lap occurs every
            // two loop counts
            else if (animation.loopValue === 2 && animation.loopCount > 1) {
                this.eventManager.fire({
                    type: EventType.Loop,
                    data: { animation: animation.name, type: LoopType.PingPong },
                });
                animation.loopCount = 0;
            }
        }
    };
    /**
     * Checks if states have changed in state machines and fires a statechange
     * event
     */
    Animator.prototype.handleStateChanges = function () {
        var statesChanged = [];
        for (var _i = 0, _a = this.stateMachines.filter(function (sm) { return sm.playing; }); _i < _a.length; _i++) {
            var stateMachine = _a[_i];
            statesChanged.push.apply(statesChanged, stateMachine.statesChanged);
        }
        if (statesChanged.length > 0) {
            this.eventManager.fire({
                type: EventType.StateChange,
                data: statesChanged,
            });
        }
    };
    Animator.prototype.handleAdvancing = function (time) {
        this.eventManager.fire({
            type: EventType.Advance,
            data: time,
        });
    };
    return Animator;
}());
// #endregion
// #region events
/**
 * Supported event types triggered in Rive
 */
var EventType;
(function (EventType) {
    EventType["Load"] = "load";
    EventType["LoadError"] = "loaderror";
    EventType["Play"] = "play";
    EventType["Pause"] = "pause";
    EventType["Stop"] = "stop";
    EventType["Loop"] = "loop";
    EventType["Draw"] = "draw";
    EventType["Advance"] = "advance";
    EventType["StateChange"] = "statechange";
    EventType["RiveEvent"] = "riveevent";
    EventType["AudioStatusChange"] = "audiostatuschange";
})(EventType || (EventType = {}));
/**
 * Looping types: one-shot, loop, and ping-pong
 */
var LoopType;
(function (LoopType) {
    LoopType["OneShot"] = "oneshot";
    LoopType["Loop"] = "loop";
    LoopType["PingPong"] = "pingpong";
})(LoopType || (LoopType = {}));
// Manages Rive events and listeners
var EventManager = /** @class */ (function () {
    function EventManager(listeners) {
        if (listeners === void 0) { listeners = []; }
        this.listeners = listeners;
    }
    // Gets listeners of specified type
    EventManager.prototype.getListeners = function (type) {
        return this.listeners.filter(function (e) { return e.type === type; });
    };
    // Adds a listener
    EventManager.prototype.add = function (listener) {
        if (!this.listeners.includes(listener)) {
            this.listeners.push(listener);
        }
    };
    /**
     * Removes a listener
     * @param listener the listener with the callback to be removed
     */
    EventManager.prototype.remove = function (listener) {
        // We can't simply look for the listener as it'll be a different instance to
        // one originally subscribed. Find all the listeners of the right type and
        // then check their callbacks which should match.
        for (var i = 0; i < this.listeners.length; i++) {
            var currentListener = this.listeners[i];
            if (currentListener.type === listener.type) {
                if (currentListener.callback === listener.callback) {
                    this.listeners.splice(i, 1);
                    break;
                }
            }
        }
    };
    /**
     * Clears all listeners of specified type, or every listener if no type is
     * specified
     * @param type the type of listeners to clear, or all listeners if not
     * specified
     */
    EventManager.prototype.removeAll = function (type) {
        var _this = this;
        if (!type) {
            this.listeners.splice(0, this.listeners.length);
        }
        else {
            this.listeners
                .filter(function (l) { return l.type === type; })
                .forEach(function (l) { return _this.remove(l); });
        }
    };
    // Fires an event
    EventManager.prototype.fire = function (event) {
        var eventListeners = this.getListeners(event.type);
        eventListeners.forEach(function (listener) { return listener.callback(event); });
    };
    return EventManager;
}());
// Manages a queue of tasks
var TaskQueueManager = /** @class */ (function () {
    function TaskQueueManager(eventManager) {
        this.eventManager = eventManager;
        this.queue = [];
    }
    // Adds a task top the queue
    TaskQueueManager.prototype.add = function (task) {
        this.queue.push(task);
    };
    // Processes all tasks in the queue
    TaskQueueManager.prototype.process = function () {
        while (this.queue.length > 0) {
            var task = this.queue.shift();
            if (task === null || task === void 0 ? void 0 : task.action) {
                task.action();
            }
            if (task === null || task === void 0 ? void 0 : task.event) {
                this.eventManager.fire(task.event);
            }
        }
    };
    return TaskQueueManager;
}());
// #endregion
// #region Audio
var SystemAudioStatus;
(function (SystemAudioStatus) {
    SystemAudioStatus[SystemAudioStatus["AVAILABLE"] = 0] = "AVAILABLE";
    SystemAudioStatus[SystemAudioStatus["UNAVAILABLE"] = 1] = "UNAVAILABLE";
})(SystemAudioStatus || (SystemAudioStatus = {}));
// Class to handle audio context availability and status changes
var AudioManager = /** @class */ (function (_super) {
    __extends(AudioManager, _super);
    function AudioManager() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this._started = false;
        _this._enabled = false;
        _this._status = SystemAudioStatus.UNAVAILABLE;
        return _this;
    }
    AudioManager.prototype.delay = function (time) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) { return setTimeout(resolve, time); })];
            });
        });
    };
    AudioManager.prototype.timeout = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (_, reject) { return setTimeout(reject, 50); })];
            });
        });
    };
    // Alerts animations on status changes and removes the listeners to avoid alerting twice.
    AudioManager.prototype.reportToListeners = function () {
        this.fire({ type: EventType.AudioStatusChange });
        this.removeAll();
    };
    /**
     * The audio context has been resolved.
     * Alert any listeners that we can now play audio.
     * Rive will now play audio at the configured volume.
     */
    AudioManager.prototype.enableAudio = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (!this._enabled) {
                    this._enabled = true;
                    this._status = SystemAudioStatus.AVAILABLE;
                    this.reportToListeners();
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Check if we are able to play audio.
     *
     * We currently check the audio context, when resume() returns before a timeout we know that the
     * audio context is running and we can enable audio.
     */
    AudioManager.prototype.testAudio = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!(this._status === SystemAudioStatus.UNAVAILABLE &&
                            this._audioContext !== null)) return [3 /*break*/, 4];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, Promise.race([this._audioContext.resume(), this.timeout()])];
                    case 2:
                        _b.sent();
                        this.enableAudio();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Establish audio for use with rive.
     * We both test if we can use audio intermittently and listen for user interaction.
     * The aim is to enable audio playback as soon as the browser allows this.
     */
    AudioManager.prototype._establishAudio = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!!this._started) return [3 /*break*/, 5];
                        this._started = true;
                        if (!(typeof window == "undefined")) return [3 /*break*/, 1];
                        this.enableAudio();
                        return [3 /*break*/, 5];
                    case 1:
                        this._audioContext = new AudioContext();
                        this.listenForUserAction();
                        _a.label = 2;
                    case 2:
                        if (!(this._status === SystemAudioStatus.UNAVAILABLE)) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.testAudio()];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, this.delay(1000)];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 2];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    AudioManager.prototype.listenForUserAction = function () {
        var _this = this;
        // NOTE: AudioContexts are ready immediately if requested in a ui callback
        // we *could* re request one in this listener.
        var _clickListener = function () { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // note this has "better" results than calling `await this.testAudio()`
                // as we force audio to be enabled in the current thread, rather than chancing
                // the thread to be passed over for some other async context
                this.enableAudio();
                return [2 /*return*/];
            });
        }); };
        // NOTE: we should test this on mobile/pads
        document.addEventListener("pointerdown", _clickListener, {
            once: true,
        });
    };
    /**
     * Establish the audio context for rive, this lets rive know that we can play audio.
     */
    AudioManager.prototype.establishAudio = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                this._establishAudio();
                return [2 /*return*/];
            });
        });
    };
    Object.defineProperty(AudioManager.prototype, "systemVolume", {
        get: function () {
            if (this._status === SystemAudioStatus.UNAVAILABLE) {
                // We do an immediate test to avoid depending on the delay of the running test
                this.testAudio();
                return 0;
            }
            return 1;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(AudioManager.prototype, "status", {
        get: function () {
            return this._status;
        },
        enumerable: false,
        configurable: true
    });
    return AudioManager;
}(EventManager));
var audioManager = new AudioManager();
var FakeResizeObserver = /** @class */ (function () {
    function FakeResizeObserver() {
    }
    FakeResizeObserver.prototype.observe = function () { };
    FakeResizeObserver.prototype.unobserve = function () { };
    FakeResizeObserver.prototype.disconnect = function () { };
    return FakeResizeObserver;
}());
var MyResizeObserver = globalThis.ResizeObserver || FakeResizeObserver;
/**
 * This class takes care of any observers that will be attached to an animation.
 * It should be treated as a singleton because observers are much more performant
 * when used for observing multiple elements by a single instance.
 */
var ObjectObservers = /** @class */ (function () {
    function ObjectObservers() {
        var _this = this;
        this._elementsMap = new Map();
        /**
         * Resize observers trigger both when the element changes its size and also when the
         * element is added or removed from the document.
         */
        this._onObservedEntry = function (entry) {
            var observed = _this._elementsMap.get(entry.target);
            if (observed !== null) {
                observed.onResize(entry.target.clientWidth == 0 || entry.target.clientHeight == 0);
            }
            else {
                _this._resizeObserver.unobserve(entry.target);
            }
        };
        this._onObserved = function (entries) {
            entries.forEach(_this._onObservedEntry);
        };
        this._resizeObserver = new MyResizeObserver(this._onObserved);
    }
    // Adds an observable element
    ObjectObservers.prototype.add = function (element, onResize) {
        var observed = {
            onResize: onResize,
            element: element,
        };
        this._elementsMap.set(element, observed);
        this._resizeObserver.observe(element);
        return observed;
    };
    // Removes an observable element
    ObjectObservers.prototype.remove = function (observed) {
        this._resizeObserver.unobserve(observed.element);
        this._elementsMap.delete(observed.element);
    };
    return ObjectObservers;
}());
var observers = new ObjectObservers();
var RiveFile = /** @class */ (function () {
    function RiveFile(params) {
        // Allow the runtime to automatically load assets hosted in Rive's runtime.
        this.enableRiveAssetCDN = true;
        this.referenceCount = 0;
        this.destroyed = false;
        this.src = params.src;
        this.buffer = params.buffer;
        if (params.assetLoader)
            this.assetLoader = params.assetLoader;
        this.enableRiveAssetCDN =
            typeof params.enableRiveAssetCDN == "boolean"
                ? params.enableRiveAssetCDN
                : true;
        // New event management system
        this.eventManager = new EventManager();
        if (params.onLoad)
            this.on(EventType.Load, params.onLoad);
        if (params.onLoadError)
            this.on(EventType.LoadError, params.onLoadError);
    }
    RiveFile.prototype.initData = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, loader, _b;
            var _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (!this.src) return [3 /*break*/, 2];
                        _a = this;
                        return [4 /*yield*/, loadRiveFile(this.src)];
                    case 1:
                        _a.buffer = _d.sent();
                        _d.label = 2;
                    case 2:
                        if (this.destroyed) {
                            return [2 /*return*/];
                        }
                        if (this.assetLoader) {
                            loader = new this.runtime.CustomFileAssetLoader({
                                loadContents: this.assetLoader,
                            });
                        }
                        // Load the Rive file
                        _b = this;
                        return [4 /*yield*/, this.runtime.load(new Uint8Array(this.buffer), loader, this.enableRiveAssetCDN)];
                    case 3:
                        // Load the Rive file
                        _b.file = _d.sent();
                        if (this.destroyed) {
                            (_c = this.file) === null || _c === void 0 ? void 0 : _c.delete();
                            this.file = null;
                            return [2 /*return*/];
                        }
                        if (this.file !== null) {
                            this.eventManager.fire({
                                type: EventType.Load,
                                data: this,
                            });
                        }
                        else {
                            this.eventManager.fire({
                                type: EventType.LoadError,
                                data: null,
                            });
                            throw new Error(RiveFile.fileLoadErrorMessage);
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    RiveFile.prototype.init = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        // If no source file url specified, it's a bust
                        if (!this.src && !this.buffer) {
                            throw new Error(RiveFile.missingErrorMessage);
                        }
                        _a = this;
                        return [4 /*yield*/, RuntimeLoader.awaitInstance()];
                    case 1:
                        _a.runtime = _b.sent();
                        if (this.destroyed) {
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, this.initData()];
                    case 2:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Subscribe to Rive-generated events
     * @param type the type of event to subscribe to
     * @param callback callback to fire when the event occurs
     */
    RiveFile.prototype.on = function (type, callback) {
        this.eventManager.add({
            type: type,
            callback: callback,
        });
    };
    /**
     * Unsubscribes from a Rive-generated event
     * @param type the type of event to unsubscribe from
     * @param callback the callback to unsubscribe
     */
    RiveFile.prototype.off = function (type, callback) {
        this.eventManager.remove({
            type: type,
            callback: callback,
        });
    };
    RiveFile.prototype.cleanup = function () {
        var _a;
        this.referenceCount -= 1;
        if (this.referenceCount <= 0) {
            this.removeAllRiveEventListeners();
            (_a = this.file) === null || _a === void 0 ? void 0 : _a.delete();
            this.file = null;
            this.destroyed = true;
        }
    };
    /**
     * Unsubscribes all Rive listeners from an event type, or everything if no type is
     * given
     * @param type the type of event to unsubscribe from, or all types if
     * undefined
     */
    RiveFile.prototype.removeAllRiveEventListeners = function (type) {
        this.eventManager.removeAll(type);
    };
    RiveFile.prototype.getInstance = function () {
        if (this.file !== null) {
            this.referenceCount += 1;
            return this.file;
        }
    };
    // Error message for missing source or buffer
    RiveFile.missingErrorMessage = "Rive source file or data buffer required";
    // Error message for file load error
    RiveFile.fileLoadErrorMessage = "The file failed to load";
    return RiveFile;
}());

var Rive = /** @class */ (function () {
    function Rive(params) {
        var _this = this;
        var _a;
        // Tracks if a Rive file is loaded
        this.loaded = false;
        // Tracks if a Rive file is destroyed
        this.destroyed = false;
        // Reference of an object that handles any observers for the animation
        this._observed = null;
        /**
         * Tracks if a Rive file is loaded; we need this in addition to loaded as some
         * commands (e.g. contents) can be called as soon as the file is loaded.
         * However, playback commands need to be queued and run in order once initial
         * animations and autoplay has been sorted out. This applies to play, pause,
         * and start.
         */
        this.readyForPlaying = false;
        // Runtime artboard
        this.artboard = null;
        // place to clear up event listeners
        this.eventCleanup = null;
        this.shouldDisableRiveListeners = false;
        this.automaticallyHandleEvents = false;
        // Allow the runtime to automatically load assets hosted in Rive's runtime.
        this.enableRiveAssetCDN = true;
        // Keep a local value of the set volume to update it asynchronously
        this._volume = 1;
        // Keep a local value of the set width to update it asynchronously
        this._artboardWidth = undefined;
        // Keep a local value of the set height to update it asynchronously
        this._artboardHeight = undefined;
        // Keep a local value of the device pixel ratio used in rendering and canvas/artboard resizing
        this._devicePixelRatioUsed = 1;
        // Whether the canvas element's size is 0
        this._hasZeroSize = false;
        // Audio event listener
        this._audioEventListener = null;
        // draw method bound to the class
        this._boundDraw = null;
        this._viewModelInstance = null;
        this._dataEnums = null;
        // Durations to generate a frame for the last second. Used for performance profiling.
        this.durations = [];
        this.frameTimes = [];
        this.frameCount = 0;
        this.isTouchScrollEnabled = false;
        this.onCanvasResize = function (hasZeroSize) {
            var toggledDisplay = _this._hasZeroSize !== hasZeroSize;
            _this._hasZeroSize = hasZeroSize;
            if (!hasZeroSize) {
                if (toggledDisplay) {
                    _this.resizeDrawingSurfaceToCanvas();
                }
            }
            else if (!_this._layout.maxX || !_this._layout.maxY) {
                _this.resizeToCanvas();
            }
        };
        /**
         * Used be draw to track when a second of active rendering time has passed.
         * Used for debugging purposes
         */
        this.renderSecondTimer = 0;
        this._boundDraw = this.draw.bind(this);
        this.canvas = params.canvas;
        if (params.canvas.constructor === HTMLCanvasElement) {
            this._observed = observers.add(this.canvas, this.onCanvasResize);
        }
        this.src = params.src;
        this.buffer = params.buffer;
        this.riveFile = params.riveFile;
        this.layout = (_a = params.layout) !== null && _a !== void 0 ? _a : new Layout();
        this.shouldDisableRiveListeners = !!params.shouldDisableRiveListeners;
        this.isTouchScrollEnabled = !!params.isTouchScrollEnabled;
        this.automaticallyHandleEvents = !!params.automaticallyHandleEvents;
        this.enableRiveAssetCDN =
            params.enableRiveAssetCDN === undefined
                ? true
                : params.enableRiveAssetCDN;
        // New event management system
        this.eventManager = new EventManager();
        if (params.onLoad)
            this.on(EventType.Load, params.onLoad);
        if (params.onLoadError)
            this.on(EventType.LoadError, params.onLoadError);
        if (params.onPlay)
            this.on(EventType.Play, params.onPlay);
        if (params.onPause)
            this.on(EventType.Pause, params.onPause);
        if (params.onStop)
            this.on(EventType.Stop, params.onStop);
        if (params.onLoop)
            this.on(EventType.Loop, params.onLoop);
        if (params.onStateChange)
            this.on(EventType.StateChange, params.onStateChange);
        if (params.onAdvance)
            this.on(EventType.Advance, params.onAdvance);
        /**
         * @deprecated Use camelCase'd versions instead.
         */
        if (params.onload && !params.onLoad)
            this.on(EventType.Load, params.onload);
        if (params.onloaderror && !params.onLoadError)
            this.on(EventType.LoadError, params.onloaderror);
        if (params.onplay && !params.onPlay)
            this.on(EventType.Play, params.onplay);
        if (params.onpause && !params.onPause)
            this.on(EventType.Pause, params.onpause);
        if (params.onstop && !params.onStop)
            this.on(EventType.Stop, params.onstop);
        if (params.onloop && !params.onLoop)
            this.on(EventType.Loop, params.onloop);
        if (params.onstatechange && !params.onStateChange)
            this.on(EventType.StateChange, params.onstatechange);
        /**
         * Asset loading
         */
        if (params.assetLoader)
            this.assetLoader = params.assetLoader;
        // Hook up the task queue
        this.taskQueue = new TaskQueueManager(this.eventManager);
        this.init({
            src: this.src,
            buffer: this.buffer,
            riveFile: this.riveFile,
            autoplay: params.autoplay,
            autoBind: params.autoBind,
            animations: params.animations,
            stateMachines: params.stateMachines,
            artboard: params.artboard,
            useOffscreenRenderer: params.useOffscreenRenderer,
        });
    }
    Object.defineProperty(Rive.prototype, "viewModelCount", {
        get: function () {
            return this.file.viewModelCount();
        },
        enumerable: false,
        configurable: true
    });
    // Alternative constructor to build a Rive instance from an interface/object
    Rive.new = function (params) {
        console.warn("This function is deprecated: please use `new Rive({})` instead");
        return new Rive(params);
    };
    // Event handler for when audio context becomes available
    Rive.prototype.onSystemAudioChanged = function () {
        this.volume = this._volume;
    };
    // Initializes the Rive object either from constructor or load()
    Rive.prototype.init = function (_a) {
        var _this = this;
        var src = _a.src, buffer = _a.buffer, riveFile = _a.riveFile, animations = _a.animations, stateMachines = _a.stateMachines, artboard = _a.artboard, _b = _a.autoplay, autoplay = _b === void 0 ? false : _b, _c = _a.useOffscreenRenderer, useOffscreenRenderer = _c === void 0 ? false : _c, _d = _a.autoBind, autoBind = _d === void 0 ? false : _d;
        if (this.destroyed) {
            return;
        }
        this.src = src;
        this.buffer = buffer;
        this.riveFile = riveFile;
        // If no source file url specified, it's a bust
        if (!this.src && !this.buffer && !this.riveFile) {
            throw new RiveError(Rive.missingErrorMessage);
        }
        // List of animations that should be initialized.
        var startingAnimationNames = mapToStringArray(animations);
        // List of state machines that should be initialized
        var startingStateMachineNames = mapToStringArray(stateMachines);
        // Ensure loaded is marked as false if loading new file
        this.loaded = false;
        this.readyForPlaying = false;
        // Ensure the runtime is loaded
        RuntimeLoader.awaitInstance()
            .then(function (runtime) {
            if (_this.destroyed) {
                return;
            }
            _this.runtime = runtime;
            _this.removeRiveListeners();
            _this.deleteRiveRenderer();
            // Get the canvas where you want to render the animation and create a renderer
            _this.renderer = _this.runtime.makeRenderer(_this.canvas, useOffscreenRenderer);
            // Initial size adjustment based on devicePixelRatio if no width/height are
            // specified explicitly
            if (!(_this.canvas.width || _this.canvas.height)) {
                _this.resizeDrawingSurfaceToCanvas();
            }
            // Load Rive data from a source uri or a data buffer
            _this.initData(artboard, startingAnimationNames, startingStateMachineNames, autoplay, autoBind)
                .then(function () { return _this.setupRiveListeners(); })
                .catch(function (e) {
                console.error(e);
            });
        })
            .catch(function (e) {
            console.error(e);
        });
    };
    /**
     * Setup Rive Listeners on the canvas
     * @param riveListenerOptions - Enables TouchEvent events on the canvas. Set to true to allow
     * touch scrolling on the canvas element on touch-enabled devices
     * i.e. { isTouchScrollEnabled: true }
     */
    Rive.prototype.setupRiveListeners = function (riveListenerOptions) {
        var _this = this;
        if (this.eventCleanup) {
            this.eventCleanup();
        }
        if (!this.shouldDisableRiveListeners) {
            var activeStateMachines = (this.animator.stateMachines || [])
                .filter(function (sm) { return sm.playing && _this.runtime.hasListeners(sm.instance); })
                .map(function (sm) { return sm.instance; });
            var touchScrollEnabledOption = this.isTouchScrollEnabled;
            if (riveListenerOptions &&
                "isTouchScrollEnabled" in riveListenerOptions) {
                touchScrollEnabledOption = riveListenerOptions.isTouchScrollEnabled;
            }
            this.eventCleanup = (0,_utils__WEBPACK_IMPORTED_MODULE_3__.registerTouchInteractions)({
                canvas: this.canvas,
                artboard: this.artboard,
                stateMachines: activeStateMachines,
                renderer: this.renderer,
                rive: this.runtime,
                fit: this._layout.runtimeFit(this.runtime),
                alignment: this._layout.runtimeAlignment(this.runtime),
                isTouchScrollEnabled: touchScrollEnabledOption,
                layoutScaleFactor: this._layout.layoutScaleFactor,
            });
        }
    };
    /**
     * Remove Rive Listeners setup on the canvas
     */
    Rive.prototype.removeRiveListeners = function () {
        if (this.eventCleanup) {
            this.eventCleanup();
            this.eventCleanup = null;
        }
    };
    /**
     * If the instance has audio and the system audio is not ready
     * we hook the instance to the audio manager
     */
    Rive.prototype.initializeAudio = function () {
        var _this = this;
        var _a;
        // Initialize audio if needed
        if (audioManager.status == SystemAudioStatus.UNAVAILABLE) {
            if (((_a = this.artboard) === null || _a === void 0 ? void 0 : _a.hasAudio) && this._audioEventListener === null) {
                this._audioEventListener = {
                    type: EventType.AudioStatusChange,
                    callback: function () { return _this.onSystemAudioChanged(); },
                };
                audioManager.add(this._audioEventListener);
                audioManager.establishAudio();
            }
        }
    };
    Rive.prototype.initArtboardSize = function () {
        if (!this.artboard)
            return;
        // Use preset values if they are not undefined
        this._artboardWidth = this.artboard.width =
            this._artboardWidth || this.artboard.width;
        this._artboardHeight = this.artboard.height =
            this._artboardHeight || this.artboard.height;
    };
    // Initializes runtime with Rive data and preps for playing
    Rive.prototype.initData = function (artboardName, animationNames, stateMachineNames, autoplay, autoBind) {
        return __awaiter(this, void 0, void 0, function () {
            var error_1, msg;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 3, , 4]);
                        if (!(this.riveFile == null)) return [3 /*break*/, 2];
                        this.riveFile = new RiveFile({
                            src: this.src,
                            buffer: this.buffer,
                            enableRiveAssetCDN: this.enableRiveAssetCDN,
                            assetLoader: this.assetLoader,
                        });
                        return [4 /*yield*/, this.riveFile.init()];
                    case 1:
                        _b.sent();
                        _b.label = 2;
                    case 2:
                        // Check for riveFile in case it has been cleaned up while initializing;
                        if (!this.riveFile) {
                            throw new RiveError(Rive.cleanupErrorMessage);
                        }
                        this.file = this.riveFile.getInstance();
                        // Initialize and draw frame
                        this.initArtboard(artboardName, animationNames, stateMachineNames, autoplay, autoBind);
                        // Initialize the artboard size
                        this.initArtboardSize();
                        // Check for audio
                        this.initializeAudio();
                        // Everything's set up, emit a load event
                        this.loaded = true;
                        this.eventManager.fire({
                            type: EventType.Load,
                            data: (_a = this.src) !== null && _a !== void 0 ? _a : "buffer",
                        });
                        // Flag ready for playback commands and clear the task queue; this order
                        // is important or it may infinitely recurse
                        this.readyForPlaying = true;
                        this.taskQueue.process();
                        this.drawFrame();
                        return [2 /*return*/, Promise.resolve()];
                    case 3:
                        error_1 = _b.sent();
                        msg = resolveErrorMessage(error_1);
                        console.warn(msg);
                        this.eventManager.fire({ type: EventType.LoadError, data: msg });
                        return [2 /*return*/, Promise.reject(msg)];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    // Initialize for playback
    Rive.prototype.initArtboard = function (artboardName, animationNames, stateMachineNames, autoplay, autoBind) {
        if (!this.file) {
            return;
        }
        // Fetch the artboard
        var rootArtboard = artboardName
            ? this.file.artboardByName(artboardName)
            : this.file.defaultArtboard();
        // Check we have a working artboard
        if (!rootArtboard) {
            var msg = "Invalid artboard name or no default artboard";
            console.warn(msg);
            this.eventManager.fire({ type: EventType.LoadError, data: msg });
            return;
        }
        this.artboard = rootArtboard;
        rootArtboard.volume = this._volume * audioManager.systemVolume;
        // Check that the artboard has at least 1 animation
        if (this.artboard.animationCount() < 1) {
            var msg = "Artboard has no animations";
            this.eventManager.fire({ type: EventType.LoadError, data: msg });
            throw msg;
        }
        // Initialize the animator
        this.animator = new Animator(this.runtime, this.artboard, this.eventManager);
        // Initialize the animations; as loaded hasn't happened yet, we need to
        // suppress firing the play/pause events until the load event has fired. To
        // do this we tell the animator to suppress firing events, and add event
        // firing to the task queue.
        var instanceNames;
        if (animationNames.length > 0 || stateMachineNames.length > 0) {
            instanceNames = animationNames.concat(stateMachineNames);
            this.animator.initLinearAnimations(animationNames, autoplay);
            this.animator.initStateMachines(stateMachineNames, autoplay);
        }
        else {
            instanceNames = [this.animator.atLeastOne(autoplay, false)];
        }
        // Queue up firing the playback events
        this.taskQueue.add({
            event: {
                type: autoplay ? EventType.Play : EventType.Pause,
                data: instanceNames,
            },
        });
        if (autoBind) {
            var viewModel = this.file.defaultArtboardViewModel(rootArtboard);
            if (viewModel !== null) {
                var runtimeInstance = viewModel.defaultInstance();
                if (runtimeInstance !== null) {
                    var viewModelInstance = new ViewModelInstance(runtimeInstance, null);
                    this.bindViewModelInstance(viewModelInstance);
                }
            }
        }
    };
    // Draws the current artboard frame
    Rive.prototype.drawFrame = function () {
        var _a, _b;
        if ((_a = document === null || document === void 0 ? void 0 : document.timeline) === null || _a === void 0 ? void 0 : _a.currentTime) {
            if (this.loaded && this.artboard && !this.frameRequestId) {
                this._boundDraw(document.timeline.currentTime);
                (_b = this.runtime) === null || _b === void 0 ? void 0 : _b.resolveAnimationFrame();
            }
        }
        else {
            this.startRendering();
        }
    };
    /**
     * Draw rendering loop; renders animation frames at the correct time interval.
     * @param time the time at which to render a frame
     */
    Rive.prototype.draw = function (time, onSecond) {
        var _a;
        // Clear the frameRequestId, as we're now rendering a fresh frame
        this.frameRequestId = null;
        var before = performance.now();
        // On the first pass, make sure lastTime has a valid value
        if (!this.lastRenderTime) {
            this.lastRenderTime = time;
        }
        // Handle the onSecond callback
        this.renderSecondTimer += time - this.lastRenderTime;
        if (this.renderSecondTimer > 5000) {
            this.renderSecondTimer = 0;
            onSecond === null || onSecond === void 0 ? void 0 : onSecond();
        }
        // Calculate the elapsed time between frames in seconds
        var elapsedTime = (time - this.lastRenderTime) / 1000;
        this.lastRenderTime = time;
        // - Advance non-paused animations by the elapsed number of seconds
        // - Advance any animations that require scrubbing
        // - Advance to the first frame even when autoplay is false
        var activeAnimations = this.animator.animations
            .filter(function (a) { return a.playing || a.needsScrub; })
            // The scrubbed animations must be applied first to prevent weird artifacts
            // if the playing animations conflict with the scrubbed animating attribuates.
            .sort(function (first) { return (first.needsScrub ? -1 : 1); });
        for (var _i = 0, activeAnimations_1 = activeAnimations; _i < activeAnimations_1.length; _i++) {
            var animation = activeAnimations_1[_i];
            animation.advance(elapsedTime);
            if (animation.instance.didLoop) {
                animation.loopCount += 1;
            }
            animation.apply(1.0);
        }
        // - Advance non-paused state machines by the elapsed number of seconds
        // - Advance to the first frame even when autoplay is false
        var activeStateMachines = this.animator.stateMachines.filter(function (a) { return a.playing; });
        for (var _b = 0, activeStateMachines_1 = activeStateMachines; _b < activeStateMachines_1.length; _b++) {
            var stateMachine = activeStateMachines_1[_b];
            // Check for events before the current frame's state machine advance
            var numEventsReported = stateMachine.reportedEventCount();
            if (numEventsReported) {
                for (var i = 0; i < numEventsReported; i++) {
                    var event_1 = stateMachine.reportedEventAt(i);
                    if (event_1) {
                        if (event_1.type === RiveEventType.OpenUrl) {
                            this.eventManager.fire({
                                type: EventType.RiveEvent,
                                data: event_1,
                            });
                            // Handle the event side effect if explicitly enabled
                            if (this.automaticallyHandleEvents) {
                                var newAnchorTag = document.createElement("a");
                                var _c = event_1, url = _c.url, target = _c.target;
                                var sanitizedUrl = (0,_utils__WEBPACK_IMPORTED_MODULE_3__.sanitizeUrl)(url);
                                url && newAnchorTag.setAttribute("href", sanitizedUrl);
                                target && newAnchorTag.setAttribute("target", target);
                                if (sanitizedUrl && sanitizedUrl !== _utils__WEBPACK_IMPORTED_MODULE_3__.BLANK_URL) {
                                    newAnchorTag.click();
                                }
                            }
                        }
                        else {
                            this.eventManager.fire({
                                type: EventType.RiveEvent,
                                data: event_1,
                            });
                        }
                    }
                }
            }
            stateMachine.advanceAndApply(elapsedTime);
            // stateMachine.instance.apply(this.artboard);
        }
        // Once the animations have been applied to the artboard, advance it
        // by the elapsed time.
        if (this.animator.stateMachines.length == 0) {
            this.artboard.advance(elapsedTime);
        }
        var renderer = this.renderer;
        // Canvas must be wiped to prevent artifacts
        renderer.clear();
        renderer.save();
        // Update the renderer alignment if necessary
        this.alignRenderer();
        // Do not draw on 0 canvas size
        if (!this._hasZeroSize) {
            this.artboard.draw(renderer);
        }
        renderer.restore();
        renderer.flush();
        // Check for any animations that looped
        this.animator.handleLooping();
        // Check for any state machines that had a state change
        this.animator.handleStateChanges();
        // Report advanced time
        this.animator.handleAdvancing(elapsedTime);
        // Add duration to create frame to durations array
        this.frameCount++;
        var after = performance.now();
        this.frameTimes.push(after);
        this.durations.push(after - before);
        while (this.frameTimes[0] <= after - 1000) {
            this.frameTimes.shift();
            this.durations.shift();
        }
        (_a = this._viewModelInstance) === null || _a === void 0 ? void 0 : _a.handleCallbacks();
        // Calling requestAnimationFrame will rerun draw() at the correct rate:
        // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Basic_animations
        if (this.animator.isPlaying) {
            // Request a new rendering frame
            this.startRendering();
        }
        else if (this.animator.isPaused) {
            // Reset the end time so on playback it starts at the correct frame
            this.lastRenderTime = 0;
        }
        else if (this.animator.isStopped) {
            // Reset animation instances, artboard and time
            // TODO: implement this properly when we have instancing
            // this.initArtboard();
            // this.drawFrame();
            this.lastRenderTime = 0;
        }
    };
    /**
     * Align the renderer
     */
    Rive.prototype.alignRenderer = function () {
        var _a = this, renderer = _a.renderer, runtime = _a.runtime, _layout = _a._layout, artboard = _a.artboard;
        // Align things up safe in the knowledge we can restore if changed
        renderer.align(_layout.runtimeFit(runtime), _layout.runtimeAlignment(runtime), {
            minX: _layout.minX,
            minY: _layout.minY,
            maxX: _layout.maxX,
            maxY: _layout.maxY,
        }, artboard.bounds, this._devicePixelRatioUsed * _layout.layoutScaleFactor);
    };
    Object.defineProperty(Rive.prototype, "fps", {
        get: function () {
            return this.durations.length;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "frameTime", {
        get: function () {
            if (this.durations.length === 0) {
                return 0;
            }
            return (this.durations.reduce(function (a, b) { return a + b; }, 0) / this.durations.length).toFixed(4);
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Cleans up all Wasm-generated objects that need to be manually destroyed:
     * artboard instances, animation instances, state machine instances,
     * renderer instance, file and runtime.
     *
     * Once this is called, you will need to initialise a new instance of the
     * Rive class
     */
    Rive.prototype.cleanup = function () {
        var _a, _b;
        this.destroyed = true;
        // Stop the renderer if it hasn't already been stopped.
        this.stopRendering();
        // Clean up any artboard, animation or state machine instances.
        this.cleanupInstances();
        // Remove from observer
        if (this._observed !== null) {
            observers.remove(this._observed);
        }
        this.removeRiveListeners();
        if (this.file) {
            (_a = this.riveFile) === null || _a === void 0 ? void 0 : _a.cleanup();
            this.file = null;
        }
        this.riveFile = null;
        this.deleteRiveRenderer();
        if (this._audioEventListener !== null) {
            audioManager.remove(this._audioEventListener);
            this._audioEventListener = null;
        }
        (_b = this._viewModelInstance) === null || _b === void 0 ? void 0 : _b.cleanup();
        this._viewModelInstance = null;
        this._dataEnums = null;
    };
    /**
     * Cleans up the Renderer object. Only call this API if you no longer
     * need to render Rive content in your session.
     */
    Rive.prototype.deleteRiveRenderer = function () {
        var _a;
        (_a = this.renderer) === null || _a === void 0 ? void 0 : _a.delete();
        this.renderer = null;
    };
    /**
     * Cleans up any Wasm-generated objects that need to be manually destroyed:
     * artboard instances, animation instances, state machine instances.
     *
     * Once this is called, things will need to be reinitialized or bad things
     * might happen.
     */
    Rive.prototype.cleanupInstances = function () {
        if (this.eventCleanup !== null) {
            this.eventCleanup();
        }
        // Delete all animation and state machine instances
        this.stop();
        if (this.artboard) {
            this.artboard.delete();
            this.artboard = null;
        }
    };
    /**
     * Tries to query the setup Artboard for a text run node with the given name.
     *
     * @param textRunName - Name of the text run node associated with a text object
     * @returns - TextValueRun node or undefined if the text run cannot be queried
     */
    Rive.prototype.retrieveTextRun = function (textRunName) {
        var _a;
        if (!textRunName) {
            console.warn("No text run name provided");
            return;
        }
        if (!this.artboard) {
            console.warn("Tried to access text run, but the Artboard is null");
            return;
        }
        var textRun = this.artboard.textRun(textRunName);
        if (!textRun) {
            console.warn("Could not access a text run with name '".concat(textRunName, "' in the '").concat((_a = this.artboard) === null || _a === void 0 ? void 0 : _a.name, "' Artboard. Note that you must rename a text run node in the Rive editor to make it queryable at runtime."));
            return;
        }
        return textRun;
    };
    /**
     * Returns a string from a given text run node name, or undefined if the text run
     * cannot be queried.
     *
     * @param textRunName - Name of the text run node associated with a text object
     * @returns - String value of the text run node or undefined
     */
    Rive.prototype.getTextRunValue = function (textRunName) {
        var textRun = this.retrieveTextRun(textRunName);
        return textRun ? textRun.text : undefined;
    };
    /**
     * Sets a text value for a given text run node name if possible
     *
     * @param textRunName - Name of the text run node associated with a text object
     * @param textRunValue - String value to set on the text run node
     */
    Rive.prototype.setTextRunValue = function (textRunName, textRunValue) {
        var textRun = this.retrieveTextRun(textRunName);
        if (textRun) {
            textRun.text = textRunValue;
        }
    };
    // Plays specified animations; if none specified, it unpauses everything.
    Rive.prototype.play = function (animationNames, autoplay) {
        var _this = this;
        animationNames = mapToStringArray(animationNames);
        // If the file's not loaded, queue up the play
        if (!this.readyForPlaying) {
            this.taskQueue.add({
                action: function () { return _this.play(animationNames, autoplay); },
            });
            return;
        }
        this.animator.play(animationNames);
        if (this.eventCleanup) {
            this.eventCleanup();
        }
        this.setupRiveListeners();
        this.startRendering();
    };
    // Pauses specified animations; if none specified, pauses all.
    Rive.prototype.pause = function (animationNames) {
        var _this = this;
        animationNames = mapToStringArray(animationNames);
        // If the file's not loaded, early out, nothing to pause
        if (!this.readyForPlaying) {
            this.taskQueue.add({
                action: function () { return _this.pause(animationNames); },
            });
            return;
        }
        if (this.eventCleanup) {
            this.eventCleanup();
        }
        this.animator.pause(animationNames);
    };
    Rive.prototype.scrub = function (animationNames, value) {
        var _this = this;
        animationNames = mapToStringArray(animationNames);
        // If the file's not loaded, early out, nothing to pause
        if (!this.readyForPlaying) {
            this.taskQueue.add({
                action: function () { return _this.scrub(animationNames, value); },
            });
            return;
        }
        // Scrub the animation time; we draw a single frame here so that if
        // nothing's currently playing, the scrubbed animation is still rendered/
        this.animator.scrub(animationNames, value || 0);
        this.drawFrame();
    };
    // Stops specified animations; if none specifies, stops them all.
    Rive.prototype.stop = function (animationNames) {
        var _this = this;
        animationNames = mapToStringArray(animationNames);
        // If the file's not loaded, early out, nothing to pause
        if (!this.readyForPlaying) {
            this.taskQueue.add({
                action: function () { return _this.stop(animationNames); },
            });
            return;
        }
        // If there is no artboard, this.animator will be undefined
        if (this.animator) {
            this.animator.stop(animationNames);
        }
        if (this.eventCleanup) {
            this.eventCleanup();
        }
    };
    /**
     * Resets the animation
     * @param artboard the name of the artboard, or default if none given
     * @param animations the names of animations for playback
     * @param stateMachines the names of state machines for playback
     * @param autoplay whether to autoplay when reset, defaults to false
     *
     */
    Rive.prototype.reset = function (params) {
        var _a, _b;
        // Get the current artboard, animations, state machines, and playback states
        var artBoardName = params === null || params === void 0 ? void 0 : params.artboard;
        var animationNames = mapToStringArray(params === null || params === void 0 ? void 0 : params.animations);
        var stateMachineNames = mapToStringArray(params === null || params === void 0 ? void 0 : params.stateMachines);
        var autoplay = (_a = params === null || params === void 0 ? void 0 : params.autoplay) !== null && _a !== void 0 ? _a : false;
        var autoBind = (_b = params === null || params === void 0 ? void 0 : params.autoBind) !== null && _b !== void 0 ? _b : false;
        // Stop everything and clean up
        this.cleanupInstances();
        // Reinitialize an artboard instance with the state
        this.initArtboard(artBoardName, animationNames, stateMachineNames, autoplay, autoBind);
        this.taskQueue.process();
    };
    // Loads a new Rive file, keeping listeners in place
    Rive.prototype.load = function (params) {
        this.file = null;
        // Stop all animations
        this.stop();
        // Reinitialize
        this.init(params);
    };
    Object.defineProperty(Rive.prototype, "layout", {
        /**
         * Returns the current layout. Note that layout should be treated as
         * immutable. If you want to change the layout, create a new one use the
         * layout setter
         */
        get: function () {
            return this._layout;
        },
        // Sets a new layout
        set: function (layout) {
            this._layout = layout;
            // If the maxX or maxY are 0, then set them to the canvas width and height
            if (!layout.maxX || !layout.maxY) {
                this.resizeToCanvas();
            }
            if (this.loaded && !this.animator.isPlaying) {
                this.drawFrame();
            }
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Sets the layout bounds to the current canvas size; this is typically called
     * when the canvas is resized
     */
    Rive.prototype.resizeToCanvas = function () {
        this._layout = this.layout.copyWith({
            minX: 0,
            minY: 0,
            maxX: this.canvas.width,
            maxY: this.canvas.height,
        });
    };
    /**
     * Accounts for devicePixelRatio as a multiplier to render the size of the canvas drawing surface.
     * Uses the size of the backing canvas to set new width/height attributes. Need to re-render
     * and resize the layout to match the new drawing surface afterwards.
     * Useful function for consumers to include in a window resize listener.
     *
     * This method will set the {@link devicePixelRatioUsed} property.
     *
     * Optionally, you can provide a {@link customDevicePixelRatio} to provide a
     * custom value.
     */
    Rive.prototype.resizeDrawingSurfaceToCanvas = function (customDevicePixelRatio) {
        if (this.canvas instanceof HTMLCanvasElement && !!window) {
            var _a = this.canvas.getBoundingClientRect(), width = _a.width, height = _a.height;
            var dpr = customDevicePixelRatio || window.devicePixelRatio || 1;
            this.devicePixelRatioUsed = dpr;
            this.canvas.width = dpr * width;
            this.canvas.height = dpr * height;
            this.resizeToCanvas();
            this.drawFrame();
            if (this.layout.fit === Fit.Layout) {
                var scaleFactor = this._layout.layoutScaleFactor;
                this.artboard.width = width / scaleFactor;
                this.artboard.height = height / scaleFactor;
            }
        }
    };
    Object.defineProperty(Rive.prototype, "source", {
        // Returns the animation source, which may be undefined
        get: function () {
            return this.src;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "activeArtboard", {
        /**
         * Returns the name of the active artboard
         */
        get: function () {
            return this.artboard ? this.artboard.name : "";
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "animationNames", {
        // Returns a list of animation names on the chosen artboard
        get: function () {
            // If the file's not loaded, we got nothing to return
            if (!this.loaded || !this.artboard) {
                return [];
            }
            var animationNames = [];
            for (var i = 0; i < this.artboard.animationCount(); i++) {
                animationNames.push(this.artboard.animationByIndex(i).name);
            }
            return animationNames;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "stateMachineNames", {
        /**
         * Returns a list of state machine names from the current artboard
         */
        get: function () {
            // If the file's not loaded, we got nothing to return
            if (!this.loaded || !this.artboard) {
                return [];
            }
            var stateMachineNames = [];
            for (var i = 0; i < this.artboard.stateMachineCount(); i++) {
                stateMachineNames.push(this.artboard.stateMachineByIndex(i).name);
            }
            return stateMachineNames;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Returns the inputs for the specified instanced state machine, or an empty
     * list if the name is invalid or the state machine is not instanced
     * @param name the state machine name
     * @returns the inputs for the named state machine
     */
    Rive.prototype.stateMachineInputs = function (name) {
        // If the file's not loaded, early out, nothing to pause
        if (!this.loaded) {
            return;
        }
        var stateMachine = this.animator.stateMachines.find(function (m) { return m.name === name; });
        return stateMachine === null || stateMachine === void 0 ? void 0 : stateMachine.inputs;
    };
    // Returns the input with the provided name at the given path
    Rive.prototype.retrieveInputAtPath = function (name, path) {
        if (!name) {
            console.warn("No input name provided for path '".concat(path, "'"));
            return;
        }
        if (!this.artboard) {
            console.warn("Tried to access input: '".concat(name, "', at path: '").concat(path, "', but the Artboard is null"));
            return;
        }
        var input = this.artboard.inputByPath(name, path);
        if (!input) {
            console.warn("Could not access an input with name: '".concat(name, "', at path:'").concat(path, "'"));
            return;
        }
        return input;
    };
    /**
     * Set the boolean input with the provided name at the given path with value
     * @param input the state machine input name
     * @param value the value to set the input to
     * @param path the path the input is located at an artboard level
     */
    Rive.prototype.setBooleanStateAtPath = function (inputName, value, path) {
        var input = this.retrieveInputAtPath(inputName, path);
        if (!input)
            return;
        if (input.type === StateMachineInputType.Boolean) {
            input.asBool().value = value;
        }
        else {
            console.warn("Input with name: '".concat(inputName, "', at path:'").concat(path, "' is not a boolean"));
        }
    };
    /**
     * Set the number input with the provided name at the given path with value
     * @param input the state machine input name
     * @param value the value to set the input to
     * @param path the path the input is located at an artboard level
     */
    Rive.prototype.setNumberStateAtPath = function (inputName, value, path) {
        var input = this.retrieveInputAtPath(inputName, path);
        if (!input)
            return;
        if (input.type === StateMachineInputType.Number) {
            input.asNumber().value = value;
        }
        else {
            console.warn("Input with name: '".concat(inputName, "', at path:'").concat(path, "' is not a number"));
        }
    };
    /**
     * Fire the trigger with the provided name at the given path
     * @param input the state machine input name
     * @param path the path the input is located at an artboard level
     */
    Rive.prototype.fireStateAtPath = function (inputName, path) {
        var input = this.retrieveInputAtPath(inputName, path);
        if (!input)
            return;
        if (input.type === StateMachineInputType.Trigger) {
            input.asTrigger().fire();
        }
        else {
            console.warn("Input with name: '".concat(inputName, "', at path:'").concat(path, "' is not a trigger"));
        }
    };
    // Returns the TextValueRun object for the provided name at the given path
    Rive.prototype.retrieveTextAtPath = function (name, path) {
        if (!name) {
            console.warn("No text name provided for path '".concat(path, "'"));
            return;
        }
        if (!path) {
            console.warn("No path provided for text '".concat(name, "'"));
            return;
        }
        if (!this.artboard) {
            console.warn("Tried to access text: '".concat(name, "', at path: '").concat(path, "', but the Artboard is null"));
            return;
        }
        var text = this.artboard.textByPath(name, path);
        if (!text) {
            console.warn("Could not access text with name: '".concat(name, "', at path:'").concat(path, "'"));
            return;
        }
        return text;
    };
    /**
     * Retrieves the text value for a specified text run at a given path
     * @param textName The name of the text run
     * @param path The path to the text run within the artboard
     * @returns The text value of the text run, or undefined if not found
     *
     * @example
     * // Get the text value for a text run named "title" at one nested artboard deep
     * const titleText = riveInstance.getTextRunValueAtPath("title", "artboard1");
     *
     * @example
     * // Get the text value for a text run named "subtitle" within a nested group two artboards deep
     * const subtitleText = riveInstance.getTextRunValueAtPath("subtitle", "group/nestedGroup");
     *
     * @remarks
     * If the text run cannot be found at the specified path, a warning will be logged to the console.
     */
    Rive.prototype.getTextRunValueAtPath = function (textName, path) {
        var run = this.retrieveTextAtPath(textName, path);
        if (!run) {
            console.warn("Could not get text with name: '".concat(textName, "', at path:'").concat(path, "'"));
            return;
        }
        return run.text;
    };
    /**
     * Sets the text value for a specified text run at a given path
     * @param textName The name of the text run
     * @param value The new text value to set
     * @param path The path to the text run within the artboard
     * @returns void
     *
     * @example
     * // Set the text value for a text run named "title" at one nested artboard deep
     * riveInstance.setTextRunValueAtPath("title", "New Title", "artboard1");
     *
     * @example
     * // Set the text value for a text run named "subtitle" within a nested group two artboards deep
     * riveInstance.setTextRunValueAtPath("subtitle", "New Subtitle", "group/nestedGroup");
     *
     * @remarks
     * If the text run cannot be found at the specified path, a warning will be logged to the console.
     */
    Rive.prototype.setTextRunValueAtPath = function (textName, value, path) {
        var run = this.retrieveTextAtPath(textName, path);
        if (!run) {
            console.warn("Could not set text with name: '".concat(textName, "', at path:'").concat(path, "'"));
            return;
        }
        run.text = value;
    };
    Object.defineProperty(Rive.prototype, "playingStateMachineNames", {
        // Returns a list of playing machine names
        get: function () {
            // If the file's not loaded, we got nothing to return
            if (!this.loaded) {
                return [];
            }
            return this.animator.stateMachines
                .filter(function (m) { return m.playing; })
                .map(function (m) { return m.name; });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "playingAnimationNames", {
        // Returns a list of playing animation names
        get: function () {
            // If the file's not loaded, we got nothing to return
            if (!this.loaded) {
                return [];
            }
            return this.animator.animations.filter(function (a) { return a.playing; }).map(function (a) { return a.name; });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "pausedAnimationNames", {
        // Returns a list of paused animation names
        get: function () {
            // If the file's not loaded, we got nothing to return
            if (!this.loaded) {
                return [];
            }
            return this.animator.animations
                .filter(function (a) { return !a.playing; })
                .map(function (a) { return a.name; });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "pausedStateMachineNames", {
        /**
         *  Returns a list of paused machine names
         * @returns a list of state machine names that are paused
         */
        get: function () {
            // If the file's not loaded, we got nothing to return
            if (!this.loaded) {
                return [];
            }
            return this.animator.stateMachines
                .filter(function (m) { return !m.playing; })
                .map(function (m) { return m.name; });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "isPlaying", {
        /**
         * @returns true if any animation is playing
         */
        get: function () {
            return this.animator.isPlaying;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "isPaused", {
        /**
         * @returns true if all instanced animations are paused
         */
        get: function () {
            return this.animator.isPaused;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "isStopped", {
        /**
         * @returns true if no animations are playing or paused
         */
        get: function () {
            return this.animator.isStopped;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "bounds", {
        /**
         * @returns the bounds of the current artboard, or undefined if the artboard
         * isn't loaded yet.
         */
        get: function () {
            return this.artboard ? this.artboard.bounds : undefined;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Subscribe to Rive-generated events
     * @param type the type of event to subscribe to
     * @param callback callback to fire when the event occurs
     */
    Rive.prototype.on = function (type, callback) {
        this.eventManager.add({
            type: type,
            callback: callback,
        });
    };
    /**
     * Unsubscribes from a Rive-generated event
     * @param type the type of event to unsubscribe from
     * @param callback the callback to unsubscribe
     */
    Rive.prototype.off = function (type, callback) {
        this.eventManager.remove({
            type: type,
            callback: callback,
        });
    };
    /**
     * Unsubscribes from a Rive-generated event
     * @deprecated
     * @param callback the callback to unsubscribe from
     */
    Rive.prototype.unsubscribe = function (type, callback) {
        console.warn("This function is deprecated: please use `off()` instead.");
        this.off(type, callback);
    };
    /**
     * Unsubscribes all Rive listeners from an event type, or everything if no type is
     * given
     * @param type the type of event to unsubscribe from, or all types if
     * undefined
     */
    Rive.prototype.removeAllRiveEventListeners = function (type) {
        this.eventManager.removeAll(type);
    };
    /**
     * Unsubscribes all listeners from an event type, or everything if no type is
     * given
     * @deprecated
     * @param type the type of event to unsubscribe from, or all types if
     * undefined
     */
    Rive.prototype.unsubscribeAll = function (type) {
        console.warn("This function is deprecated: please use `removeAllRiveEventListeners()` instead.");
        this.removeAllRiveEventListeners(type);
    };
    /**
     * Stops the rendering loop; this is different from pausing in that it doesn't
     * change the state of any animation. It stops rendering from occurring. This
     * is designed for situations such as when Rive isn't visible.
     *
     * The only way to start rendering again is to call `startRendering`.
     * Animations that are marked as playing will start from the position that
     * they would have been at if rendering had not been stopped.
     */
    Rive.prototype.stopRendering = function () {
        if (this.loaded && this.frameRequestId) {
            if (this.runtime.cancelAnimationFrame) {
                this.runtime.cancelAnimationFrame(this.frameRequestId);
            }
            else {
                cancelAnimationFrame(this.frameRequestId);
            }
            this.frameRequestId = null;
        }
    };
    /**
     * Starts the rendering loop if it has been previously stopped. If the
     * renderer is already active, then this will have zero effect.
     */
    Rive.prototype.startRendering = function () {
        if (this.loaded && this.artboard && !this.frameRequestId) {
            if (this.runtime.requestAnimationFrame) {
                this.frameRequestId = this.runtime.requestAnimationFrame(this._boundDraw);
            }
            else {
                this.frameRequestId = requestAnimationFrame(this._boundDraw);
            }
        }
    };
    /**
     * Enables frames-per-second (FPS) reporting for the runtime
     * If no callback is provided, Rive will append a fixed-position div at the top-right corner of
     * the page with the FPS reading
     * @param fpsCallback - Callback from the runtime during the RAF loop that supplies the FPS value
     */
    Rive.prototype.enableFPSCounter = function (fpsCallback) {
        this.runtime.enableFPSCounter(fpsCallback);
    };
    /**
     * Disables frames-per-second (FPS) reporting for the runtime
     */
    Rive.prototype.disableFPSCounter = function () {
        this.runtime.disableFPSCounter();
    };
    Object.defineProperty(Rive.prototype, "contents", {
        /**
         * Returns the contents of a Rive file: the artboards, animations, and state machines
         */
        get: function () {
            if (!this.loaded) {
                return undefined;
            }
            var riveContents = {
                artboards: [],
            };
            for (var i = 0; i < this.file.artboardCount(); i++) {
                var artboard = this.file.artboardByIndex(i);
                var artboardContents = {
                    name: artboard.name,
                    animations: [],
                    stateMachines: [],
                };
                for (var j = 0; j < artboard.animationCount(); j++) {
                    var animation = artboard.animationByIndex(j);
                    artboardContents.animations.push(animation.name);
                }
                for (var k = 0; k < artboard.stateMachineCount(); k++) {
                    var stateMachine = artboard.stateMachineByIndex(k);
                    var name_1 = stateMachine.name;
                    var instance = new this.runtime.StateMachineInstance(stateMachine, artboard);
                    var inputContents = [];
                    for (var l = 0; l < instance.inputCount(); l++) {
                        var input = instance.input(l);
                        inputContents.push({ name: input.name, type: input.type });
                    }
                    artboardContents.stateMachines.push({
                        name: name_1,
                        inputs: inputContents,
                    });
                }
                riveContents.artboards.push(artboardContents);
            }
            return riveContents;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "volume", {
        /**
         * Getter / Setter for the volume of the artboard
         */
        get: function () {
            if (this.artboard && this.artboard.volume !== this._volume) {
                this._volume = this.artboard.volume;
            }
            return this._volume;
        },
        set: function (value) {
            this._volume = value;
            if (this.artboard) {
                this.artboard.volume = value * audioManager.systemVolume;
            }
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "artboardWidth", {
        /**
         * The width of the artboard.
         *
         * This will return 0 if the artboard is not loaded yet and a custom
         * width has not been set.
         *
         * Do not set this value manually when using {@link resizeDrawingSurfaceToCanvas}
         * with a {@link Layout.fit} of {@link Fit.Layout}, as the artboard width is
         * automatically set.
         */
        get: function () {
            var _a;
            if (this.artboard) {
                return this.artboard.width;
            }
            return (_a = this._artboardWidth) !== null && _a !== void 0 ? _a : 0;
        },
        set: function (value) {
            this._artboardWidth = value;
            if (this.artboard) {
                this.artboard.width = value;
            }
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Rive.prototype, "artboardHeight", {
        /**
         * The height of the artboard.
         *
         * This will return 0 if the artboard is not loaded yet and a custom
         * height has not been set.
         *
         * Do not set this value manually when using {@link resizeDrawingSurfaceToCanvas}
         * with a {@link Layout.fit} of {@link Fit.Layout}, as the artboard height is
         * automatically set.
         */
        get: function () {
            var _a;
            if (this.artboard) {
                return this.artboard.height;
            }
            return (_a = this._artboardHeight) !== null && _a !== void 0 ? _a : 0;
        },
        set: function (value) {
            this._artboardHeight = value;
            if (this.artboard) {
                this.artboard.height = value;
            }
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Reset the artboard size to its original values.
     */
    Rive.prototype.resetArtboardSize = function () {
        if (this.artboard) {
            this.artboard.resetArtboardSize();
            this._artboardWidth = this.artboard.width;
            this._artboardHeight = this.artboard.height;
        }
        else {
            // If the artboard isn't loaded, we need to reset the custom width and height
            this._artboardWidth = undefined;
            this._artboardHeight = undefined;
        }
    };
    Object.defineProperty(Rive.prototype, "devicePixelRatioUsed", {
        /**
         * The device pixel ratio used in rendering and canvas/artboard resizing.
         *
         * This value will be overidden by the device pixel ratio used in
         * {@link resizeDrawingSurfaceToCanvas}. If you use that method, do not set this value.
         */
        get: function () {
            return this._devicePixelRatioUsed;
        },
        set: function (value) {
            this._devicePixelRatioUsed = value;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Initialize the data context with the view model instance.
     */
    Rive.prototype.bindViewModelInstance = function (viewModelInstance) {
        var _a;
        if (this.artboard && !this.destroyed) {
            if (viewModelInstance && viewModelInstance.runtimeInstance) {
                viewModelInstance.internalIncrementReferenceCount();
                (_a = this._viewModelInstance) === null || _a === void 0 ? void 0 : _a.cleanup();
                this._viewModelInstance = viewModelInstance;
                if (this.animator.stateMachines.length > 0) {
                    this.animator.stateMachines.forEach(function (stateMachine) {
                        return stateMachine.bindViewModelInstance(viewModelInstance);
                    });
                }
                else {
                    this.artboard.bindViewModelInstance(viewModelInstance.runtimeInstance);
                }
            }
        }
    };
    Object.defineProperty(Rive.prototype, "viewModelInstance", {
        get: function () {
            return this._viewModelInstance;
        },
        enumerable: false,
        configurable: true
    });
    Rive.prototype.viewModelByIndex = function (index) {
        var viewModel = this.file.viewModelByIndex(index);
        if (viewModel !== null) {
            return new ViewModel(viewModel);
        }
        return null;
    };
    Rive.prototype.viewModelByName = function (name) {
        var viewModel = this.file.viewModelByName(name);
        if (viewModel !== null) {
            return new ViewModel(viewModel);
        }
        return null;
    };
    Rive.prototype.enums = function () {
        if (this._dataEnums === null) {
            var dataEnums = this.file.enums();
            this._dataEnums = dataEnums.map(function (dataEnum) {
                return new DataEnum(dataEnum);
            });
        }
        return this._dataEnums;
    };
    Rive.prototype.defaultViewModel = function () {
        if (this.artboard) {
            var viewModel = this.file.defaultArtboardViewModel(this.artboard);
            if (viewModel) {
                return new ViewModel(viewModel);
            }
        }
        return null;
    };
    // Error message for missing source or buffer
    Rive.missingErrorMessage = "Rive source file or data buffer required";
    // Error message for removed rive file
    Rive.cleanupErrorMessage = "Attempt to use file after calling cleanup.";
    return Rive;
}());

var ViewModel = /** @class */ (function () {
    function ViewModel(viewModel) {
        this._viewModel = viewModel;
    }
    Object.defineProperty(ViewModel.prototype, "instanceCount", {
        get: function () {
            return this._viewModel.instanceCount;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ViewModel.prototype, "name", {
        get: function () {
            return this._viewModel.name;
        },
        enumerable: false,
        configurable: true
    });
    ViewModel.prototype.instanceByIndex = function (index) {
        var instance = this._viewModel.instanceByIndex(index);
        if (instance !== null) {
            return new ViewModelInstance(instance, null);
        }
        return null;
    };
    ViewModel.prototype.instanceByName = function (name) {
        var instance = this._viewModel.instanceByName(name);
        if (instance !== null) {
            return new ViewModelInstance(instance, null);
        }
        return null;
    };
    ViewModel.prototype.defaultInstance = function () {
        var runtimeInstance = this._viewModel.defaultInstance();
        if (runtimeInstance !== null) {
            return new ViewModelInstance(runtimeInstance, null);
        }
        return null;
    };
    ViewModel.prototype.instance = function () {
        var runtimeInstance = this._viewModel.instance();
        if (runtimeInstance !== null) {
            return new ViewModelInstance(runtimeInstance, null);
        }
        return null;
    };
    Object.defineProperty(ViewModel.prototype, "properties", {
        get: function () {
            return this._viewModel.getProperties();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ViewModel.prototype, "instanceNames", {
        get: function () {
            return this._viewModel.getInstanceNames();
        },
        enumerable: false,
        configurable: true
    });
    return ViewModel;
}());

var DataEnum = /** @class */ (function () {
    function DataEnum(dataEnum) {
        this._dataEnum = dataEnum;
    }
    Object.defineProperty(DataEnum.prototype, "name", {
        get: function () {
            return this._dataEnum.name;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DataEnum.prototype, "values", {
        get: function () {
            return this._dataEnum.values;
        },
        enumerable: false,
        configurable: true
    });
    return DataEnum;
}());

var PropertyType;
(function (PropertyType) {
    PropertyType["Number"] = "number";
    PropertyType["String"] = "string";
    PropertyType["Boolean"] = "boolean";
    PropertyType["Color"] = "color";
    PropertyType["Trigger"] = "trigger";
    PropertyType["Enum"] = "enum";
    PropertyType["List"] = "list";
})(PropertyType || (PropertyType = {}));
var ViewModelInstance = /** @class */ (function () {
    function ViewModelInstance(runtimeInstance, parent) {
        this._parents = [];
        this._children = [];
        this._viewModelInstances = new Map();
        this._propertiesWithCallbacks = [];
        this._referenceCount = 0;
        this._runtimeInstance = runtimeInstance;
        if (parent !== null) {
            this._parents.push(parent);
        }
    }
    Object.defineProperty(ViewModelInstance.prototype, "runtimeInstance", {
        get: function () {
            return this._runtimeInstance;
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstance.prototype.handleCallbacks = function () {
        if (this._propertiesWithCallbacks.length !== 0) {
            this._propertiesWithCallbacks.forEach(function (property) {
                property.handleCallbacks();
            });
            this._propertiesWithCallbacks.forEach(function (property) {
                property.clearChanges();
            });
        }
        this._children.forEach(function (child) { return child.handleCallbacks(); });
    };
    ViewModelInstance.prototype.addParent = function (parent) {
        this._parents.push(parent);
        if (this._propertiesWithCallbacks.length > 0 || this._children.length > 0) {
            parent.addToViewModelCallbacks(this);
        }
    };
    ViewModelInstance.prototype.removeParent = function (parent) {
        var index = this._parents.indexOf(parent);
        if (index !== -1) {
            var parent_1 = this._parents[index];
            parent_1.removeFromViewModelCallbacks(this);
            this._parents.splice(index, 1);
        }
    };
    /*
     * method for internal use, it shouldn't be called externally
     */
    ViewModelInstance.prototype.addToPropertyCallbacks = function (property) {
        var _this = this;
        if (!this._propertiesWithCallbacks.includes(property)) {
            this._propertiesWithCallbacks.push(property);
            if (this._propertiesWithCallbacks.length > 0) {
                this._parents.forEach(function (parent) {
                    parent.addToViewModelCallbacks(_this);
                });
            }
        }
    };
    /*
     * method for internal use, it shouldn't be called externally
     */
    ViewModelInstance.prototype.removeFromPropertyCallbacks = function (property) {
        var _this = this;
        if (this._propertiesWithCallbacks.includes(property)) {
            this._propertiesWithCallbacks = this._propertiesWithCallbacks.filter(function (prop) { return prop !== property; });
            if (this._children.length === 0 &&
                this._propertiesWithCallbacks.length === 0) {
                this._parents.forEach(function (parent) {
                    parent.removeFromViewModelCallbacks(_this);
                });
            }
        }
    };
    /*
     * method for internal use, it shouldn't be called externally
     */
    ViewModelInstance.prototype.addToViewModelCallbacks = function (instance) {
        var _this = this;
        if (!this._children.includes(instance)) {
            this._children.push(instance);
            this._parents.forEach(function (parent) {
                parent.addToViewModelCallbacks(_this);
            });
        }
    };
    /*
     * method for internal use, it shouldn't be called externally
     */
    ViewModelInstance.prototype.removeFromViewModelCallbacks = function (instance) {
        var _this = this;
        if (this._children.includes(instance)) {
            this._children = this._children.filter(function (child) { return child !== instance; });
            if (this._children.length === 0 &&
                this._propertiesWithCallbacks.length === 0) {
                this._parents.forEach(function (parent) {
                    parent.removeFromViewModelCallbacks(_this);
                });
            }
        }
    };
    ViewModelInstance.prototype.clearCallbacks = function () {
        this._propertiesWithCallbacks.forEach(function (property) {
            property.clearCallbacks();
        });
    };
    ViewModelInstance.prototype.propertyFromPath = function (path, type) {
        var pathSegments = path.split("/");
        return this.propertyFromPathSegments(pathSegments, 0, type);
    };
    ViewModelInstance.prototype.viewModelFromPathSegments = function (pathSegments, index) {
        var viewModelInstance = this.internalViewModelInstance(pathSegments[index]);
        if (viewModelInstance !== null) {
            if (index == pathSegments.length - 1) {
                return viewModelInstance;
            }
            else {
                return viewModelInstance.viewModelFromPathSegments(pathSegments, index++);
            }
        }
        return null;
    };
    ViewModelInstance.prototype.propertyFromPathSegments = function (pathSegments, index, type) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        if (index < pathSegments.length - 1) {
            var viewModelInstance = this.internalViewModelInstance(pathSegments[index]);
            if (viewModelInstance !== null) {
                return viewModelInstance.propertyFromPathSegments(pathSegments, index + 1, type);
            }
            else {
                return null;
            }
        }
        var instance = null;
        switch (type) {
            case PropertyType.Number:
                instance = (_b = (_a = this._runtimeInstance) === null || _a === void 0 ? void 0 : _a.number(pathSegments[index])) !== null && _b !== void 0 ? _b : null;
                if (instance !== null) {
                    return new ViewModelInstanceNumber(instance, this);
                }
                break;
            case PropertyType.String:
                instance = (_d = (_c = this._runtimeInstance) === null || _c === void 0 ? void 0 : _c.string(pathSegments[index])) !== null && _d !== void 0 ? _d : null;
                if (instance !== null) {
                    return new ViewModelInstanceString(instance, this);
                }
                break;
            case PropertyType.Boolean:
                instance = (_f = (_e = this._runtimeInstance) === null || _e === void 0 ? void 0 : _e.boolean(pathSegments[index])) !== null && _f !== void 0 ? _f : null;
                if (instance !== null) {
                    return new ViewModelInstanceBoolean(instance, this);
                }
                break;
            case PropertyType.Color:
                instance = (_h = (_g = this._runtimeInstance) === null || _g === void 0 ? void 0 : _g.color(pathSegments[index])) !== null && _h !== void 0 ? _h : null;
                if (instance !== null) {
                    return new ViewModelInstanceColor(instance, this);
                }
                break;
            case PropertyType.Trigger:
                instance = (_k = (_j = this._runtimeInstance) === null || _j === void 0 ? void 0 : _j.trigger(pathSegments[index])) !== null && _k !== void 0 ? _k : null;
                if (instance !== null) {
                    return new ViewModelInstanceTrigger(instance, this);
                }
                break;
            case PropertyType.Enum:
                instance = (_m = (_l = this._runtimeInstance) === null || _l === void 0 ? void 0 : _l.enum(pathSegments[index])) !== null && _m !== void 0 ? _m : null;
                if (instance !== null) {
                    return new ViewModelInstanceEnum(instance, this);
                }
                break;
            case PropertyType.List:
                instance = (_p = (_o = this._runtimeInstance) === null || _o === void 0 ? void 0 : _o.list(pathSegments[index])) !== null && _p !== void 0 ? _p : null;
                if (instance !== null) {
                    return new ViewModelInstanceList(instance, this);
                }
                break;
        }
        return null;
    };
    ViewModelInstance.prototype.internalViewModelInstance = function (name) {
        var _a;
        if (this._viewModelInstances.has(name)) {
            return this._viewModelInstances.get(name);
        }
        var viewModelRuntimeInstance = (_a = this._runtimeInstance) === null || _a === void 0 ? void 0 : _a.viewModel(name);
        if (viewModelRuntimeInstance !== null) {
            var viewModelInstance = new ViewModelInstance(viewModelRuntimeInstance, this);
            viewModelInstance.internalIncrementReferenceCount();
            this._viewModelInstances.set(name, viewModelInstance);
            return viewModelInstance;
        }
        return null;
    };
    /**
     * method to access a property instance of type number belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the number property
     */
    ViewModelInstance.prototype.number = function (path) {
        var viewmodelInstanceValue = this.propertyFromPath(path, PropertyType.Number);
        return viewmodelInstanceValue;
    };
    /**
     * method to access a property instance of type string belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the string property
     */
    ViewModelInstance.prototype.string = function (path) {
        var viewmodelInstanceValue = this.propertyFromPath(path, PropertyType.String);
        return viewmodelInstanceValue;
    };
    /**
     * method to access a property instance of type boolean belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the boolean property
     */
    ViewModelInstance.prototype.boolean = function (path) {
        var viewmodelInstanceValue = this.propertyFromPath(path, PropertyType.Boolean);
        return viewmodelInstanceValue;
    };
    /**
     * method to access a property instance of type color belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the ttrigger property
     */
    ViewModelInstance.prototype.color = function (path) {
        var viewmodelInstanceValue = this.propertyFromPath(path, PropertyType.Color);
        return viewmodelInstanceValue;
    };
    /**
     * method to access a property instance of type trigger belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the trigger property
     */
    ViewModelInstance.prototype.trigger = function (path) {
        var viewmodelInstanceValue = this.propertyFromPath(path, PropertyType.Trigger);
        return viewmodelInstanceValue;
    };
    /**
     * method to access a property instance of type enum belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the enum property
     */
    ViewModelInstance.prototype.enum = function (path) {
        var viewmodelInstanceValue = this.propertyFromPath(path, PropertyType.Enum);
        return viewmodelInstanceValue;
    };
    /**
     * method to access a property instance of type list belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the list property
     */
    ViewModelInstance.prototype.list = function (path) {
        var viewmodelInstanceValue = this.propertyFromPath(path, PropertyType.List);
        return viewmodelInstanceValue;
    };
    /**
     * method to access a view model property instance belonging
     * to the view model instance or to a nested view model instance
     * @param path - path to the view model property
     */
    ViewModelInstance.prototype.viewModel = function (path) {
        var pathSegments = path.split("/");
        var parentViewModelInstance = pathSegments.length > 1
            ? this.viewModelFromPathSegments(pathSegments.slice(0, pathSegments.length - 1), 0)
            : this;
        if (parentViewModelInstance != null) {
            return parentViewModelInstance.internalViewModelInstance(pathSegments[pathSegments.length - 1]);
        }
        return null;
    };
    ViewModelInstance.prototype.internalReplaceViewModel = function (name, value) {
        var _a;
        if (value.runtimeInstance !== null) {
            var result = ((_a = this._runtimeInstance) === null || _a === void 0 ? void 0 : _a.replaceViewModel(name, value.runtimeInstance)) ||
                false;
            if (result) {
                value.internalIncrementReferenceCount();
                var oldInstance_1 = this.internalViewModelInstance(name);
                if (oldInstance_1 !== null) {
                    oldInstance_1.removeParent(this);
                    if (this._children.includes(oldInstance_1)) {
                        this._children = this._children.filter(function (child) { return child !== oldInstance_1; });
                    }
                    oldInstance_1.cleanup();
                }
                this._viewModelInstances.set(name, value);
                value.addParent(this);
            }
            return result;
        }
        return false;
    };
    /**
     * method to replace a view model property with another view model value
     * @param path - path to the view model property
     * @param value - view model that will replace the original
     */
    ViewModelInstance.prototype.replaceViewModel = function (path, value) {
        var _a;
        var pathSegments = path.split("/");
        var viewModelInstance = pathSegments.length > 1
            ? this.viewModelFromPathSegments(pathSegments.slice(0, pathSegments.length - 1), 0)
            : this;
        return ((_a = viewModelInstance === null || viewModelInstance === void 0 ? void 0 : viewModelInstance.internalReplaceViewModel(pathSegments[pathSegments.length - 1], value)) !== null && _a !== void 0 ? _a : false);
    };
    /*
     * method to add one to the reference counter of the instance.
     * Use if the file owning the reference is destroyed but the instance needs to stay around
     */
    ViewModelInstance.prototype.incrementReferenceCount = function () {
        var _a;
        this._referenceCount++;
        (_a = this._runtimeInstance) === null || _a === void 0 ? void 0 : _a.incrementReferenceCount();
    };
    /*
     * method to subtract one to the reference counter of the instance.
     * Use if incrementReferenceCount has been called
     */
    ViewModelInstance.prototype.decrementReferenceCount = function () {
        var _a;
        this._referenceCount--;
        (_a = this._runtimeInstance) === null || _a === void 0 ? void 0 : _a.decrementReferenceCount();
    };
    Object.defineProperty(ViewModelInstance.prototype, "properties", {
        get: function () {
            var _a;
            return (((_a = this._runtimeInstance) === null || _a === void 0 ? void 0 : _a.getProperties().map(function (prop) { return (__assign({}, prop)); })) || []);
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstance.prototype.internalIncrementReferenceCount = function () {
        this._referenceCount++;
    };
    ViewModelInstance.prototype.cleanup = function () {
        var _this = this;
        this._referenceCount--;
        if (this._referenceCount <= 0) {
            this._runtimeInstance = null;
            this.clearCallbacks();
            this._propertiesWithCallbacks = [];
            this._viewModelInstances.forEach(function (value) {
                value.cleanup();
            });
            this._viewModelInstances.clear();
            var children = __spreadArray([], this._children, true);
            this._children.length = 0;
            var parents = __spreadArray([], this._parents, true);
            this._parents.length = 0;
            children.forEach(function (child) {
                child.removeParent(_this);
            });
            parents.forEach(function (parent) {
                parent.removeFromViewModelCallbacks(_this);
            });
        }
    };
    return ViewModelInstance;
}());

var ViewModelInstanceValue = /** @class */ (function () {
    function ViewModelInstanceValue(instance, parent) {
        this.callbacks = [];
        this._viewModelInstanceValue = instance;
        this._parentViewModel = parent;
    }
    ViewModelInstanceValue.prototype.on = function (callback) {
        // Since we don't clean the changed flag for properties that don't have listeners,
        // we clean it the first time we add a listener to it
        if (this.callbacks.length === 0) {
            this._viewModelInstanceValue.clearChanges();
        }
        if (!this.callbacks.includes(callback)) {
            this.callbacks.push(callback);
            this._parentViewModel.addToPropertyCallbacks(this);
        }
    };
    ViewModelInstanceValue.prototype.off = function (callback) {
        if (!callback) {
            this.callbacks.length = 0;
        }
        else {
            this.callbacks = this.callbacks.filter(function (cb) { return cb !== callback; });
        }
        if (this.callbacks.length === 0) {
            this._parentViewModel.removeFromPropertyCallbacks(this);
        }
    };
    ViewModelInstanceValue.prototype.internalHandleCallback = function (callback) { };
    ViewModelInstanceValue.prototype.handleCallbacks = function () {
        var _this = this;
        if (this._viewModelInstanceValue.hasChanged) {
            this.callbacks.forEach(function (callback) {
                _this.internalHandleCallback(callback);
            });
        }
    };
    ViewModelInstanceValue.prototype.clearChanges = function () {
        this._viewModelInstanceValue.clearChanges();
    };
    ViewModelInstanceValue.prototype.clearCallbacks = function () {
        this.callbacks.length = 0;
    };
    Object.defineProperty(ViewModelInstanceValue.prototype, "name", {
        get: function () {
            return this._viewModelInstanceValue.name;
        },
        enumerable: false,
        configurable: true
    });
    return ViewModelInstanceValue;
}());

var ViewModelInstanceString = /** @class */ (function (_super) {
    __extends(ViewModelInstanceString, _super);
    function ViewModelInstanceString(instance, parent) {
        return _super.call(this, instance, parent) || this;
    }
    Object.defineProperty(ViewModelInstanceString.prototype, "value", {
        get: function () {
            return this._viewModelInstanceValue.value;
        },
        set: function (val) {
            this._viewModelInstanceValue.value = val;
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstanceString.prototype.internalHandleCallback = function (callback) {
        callback(this.value);
    };
    return ViewModelInstanceString;
}(ViewModelInstanceValue));

var ViewModelInstanceNumber = /** @class */ (function (_super) {
    __extends(ViewModelInstanceNumber, _super);
    function ViewModelInstanceNumber(instance, parent) {
        return _super.call(this, instance, parent) || this;
    }
    Object.defineProperty(ViewModelInstanceNumber.prototype, "value", {
        get: function () {
            return this._viewModelInstanceValue.value;
        },
        set: function (val) {
            this._viewModelInstanceValue.value = val;
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstanceNumber.prototype.internalHandleCallback = function (callback) {
        callback(this.value);
    };
    return ViewModelInstanceNumber;
}(ViewModelInstanceValue));

var ViewModelInstanceBoolean = /** @class */ (function (_super) {
    __extends(ViewModelInstanceBoolean, _super);
    function ViewModelInstanceBoolean(instance, parent) {
        return _super.call(this, instance, parent) || this;
    }
    Object.defineProperty(ViewModelInstanceBoolean.prototype, "value", {
        get: function () {
            return this._viewModelInstanceValue.value;
        },
        set: function (val) {
            this._viewModelInstanceValue.value = val;
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstanceBoolean.prototype.internalHandleCallback = function (callback) {
        callback(this.value);
    };
    return ViewModelInstanceBoolean;
}(ViewModelInstanceValue));

var ViewModelInstanceTrigger = /** @class */ (function (_super) {
    __extends(ViewModelInstanceTrigger, _super);
    function ViewModelInstanceTrigger(instance, parent) {
        return _super.call(this, instance, parent) || this;
    }
    ViewModelInstanceTrigger.prototype.trigger = function () {
        return this._viewModelInstanceValue.trigger();
    };
    ViewModelInstanceTrigger.prototype.internalHandleCallback = function (callback) {
        callback();
    };
    return ViewModelInstanceTrigger;
}(ViewModelInstanceValue));

var ViewModelInstanceEnum = /** @class */ (function (_super) {
    __extends(ViewModelInstanceEnum, _super);
    function ViewModelInstanceEnum(instance, parent) {
        return _super.call(this, instance, parent) || this;
    }
    Object.defineProperty(ViewModelInstanceEnum.prototype, "value", {
        get: function () {
            return this._viewModelInstanceValue.value;
        },
        set: function (val) {
            this._viewModelInstanceValue.value = val;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ViewModelInstanceEnum.prototype, "valueIndex", {
        get: function () {
            return this._viewModelInstanceValue
                .valueIndex;
        },
        set: function (val) {
            this._viewModelInstanceValue.valueIndex = val;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ViewModelInstanceEnum.prototype, "values", {
        get: function () {
            return this._viewModelInstanceValue.values;
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstanceEnum.prototype.internalHandleCallback = function (callback) {
        callback(this.value);
    };
    return ViewModelInstanceEnum;
}(ViewModelInstanceValue));

var ViewModelInstanceList = /** @class */ (function (_super) {
    __extends(ViewModelInstanceList, _super);
    function ViewModelInstanceList(instance, parent) {
        return _super.call(this, instance, parent) || this;
    }
    Object.defineProperty(ViewModelInstanceList.prototype, "length", {
        get: function () {
            return this._viewModelInstanceValue.size;
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstanceList.prototype.addInstance = function (instance) {
        if (instance.runtimeInstance != null) {
            this._viewModelInstanceValue.addInstance(instance.runtimeInstance);
        }
    };
    ViewModelInstanceList.prototype.removeInstance = function (instance) {
        if (instance.runtimeInstance != null) {
            this._viewModelInstanceValue.removeInstance(instance.runtimeInstance);
        }
    };
    ViewModelInstanceList.prototype.removeInstanceAt = function (index) {
        this._viewModelInstanceValue.removeInstanceAt(index);
    };
    ViewModelInstanceList.prototype.instanceAt = function (index) {
        var runtimeInstance = this._viewModelInstanceValue.instanceAt(index);
        if (runtimeInstance != null) {
            var viewModelInstance = new ViewModelInstance(runtimeInstance, null);
            return viewModelInstance;
        }
        return null;
    };
    ViewModelInstanceList.prototype.internalHandleCallback = function (callback) {
        callback();
    };
    return ViewModelInstanceList;
}(ViewModelInstanceValue));

var ViewModelInstanceColor = /** @class */ (function (_super) {
    __extends(ViewModelInstanceColor, _super);
    function ViewModelInstanceColor(instance, parent) {
        return _super.call(this, instance, parent) || this;
    }
    Object.defineProperty(ViewModelInstanceColor.prototype, "value", {
        get: function () {
            return this._viewModelInstanceValue.value;
        },
        set: function (val) {
            this._viewModelInstanceValue.value = val;
        },
        enumerable: false,
        configurable: true
    });
    ViewModelInstanceColor.prototype.rgb = function (r, g, b) {
        this._viewModelInstanceValue.rgb(r, g, b);
    };
    ViewModelInstanceColor.prototype.rgba = function (r, g, b, a) {
        this._viewModelInstanceValue.argb(a, r, g, b);
    };
    ViewModelInstanceColor.prototype.argb = function (a, r, g, b) {
        this._viewModelInstanceValue.argb(a, r, g, b);
    };
    // Value 0 to 255
    ViewModelInstanceColor.prototype.alpha = function (a) {
        this._viewModelInstanceValue.alpha(a);
    };
    // Value 0 to 1
    ViewModelInstanceColor.prototype.opacity = function (o) {
        this._viewModelInstanceValue.alpha(Math.round(Math.max(0, Math.min(1, o)) * 255));
    };
    ViewModelInstanceColor.prototype.internalHandleCallback = function (callback) {
        callback(this.value);
    };
    return ViewModelInstanceColor;
}(ViewModelInstanceValue));

// Loads Rive data from a URI via fetch.
var loadRiveFile = function (src) { return __awaiter(void 0, void 0, void 0, function () {
    var req, res, buffer;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                req = new Request(src);
                return [4 /*yield*/, fetch(req)];
            case 1:
                res = _a.sent();
                return [4 /*yield*/, res.arrayBuffer()];
            case 2:
                buffer = _a.sent();
                return [2 /*return*/, buffer];
        }
    });
}); };
// #endregion
// #region utility functions
/*
 * Utility function to ensure an object is a string array
 */
var mapToStringArray = function (obj) {
    if (typeof obj === "string") {
        return [obj];
    }
    else if (obj instanceof Array) {
        return obj;
    }
    // If obj is undefined, return empty array
    return [];
};
// #endregion
// #region testing utilities
// Exports to only be used for tests
var Testing = {
    EventManager: EventManager,
    TaskQueueManager: TaskQueueManager,
};
// #endregion
// #region asset loaders
/**
 * Decodes bytes into an audio asset.
 *
 * Be sure to call `.unref()` on the audio once it is no longer needed. This
 * allows the engine to clean it up when it is not used by any more animations.
 */
var decodeAudio = function (bytes) {
    return new Promise(function (resolve) {
        return RuntimeLoader.getInstance(function (rive) {
            rive.decodeAudio(bytes, resolve);
        });
    });
};
/**
 * Decodes bytes into an image.
 *
 * Be sure to call `.unref()` on the image once it is no longer needed. This
 * allows the engine to clean it up when it is not used by any more animations.
 */
var decodeImage = function (bytes) {
    return new Promise(function (resolve) {
        return RuntimeLoader.getInstance(function (rive) {
            rive.decodeImage(bytes, resolve);
        });
    });
};
/**
 * Decodes bytes into a font.
 *
 * Be sure to call `.unref()` on the font once it is no longer needed. This
 * allows the engine to clean it up when it is not used by any more animations.
 */
var decodeFont = function (bytes) {
    return new Promise(function (resolve) {
        return RuntimeLoader.getInstance(function (rive) {
            rive.decodeFont(bytes, resolve);
        });
    });
};
// #endregion

})();

/******/ 	return __webpack_exports__;
/******/ })()
;
});
//# sourceMappingURL=rive.js.map