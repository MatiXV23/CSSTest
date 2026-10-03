/**
 * Paneles de código de las preguntas.
 *
 * - Antes de responder: CSS y HTML de solo lectura, con resaltado de sintaxis
 *   hecho a mano y numeración de líneas.
 * - Después de responder ("Probar en vivo"): los paneles pasan a ser editables
 *   y el resultado se dibuja en un iframe que se actualiza mientras se escribe.
 *
 * El código nunca se inserta con innerHTML: se arma con nodos de texto y <span>,
 * así un `<script>` dentro de un ejemplo se muestra como texto y no se ejecuta.
 */

import { Inspector } from './inspector.js';

const DEMORA_ACTUALIZACION = 300; // ms sin escribir antes de redibujar el resultado
const ALTO_VISTA = { minimo: 160, maximo: 480 }; // px

/* ---------- Resaltado de sintaxis ---------- */

// Reglas @ cuyo bloque contiene otras reglas (y no declaraciones).
const ARROBAS_AGRUPADORAS = /^@(media|supports|container|layer|document|scope|starting-style)$/i;

/** Busca `regex` (con la bandera `y`) exactamente en la posición `i`. */
function leer(regex, codigo, i) {
  regex.lastIndex = i;
  return regex.exec(codigo)?.[0];
}

/**
 * Divide CSS en fragmentos { tipo, texto }.
 * No es un analizador completo: alcanza para colorear ejemplos cortos.
 * `contexto` es 'reglas' para una hoja de estilo o 'declaraciones' para un atributo style.
 */
