/**
 * Lógica del cuestionario, independiente del DOM.
 *
 * El estado de un intento es un objeto plano (solo datos), así se puede guardar
 * en localStorage con JSON.stringify y recuperarlo tal cual al recargar.
 */

const VERSION_ESTADO = 1;

/** Devuelve una copia de la lista en orden aleatorio (algoritmo de Fisher-Yates). */
export function mezclar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** ¿Es `orden` una permutación de 0..cantidad-1? */
function esPermutacion(orden, cantidad) {
  return Array.isArray(orden) && orden.length === cantidad && [...orden].sort((a, b) => a - b).every((n, i) => n === i);
}

export class Cuestionario {
  #banco; // Map: id → pregunta
  #estado;

  constructor(banco, estado) {
    this.#banco = new Map(banco.map((pregunta) => [pregunta.id, pregunta]));
    this.#estado = estado;
  }

  /**
   * Crea un intento nuevo con las preguntas indicadas (por defecto, todas).
   * Se mezclan tanto las preguntas como las opciones de cada una.
   */
  static nuevo(banco, ids = banco.map((p) => p.id), modo = 'completo') {
    const elegidas = banco.filter((p) => ids.includes(p.id));
    return new Cuestionario(banco, {
      version: VERSION_ESTADO,
      modo,
      ids: mezclar(elegidas.map((p) => p.id)),
      ordenOpciones: Object.fromEntries(elegidas.map((p) => [p.id, mezclar(p.opciones.map((_, i) => i))])),
      respuestas: {}, // id de pregunta → índice (en pregunta.opciones) de la opción elegida
      actual: 0,
      terminado: false,
    });
  }

  /** Recupera un intento guardado. Devuelve null si los datos no coinciden con el banco actual. */
  static restaurar(banco, datos) {
    const porId = new Map(banco.map((p) => [p.id, p]));
    const cantidadDeOpciones = (id) => porId.get(id).opciones.length;
    const valido =
      datos?.version === VERSION_ESTADO &&
      Array.isArray(datos.ids) &&
      datos.ids.length > 0 &&
      datos.ids.every((id) => porId.has(id) && esPermutacion(datos.ordenOpciones?.[id], cantidadDeOpciones(id))) &&
      Number.isInteger(datos.actual) &&
      datos.actual >= 0 &&
      datos.actual < datos.ids.length &&
      Object.entries(datos.respuestas ?? {}).every(
        ([id, indice]) => datos.ids.includes(id) && Number.isInteger(indice) && indice >= 0 && indice < cantidadDeOpciones(id),
      );
    return valido ? new Cuestionario(banco, datos) : null;
  }

  get modo() {
    return this.#estado.modo;
  }

  get total() {
    return this.#estado.ids.length;
  }

  /** Número de la pregunta actual, empezando en 1. */
  get numero() {
    return this.#estado.actual + 1;
  }

  get esUltima() {
    return this.numero === this.total;
  }

  get terminado() {
    return this.#estado.terminado;
  }

  get pregunta() {
    return this.#banco.get(this.#estado.ids[this.#estado.actual]);
  }

  /** Opciones de la pregunta actual, en el orden mezclado de este intento. */
  get opciones() {
    const { id, opciones } = this.pregunta;
    return this.#estado.ordenOpciones[id].map((indice) => opciones[indice]);
  }

  /** Posición (en el orden mostrado) de la opción elegida, o -1 si todavía no se respondió. */
  get elegida() {
    const { id } = this.pregunta;
    const indice = this.#estado.respuestas[id];
    return indice === undefined ? -1 : this.#estado.ordenOpciones[id].indexOf(indice);
  }

  get respondida() {
    return this.elegida !== -1;
  }

  /** Cantidad de respuestas correctas hasta el momento. */
  get aciertos() {
    return Object.entries(this.#estado.respuestas).filter(([id, indice]) => this.#banco.get(id).opciones[indice].correcta)
      .length;
  }

  /** Registra la respuesta a la pregunta actual. Devuelve false si ya estaba respondida. */
  responder(posicion) {
    if (this.respondida || this.terminado) return false;
    const { id } = this.pregunta;
    this.#estado.respuestas[id] = this.#estado.ordenOpciones[id][posicion];
    return true;
  }

  /** Pasa a la pregunta siguiente; después de la última, marca el intento como terminado. */
  avanzar() {
    if (!this.respondida) return;
    if (this.esUltima) this.#estado.terminado = true;
    else this.#estado.actual++;
  }

  resultado() {
    const falladas = [];
    for (const id of this.#estado.ids) {
      const pregunta = this.#banco.get(id);
      const elegida = pregunta.opciones[this.#estado.respuestas[id]];
      if (!elegida?.correcta) {
        falladas.push({ pregunta, elegida, correcta: pregunta.opciones.find((o) => o.correcta) });
      }
    }
    const aciertos = this.total - falladas.length;
    return { aciertos, total: this.total, porcentaje: Math.round((aciertos / this.total) * 100), falladas };
  }

  /** JSON.stringify usa este método: se guarda solo el estado, no el banco. */
  toJSON() {
    return this.#estado;
  }
}
