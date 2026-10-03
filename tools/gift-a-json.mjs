#!/usr/bin/env node
/**
 * Convierte un banco de preguntas en formato GIFT (Moodle) al JSON que usa la app.
 *
 * Uso (desde la raíz del proyecto):
 *   node tools/gift-a-json.mjs [entrada.gift] [salida.json]
 *
 * Por defecto lee `practica_css_20.gift` y escribe `data/preguntas.json`.
 *
 * Solo admite preguntas de opción múltiple (`=` correcta, `~` incorrectas).
 * Los textos del JSON no llevan HTML: el código en línea queda marcado entre
 * comillas invertidas (`así`) y la app lo convierte en elementos <code>.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRADA = resolve(RAIZ, process.argv[2] ?? 'practica_css_20.gift');
const SALIDA = resolve(RAIZ, process.argv[3] ?? 'data/preguntas.json');

const ELEMENTOS_VACIOS = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const avisos = [];
const avisar = (mensaje) => avisos.push(mensaje);

/* ---------- Utilidades del formato GIFT ---------- */

/** Busca `buscado` en `texto` salteando los caracteres escapados con `\`. */
function indiceSinEscapar(texto, buscado, desde = 0) {
  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === '\\') {
      i++;
      continue;
    }
    if (texto.startsWith(buscado, i)) return i;
  }
  return -1;
}

/** Quita las barras de escape de GIFT: \~ \= \# \{ \} \: \\ y \n (salto de línea). */
function desescapar(texto) {
  return texto.replace(/\\(.)/g, (_, caracter) => (caracter === 'n' ? '\n' : caracter));
}

/** Separa el bloque de respuestas en opciones, cortando en cada `=` o `~` sin escapar. */
function separarOpciones(bloque) {
  const opciones = [];
  let actual = null;
  for (let i = 0; i < bloque.length; i++) {
    const caracter = bloque[i];
    if (caracter === '\\') {
      if (actual) actual.crudo += caracter + (bloque[i + 1] ?? '');
      i++;
    } else if (caracter === '=' || caracter === '~') {
      actual = { marca: caracter, crudo: '' };
      opciones.push(actual);
    } else if (actual) {
      actual.crudo += caracter;
    }
  }
  return opciones;
}

/* ---------- Utilidades de HTML ---------- */

function decodificarEntidades(texto) {
  return texto.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entidad, nombre) => {
    if (nombre[0] === '#') {
      const hexadecimal = nombre[1].toLowerCase() === 'x';
      return String.fromCodePoint(parseInt(nombre.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10));
    }
    return ENTIDADES[nombre.toLowerCase()] ?? entidad;
  });
}

function quitarEtiquetas(html) {
  return html.replace(/<[^>]*>/g, (etiqueta) => {
    if (!/^<\/?(code|pre|br|p)\b/i.test(etiqueta)) avisar(`Se descartó la etiqueta ${etiqueta}`);
    return /^<br\b/i.test(etiqueta) ? '\n' : '';
  });
}

/** Saca la sangría común a todas las líneas no vacías. */
function quitarSangria(texto) {
  const lineas = texto.replace(/\s+$/, '').split('\n');
  while (lineas.length && !lineas[0].trim()) lineas.shift();
  const sangria = Math.min(...lineas.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lineas.map((l) => l.slice(sangria).trimEnd()).join('\n');
}

/**
 * Pasa un fragmento HTML de GIFT a texto plano.
 * Cada <code> se convierte en `código` y las entidades (&lt; &gt;...) se decodifican.
 */
function htmlATexto(html) {
  const codigos = [];
  const conMarcas = html.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, contenido) => {
    const codigo = decodificarEntidades(quitarEtiquetas(contenido)).replace(/\s+/g, ' ').trim();
    if (codigo.includes('`')) avisar(`El código «${codigo}» tiene una comilla invertida y se va a mostrar mal.`);
    codigos.push(`\`${codigo}\``);
    // Marcador temporal: así el código (que ya puede tener < y >) no pasa por quitarEtiquetas.
    return `\u0000${codigos.length - 1}\u0000`;
  });
  return decodificarEntidades(quitarEtiquetas(conMarcas))
    .split('\n')
    .map((linea) => linea.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => codigos[n]);
}

/* ---------- Bloques de código: separar CSS y HTML ---------- */

