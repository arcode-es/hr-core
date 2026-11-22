import { b, lista, movil, nota, pantalla, pasos, recorte, tabla } from './piezas.mjs';

/** Capítulos de gestión: responsables de equipo y Administración. */
export const capitulosGestion = [
  {
    id: 'perfiles',
    title: 'Perfiles y panel del equipo',
    lead: 'Quién puede hacer qué, y la pantalla desde la que se ve todo lo que está pendiente.',
    html: `
<h3>Los cuatro perfiles</h3>
${tabla(
  ['Perfil', 'Qué puede hacer'],
  [
    ['Empleado', 'Ficha, envía gastos, pide ausencias y recibe y firma documentos.'],
    ['Responsable', 'Además, planifica turnos y valida jornadas, ausencias y gastos de su gente. Si tiene departamentos a su cargo, solo ve y gestiona a esas personas; si no tiene ninguno, a toda la empresa.'],
    ['Administrador', 'Además, gestiona la empresa: equipo, ubicaciones, quioscos, documentos, nóminas, informes, coste por obra y ajustes.'],
    ['Inspección', 'Solo consulta registros e informes. Pensado para la Inspección de Trabajo o la representación legal de la plantilla.'],
  ],
)}
${nota('En la demo, <strong>Elena Martín Soler</strong> es Administración y <strong>Javier Ortega Ruiz</strong> es Responsable (jefe de obra). Entra con cada perfil para ver las diferencias. Los responsables y administradores también fichan y envían gastos como cualquier persona: lo explica la primera parte de este manual.', 'demo')}

<h3>Tu equipo ahora</h3>
<p>La pantalla de <strong>Inicio</strong> añade el bloque <strong>Tu equipo ahora</strong>: cuánta gente está fichada, las jornadas, gastos y ausencias que esperan tu validación, los documentos sin leer o firmar, quién está ausente hoy y las alertas abiertas. Cada tarjeta lleva al apartado correspondiente.</p>
${pantalla('d-inicio', 'Inicio de Administración: lo pendiente, de un vistazo')}
<p>Todo funciona igual desde el móvil: los apartados de gestión están en <strong>Más</strong>.</p>
${movil(['m-responsable-inicio', 'El panel en el móvil'], ['m-responsable-mas', 'Los apartados de gestión, en «Más»'], ['m-responsable-pendientes', 'Validar desde el móvil'])}
`,
  },
  {
    id: 'validar',
    title: 'Validar jornadas',
    lead: 'El apartado Fichajes reúne lo que ha fichado el equipo, lo que espera tu visto bueno y la bolsa de horas.',
    html: `
<h3>Equipo: el día a día</h3>
<p>La pestaña <strong>Equipo</strong> muestra, día a día, la jornada de cada persona: entrada, salida, horas y avisos de ubicación. Pulsa una jornada para ver el detalle de tramos, con el centro, la dirección, las fotos y el historial de cambios.</p>
${pantalla('d-fichajes-equipo', 'Fichajes › Equipo')}
${pantalla('d-fichajes-detalle', 'El detalle de una jornada, con sus tramos y ubicaciones')}

<h3>Pendientes: aprobar o rechazar</h3>
<p>Las jornadas que alguien ha añadido a mano o ha corregido <strong>no cuentan hasta que se validan</strong>. Aparecen en la pestaña <strong>Pendientes</strong>, con el número en el menú.</p>
${lista(
  'Una <strong>jornada manual</strong> muestra las horas declaradas y el motivo.',
  'Una <strong>corrección</strong> muestra el antes y el ahora, para comparar de un vistazo.',
  `${b('Aprobar')} la da por buena. ${b('Rechazar')} pide un motivo, que le llega a la persona; en una corrección, la jornada vuelve a su versión anterior.`,
)}
${pantalla('d-fichajes-pendientes', 'Fichajes › Pendientes: una jornada manual y una corrección')}
${nota('Los informes oficiales solo incluyen jornadas aprobadas. Conviene dejar la bandeja de pendientes a cero antes de cerrar el mes.', 'ojo')}

<h3>Horas: la bolsa del equipo</h3>
<p>La pestaña <strong>Horas</strong> compara, por persona y mes, lo planificado con lo trabajado, y separa las horas ordinarias, extra, nocturnas y de desplazamiento.</p>
${pantalla('d-fichajes-horas', 'Fichajes › Horas')}
`,
  },
  {
    id: 'cuadrante',
    title: 'Cuadrante y turnos rotativos',
    lead: 'Planifica la semana o el mes, repite lo que funciona y publica cuando esté listo.',
    html: `
<h3>El cuadrante</h3>
<p>En <strong>Horario › Cuadrante</strong> cada fila es una persona y cada columna un día. Los turnos se crean en <strong>borrador</strong>: el equipo no los ve hasta que los publicas.</p>
${pantalla('d-cuadrante', 'El cuadrante de la semana')}
${pasos(
  'Pulsa la casilla de una persona y un día para añadir un turno.',
  'Indica inicio, fin, pausa prevista y centro. Puedes dejar una nota para la persona.',
  'Con «Repetir esta semana» marcas otros días y creas el mismo turno de una vez.',
  `Cuando el cuadrante esté listo, pulsa ${b('Publicar borradores')}. Cada persona recibe un aviso con sus turnos.`,
)}
${pantalla('d-turno-nuevo', 'Un turno nuevo, con nota para la persona')}
${lista(
  `${b('Copiar semana anterior')} trae los turnos de la semana pasada como borradores.`,
  'La vista <strong>Mes</strong> enseña el mes entero para detectar huecos.',
  'Las ausencias aprobadas y los festivos aparecen en el cuadrante, para no planificar encima.',
)}
${pantalla('d-cuadrante-mes', 'La vista de mes')}

<h3>Turnos rotativos</h3>
<p>Para ciclos que se repiten (mañana, tarde, libre…) no hace falta crear los turnos uno a uno.</p>
${pasos(
  `Pulsa ${b('Turnos rotativos')}. Elige un patrón o crea uno con ${b('Nuevo patrón')}: la secuencia de días de trabajo, con su horario, y de días libres.`,
  `Pulsa ${b('Aplicar')} y marca las personas.`,
  'Indica el <strong>primer día del ciclo</strong> y cuántas <strong>semanas</strong> quieres generar.',
  'Con el <strong>desfase entre personas</strong> escalonas al equipo: con 0 todas van igual; con 1, cada persona va un día por delante de la anterior.',
  `Pulsa ${b('Crear los turnos en borrador')}, revísalos en el cuadrante y publícalos como siempre.`,
)}
${pantalla('d-rotativos-aplicar', 'Aplicar un patrón rotativo a varias personas')}
`,
  },
  {
    id: 'ausencias-gestion',
    title: 'Ausencias, festivos y calendario',
    lead: 'Las solicitudes del equipo, quién falta cada día y el calendario laboral de cada centro.',
    html: `
<h3>Aprobar solicitudes</h3>
<p>En <strong>Ausencias › Por aprobar</strong> están las solicitudes pendientes, con el tipo, las fechas, los días que consumen y el justificante si lo hay. Pulsa ${b('Aprobar')} o ${b('Rechazar')}; la persona recibe la respuesta al momento.</p>
<p>Si la persona ya tenía turnos esos días, la app te lo advierte y te ofrece <strong>quitarlos al aprobar</strong>, para que el cuadrante no quede con turnos imposibles.</p>
${pantalla('d-ausencias-aprobar', 'Una solicitud de vacaciones que pisa turnos ya publicados')}

<h3>El calendario del equipo</h3>
<p>La pestaña <strong>Calendario</strong> muestra el mes con las ausencias de todo el equipo por colores, para ver de un vistazo los solapes antes de aprobar. En <strong>Mías</strong> están tus propias solicitudes.</p>
${pantalla('d-ausencias-calendario', 'Ausencias › Calendario')}

<h3>Calendario laboral y festivos <small>(Administración)</small></h3>
<p>En <strong>Empresa › Calendario laboral y vacaciones</strong> se fijan la comunidad autónoma, los días de vacaciones al año y si se cuentan en días laborables o naturales. Los días de una persona concreta se cambian en su ficha (capítulo {{cap:equipo}}).</p>
${recorte('d-empresa-calendario', 'Calendario laboral y vacaciones')}
<p>En <strong>Festivos</strong>, ${b('Importar los festivos oficiales')} carga los nacionales y los autonómicos del año. Los <strong>locales</strong> se añaden a mano y pueden asignarse a una ubicación concreta, porque cada municipio tiene los suyos. Los festivos no cuentan como horas previstas en el cuadrante ni como días de vacaciones.</p>
${recorte('d-empresa-festivos', 'Festivos nacionales, autonómicos y locales por centro')}
`,
  },
  {
    id: 'alertas',
    title: 'Alertas de jornada',
    lead: 'HR-Core vigila los límites legales y avisa a tiempo, antes de que un descuido acabe en incumplimiento.',
    html: `
<p>El apartado <strong>Alertas</strong> lista los avisos abiertos; la pestaña <strong>Todas</strong> incluye los ya resueltos. Cada alerta indica la persona, el día, el dato concreto y su base legal.</p>
${tabla(
  ['Alerta', 'Cuándo salta'],
  [
    ['Entrada sin fichar', 'Tenía turno y, pasados los minutos de cortesía, no ha fichado.'],
    ['Jornada abierta demasiado tiempo', 'Lleva muchas horas sin finalizar: probablemente olvidó fichar la salida.'],
    ['Menos de 12 h de descanso', 'Entre el final de una jornada y el inicio de la siguiente no hay 12 horas.'],
    ['Más de 9 h ordinarias', 'La jornada supera las 9 horas ordinarias de trabajo efectivo.'],
    ['Horas extra al 70 %', 'Ha consumido el 70 % del límite anual de horas extra.'],
    ['Tope de horas extra', 'Ha llegado al límite anual (80 horas, salvo que la empresa fije otro).'],
  ],
)}
${pantalla('d-alertas', 'Alertas abiertas')}
<p>Cuando hayas hablado con la persona o corregido la jornada, pulsa ${b('Resolver')}. La alerta queda en el historial.</p>
<h3>Configurarlas <small>(Administración)</small></h3>
<p>En <strong>Empresa › Alertas de jornada</strong> se activan o desactivan y se ajustan los umbrales: a los cuántos minutos avisar de una entrada sin fichar, a las cuántas horas de una jornada abierta, y el límite anual de horas extra.</p>
${recorte('d-empresa-alertas', 'Umbrales de las alertas')}
${nota('Las alertas llegan también como aviso y, si se quiere, por correo: al momento o en un resumen diario a las 08:00. Cada responsable lo elige en Ajustes › Avisos por correo.')}
`,
  },
  {
    id: 'gastos-gestion',
    title: 'Gastos y liquidación',
    lead: 'Revisar tickets, pagar lo adelantado y adaptar las categorías a tu empresa.',
    html: `
<h3>Por aprobar</h3>
<p>En <strong>Gastos › Por aprobar</strong> están los gastos pendientes del equipo. Abre uno para ver el ticket, el importe, el IVA, la categoría, la forma de pago y la obra a la que se imputa. ${b('Aprobar')} lo acepta; ${b('Rechazar')} pide un motivo, y la persona puede corregirlo y reenviarlo.</p>
${pantalla('d-gastos-aprobar', 'Gastos por aprobar')}
${pantalla('d-gasto-detalle', 'El detalle, con la foto del ticket')}

<h3>Liquidación</h3>
<p>La pestaña <strong>Liquidación</strong> agrupa por persona lo aprobado que cada una <strong>adelantó de su bolsillo</strong>. Cuando hagas la transferencia o lo incluyas en la nómina, pulsa ${b('Marcar como pagado')}: los gastos pasan a «Pagado» y la persona recibe un aviso. Lo pagado con tarjeta de empresa no genera reembolso.</p>
${pantalla('d-gastos-liquidacion', 'Liquidación: lo que hay que devolver a cada persona')}

<h3>Categorías y kilometraje <small>(Administración)</small></h3>
<p>Además de las categorías de serie, en ${b('Categorías')} se crean las <strong>propias</strong> de la empresa (por ejemplo, equipos de protección). El precio por kilómetro se fija en <strong>Empresa › Gastos</strong>.</p>
${pantalla('d-gastos-categorias', 'Categorías propias de gasto')}
<p>Para la contabilidad, el informe <strong>Liquidación de gastos y dietas</strong> (capítulo {{cap:informes}}) reúne todos los gastos del mes con su estado y los tickets en un anexo.</p>
`,
  },
  {
    id: 'documentos-gestion',
    title: 'Documentos, nóminas y registro mensual',
    lead: 'Enviar para leer o firmar, con plazo y recordatorios; repartir las nóminas por DNI; y el registro de jornada firmado cada mes.',
    html: `
<h3>Enviar un documento</h3>
${pasos(
  `En <strong>Documentos</strong>, pulsa ${b('Enviar')} y elige el archivo (PDF o imagen, hasta 10 MB).`,
  'Ponle título y tipo: contrato, prevención de riesgos, comunicado…',
  'Elige los <strong>destinatarios</strong>: personas concretas, un departamento o toda la plantilla.',
  'Decide qué pides: <strong>confirmar lectura</strong> o <strong>firmar</strong>.',
  'Si quieres, pon una <strong>fecha límite</strong>.',
)}
${pantalla('d-documento-enviar', 'Enviar un documento a firmar, con fecha límite')}
<h4>Plazos y recordatorios</h4>
<p>Con fecha límite, HR-Core recuerda el documento a quien no lo haya atendido: <strong>tres días antes</strong>, <strong>el mismo día</strong> y, si vence, <strong>cada tres días</strong> hasta que lo firme o lo lea.</p>
<h4>Seguimiento</h4>
<p>En la pestaña <strong>Enviados</strong>, cada documento muestra una barra con cuántas personas lo han leído o firmado. Despliégalo para ver el estado de cada una y descargar el PDF firmado, con su hoja de certificado (firmante, DNI, fecha y hora, y huella SHA-256 del documento).</p>
${pantalla('d-documento-seguimiento', 'Documentos enviados y su seguimiento')}

<h3>Nóminas por DNI <small>(Administración)</small></h3>
<p>No hace falta separar el PDF de la gestoría ni enviar las nóminas una a una.</p>
${pasos(
  `En <strong>Documentos</strong>, pulsa ${b('Enviar nóminas')} y sube el PDF con todas las nóminas del mes.`,
  'HR-Core lee el <strong>DNI o NIE de cada página</strong> y la asigna a la persona que corresponde.',
  'Revisa el reparto. Las páginas sin dueño aparecen señaladas: puedes asignarlas a mano o dejarlas sin enviar.',
  `Pulsa ${b('Enviar nóminas')}. Cada persona recibe solo la suya.`,
)}
${pantalla('d-nominas', 'El PDF de la gestoría, repartido por DNI')}
${lista(
  'Para que funcione, cada persona debe tener su DNI o NIE en el perfil y el PDF debe contener texto (no una foto escaneada).',
  'Si no llegas a enviarlo, el PDF se borra solo en 24 horas.',
  `${b('Descargar un PDF de ejemplo')} genera un archivo de prueba con los DNI de tu plantilla, para ver cómo funciona.`,
)}

<h3>Registro mensual de jornada</h3>
<p>El Estatuto de los Trabajadores obliga a llevar un registro diario de jornada (art. 34.9) y a entregar cada mes a cada persona el resumen de sus horas (art. 35.5). Con HR-Core, cada persona recibe el <strong>registro del mes anterior</strong> como documento para firmar o confirmar.</p>
${lista(
  `A mano: en <strong>Documentos</strong>, pulsa ${b('Registro mensual')}, elige el mes y envíalo.`,
  'Automático: en <strong>Empresa › Registro mensual de jornada</strong> se activa el envío, el día del mes en que sale y si se pide firma o basta con la lectura.',
)}
${recorte('d-empresa-registro', 'El envío automático del registro mensual')}
`,
  },
  {
    id: 'equipo',
    title: 'Equipo, altas e invitaciones',
    lead: 'Dar de alta a la plantilla, de una en una o toda a la vez, y organizarla por departamentos.',
    html: `
<p>El apartado <strong>Equipo</strong> lista a las personas con su perfil y departamento, las invitaciones en curso y los departamentos. Los responsables lo consultan; las altas y los cambios son de Administración.</p>
${pantalla('d-equipo', 'Equipo: personas, invitaciones y departamentos')}

<h3>Invitar a una persona</h3>
${pasos(
  `Pulsa ${b('Invitar')} y escribe su correo y su nombre.`,
  'Elige el perfil (empleado, responsable, administrador o inspección) y el departamento.',
  'Envía. La persona recibe un enlace válido durante <strong>siete días</strong> para elegir su contraseña.',
)}
<p>En <strong>Invitaciones</strong> ves las pendientes y puedes ${b('Reenviar')} o anularlas.</p>
${pantalla('d-invitar', 'Invitar a una persona')}

<h3>Alta masiva</h3>
<p>Para dar de alta a toda la plantilla de una vez, pulsa ${b('Importar plantilla')}:</p>
${pasos(
  `${b('Descargar la plantilla')} te da el archivo con las columnas preparadas.`,
  'Rellénalo en Excel (o guárdalo como CSV): una fila por persona.',
  'Súbelo. HR-Core te enseña qué filas son correctas y cuáles tienen errores antes de crear nada.',
  'Confirma. Cada persona recibe su invitación con sus datos ya preparados: departamento, puesto, jornada y DNI.',
)}
${pantalla('d-importar', 'Alta masiva desde Excel o CSV')}

<h3>La ficha de cada persona</h3>
<p>Pulsa a alguien para abrir <strong>Gestionar miembro</strong>:</p>
${lista(
  '<strong>Rol</strong> y <strong>departamento</strong>.',
  '<strong>Condiciones</strong>: días de vacaciones, jornada anual y horas semanales, si son distintas de las generales, y <strong>coste por hora</strong>, que alimenta el informe de coste por obra.',
  `<strong>Quiosco</strong>: ${b('Tarjeta del quiosco (PDF)')} genera su tarjeta para identificarse en la tablet (al generar una nueva, la anterior deja de valer) y ${b('Borrar su PIN')} le permite elegir otro si lo ha olvidado.`,
  `${b('Desactivar acceso')} cuando deja la empresa: ya no puede entrar, y su registro de jornada se conserva.`,
)}
${pantalla('d-miembro', 'Gestionar miembro')}

<h3>Departamentos y responsables</h3>
<p>Crea los departamentos que necesites (Obra, Oficina…) y, con ${b('Responsables')}, indica quién está al cargo de cada uno. Un responsable con departamentos a su cargo solo ve y gestiona a su gente; sin ninguno, ve a toda la empresa.</p>
${pantalla('d-departamento-responsables', 'Responsables de un departamento')}
`,
  },
  {
    id: 'ubicaciones',
    title: 'Ubicaciones, carteles QR y quioscos',
    lead: 'Los centros de trabajo, su perímetro y las dos formas de fichar sin depender del GPS del móvil.',
    html: `
<h3>Ubicaciones</h3>
<p>Una ubicación es un centro de trabajo: una obra, una nave, la oficina. En <strong>Ubicaciones</strong> las ves en el mapa y en la lista, cada una con su radio.</p>
${pantalla('d-ubicaciones', 'Los centros de trabajo de la empresa')}
${pasos(
  `Pulsa ${b('Nueva')} y busca la dirección, o coloca el punto en el mapa.`,
  'Ajusta el <strong>radio</strong> del perímetro: quien fiche dentro queda «en la ubicación»; fuera, el fichaje se marca con aviso.',
  'Elige un color para distinguirla en el cuadrante y los informes.',
  'Cuando la obra termine, desactívala: deja de ofrecerse para fichar y su histórico se conserva.',
)}
${nota('Un radio demasiado ajustado genera avisos falsos: el GPS de un móvil puede desviarse decenas de metros, sobre todo entre edificios. Entre 80 y 150 metros suele funcionar bien para una obra urbana.', 'truco')}

<h3>Cartel con código QR</h3>
<p>En la ficha de cada ubicación está el apartado <strong>Cartel con código QR</strong>. ${b('Descargar el cartel (PDF)')} genera un cartel listo para imprimir y colgar a la entrada. Al escanearlo con el móvil, el fichaje cuenta como presencia en ese centro <strong>aunque no haya GPS</strong>: es la solución para sótanos, naves e interiores.</p>
<p>Si sospechas que alguien ha fotografiado el cartel para fichar desde otro sitio, pulsa ${b('Generar un código nuevo')}: el cartel anterior deja de valer y basta con imprimir el nuevo.</p>
${pantalla('d-ubicacion', 'La ficha de una ubicación: perímetro, color y cartel QR')}

<h3>Quioscos de fichaje <small>(Administración)</small></h3>
<p>Un quiosco es una <strong>tablet fija a la entrada</strong> donde cada persona ficha con su PIN o con su tarjeta. Cuenta como presencia en la ubicación del quiosco.</p>
${pasos(
  `En <strong>Empresa › Quioscos de fichaje</strong>, escribe un nombre, elige su ubicación y pulsa ${b('Añadir quiosco')}.`,
  'Aparece un <strong>código de emparejamiento</strong>, que caduca a los pocos minutos y solo sirve una vez.',
  'En la tablet, abre la dirección de HR-Core terminada en <strong>/kiosk</strong>, escribe el código y pulsa «Emparejar».',
  'La tablet queda en modo quiosco. Conviene instalarla como app y dejarla fija, enchufada y con la pantalla siempre encendida.',
)}
${pantalla('d-quiosco-codigo', 'El código para emparejar la tablet')}
${pantalla('k-emparejar', 'En la tablet: escribir el código', 'tablet')}
${pantalla('k-fichar', 'Tras el PIN, la persona elige qué fichar', 'tablet')}
${lista(
  'Cada persona elige su PIN en <strong>Ajustes › PIN del quiosco</strong>.',
  'Las <strong>tarjetas</strong> se imprimen desde la ficha de cada persona en Equipo; la tarjeta identifica, y el PIN sigue haciendo falta.',
  `Si una tablet se pierde o se cambia, ${b('Código nuevo')} la desvincula y permite emparejar otra.`,
)}
${recorte('d-empresa-quioscos', 'Los quioscos de la empresa y su estado')}
`,
  },
  {
    id: 'informes',
    title: 'Informes, gestoría y coste por obra',
    lead: 'Los documentos oficiales del mes, el archivo para la gestoría y lo que cuesta cada obra en horas y en dinero.',
    html: `
<h3>Informes</h3>
<p>En <strong>Informes</strong> eliges el mes y la persona, y descargas al momento:</p>
${tabla(
  ['Informe', 'Para qué sirve', 'Formatos'],
  [
    ['Registro de jornada', 'El informe oficial del mes: entradas, salidas, pausas, horas ordinarias y extra, con espacio para las firmas. Listo para una inspección.', 'PDF · Excel · CSV'],
    ['Informe detallado con ubicaciones', 'Cada tramo con su hora exacta, coordenadas, dirección, perímetro y fotos. Para contrastar registros.', 'PDF'],
    ['Liquidación de gastos y dietas', 'Los gastos del mes con su estado, lo pendiente de reembolso y los tickets en anexo.', 'PDF · Excel · CSV'],
    ['Registro de toda la plantilla', 'El registro del mes de cada persona, en un Excel con resumen o en un único PDF.', 'Excel · PDF'],
    ['Exportación para la gestoría', 'Una fila por persona con horas, ausencias y gastos del mes.', 'Excel · CSV'],
  ],
)}
${pantalla('d-informes', 'Los informes del mes')}
${nota('Solo se incluyen las jornadas aprobadas, y los informes se generan en el momento con los datos actuales. El perfil <strong>Inspección</strong> puede consultar y descargar estos registros sin poder cambiar nada.')}

<h3>El archivo para la gestoría <small>(Administración)</small></h3>
<p>Cada gestoría pide los datos a su manera. En <strong>Empresa › Exportación para la gestoría</strong> eliges <strong>qué columnas</strong> lleva el archivo mensual y <strong>en qué orden</strong>: DNI, nombre, departamento, días trabajados, horas ordinarias, extra, nocturnas y de desplazamiento, días de vacaciones y de baja, gastos… Se configura una vez y cada mes solo hay que descargarlo.</p>
${recorte('d-empresa-gestoria', 'Las columnas del archivo de la gestoría')}

<h3>Coste por obra <small>(Administración)</small></h3>
<p><strong>Coste por obra</strong> cruza las horas fichadas en cada ubicación con el coste por hora de cada persona y con los gastos imputados a esa obra. Para cada mes verás el total de horas, el coste de personal, los gastos y el desglose por ubicación, y podrás llevártelo con ${b('Descargar en Excel')}.</p>
${pantalla('d-coste-obra', 'Horas, coste de personal y gastos de cada obra')}
${nota('Para que las cifras sean fiables, rellena el <strong>coste por hora</strong> en la ficha de cada persona (capítulo {{cap:equipo}}) y pide al equipo que asocie cada gasto a su obra.', 'truco')}
`,
  },
  {
    id: 'empresa',
    title: 'Ajustes de empresa',
    lead: 'La marca, las reglas de la jornada y los compromisos de privacidad y desconexión. Solo Administración.',
    html: `
<p>Todo está en el apartado <strong>Empresa</strong>.</p>
<h3>Datos y marca</h3>
<p>En <strong>Datos de la empresa</strong> están el nombre de la empresa y su CIF o NIF, que aparecen en los informes oficiales. En <strong>Marca de la empresa</strong> pones el nombre comercial, el <strong>logotipo</strong> y el <strong>color</strong>: la app y los PDF se visten con ellos. Si el color elegido es muy claro, HR-Core lo oscurece lo justo para que los textos se lean bien.</p>
${recorte('d-empresa-marca', 'La marca de la empresa')}

<h3>Jornada y fichaje</h3>
${lista(
  '<strong>Zona horaria</strong> de la empresa: se usa para los días, los turnos de noche y los informes.',
  '<strong>Tramo nocturno</strong>: entre qué horas el trabajo cuenta como nocturno.',
  '<strong>Radio por defecto</strong> de las ubicaciones nuevas.',
  '<strong>Jornadas a mano</strong>: si la plantilla puede añadir jornadas (siempre pendientes de validación) o solo los responsables.',
  '<strong>Foto al empezar y al terminar</strong>: quien no pueda hacerla ficha igualmente y queda marcado «sin foto».',
  '<strong>Margen de puntualidad</strong>, en minutos.',
)}
${recorte('d-empresa-jornada', 'Las reglas de la jornada y del fichaje')}

<h3>Privacidad y desconexión</h3>
${lista(
  '<strong>Conservación de las fotos de fichaje</strong>: pasado el plazo se borran las fotos; el fichaje (horas, posición y ubicación) se conserva.',
  '<strong>Horario de desconexión digital</strong>: fuera de él no llegan notificaciones al móvil; los avisos se ven en la app y el push llega al terminar (art. 88 LOPDGDD). Puede extenderse a sábados y domingos.',
  '<strong>Información sobre la geolocalización</strong>: el texto propio de tu empresa que cada persona lee antes de fichar con ubicación por primera vez. Indica quién consulta esos datos y para qué.',
)}
${recorte('d-empresa-privacidad', 'Plazos de conservación, desconexión digital e información al personal')}
${nota('Antes de empezar a fichar con ubicación, informa a la plantilla y a su representación legal de que se va a usar la geolocalización y con qué fin. El texto de este apartado te ayuda a dejar constancia, pero no sustituye a esa comunicación.', 'ojo')}

<h3>Lo demás, en su capítulo</h3>
${tabla(
  ['Apartado de Empresa', 'Dónde se explica'],
  [
    ['Alertas de jornada', 'Capítulo {{cap:alertas}}'],
    ['Registro mensual de jornada', 'Capítulo {{cap:documentos-gestion}}'],
    ['Exportación para la gestoría', 'Capítulo {{cap:informes}}'],
    ['Gastos (precio por kilómetro)', 'Capítulo {{cap:gastos-gestion}}'],
    ['Calendario laboral, vacaciones y festivos', 'Capítulo {{cap:ausencias-gestion}}'],
    ['Quioscos de fichaje', 'Capítulo {{cap:ubicaciones}}'],
  ],
)}
`,
  },
];
