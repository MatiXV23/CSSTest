/**
 * Inspector del resultado en vivo.
 *
 * Al pasar el mouse por un elemento del resultado (o al elegirlo de la lista)
 * dibuja su caja como las herramientas de desarrollo del navegador y muestra
 * sus medidas reales y algunos valores calculados.
 *
 * El iframe no puede ejecutar scripts (sandbox sin allow-scripts), pero como
 * tiene allow-same-origin, esta página sí puede leer su documento, escuchar
 * sus eventos y usar getBoundingClientRect y getComputedStyle sobre sus elementos.
 */

const LADOS = ['top', 'right', 'bottom', 'left'];
const NO_VISIBLES = new Set(['script', 'style', 'template', 'noscript', 'link', 'meta', 'title']);
const formatoNumero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** "div.caja", "h1#titulo", "li.alerta-box" */
export function describir(elemento) {
  const id = elemento.id ? `#${elemento.id}` : '';
  const clases = [...elemento.classList].map((clase) => `.${clase}`).join('');
  return `${elemento.localName}${id}${clases}`;
}

/** Abrevia cuatro valores como lo haría el shorthand de CSS: "10px 20px" en vez de "10px 20px 10px 20px". */
function abreviar([arriba, derecha, abajo, izquierda]) {
  if (derecha === izquierda) {
    if (arriba === abajo) return arriba === derecha ? arriba : `${arriba} ${derecha}`;
    return `${arriba} ${derecha} ${abajo}`;
  }
  return `${arriba} ${derecha} ${abajo} ${izquierda}`;
}

function profundidad(elemento) {
  let nivel = 0;
  for (let actual = elemento; actual.parentElement && actual.localName !== 'body'; actual = actual.parentElement) nivel++;
  return nivel;
}

