/**
 * Punto de entrada: carga las preguntas, maneja las pantallas y el teclado,
 * y guarda el progreso en localStorage.
 */

import { Cuestionario } from './quiz.js';
import { VisorDeCodigo, bloqueDeCodigo } from './editor.js';

// La ruta se resuelve desde este archivo, así funciona en cualquier subcarpeta (GitHub Pages).
const URL_PREGUNTAS = new URL('../data/preguntas.json', import.meta.url);
const CLAVE_PROGRESO = 'practica-css:progreso';
const NIVELES = {
  básica: { nombre: 'Básica', barras: 1 },
  media: { nombre: 'Media', barras: 2 },
};

const $ = (selector) => document.querySelector(selector);

const pantallas = {
  inicio: $('#inicio'),
  cuestionario: $('#cuestionario'),
  resultados: $('#resultados'),
};
const visor = new VisorDeCodigo($('#codigo'));

let banco = [];
let cuestionario = null;

/* ---------- Progreso guardado ---------- */

// localStorage puede no estar disponible (modo privado, permisos): en ese caso se sigue sin guardar.
function guardarProgreso() {
  try {
    localStorage.setItem(CLAVE_PROGRESO, JSON.stringify(cuestionario));
  } catch {
    /* sin almacenamiento */
  }
}

function leerProgreso() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PROGRESO));
  } catch {
    return null;
  }
}

function borrarProgreso() {
  try {
    localStorage.removeItem(CLAVE_PROGRESO);
  } catch {
    /* sin almacenamiento */
  }
}

/* ---------- Ayudas para armar el DOM ---------- */

function elemento(etiqueta, clase, ...hijos) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  nodo.append(...hijos);
  return nodo;
}

/** Convierte "El selector `a:hover` ..." en texto con elementos <code>. */
function textoConCodigo(texto) {
  const fragmento = document.createDocumentFragment();
  texto.split('`').forEach((parte, i) => {
    if (!parte) return;
    fragmento.append(i % 2 ? elemento('code', '', parte) : parte);
  });
  return fragmento;
}

/** Un párrafo por cada línea del enunciado. */
function parrafos(texto) {
  return texto.split('\n').map((linea) => elemento('p', '', textoConCodigo(linea)));
}

/** "Práctica - Selectores - Clase sola" → "Selectores" */
function temaDe(titulo) {
  const partes = titulo.split(' - ');
  return partes.length > 1 ? partes.at(-2) : '';
}

function etiquetaDeNivel(nivel) {
  const { nombre, barras } = NIVELES[nivel];
  const marcas = elemento('span', 'barras');
  marcas.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 2; i++) marcas.append(elemento('i', i <= barras ? 'llena' : ''));
  return elemento('span', `nivel nivel--${nivel === 'básica' ? 'basica' : nivel}`, marcas, elemento('span', 'vh', 'Nivel: '), nombre);
}

function mostrarPantalla(nombre, foco) {
  $('#carga').hidden = true;
  for (const [clave, pantalla] of Object.entries(pantallas)) pantalla.hidden = clave !== nombre;
  window.scrollTo(0, 0);
  foco?.focus({ preventScroll: true });
}

/* ---------- Inicio ---------- */

function renderInicio() {
  const conCodigo = banco.filter((p) => p.codigo).length;
  $('#cantidad-total').textContent = banco.length;
  $('#cantidad-basicas').textContent = banco.length - conCodigo;
  $('#cantidad-medias').textContent = conCodigo;
  document.title = 'Práctica de CSS';
}

function irAlInicio() {
  cuestionario = null;
  borrarProgreso();
  renderInicio();
  mostrarPantalla('inicio', $('#titulo-inicio'));
}

function empezar(ids, modo) {
  cuestionario = Cuestionario.nuevo(banco, ids, modo);
  guardarProgreso();
  mostrarPantalla('cuestionario');
  renderPregunta();
}

/* ---------- Cuestionario ---------- */

