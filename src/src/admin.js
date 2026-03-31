import moment from 'moment-timezone';
import mongoose from 'mongoose';

const usuarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  correo: { type: String, required: true },
  password: { type: String, required: true },
  sessions: [{ type: Object, default: null }],
  empresa_id: { type: mongoose.Schema.Types.ObjectId, ref: 'empresas' },
  celular: { type: String },
  customer: { type: Object },
  curp: { type: String },
  accountToken: { type: String },
  verified: { type: Boolean, default: false },
  subscripcion: {
    nickname: { type: String },
    token: { type: String },
    trial: { type: Boolean },
    vence: { type: String },
    precio: { type: Number },
    auto_renovar: { type: Boolean },
    checkoutSession: { type: Object, default: undefined },
  },
  server_whatsapp: { type: String },
  token_whatsapp: { type: String },
  fecha_registro: {
    type: String,
    default: () =>
      moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss'),
  },
  coleccion: { type: String },
  newsletter: { type: Boolean, default: true },
  session: { type: String },
  server_whatsapp: { type: String, default: 'http://54.234.159.150:21465' },
});

export default mongoose.model('usuarios', usuarioSchema);
