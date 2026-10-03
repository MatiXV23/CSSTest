/**
 * Paneles de código de las preguntas: resaltado de sintaxis hecho a mano
 * y numeración de líneas.
 *
 * El código nunca se inserta con innerHTML: se arma con nodos de texto y <span>,
 * así un `<script>` dentro de un ejemplo se muestra como texto y no se ejecuta.
 */

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

/* ---------- Paneles ---------- */

class PanelDeCodigo {
  constructor(figura) {
    this.lenguaje = figura.dataset.lenguaje;
    this.fuente = figura.querySelector('.fuente code');
  }

  mostrar(codigo) {
    this.fuente.replaceChildren(...lineasResaltadas(codigo, this.lenguaje));
  }
}

export class VisorDeCodigo {
  constructor(seccion) {
    this.seccion = seccion;
    this.paneles = [...seccion.querySelectorAll('.panel')].map((figura) => new PanelDeCodigo(figura));
  }

  /** Muestra el código de una pregunta, o esconde la sección si la pregunta no tiene. */
  cargar(codigo) {
    this.seccion.hidden = !codigo;
    if (!codigo) return;
    for (const panel of this.paneles) panel.mostrar(codigo[panel.lenguaje]);
  }
}