function renderPregunta() {
  const { pregunta, numero, total } = cuestionario;

  document.title = `Pregunta ${numero} de ${total} · Práctica de CSS`;
  $('#numero-pregunta').replaceChildren(`Pregunta ${numero} `, elemento('span', '', `de ${total}`));
  $('#tema').textContent = temaDe(pregunta.titulo);
  $('#nivel').replaceChildren(etiquetaDeNivel(pregunta.nivel));
  $('#modo').hidden = cuestionario.modo !== 'falladas';
  $('#enunciado').replaceChildren(...parrafos(pregunta.enunciado));
  visor.cargar(pregunta.codigo);

  const plantilla = $('#plantilla-opcion');
  $('#opciones').replaceChildren(
    ...cuestionario.opciones.map((opcion, posicion) => {
      const item = plantilla.content.cloneNode(true);
      const boton = item.querySelector('button');
      boton.dataset.posicion = posicion;
      boton.setAttribute('aria-keyshortcuts', String(posicion + 1));
      item.querySelector('.numero').textContent = posicion + 1;
      item.querySelector('.texto').append(textoConCodigo(opcion.texto));
      return item;
    }),
  );

  $('#retroalimentacion').replaceChildren();
  $('#retroalimentacion').className = 'retroalimentacion';
  $('#btn-siguiente').hidden = true;
  $('#btn-siguiente').replaceChildren(
    ...(cuestionario.esUltima ? ['Ver resultados'] : ['Siguiente ', elemento('span', '', '→')]),
  );
  $('#btn-siguiente').lastElementChild?.setAttribute('aria-hidden', 'true');

  actualizarProgreso();
  if (cuestionario.respondida) mostrarCorreccion();

  window.scrollTo(0, 0);
  $('#numero-pregunta').focus({ preventScroll: true });
}

function actualizarProgreso() {
  const { numero, total, aciertos, respondida } = cuestionario;
  $('#progreso').max = total;
  $('#progreso').value = numero - (respondida ? 0 : 1);
  $('#aciertos').textContent = aciertos === 1 ? '1 correcta' : `${aciertos} correctas`;
}

function responder(posicion) {
  if (!cuestionario.responder(posicion)) return;
  guardarProgreso();
  mostrarCorreccion();
  $('#btn-siguiente').focus();
}

/** Bloquea las opciones, las marca y muestra la retroalimentación. */
function mostrarCorreccion() {
  const { opciones, elegida } = cuestionario;
  const correcta = opciones.findIndex((opcion) => opcion.correcta);
  const acerto = elegida === correcta;

  for (const boton of $('#opciones').querySelectorAll('button')) {
    const posicion = Number(boton.dataset.posicion);
    const marca = boton.querySelector('.marca');
    boton.disabled = true;
    if (posicion === correcta) {
      boton.classList.add('es-correcta');
      marca.replaceChildren(elemento('span', '', '✓ '), acerto ? 'Tu respuesta: correcta' : 'Respuesta correcta');
    } else if (posicion === elegida) {
      boton.classList.add('es-incorrecta');
      marca.replaceChildren(elemento('span', '', '✗ '), 'Tu respuesta: incorrecta');
    }
    marca.firstElementChild?.setAttribute('aria-hidden', 'true');
  }

  const elegidaRetro = opciones[elegida].retro;
  const contenido = [elemento('p', 'veredicto', acerto ? '¡Correcto!' : 'Incorrecto.')];
  if (acerto) {
    if (elegidaRetro) contenido.push(elemento('p', '', textoConCodigo(elegidaRetro)));
  } else {
    if (elegidaRetro) contenido.push(elemento('p', '', elemento('strong', '', 'Tu respuesta: '), textoConCodigo(elegidaRetro)));
    const { texto, retro } = opciones[correcta];
    contenido.push(
      elemento('p', '', elemento('strong', '', 'Respuesta correcta: '), textoConCodigo(texto), retro ? ' ' : ''),
    );
    if (retro) contenido.at(-1).append(textoConCodigo(retro));
  }
  const caja = $('#retroalimentacion');
  caja.className = `retroalimentacion retroalimentacion--${acerto ? 'ok' : 'mal'}`;
  caja.replaceChildren(...contenido);

  $('#btn-siguiente').hidden = false;
  actualizarProgreso();
}

function siguiente() {
  if (!cuestionario?.respondida) return;
  cuestionario.avanzar();
  guardarProgreso();
  if (cuestionario.terminado) mostrarResultados();
  else renderPregunta();
}

/* ---------- Resultados ---------- */

function mensajePara(porcentaje) {
  if (porcentaje === 100) return '¡Perfecto! Respondiste todo bien.';
  if (porcentaje >= 80) return '¡Muy bien! Repasá las que fallaste para cerrar los detalles.';
  if (porcentaje >= 60) return 'Vas bien, pero conviene repasar algunos temas.';
  return 'Hay que repasar. Leé las explicaciones de abajo y probá de nuevo.';
}

