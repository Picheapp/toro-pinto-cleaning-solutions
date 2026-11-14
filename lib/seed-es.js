'use strict';
// Spanish (Puerto Rico) versions of the seeded catalog. Everything stays editable in Admin.
module.exports = {
  categories: {
    'residential-cleaning': ['Limpieza Residencial', 'Lavado a presión de casas, marquesinas y patios — solo exterior.'],
    'commercial-cleaning': ['Limpieza Comercial', 'Locales, estacionamientos y gasolineras impecables para tus clientes.'],
    'restaurant-kitchen': ['Restaurantes y Servicio de Comida', 'Cocinas industriales de restaurante y locales de comida rápida — campanas, pisos, equipos y grasa.'],
    'recurring-cleaning': ['Limpieza Recurrente', 'Programa y olvídate: servicio semanal, quincenal o mensual con ahorros.'],
    specialized: ['Servicios Especializados', 'Lavado suave de techos, remoción de grafiti, cristales y otros trabajos especiales.'],
  },
  services: {
    'house-wash': ['Lavado Exterior de Casa', 'Lavado suave y a presión que remueve moho, algas y suciedad de paredes, fachadas y molduras sin dañar la pintura.', ['Lavado suave seguro para pintura y revestimientos', 'Remueve moho, algas y suciedad de la calle', 'Plantas y ventanas protegidas', 'Equipo móvil completo — traemos nuestra propia agua']],
    'driveway-patio': ['Lavado a Presión de Marquesina y Patio', 'Limpieza a alta presión que restaura concreto, adoquines y aceras y levanta manchas de aceite y goma.', ['Tratamiento localizado para manchas de aceite y óxido', 'Bordes y juntas detalladas', 'Ideal antes de sellar o pintar', 'Superficies residenciales y comerciales']],
    storefront: ['Lavado de Fachada y Aceras Comerciales', 'Causa una gran primera impresión: lavado a presión de fachadas, aceras, entradas y pasillos.', ['Horarios temprano en la mañana y fuera de horas', 'Remoción de chicle y manchas', 'Planes de mantenimiento recurrente', 'Equipos con licencia y seguro']],
    'parking-lot': ['Limpieza de Estacionamientos y Pavimento', 'Remueve aceite, grasa y acumulación de estacionamientos, áreas de carga y carriles con limpiadores de superficie potentes.', ['Limpiadores de superficie para áreas grandes', 'Desengrasado de aceite y grasa', 'Limpieza de área de zafacones disponible', 'Recuperación de agua bajo petición']],
    'gas-station': ['Limpieza de Gasolineras y Áreas de Surtidores', 'Desengrasado y lavado a presión especializado para estaciones de combustible — islas de bombas, techos y pavimento.', ['Desengrasado de techo, islas de bombas y losa', 'Procedimientos seguros para estaciones de combustible', 'Horarios nocturnos y de fin de semana', 'Visita al sitio y cotización gratis']],
    'recurring-commercial': ['Mantenimiento Comercial Recurrente', 'Programas de mantenimiento a la medida para restaurantes, comercios y sitios industriales — definidos tras una visita rápida.', ['Alcance y calendario a la medida', 'Precios por volumen', 'Un solo punto de contacto', 'Facturación mensual disponible']],
    'industrial-kitchen': ['Limpieza de Cocina Industrial de Restaurante', 'Desengrasado de uso rudo para cocinas comerciales — campanas y extractores, línea de cocción, freidoras, paredes, pisos y desagües — definido tras una visita gratis.', ['Desengrasado de campanas, extractores y línea de cocción', 'Paredes, pisos, desagües y área de trampa de grasa', 'Horarios de noche y madrugada sin afectar el servicio', 'Visita al sitio y cotización gratis']],
    'fast-food': ['Limpieza para Comida Rápida y Servicio Rápido', 'Programas de limpieza rápidos y repetibles para locales de comida rápida — cocinas, equipos, pisos y lavado a presión de autoservicio y entrada.', ['Desengrasado de cocina y equipos', 'Fregado de pisos y desagües', 'Lavado de autoservicio, entrada y área de zafacones', 'Programas semanales, quincenales o mensuales']],
    'roof-soft-wash': ['Lavado Suave de Techos', 'Limpieza de techos a baja presión que remueve rayas negras, algas y moho sin dañar tejas ni losas.', ['Método a baja presión seguro para techos', 'Elimina algas y moho de raíz', 'Extiende la vida del techo', 'Jardinería protegida']],
    graffiti: ['Remoción de Grafiti y Chicle', 'Remoción dirigida de grafiti, exceso de pintura y chicle pegado en mampostería, concreto y metal.', ['Métodos adecuados para cada superficie', 'Respuesta rápida para negocios', 'Recubrimiento protector opcional', 'Cotización gratis con fotos']],
    'window-glass': ['Limpieza de Ventanas y Cristales', 'Limpieza de cristales exterior sin rayas — vitrinas, puertas de patio y ventanas residenciales.', ['Hasta 15 ventanas incluidas', 'Marcos, repisas y rieles limpiados', 'Tratamiento de manchas de agua dura disponible', 'Sistemas de agua pura para cristales exteriores']],
  },
  addons: {
    'Gutter rinse': 'Enjuague de canaletas', 'Oil / rust stain treatment': 'Tratamiento de manchas de aceite / óxido', 'Protective sealant': 'Sellador protector',
    'Graffiti spot treatment': 'Tratamiento localizado de grafiti', 'Dumpster pad cleaning': 'Limpieza del área de zafacones', 'Gum removal': 'Remoción de chicle',
    'Rust stain removal': 'Remoción de manchas de óxido',
  },
  products: {
    'all-purpose-cleaner': ['Limpiador Multiuso Pro', 'Concentrado sin rayas que corta la suciedad diaria en topes, pisos y paredes. Aroma agradable y suave.', { '32 oz spray': '32 oz con atomizador', '1 gallon': '1 galón', '5 gallon pail': 'Cubeta de 5 galones' }, 'Limpiadores'],
    'heavy-duty-degreaser': ['Desengrasante de Uso Rudo', 'Desengrasante de fuerza profesional para parrillas, pisos de garaje, motores y cocinas comerciales.', { '1 gallon': '1 galón', '5 gallon pail': 'Cubeta de 5 galones' }, 'Limpiadores'],
    'glass-cleaner': ['Limpiador de Cristales Sin Rayas', 'Limpiador de cristales y espejos sin amoníaco que seca transparente.', { '32 oz spray': '32 oz con atomizador', '1 gallon': '1 galón' }, 'Limpiadores'],
    'floor-cleaner': ['Limpiador de Pisos Ecológico', 'Limpiador de pisos a base de plantas, seguro para losa, vinilo, laminado y madera sellada.', { '1 gallon': '1 galón' }, 'Limpiadores'],
    'surface-sanitizer': ['Desinfectante de Superficies en Atomizador', 'Atomizador desinfectante de acción rápida para superficies de mucho contacto en cocinas y áreas de servicio de comida.', { '24 oz spray': '24 oz con atomizador' }, 'Limpiadores'],
    'microfiber-cloths': ['Paquete de Paños de Microfibra', 'Paños de microfibra sin pelusa y ultra absorbentes. Lavables y reutilizables.', { '6-pack': 'Paquete de 6', '12-pack': 'Paquete de 12' }, 'Herramientas'],
    'window-squeegee-kit': ['Kit Profesional de Escobilla para Ventanas', 'Escobilla de acero inoxidable con goma, manga lavadora y mango extensible.', { 'Standard kit': 'Kit estándar' }, 'Herramientas'],
    'pro-cleaning-bucket-kit': ['Kit de Cubeta de Limpieza Pro', 'Cubeta de uso rudo con exprimidor, cepillo y esponja — todo para pisos y paredes.', { 'Standard kit': 'Kit estándar' }, 'Herramientas'],
  },
  plans: {
    Plus: ['5% de descuento en cada servicio', 'Re-chequeo gratis de estimados', 'Promociones exclusivas para miembros'],
    Premium: ['10% de descuento en cada servicio', 'Prioridad al programar', 'Promociones exclusivas para miembros', 'Un extra gratis por trimestre'],
    Elite: ['15% de descuento en cada servicio', 'Prioridad al programar', 'Jefe de equipo dedicado', 'Un extra gratis cada mes'],
  },
  gallery: {
    'Driveway & wall wash': ['Lavado de marquesina y pared', 'Ilustración — reemplaza con fotos de tus trabajos en Admin → Contenido'],
    'Patio & entry restoration': ['Restauración de patio y entrada', 'Ilustración — reemplaza con fotos de tus trabajos en Admin → Contenido'],
  },
};