/**
 * Clasifica cada línea de un bloque <pre> como CSS o HTML.
 * - Dentro de llaves abiertas, sigue siendo CSS.
 * - Una línea que empieza con `<` es HTML.
 * - Una línea que abre llaves o termina en coma (lista de selectores) es CSS.
 * - El resto (por ejemplo texto suelto) toma el tipo de la línea anterior.
 */
function separarCssDeHtml(bloque) {
  const css = [];
  const html = [];
  let profundidad = 0;
  let anterior = html;
  for (const linea of bloque.split('\n')) {
    const limpia = linea.trim();
    let destino = anterior;
    if (profundidad > 0) destino = css;
    else if (limpia.startsWith('<')) destino = html;
    else if (/[{,]$|\{/.test(limpia)) destino = css;
    if (destino === css) {
      profundidad += (limpia.match(/\{/g) ?? []).length - (limpia.match(/\}/g) ?? []).length;
    }
    destino.push(linea);
    anterior = destino;
  }
  return { css: css.length ? quitarSangria(css.join('\n')) : '', html: html.length ? quitarSangria(html.join('\n')) : '' };
}

/** Arma un elemento HTML a partir de un selector compuesto, por ejemplo `li.item#uno[type="x"]`. */
function elementoDesdeCompuesto(compuesto, contenido) {
  const sinPseudos = compuesto.replace(/::?[\w-]+(\([^)]*\))?/g, '');
  const porDefecto = contenido.startsWith('<li') ? 'ul' : 'div';
  const etiqueta = sinPseudos.match(/^[a-z][\w-]*/i)?.[0].toLowerCase() ?? porDefecto;
  const atributos = [];
  const id = sinPseudos.match(/#([\w-]+)/)?.[1];
  if (id) atributos.push(`id="${id}"`);
  const clases = [...sinPseudos.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (clases.length) atributos.push(`class="${clases.join(' ')}"`);
  for (const [, nombre, operador, valor = ''] of sinPseudos.matchAll(/\[([\w-]+)(?:([~|^$*]?=)\s*["']?([^"'\]]*)["']?)?\]/g)) {
    // Inventamos un valor que cumpla el selector de atributo.
    const ejemplos = { '^=': `${valor}-ejemplo`, '$=': `ejemplo${valor}`, '*=': `un-${valor}-ejemplo` };
    atributos.push(operador ? `${nombre}="${ejemplos[operador] ?? valor}"` : nombre);
  }
  if (etiqueta === 'a' && !atributos.some((a) => a.startsWith('href'))) atributos.push('href="#"');
  const apertura = `<${[etiqueta, ...atributos].join(' ')}>`;
  if (ELEMENTOS_VACIOS.has(etiqueta)) return apertura;
  if (!contenido.startsWith('<')) return `${apertura}${contenido}</${etiqueta}>`;
  return `${apertura}\n${contenido.replace(/^/gm, '  ')}\n</${etiqueta}>`;
}

/**
 * Genera un HTML mínimo para que se vean las reglas de un CSS que vino sin HTML.
 * `.caja { ... }` → `<div class="caja">Contenido</div>`
 * `nav > a { ... }` → `<nav>\n  <a href="#">Contenido</a>\n</nav>`
 */
function htmlParaCss(css) {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectores = [...sinComentarios.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((m) => m[1].split(',')[0].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(html|body|:root|\*)$/.test(s));

  const elementos = [...new Set(selectores)].map((selector) => {
    // "nav > a.activo" → [{ compuesto: 'nav' }, { compuesto: 'a.activo', combinador: '>' }]
    const pasos = [];
    let combinador = ' ';
    for (const parte of selector.replace(/\s*([>+~])\s*/g, ' $1 ').trim().split(/\s+/)) {
      if (/^[>+~]$/.test(parte)) combinador = parte;
      else {
        pasos.push({ compuesto: parte, combinador });
        combinador = ' ';
      }
    }
    // Se arma de derecha a izquierda: el último compuesto es el que recibe el estilo.
    let nodos = [elementoDesdeCompuesto(pasos.at(-1).compuesto, 'Contenido')];
    for (let i = pasos.length - 1; i > 0; i--) {
      const anterior = pasos[i - 1].compuesto;
      nodos = ['+', '~'].includes(pasos[i].combinador)
        ? [elementoDesdeCompuesto(anterior, 'Hermano'), ...nodos]
        : [elementoDesdeCompuesto(anterior, nodos.join('\n'))];
    }
    return nodos.join('\n');
  });
  return elementos.join('\n');
}

/** Los <li> sueltos se envuelven en una lista para que el HTML sea válido. */
function envolverItemsSueltos(html) {
  if (!/^<li[\s>]/.test(html) || /<[ou]l[\s>]/.test(html)) return html;
  return `<ul>\n${html.replace(/^/gm, '  ')}\n</ul>`;
}

function extraerCodigo(htmlDelPre) {
  const bloque = quitarSangria(decodificarEntidades(quitarEtiquetas(htmlDelPre)));
  const { css, html } = separarCssDeHtml(bloque);
  return { css, html: html ? envolverItemsSueltos(html) : htmlParaCss(css) };
}

/* ---------- Preguntas ---------- */

function crearId(titulo, usados) {
  const base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  usados.add(id);
  return id;
}

function convertirPregunta(bloque, numero, idsUsados) {
  let resto = bloque.trim();

  let titulo = `Pregunta ${numero}`;
  if (resto.startsWith('::')) {
    const fin = indiceSinEscapar(resto, '::', 2);
    titulo = desescapar(resto.slice(2, fin)).trim();
    resto = resto.slice(fin + 2).trimStart();
  }
  const formato = resto.match(/^\[(html|moodle|plain|markdown)\]/);
  if (formato) resto = resto.slice(formato[0].length);

  const abre = indiceSinEscapar(resto, '{');
  const cierra = indiceSinEscapar(resto, '}', abre + 1);
  if (abre === -1 || cierra === -1) {
    avisar(`«${titulo}»: no tiene bloque de respuestas { }; se omite.`);
    return null;
  }

  // Si hay texto después de las llaves, es una pregunta de "palabra faltante".
  const despues = resto.slice(cierra + 1).trim();
  let enunciadoHtml = desescapar(resto.slice(0, abre).trim() + (despues ? ` _____ ${despues}` : ''));

  let respuestas = resto.slice(abre + 1, cierra);
  const general = indiceSinEscapar(respuestas, '####');
  if (general !== -1) respuestas = respuestas.slice(0, general);

  const opciones = separarOpciones(respuestas).map(({ marca, crudo }) => {
    let texto = crudo;
    let peso = marca === '=' ? 100 : 0;
    const conPeso = texto.match(/^\s*%(-?\d+(?:\.\d+)?)%/);
    if (conPeso) {
      peso = Number(conPeso[1]);
      texto = texto.slice(conPeso[0].length);
    }
    const numeral = indiceSinEscapar(texto, '#');
    const retro = numeral === -1 ? '' : texto.slice(numeral + 1);
    if (numeral !== -1) texto = texto.slice(0, numeral);
    return {
      texto: htmlATexto(desescapar(texto)),
      correcta: peso >= 100,
      retro: htmlATexto(desescapar(retro)),
    };
  });

  if (opciones.length < 2) {
    avisar(`«${titulo}»: no es de opción múltiple (tiene ${opciones.length} opciones); se omite.`);
    return null;
  }
  const correctas = opciones.filter((o) => o.correcta).length;
  if (correctas !== 1) avisar(`«${titulo}»: tiene ${correctas} opciones correctas (se esperaba 1).`);

  // Un bloque <pre> se separa del enunciado y se reparte en CSS y HTML.
  let codigo = null;
  enunciadoHtml = enunciadoHtml.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i, (_, contenido) => {
    codigo = extraerCodigo(contenido);
    return '<br>';
  });

  return {
    id: crearId(titulo, idsUsados),
    titulo,
    nivel: codigo ? 'media' : 'básica',
    enunciado: htmlATexto(enunciadoHtml),
    codigo,
    opciones,
  };
}

function convertirGift(gift) {
  const sinComentarios = gift
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((linea) => !linea.trimStart().startsWith('//'))
    .join('\n');

  const idsUsados = new Set();
  return sinComentarios
    .split(/\n\s*\n/)
    .filter((bloque) => bloque.trim())
    .map((bloque, i) => convertirPregunta(bloque, i + 1, idsUsados))
    .filter(Boolean);
}

/* ---------- Programa principal ---------- */

const preguntas = convertirGift(await readFile(ENTRADA, 'utf8'));
await mkdir(dirname(SALIDA), { recursive: true });
await writeFile(SALIDA, `${JSON.stringify(preguntas, null, 2)}\n`, 'utf8');

const conCodigo = preguntas.filter((p) => p.codigo).length;
console.log(`✔ ${preguntas.length} preguntas convertidas (${preguntas.length - conCodigo} básicas, ${conCodigo} con código).`);
console.log(`  Archivo generado: ${SALIDA}`);
for (const aviso of avisos) console.warn(`⚠ ${aviso}`);