function mostrarResultados() {
  const { aciertos, total, porcentaje, falladas } = cuestionario.resultado();

  document.title = `Resultados: ${aciertos} de ${total} · Práctica de CSS`;
  $('#puntaje').textContent = aciertos;
  $('#puntaje-total').textContent = total;
  $('#porcentaje').textContent = `${porcentaje} % de respuestas correctas`;
  $('#mensaje').textContent = mensajePara(porcentaje);

  $('#btn-falladas').hidden = falladas.length === 0;
  $('#btn-falladas').textContent = `Practicar solo las falladas (${falladas.length})`;
  $('#sin-falladas').hidden = falladas.length > 0;

  const plantilla = $('#plantilla-fallada');
  $('#lista-falladas').replaceChildren(
    ...falladas.map(({ pregunta, elegida, correcta }, i) => {
      const item = plantilla.content.cloneNode(true);
      item.querySelector('.numero-fallada').textContent = `${i + 1} de ${falladas.length}`;
      item.querySelector('.tema').textContent = temaDe(pregunta.titulo);
      item.querySelector('.enunciado').append(...parrafos(pregunta.enunciado));
      if (pregunta.codigo) {
        item.querySelector('.codigo-fallada').hidden = false;
        item.querySelector('.codigo-fallada-bloques').append(
          elemento('p', 'rotulo', 'CSS'),
          bloqueDeCodigo(pregunta.codigo.css, 'css'),
          elemento('p', 'rotulo', 'HTML'),
          bloqueDeCodigo(pregunta.codigo.html, 'html'),
        );
      }
      const [tuya, buena] = item.querySelectorAll('.respuesta');
      for (const [caja, opcion] of [
        [tuya, elegida],
        [buena, correcta],
      ]) {
        caja.querySelector('.texto').append(textoConCodigo(opcion.texto));
        caja.querySelector('.explicacion').append(textoConCodigo(opcion.retro));
      }
      return item;
    }),
  );

  mostrarPantalla('resultados', $('#titulo-resultados'));
}

/* ---------- Eventos ---------- */

$('#btn-empezar').addEventListener('click', () => empezar());

$('#opciones').addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-posicion]');
  if (boton) responder(Number(boton.dataset.posicion));
});

$('#btn-siguiente').addEventListener('click', siguiente);

$('#btn-reintentar').addEventListener('click', () => empezar());

$('#btn-falladas').addEventListener('click', () => {
  empezar(cuestionario.resultado().falladas.map(({ pregunta }) => pregunta.id), 'falladas');
});

$('#btn-reiniciar').addEventListener('click', () => $('#dialogo-reiniciar').showModal());

$('#dialogo-reiniciar').addEventListener('close', (evento) => {
  if (evento.target.returnValue === 'confirmar') irAlInicio();
  else $('#btn-reiniciar').focus();
});

// Atajos: 1 a 4 eligen una opción y la flecha derecha pasa a la siguiente pregunta.
document.addEventListener('keydown', (evento) => {
  if (pantallas.cuestionario.hidden || evento.altKey || evento.ctrlKey || evento.metaKey) return;
  if ($('dialog[open]')) return;
  // No interferimos cuando se escribe o se desplaza contenido con las flechas.
  if (evento.target.closest('input, textarea, select, [contenteditable]')) return;

  if (/^[1-9]$/.test(evento.key) && !cuestionario.respondida) {
    const posicion = Number(evento.key) - 1;
    if (posicion < cuestionario.opciones.length) {
      evento.preventDefault();
      responder(posicion);
    }
  } else if (evento.key === 'ArrowRight' && cuestionario.respondida) {
    evento.preventDefault();
    siguiente();
  }
});

/* ---------- Arranque ---------- */

async function iniciar() {
  try {
    const respuesta = await fetch(URL_PREGUNTAS);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    banco = await respuesta.json();
  } catch (error) {
    console.error(error);
    $('#mensaje-carga').textContent =
      'No se pudieron cargar las preguntas. Revisá tu conexión y volvé a cargar la página.';
    return;
  }

  renderInicio();
  cuestionario = Cuestionario.restaurar(banco, leerProgreso());
  if (!cuestionario) mostrarPantalla('inicio');
  else if (cuestionario.terminado) mostrarResultados();
  else {
    mostrarPantalla('cuestionario');
    renderPregunta();
  }
}

iniciar();
