import moment from 'moment-timezone';
import mongoose from 'mongoose';

const today = new Date();
const OrdenSchema = new mongoose.Schema({
  cliente: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'clientes', // <-- Este debe coincidir con el nombre del modelo Mongoose
  },
  quote_address: { type: String },
  descripcion: { type: String, required: true },
  productos: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'productos',
    },
  ],
  Gasto: { type: Number, default: 0 },
  precioCliente: { type: Number, required: true },
  fecha_Aceptacion: {
    type: String,
    default: () =>
      moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss'),
  },
  path_Archivo: { type: String },
  no_Orden: { type: Number, required: true },
  user_id: { type: String, required: true },
  utilidad: { type: Number, required: true },
  anticipo: { type: Number, default: 0 },
  fecha_Entrega: { type: String },
  porcen_Empleado: { type: Number },
  pagada: { type: Boolean, default: false },
  status: { type: String, default: 'Sin asignar/Pendiente' },
  visibilidad: { type: Number, default: 1 },
  ganancia_Empresa: { type: Number },
  id_empleado: [{ type: mongoose.Schema.Types.ObjectId, ref: 'empleados' }],
  empleado_responsable: [
    {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'empleados' },
      nombre: String,
      celular: String,
      email: String,
    },
  ],
  listaMateriales: { type: Object },
  conceptos: { type: Object },
  recibio: { type: String },
  checkpoint: { type: Number, default: 0 },
  tiempoTranscurrido: { type: Number },
  duracion: { type: String, default: undefined },
  descuento: { type: Number },
  IVA: { type: Number, default: 0 },
  sent: { type: Boolean, default: false },
});

module.exports = mongoose.model('ordenes_trabajo', OrdenSchema);
