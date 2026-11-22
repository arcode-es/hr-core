import { b, lista, movil, nota, pantalla, pasos, recorte, tabla } from './piezas.mjs';

/** Capítulos del día a día de cualquier persona de la plantilla. Los usan los dos manuales. */
export const capitulosTrabajador = [
  {
    id: 'entrar',
    title: 'Entrar e instalar la app',
    lead: 'HR-Core se abre desde el navegador y se instala en el móvil como una app más, sin pasar por ninguna tienda.',
    html: `
<h3>Entrar por primera vez</h3>
<p>Tu empresa te da de alta con tu correo. Recibirás una <strong>invitación</strong> con un enlace que vale siete días: ábrelo, elige tu contraseña y ya estás dentro. A partir de ahí entras siempre con tu correo y tu contraseña en la dirección que te haya dado la empresa.</p>
${lista(
  'Si olvidas la contraseña, pulsa «¿Has olvidado tu contraseña?» en la pantalla de entrada: te llega un enlace que caduca en una hora.',
  'La sesión se mantiene abierta en tu móvil: no tienes que escribir la contraseña cada día.',
)}
${nota(`En la demo pública no hay registro ni invitaciones: se entra con un clic eligiendo un perfil. La cuenta de <strong>Luis Peña Gómez</strong> es la de una persona trabajadora. Los datos son ficticios y se restablecen cada noche.`, 'demo')}
${movil(['m-acceso', 'La entrada de la demo: un clic por perfil'], ['m-inicio', 'Inicio: tu día de un vistazo'], ['m-mas', '«Más»: el resto de apartados'])}

<h3>Instalarla en el móvil</h3>
<p>Instalada, la app se abre a pantalla completa desde su icono, funciona sin conexión y puede enviarte avisos.</p>
<h4>En Android (Chrome)</h4>
${pasos('Abre la dirección de HR-Core en Chrome y entra con tu cuenta.', `Pulsa el menú ⋮ y elige ${b('Instalar aplicación')} (o ${b('Añadir a pantalla de inicio')}).`, 'Confirma. El icono de HR-Core aparece junto al resto de tus apps.')}
<h4>En iPhone (Safari)</h4>
${pasos('Abre la dirección de HR-Core en Safari y entra con tu cuenta.', `Pulsa el botón ${b('Compartir')} y elige ${b('Añadir a pantalla de inicio')}.`, `Pulsa ${b('Añadir')}. Abre la app desde el icono nuevo.`)}
${nota('En iPhone los avisos push solo funcionan con la app instalada en la pantalla de inicio. Instálala antes de activarlos.', 'ojo')}

<h3>Cómo moverte</h3>
<p>En el móvil, la barra de abajo tiene lo de todos los días: <strong>Inicio</strong>, <strong>Horario</strong>, <strong>Fichar</strong> (el botón central), <strong>Gastos</strong> y <strong>Más</strong>, donde están Ausencias, Documentos, Informes, Ubicaciones y Ajustes. En el ordenador, el mismo menú aparece a la izquierda.</p>
<p>La campana de arriba reúne tus <strong>avisos</strong>: turnos publicados, documentos por firmar, respuestas a tus solicitudes y gastos revisados.</p>
${movil(['m-avisos', 'Los avisos, en la campana'])}
`,
  },
  {
    id: 'fichar',
    title: 'Fichar la jornada',
    lead: 'Un botón para empezar, otro para parar. La app registra la hora y, si tu empresa lo usa, el lugar desde el que fichas.',
    html: `
<h3>Fichar con el GPS del móvil</h3>
${pasos(
  `Pulsa ${b('Fichar')} en la barra de abajo. La primera vez verás el aviso «Antes de fichar con ubicación»: léelo y pulsa ${b('Entendido')}.`,
  'El navegador te pedirá permiso para usar tu ubicación. Acéptalo.',
  'Arriba verás dónde estás: «Estás en…» si te encuentras dentro de un centro de trabajo, o «Fuera de perímetro» con la distancia que falta.',
  `Pulsa ${b('Iniciar jornada')}. El contador empieza a correr.`,
)}
${movil(['m-aviso-ubicacion', 'El aviso de privacidad, la primera vez'], ['m-fichar-listo', 'Lista para empezar, dentro de la obra'], ['m-fichar-trabajando', 'Jornada en curso'])}
${nota('La app <strong>solo toma tu posición en el momento de fichar</strong>: al empezar, al parar y al terminar. No hay seguimiento continuo ni se guarda tu recorrido. Si no das permiso de ubicación puedes fichar igualmente; el fichaje queda señalado para que tu responsable lo revise.')}

<h3>Pausas y fin de la jornada</h3>
${lista(
  `${b('Pausa')} abre tres opciones: <strong>Comida</strong> y <strong>Descanso</strong>, que no cuentan como tiempo trabajado, y <strong>Desplazamiento</strong>, para trayectos entre obras o clientes, que se contabiliza aparte.`,
  `${b('Reanudar')} termina la pausa y vuelve al trabajo.`,
  `${b('Finalizar')} pide confirmación, te enseña el resumen del día y registra la hora y el lugar de salida.`,
)}
${movil(['m-fichar-pausa', 'Elegir el tipo de pausa'], ['m-fichar-en-pausa', 'En pausa'], ['m-fichar-finalizar', 'Confirmar el fin de jornada'])}

<h3>Dejar una nota de relevo</h3>
<p>Antes de terminar puedes dejar escrito lo que debe saber quien viene después: qué queda pendiente, un aviso de seguridad, dónde están las llaves.</p>
${pasos(
  `Pulsa ${b('Finalizar')}. En la confirmación, escribe en <strong>Nota de relevo</strong>. Es opcional: si la dejas en blanco, no se envía nada.`,
  `En <strong>¿Para quién?</strong> elige ${b('Quien entre en el siguiente turno')} o el nombre de una persona de la empresa.`,
  `Pulsa ${b('Finalizar jornada')}. La nota se guarda junto con tu salida.`,
)}
${lista(
  '<strong>Para el siguiente turno:</strong> la recibe la primera persona que inicie su jornada después de ti en tu misma obra o centro, y solo ella. Si nadie ficha en tres días, la nota caduca.',
  '<strong>Para una persona concreta:</strong> solo la ve ella, y la espera el tiempo que haga falta hasta que inicie su jornada.',
)}
<p>Quien la recibe la ve nada más pulsar ${b('Iniciar jornada')}, arriba en la pantalla de fichar y en el inicio, y se queda ahí hasta que pulsa ${b('Entendido')}. En <strong>Notas que has dejado</strong>, al final de la pantalla de fichar, puedes comprobar si tu nota sigue esperando, si ya se ha entregado y si la han leído.</p>
${movil(['m-relevo-escribir', 'Escribir la nota al finalizar'], ['m-relevo-recibida', 'Así la recibe quien empieza'], ['m-relevo-enviada', 'Saber si ya la han leído'])}
${nota('La nota también viaja sin cobertura: se guarda en el móvil con el fichaje y se envía al recuperar la conexión.', 'truco')}

<h3>Fichar con el QR del cartel</h3>
<p>En sótanos, naves o zonas sin cobertura GPS, la empresa puede colgar a la entrada un <strong>cartel con un código QR</strong> propio de ese centro.</p>
${pasos(
  `En la pantalla de fichar, pulsa ${b('Escanear QR')} y da permiso a la cámara.`,
  'Apunta al código del cartel. Aparecerá «Fichaje con el QR de…» y el nombre del centro.',
  `Pulsa ${b('Iniciar jornada')} (o ${b('Finalizar')} al salir). El fichaje cuenta como presencia en ese centro aunque no haya GPS.`,
)}
<p>Si la empresa cambia el cartel, el código antiguo deja de valer: usa siempre el que esté colgado.</p>

<h3>Fichar en el quiosco</h3>
<p>Algunos centros tienen una <strong>tablet a la entrada</strong> para quien no lleva móvil de empresa o no quiere usar el suyo.</p>
${pasos(
  `Busca tu nombre en la pantalla «¿Quién eres?» y púlsalo, o pulsa ${b('Usar mi tarjeta')} y enseña a la cámara la tarjeta que te ha dado la empresa.`,
  `Escribe tu <strong>PIN</strong> y pulsa ${b('Aceptar')}.`,
  `Pulsa ${b('Entrar')}, ${b('Pausa')} o ${b('Salir')}. La tablet confirma el fichaje y vuelve sola a la pantalla inicial.`,
)}
${pantalla('k-quien-eres', 'El quiosco: cada persona busca su nombre', 'tablet')}
${pantalla('k-pin', 'Después, el PIN personal', 'tablet')}
<p>El PIN lo eliges tú en <strong>Ajustes › PIN del quiosco</strong> (capítulo {{cap:ajustes}}). Nadie más lo conoce, tampoco la empresa.</p>

<h3>Fichar sin conexión</h3>
<p>Si te quedas sin cobertura, <strong>ficha con normalidad</strong>. Arriba verás la franja «Sin conexión» y el aviso «fichaje guardado en el móvil». La app guarda la hora real de cada fichaje y lo envía sola en cuanto vuelve la conexión; no tienes que hacer nada.</p>
${movil(['m-fichar-sin-conexion', 'Sin cobertura: el fichaje se guarda en el móvil'])}
${nota('También puedes guardar gastos sin conexión. No cierres la sesión hasta recuperar la cobertura, para que se envíe todo lo pendiente.', 'truco')}

<h3>La foto al fichar</h3>
<p>Si tu empresa lo ha activado, la app te pedirá una <strong>foto al empezar y al terminar</strong>. También puedes añadir una por tu cuenta con ${b('Añadir foto')}, por ejemplo para dejar constancia del estado de la obra.</p>
<p>¿No puedes hacerla? Pulsa «No puedo hacer la foto»: fichas igualmente y el fichaje queda marcado «sin foto». Las fotos se borran pasado el plazo que fija la empresa; el registro de horas se conserva.</p>
`,
  },
  {
    id: 'corregir',
    title: 'Revisar y corregir tus jornadas',
    lead: 'Todo lo que fichas queda a la vista. Si algo no está bien, lo corriges tú y tu responsable lo valida.',
    html: `
<h3>Tus últimos días</h3>
<p>Debajo del botón de fichar está la lista <strong>Últimos días</strong>. Pulsa un día para ver sus tramos de trabajo, pausas y desplazamientos, con el centro en el que fichaste y si hubo foto. Un triángulo de aviso indica que algún fichaje se hizo fuera del perímetro o sin ubicación.</p>
${movil(['m-jornada-detalle', 'El detalle de un día'], ['m-jornada-corregir', 'Corregir una jornada'], ['m-jornada-manual', 'Añadir una jornada a mano'])}

<h3>Corregir una jornada</h3>
${pasos(
  `Abre el día y pulsa ${b('Corregir')}.`,
  'Cambia la hora de inicio o de fin, añade o quita pausas y, si hace falta, el centro.',
  `Escribe el <strong>motivo</strong> (obligatorio) y pulsa ${b('Enviar para validar')}.`,
)}
<p>La jornada queda con la etiqueta <strong>Corrección pendiente</strong> hasta que tu responsable la apruebe o la rechace; recibirás un aviso con la respuesta. Mientras tanto se conserva la versión original.</p>

<h3>Añadir una jornada que no fichaste</h3>
<p>Si un día se te olvidó fichar, pulsa ${b('Añadir jornada')}, indica la fecha, las horas, las pausas y el motivo, y envíala. Igual que las correcciones, necesita el visto bueno de tu responsable antes de contar.</p>
${nota('Cada cambio queda guardado en el <strong>historial</strong> de la jornada, con quién lo hizo, cuándo y por qué. Es lo que exige la normativa de registro de jornada y lo que te protege si hay una discrepancia.')}
`,
  },
  {
    id: 'horario',
    title: 'Horario, ausencias y vacaciones',
    lead: 'Tus turnos publicados, tu bolsa de horas y todo lo que necesitas para pedir días libres.',
    html: `
<h3>Tu horario</h3>
<p>En <strong>Horario</strong> ves los turnos que te ha publicado la empresa: hora de entrada y salida, pausa prevista, centro y, si la hay, una nota de tu responsable. Puedes moverte por semanas o por meses. Cuando se publica o cambia un turno, recibes un aviso.</p>
<p>Arriba está tu <strong>bolsa de horas</strong>: las horas trabajadas frente a las planificadas, separadas en ordinarias, extra, nocturnas y de desplazamiento.</p>
${movil(['m-horario', 'Horario y bolsa de horas'], ['m-ausencias', 'Ausencias: saldo y solicitudes'], ['m-ausencia-pedir', 'Pedir una ausencia'])}

<h3>Pedir vacaciones u otra ausencia</h3>
${pasos(
  `Entra en <strong>Más › Ausencias</strong> y pulsa ${b('Pedir ausencia')}.`,
  'Elige el <strong>tipo</strong>: vacaciones, asuntos propios, baja médica, permiso retribuido, permiso no retribuido u otra ausencia.',
  'Indica las fechas. Para una mañana o una tarde, activa «Medio día».',
  `Añade un comentario o el <strong>justificante</strong> si procede y pulsa ${b('Enviar solicitud')}.`,
)}
<p>Antes de enviar, la app te dice cuántos días consume la solicitud y cuántos te quedarán. Los fines de semana y los festivos de tu calendario no descuentan.</p>
${lista(
  'Tu responsable la aprueba o la rechaza, y te llega un aviso.',
  `Mientras esté pendiente puedes retirarla con ${b('Anular')}.`,
  'Arriba ves siempre tu saldo de vacaciones del año: días totales, disfrutados y pendientes de aprobar.',
  'Al final de la página están los <strong>próximos festivos</strong> de tu centro.',
)}
`,
  },
  {
    id: 'gastos',
    title: 'Gastos y tickets',
    lead: 'Haz una foto al ticket en el momento y olvídate de guardarlo en la cartera.',
    html: `
<h3>Apuntar un gasto</h3>
${pasos(
  `Entra en <strong>Gastos</strong> y pulsa ${b('Añadir gasto')}.`,
  'Haz una foto al ticket. La app lo lee y rellena sola el importe, la fecha y el comercio; revísalos.',
  'Elige la <strong>categoría</strong>: comida, combustible, peaje o parking, alojamiento, material, kilometraje u otros, además de las propias de tu empresa.',
  'Indica cómo lo pagaste: «Lo adelanté yo» (te lo devolverán) o «Tarjeta de empresa».',
  'Si quieres, asócialo a una obra o centro, y guárdalo.',
)}
<p>¿No hay ticket? Usa ${b('Sin ticket')} y rellena los datos a mano. Para el <strong>kilometraje</strong> solo indicas los kilómetros: el importe se calcula con el precio por kilómetro de tu empresa.</p>
${movil(['m-gastos', 'Tus gastos del mes'], ['m-gasto-nuevo', 'Un gasto nuevo'], ['m-gasto-rechazado', 'Un gasto rechazado, con el motivo'])}

<h3>Qué pasa después</h3>
${tabla(
  ['Estado', 'Qué significa'],
  [
    ['Pendiente', 'Lo has enviado y tu responsable aún no lo ha revisado.'],
    ['Aprobado', 'Está aceptado. Si lo adelantaste tú, queda por cobrar.'],
    ['Rechazado', `No se acepta. Verás el motivo y podrás ${b('Corregir y reenviar')}.`],
    ['Pagado', 'La empresa te lo ha abonado.'],
  ],
)}
<p>Arriba tienes el total <strong>por cobrar</strong>: lo que has adelantado y ya está aprobado, pendiente de que te lo paguen.</p>
`,
  },
  {
    id: 'documentos',
    title: 'Documentos, firma y nóminas',
    lead: 'Contratos, prevención de riesgos, comunicados y nóminas llegan a la app, y los firmas con el dedo.',
    html: `
<h3>Lo que recibes</h3>
<p>En <strong>Más › Documentos</strong>, la pestaña <strong>Recibidos</strong> muestra todo lo que te ha enviado la empresa. Cada documento lleva su estado:</p>
${tabla(
  ['Estado', 'Qué tienes que hacer'],
  [
    ['Firma pendiente', 'Abrirlo, leerlo y firmarlo.'],
    ['Por leer', `Abrirlo y pulsar ${b('He leído el documento')}.`],
    ['Leído · Firmado', 'Nada. Queda guardado para consultarlo o descargarlo cuando quieras.'],
  ],
)}
<p>Si el documento tiene <strong>fecha límite</strong>, la verás en la lista y recibirás recordatorios antes de que venza.</p>
${movil(['m-documentos', 'Documentos recibidos'], ['m-documento-por-firmar', 'Leer antes de firmar'], ['m-documento-firma', 'Firmar con el dedo'])}

<h3>Firmar un documento</h3>
${pasos(
  'Abre el documento y léelo entero.',
  `Pulsa ${b('Firmar documento')}.`,
  `Dibuja tu firma con el dedo en el recuadro. Si no te convence, pulsa «Borrar y repetir».`,
  `Pulsa ${b('Firmar')}.`,
)}
<p>La app genera el PDF firmado y le añade una <strong>hoja de certificado</strong> con tu nombre y DNI, la fecha y la hora, y la huella digital del documento, que permite comprobar que no se ha modificado después. Puedes descargar tanto el original como el firmado.</p>
${nota('Para firmar necesitas tener tu <strong>DNI o NIE</strong> en tu perfil (Ajustes › Perfil). Si falta, la app te lo pedirá antes de firmar.', 'ojo')}

<h3>Nóminas</h3>
<p>Tu nómina de cada mes llega como un documento más, con el tipo «Nómina». Solo la ves tú. Ábrela para consultarla o pulsa ${b('Descargar')} para guardarla.</p>
${movil(['m-nomina', 'La nómina del mes'])}

<h3>Registro mensual de jornada</h3>
<p>Si tu empresa lo tiene activado, cada mes recibes el <strong>registro de tu jornada del mes anterior</strong> para que lo revises y lo firmes. Si ves algo incorrecto, corrige antes la jornada (capítulo {{cap:corregir}}) y avisa a tu responsable.</p>

<h3>Enviar un justificante</h3>
<p>Con el botón ${b('Justificante')} envías tú un documento a la empresa: un parte médico, un justificante de asistencia… Lo encontrarás después en la pestaña <strong>Enviados</strong>.</p>
`,
  },
  {
    id: 'ajustes',
    title: 'Tus ajustes, tu privacidad y tus datos',
    lead: 'El PIN del quiosco, cómo quieres que te avisen y el control sobre tu información.',
    html: `
<p>Todo está en <strong>Más › Ajustes</strong>.</p>
<h3>Perfil y apariencia</h3>
<p>En <strong>Perfil</strong> mantienes tu nombre, tu DNI o NIE (necesario para firmar y para los informes oficiales) y tu teléfono. En <strong>Apariencia</strong> eliges el idioma y el tema: automático, claro, oscuro o <strong>Sol</strong>, de máximo contraste para leer la pantalla en exteriores.</p>
${movil(['m-ajustes', 'Ajustes: tu perfil'])}

<h3>PIN del quiosco</h3>
<p>Para fichar en la tablet de la empresa necesitas un PIN de <strong>4 a 6 cifras</strong>. Escríbelo dos veces y pulsa ${b('Guardar PIN')}. Puedes cambiarlo cuando quieras; si lo olvidas, pide a Administración que lo borre y elige otro.</p>
${recorte('m-ajustes-pin', 'Tu PIN es personal: nadie más lo conoce, tampoco la empresa', 'estrecho')}

<h3>Avisos en el móvil (push)</h3>
<p>En <strong>Notificaciones</strong> activas los avisos push en cada dispositivo: horario publicado, gastos y jornadas revisados, documentos por firmar. El navegador te pedirá permiso la primera vez.</p>

<h3>Avisos por correo</h3>
<p>En <strong>Avisos por correo</strong> decides qué quieres recibir también en tu buzón, por grupos: documentos, respuestas a lo que pides, cambios de horario y alertas de jornada. Desmarca lo que no te interese; los avisos dentro de la app siguen llegando.</p>
${nota('La demo no envía correos, así que este apartado no aparece en ella. En una instalación real lo encontrarás en Ajustes, debajo de Notificaciones.', 'demo')}
<p>Si la empresa ha fijado un <strong>horario de desconexión digital</strong>, fuera de él no recibes notificaciones en el móvil: los avisos te esperan en la app.</p>

<h3>Contraseña y sesiones</h3>
<p>Cambia tu contraseña en <strong>Contraseña</strong>. En <strong>Sesiones abiertas</strong> ves los dispositivos donde tienes la cuenta abierta; si no reconoces alguno, ciérralo desde ahí.</p>

<h3>Privacidad y mis datos</h3>
${recorte('m-ajustes-privacidad', 'Tus datos son tuyos: descárgalos cuando quieras', 'estrecho')}
${lista(
  `${b('Descargar')} genera un archivo ZIP con tu perfil, tus fichajes, gastos, documentos y fotos.`,
  'Los enlaces <strong>Privacidad</strong>, <strong>Aviso legal</strong> y <strong>Cookies</strong> explican qué datos se tratan, para qué y durante cuánto tiempo.',
  '<strong>Eliminar mi cuenta</strong> borra tu acceso y tus datos personales. El registro de jornada se conserva cuatro años, como exige la ley, y solo puede verlo la empresa en la que trabajaste.',
)}
<h4>Lo que la empresa ve de tu ubicación</h4>
${lista(
  'Solo la posición de cada fichaje, para comprobar la asistencia en el centro de trabajo.',
  'Nunca tu recorrido ni tu posición fuera de esos momentos.',
  'En el apartado <strong>Ubicaciones</strong> puedes ver los centros de trabajo y el radio que se considera «dentro».',
)}
${movil(['m-ubicaciones', 'Los centros de trabajo y su perímetro'])}
`,
  },
];