export function fragmentosCSS(codigo, contexto = 'reglas') {
  const fragmentos = [];
  const bloques = [contexto]; // pila: qué hay dentro de cada { abierta
  let enValor = false; // después de los dos puntos de una declaración
  let arroba = null; // nombre de la regla @ que se está leyendo

  for (let i = 0; i < codigo.length; ) {
    const enDeclaraciones = bloques.at(-1) === 'declaraciones';
    const caracter = codigo[i];
    let texto;
    let tipo = null;

    if ((texto = leer(/\/\*[\s\S]*?(?:\*\/|$)/y, codigo, i))) tipo = 'comentario';
    else if ((texto = leer(/\s+/y, codigo, i))) tipo = null;
    else if ((texto = leer(/(["'])(?:\\.|(?!\1)[^\\\n])*\1?/y, codigo, i))) tipo = 'cadena';
    else if (caracter === '{') {
      bloques.push(arroba && ARROBAS_AGRUPADORAS.test(arroba) ? 'reglas' : 'declaraciones');
      [texto, tipo, enValor, arroba] = ['{', 'puntuacion', false, null];
    } else if (caracter === '}') {
      if (bloques.length > 1) bloques.pop();
      [texto, tipo, enValor] = ['}', 'puntuacion', false];
    } else if (caracter === ';') {
      [texto, tipo, enValor, arroba] = [';', 'puntuacion', false, null];
    } else if (enDeclaraciones && !enValor) {
      if (caracter === ':') [texto, tipo, enValor] = [':', 'puntuacion', true];
      else if ((texto = leer(/[\w-]+/y, codigo, i))) tipo = 'propiedad';
    } else if (enDeclaraciones) {
      if ((texto = leer(/!\s*important\b/iy, codigo, i))) tipo = 'importante';
      else if ((texto = leer(/#[\da-f]{3,8}\b/iy, codigo, i))) tipo = 'numero';
      else if ((texto = leer(/-?(?:\d*\.)?\d+(?:%|[a-z]+)?/iy, codigo, i))) tipo = 'numero';
      else if ((texto = leer(/[\w-]+(?=\()/y, codigo, i))) tipo = 'funcion';
      else if ((texto = leer(/[\w-]+/y, codigo, i))) tipo = 'valor';
    } else if ((texto = leer(/@[\w-]+/y, codigo, i))) {
      [tipo, arroba] = ['arroba', texto];
    } else if (arroba) {
      if ((texto = leer(/[^\s{};"'/]+/y, codigo, i))) tipo = 'valor';
    } else if ((texto = leer(/[^\s{};"'/]+/y, codigo, i))) {
      tipo = 'selector';
    }

    if (!texto) [texto, tipo] = [caracter, 'puntuacion'];
    fragmentos.push({ tipo, texto });
    i += texto.length;
  }
  return fragmentos;
}

/** Divide HTML en fragmentos { tipo, texto }. El contenido de <style> y de style="" se colorea como CSS. */
export function fragmentosHTML(codigo) {
  const fragmentos = [];
  const agregar = (tipo, texto) => fragmentos.push({ tipo, texto });

  for (let i = 0; i < codigo.length; ) {
    let texto;
    if ((texto = leer(/<!--[\s\S]*?(?:-->|$)/y, codigo, i)) || (texto = leer(/<![^>]*>?/y, codigo, i))) {
      agregar('comentario', texto);
      i += texto.length;
      continue;
    }

    const apertura = leer(/<\/?(?=[a-z])/iy, codigo, i);
    if (!apertura) {
      // Texto común hasta la próxima etiqueta.
      texto = leer(/[^<]+|</y, codigo, i);
      agregar(null, texto);
      i += texto.length;
      continue;
    }

    agregar('puntuacion', apertura);
    i += apertura.length;
    const nombre = leer(/[a-z][\w-]*/iy, codigo, i);
    agregar('etiqueta', nombre);
    i += nombre.length;

    // Atributos, hasta el > que cierra la etiqueta.
    let atributo = null;
    while (i < codigo.length) {
      if ((texto = leer(/\s+/y, codigo, i))) agregar(null, texto);
      else if ((texto = leer(/\/?>/y, codigo, i))) {
        agregar('puntuacion', texto);
        i += texto.length;
        break;
      } else if (codigo[i] === '=') agregar('puntuacion', (texto = '='));
      else if ((texto = leer(/"[^"]*"?|'[^']*'?/y, codigo, i))) {
        const comilla = texto[0];
        const cierra = texto.length > 1 && texto.endsWith(comilla);
        if (atributo === 'style') {
          agregar('cadena', comilla);
          fragmentos.push(...fragmentosCSS(texto.slice(1, cierra ? -1 : undefined), 'declaraciones'));
          if (cierra) agregar('cadena', comilla);
        } else agregar('cadena', texto);
      } else {
        texto = leer(/[^\s"'>/=]+|./y, codigo, i);
        atributo = texto.toLowerCase();
        agregar('atributo', texto);
      }
      i += texto.length;
    }

    // El contenido de <style> es CSS.
    if (apertura === '<' && nombre.toLowerCase() === 'style') {
      const fin = codigo.toLowerCase().indexOf('</style', i);
      const css = codigo.slice(i, fin === -1 ? undefined : fin);
      fragmentos.push(...fragmentosCSS(css));
      i += css.length;
    }
  }
  return fragmentos;
}

/** Crea un <span> por fragmento; los nodos de texto sin tipo quedan como texto plano. */
function nodosResaltados(fragmentos) {
  return fragmentos.map(({ tipo, texto }) => {
    if (!tipo) return texto;
    const span = document.createElement('span');
    span.className = `sintaxis-${tipo}`;
    span.textContent = texto;
    return span;
  });
}

/**
 * Devuelve un <span class="linea"> por cada línea del código, con la sintaxis coloreada.
 * La numeración la pone el CSS con un contador, así no se mezcla con el texto copiado.
 */
export function lineasResaltadas(codigo, lenguaje) {
  const fragmentos = lenguaje === 'css' ? fragmentosCSS(codigo) : fragmentosHTML(codigo);
  const lineas = [[]];
  for (const { tipo, texto } of fragmentos) {
    texto.split('\n').forEach((parte, i) => {
      if (i > 0) lineas.push([]);
      if (parte) lineas.at(-1).push({ tipo, texto: parte });
    });
  }
  return lineas.map((linea) => {
    const span = document.createElement('span');
    span.className = 'linea';
    span.append(...nodosResaltados(linea));
    return span;
  });
}

/** Crea un bloque <pre><code> resaltado y numerado. */
export function bloqueDeCodigo(codigo, lenguaje) {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  pre.className = 'fuente';
  code.append(...lineasResaltadas(codigo, lenguaje));
  pre.append(code);
  return pre;
}

/* ---------- Edición ---------- */

/**
 * Inserta texto en la selección del textarea.
 * execCommand conserva el historial para deshacer (Ctrl+Z); si el navegador
 * no lo admite, se usa setRangeText y se avisa del cambio con un evento input.
 */
function insertar(textarea, texto) {
  if (!document.execCommand?.('insertText', false, texto)) {
    textarea.setRangeText(texto, textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Agrega (o quita) dos espacios al comienzo de las líneas seleccionadas. */
function sangrar(textarea, quitar) {
  const { value, selectionStart: inicio } = textarea;
  let { selectionEnd: fin } = textarea;
  if (fin > inicio && value[fin - 1] === '\n') fin--; // la línea donde termina la selección no cuenta
  const variasLineas = value.slice(inicio, fin).includes('\n');

  if (!quitar && !variasLineas) {
    insertar(textarea, '  ');
    return;
  }
  const desde = value.lastIndexOf('\n', inicio - 1) + 1;
  const bloque = value.slice(desde, fin);
  const nuevo = quitar ? bloque.replace(/^ {1,2}/gm, '') : bloque.replace(/^/gm, '  ');
  if (nuevo === bloque) return;
  textarea.setSelectionRange(desde, fin);
  insertar(textarea, nuevo);
  if (variasLineas) textarea.setSelectionRange(desde, desde + nuevo.length);
}

/** Documento que se muestra en el iframe: estilo base neutro + el código del alumno. */
function documentoDeVista(css, html) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  /* Base neutra: fondo blanco y tipografía del sistema, igual en todas las computadoras. */
  html { color-scheme: light; background: #fff; color: #000; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { margin: 16px; }
</style>
<style>
${css.replace(/<\/style/gi, '<\\/style')}
</style>
</head>
<body>
${html}
</body>
</html>`;
}

/* ---------- Paneles ---------- */

class PanelDeCodigo {
  #tabLibre = false; // después de Esc, Tab vuelve a mover el foco

  constructor(figura, alCambiar) {
    this.lenguaje = figura.dataset.lenguaje;
    this.fuente = figura.querySelector('.fuente');
    this.numeros = figura.querySelector('.numeros');
    this.editor = figura.querySelector('textarea');
    this.original = '';

    this.editor.addEventListener('input', () => {
      this.#ajustar();
      alCambiar();
    });
    this.editor.addEventListener('keydown', (evento) => this.#teclaEnEditor(evento));
    this.editor.addEventListener('blur', () => {
      this.#tabLibre = false;
    });
  }

  get valor() {
    return this.editor.hidden ? this.original : this.editor.value;
  }

  /** Modo lectura: código coloreado. */
  mostrar(codigo) {
    this.original = codigo;
    this.fuente.querySelector('code').replaceChildren(...lineasResaltadas(codigo, this.lenguaje));
    this.#modoEdicion(false);
  }

  /** Modo edición: textarea con el código original. */
  editar() {
    this.#modoEdicion(true);
    this.restaurar();
  }

  restaurar() {
    this.editor.value = this.original;
    this.#ajustar();
  }

  #modoEdicion(activo) {
    this.fuente.hidden = activo;
    this.numeros.hidden = !activo;
    this.editor.hidden = !activo;
  }

  /** Actualiza los números de línea y hace crecer el textarea para que no tenga barra vertical. */
  #ajustar() {
    const lineas = this.editor.value.split('\n').length;
    this.numeros.textContent = Array.from({ length: lineas }, (_, i) => i + 1).join('\n');
    this.editor.style.height = 'auto';
    const bordes = this.editor.offsetHeight - this.editor.clientHeight; // incluye la barra horizontal
    this.editor.style.height = `${this.editor.scrollHeight + bordes}px`;
  }

  #teclaEnEditor(evento) {
    if (evento.key === 'Escape') {
      this.#tabLibre = true;
      return;
    }
    if (evento.key === 'Tab' && !this.#tabLibre && !evento.altKey && !evento.ctrlKey && !evento.metaKey) {
      evento.preventDefault();
      sangrar(this.editor, evento.shiftKey);
    } else if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
      // Mantiene la sangría de la línea actual (y suma dos espacios después de una llave).
      evento.preventDefault();
      const { value, selectionStart } = this.editor;
      const linea = value.slice(value.lastIndexOf('\n', selectionStart - 1) + 1, selectionStart);
      const sangria = linea.match(/^\s*/)[0] + (/\{\s*$/.test(linea) ? '  ' : '');
      insertar(this.editor, `\n${sangria}`);
    }
    if (evento.key !== 'Shift') this.#tabLibre = false;
  }
}

export class VisorDeCodigo {
  #temporizador;

  constructor(seccion) {
    this.seccion = seccion;
    this.paneles = [...seccion.querySelectorAll('.panel')].map(
      (figura) => new PanelDeCodigo(figura, () => this.#programarActualizacion()),
    );
    this.botonProbar = seccion.querySelector('.boton-probar');
    this.botonRestaurar = seccion.querySelector('.boton-restaurar');
    this.ayudaProbar = seccion.querySelector('.ayuda-probar');
    this.ayudaEditor = seccion.querySelector('.ayuda-editor');
    this.vivo = seccion.querySelector('.vivo');
    this.vista = seccion.querySelector('iframe');
    this.inspector = new Inspector(this.vivo);

    this.botonProbar.addEventListener('click', () => this.probar());
    this.botonRestaurar.addEventListener('click', () => {
      for (const panel of this.paneles) panel.restaurar();
      this.#actualizarVista();
    });
    this.vista.addEventListener('load', () => {
      this.#ajustarAltoDeVista();
      this.inspector.conectar();
    });
  }

  /** Muestra el código de una pregunta, o esconde la sección si la pregunta no tiene. */
  cargar(codigo) {
    clearTimeout(this.#temporizador);
    this.seccion.hidden = !codigo;
    if (!codigo) return;

    for (const panel of this.paneles) panel.mostrar(codigo[panel.lenguaje]);
    this.botonProbar.hidden = false;
    this.botonProbar.disabled = true;
    this.ayudaProbar.hidden = false;
    this.ayudaProbar.textContent = 'Respondé la pregunta para habilitar la prueba en vivo.';
    this.botonRestaurar.hidden = true;
    this.ayudaEditor.hidden = true;
    this.vivo.hidden = true;
    this.inspector.reiniciar();
  }

  /** Se llama después de responder. */
  habilitarPrueba() {
    this.botonProbar.disabled = false;
    this.ayudaProbar.textContent = 'Editá el CSS y el HTML y mirá cómo cambia el resultado.';
  }

  probar() {
    for (const panel of this.paneles) panel.editar();
    this.botonProbar.hidden = true;
    this.ayudaProbar.hidden = true;
    this.botonRestaurar.hidden = false;
    this.ayudaEditor.hidden = false;
    this.vivo.hidden = false;
    this.#actualizarVista();
    this.paneles[0].editor.focus();
  }

  #programarActualizacion() {
    clearTimeout(this.#temporizador);
    this.#temporizador = setTimeout(() => this.#actualizarVista(), DEMORA_ACTUALIZACION);
  }

  #actualizarVista() {
    clearTimeout(this.#temporizador);
    const codigo = Object.fromEntries(this.paneles.map((panel) => [panel.lenguaje, panel.valor]));
    this.vista.srcdoc = documentoDeVista(codigo.css, codigo.html);
  }

  /** El iframe toma el alto de su contenido, dentro de un mínimo y un máximo. */
  #ajustarAltoDeVista() {
    const documento = this.vista.contentDocument;
    if (!documento?.documentElement || this.vivo.hidden) return;
    this.vista.style.height = `${ALTO_VISTA.minimo}px`;
    const alto = documento.documentElement.scrollHeight;
    this.vista.style.height = `${Math.min(Math.max(alto, ALTO_VISTA.minimo), ALTO_VISTA.maximo)}px`;
  }
}
