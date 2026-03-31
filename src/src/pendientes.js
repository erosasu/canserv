const mongoose = require('mongoose');
const moment = require('moment-timezone');

const pendienteSchema = mongoose.Schema({
  descripcion: { type: String, required: true },
  domicilio: { type: String },
  completado: { type: Boolean, default: false },
  resultado: { type: String },
  user_id: { type: String },
  empleado_responsable: { type: Object },
  creado: {
    type: Date,
    default: () =>
      moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss'),
  },
});

module.exports = mongoose.model('pendientes', pendienteSchema);