/** Ubica una capa del dibujo: su caja es `rect` y sus bordes tienen los anchos indicados. */
function ubicar(capa, rect, anchos = [0, 0, 0, 0]) {
  Object.assign(capa.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(rect.width, 0)}px`,
    height: `${Math.max(rect.height, 0)}px`,
    borderWidth: anchos.map((ancho) => `${Math.max(ancho, 0)}px`).join(' '),
  });
}

/** Agranda (o achica, con valores negativos) un rectángulo en cada lado. */
function expandir(rect, [arriba, derecha, abajo, izquierda]) {
  return {
    left: rect.left - izquierda,
    top: rect.top - arriba,
    width: rect.width + izquierda + derecha,
    height: rect.height + arriba + abajo,
  };
}

const achicar = (rect, medidas) => expandir(rect, medidas.map((medida) => -medida));

export class Inspector {
  #iframe;
  #contorno;
  #capas;
  #lista;
  #datos;
  #anuncio;
  #elementos = [];
  #indice = -1; // posición en #elementos del elemento inspeccionado

  constructor(raiz) {
    this.#iframe = raiz.querySelector('iframe');
    this.#contorno = raiz.querySelector('.contorno');
    this.#capas = Object.fromEntries(
      ['margen', 'borde', 'relleno', 'contenido'].map((nombre) => [nombre, raiz.querySelector(`.capa-${nombre}`)]),
    );
    this.#lista = raiz.querySelector('.inspector-lista');
    this.#datos = Object.fromEntries([...raiz.querySelectorAll('[data-dato]')].map((dd) => [dd.dataset.dato, dd]));
    this.#anuncio = raiz.querySelector('.inspector-anuncio');

    this.#lista.addEventListener('change', () => {
      this.#inspeccionar(this.#lista.value === '' ? -1 : Number(this.#lista.value));
      this.#anunciar();
    });
  }

  /** Se llama cada vez que el iframe termina de cargar un resultado nuevo. */
  conectar() {
    const documento = this.#iframe.contentDocument;
    if (!documento?.body) return;

    this.#elementos = [documento.body, ...documento.body.querySelectorAll('*')].filter(
      (elemento) => !NO_VISIBLES.has(elemento.localName),
    );
    this.#lista.replaceChildren(
      new Option('Elegí un elemento…', ''),
      ...this.#elementos.map((elemento, i) => new Option(`${'  '.repeat(profundidad(elemento))}${describir(elemento)}`, i)),
    );

    documento.addEventListener('mouseover', (evento) => {
      const indice = this.#elementos.indexOf(evento.target);
      if (indice !== -1) this.#inspeccionar(indice);
    });
    documento.defaultView.addEventListener('scroll', () => this.#dibujar());

    // Si había un elemento elegido, se vuelve a medir con el código nuevo.
    this.#inspeccionar(this.#indice < this.#elementos.length ? this.#indice : -1);
  }

  /** Olvida el elemento elegido (al cambiar de pregunta). */
  reiniciar() {
    this.#indice = -1;
    this.#inspeccionar(-1);
  }

  #inspeccionar(indice) {
    this.#indice = indice;
    this.#lista.value = indice === -1 ? '' : String(indice);
    const elemento = this.#elementos[indice];

    if (!elemento?.isConnected) {
      this.#contorno.hidden = true;
      for (const dd of Object.values(this.#datos)) dd.replaceChildren('—');
      return;
    }

    // getBoundingClientRect: tamaño real en pantalla (con relleno y borde).
    const caja = elemento.getBoundingClientRect();
    // getComputedStyle: valores finales después de aplicar la cascada.
    const estilo = elemento.ownerDocument.defaultView.getComputedStyle(elemento);
    const lados = (propiedad) => abreviar(LADOS.map((lado) => estilo.getPropertyValue(propiedad.replace('*', lado))));

    const muestra = document.createElement('span');
    muestra.className = 'muestra-color';
    muestra.style.backgroundColor = estilo.color;

    this.#datos.ancho.replaceChildren(`${formatoNumero.format(caja.width)} px`);
    this.#datos.alto.replaceChildren(`${formatoNumero.format(caja.height)} px`);
    this.#datos.color.replaceChildren(muestra, estilo.color);
    this.#datos.padding.replaceChildren(lados('padding-*'));
    this.#datos.borde.replaceChildren(lados('border-*-width'));
    this.#datos.margen.replaceChildren(lados('margin-*'));
    this.#dibujar();
  }

  /** Dibuja margen, borde, relleno y contenido sobre el iframe, como en las DevTools. */
  #dibujar() {
    const elemento = this.#elementos[this.#indice];
    if (!elemento?.isConnected) return;

    const estilo = elemento.ownerDocument.defaultView.getComputedStyle(elemento);
    const medidas = (propiedad) => LADOS.map((lado) => parseFloat(estilo.getPropertyValue(propiedad.replace('*', lado))) || 0);
    const margen = medidas('margin-*');
    const borde = medidas('border-*-width');
    const relleno = medidas('padding-*');

    // Las coordenadas son relativas al iframe, que ocupa toda la capa del contorno.
    const cajaBorde = elemento.getBoundingClientRect();
    const cajaRelleno = achicar(cajaBorde, borde);
    ubicar(this.#capas.margen, expandir(cajaBorde, margen.map((m) => Math.max(m, 0))), margen);
    ubicar(this.#capas.borde, cajaBorde, borde);
    ubicar(this.#capas.relleno, cajaRelleno, relleno);
    ubicar(this.#capas.contenido, achicar(cajaRelleno, relleno));
    this.#contorno.hidden = false;
  }

  /** Para lectores de pantalla: resume lo que se ve en la tabla al elegir de la lista. */
  #anunciar() {
    const elemento = this.#elementos[this.#indice];
    if (!elemento) {
      this.#anuncio.textContent = '';
      return;
    }
    const dato = (clave) => this.#datos[clave].textContent;
    this.#anuncio.textContent =
      `${describir(elemento)}: ${dato('ancho')} de ancho y ${dato('alto')} de alto. ` +
      `Color ${dato('color')}, padding ${dato('padding')}, border-width ${dato('borde')}, margin ${dato('margen')}.`;
  }
}
