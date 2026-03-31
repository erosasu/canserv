import moment from 'moment-timezone';
import mongoose from 'mongoose';

const Schema = mongoose.Schema;

const defaultBalance = {
  mes: moment().tz('America/Mexico_City').format('YYYY-MM'),
  gastos: [],
  gasto_total_mes: 0,
  ingresos: [],
  ingreso_total_mes: 0,
  utilidad_mes: 0,
};

const balanceSchema = new Schema({
  mes: {
    type: String,
    default: () => moment().tz('America/Mexico_City').format('YYYY-MM'),
    required: true,
  },
  gastos: [
    {
      descripcion: { type: String },
      monto: { type: Number, default: 0 },
    },
  ],
  gasto_total_mes: { type: Number, default: 0 },
  ingresos: [
    {
      descripcion: { type: String },
      monto: { type: Number, default: 0 },
    },
  ],
  ingreso_total_mes: { type: Number, default: 0 },
  utilidad_mes: { type: Number, default: 0 },
});

const empresaSchema = new Schema({
  razon_social: { type: String }, // Optional legal name
  nombre_empresa: { type: String, required: true }, // Required company name
  domicilio_fiscal: { type: String, required: true }, // Required fiscal address
  RFC: { type: String }, // Optional tax ID
  horario: { type: String }, // Optional business hours
  num_celular: { type: String, required: true }, // Required mobile number
  tel_local: { type: String }, // Optional landline
  pagina_web: { type: String }, // Optional website
  email_contador: { type: String }, // Optional accountant's email
  correo_empresarial: { type: String, required: true }, // Required business email
  clave_interban: { type: String }, // Optional interbank key
  ganancia_universal: {
    valor_escalar: { type: Number, default: 2.5 }, // Default profit multiplier
    estado: { type: Boolean, default: false }, // Default profit state
  },
  precio_por_km: { type: Number, default: 20 }, // Default price per km
  feedback_google: { type: String }, // Optional Google feedback (likely a typo, should be removed or renamed)
  latitud: { type: Number }, // Optional latitude
  longitud: { type: Number }, // Optional longitude
  google_business_review_link: { type: String }, // Optional Google review link
  bank_name: { type: String }, // Optional bank name
  card_number_deposit: { type: String }, // Optional card number for deposits
  accountant_whatsapp: { type: String }, // Optional accountant's WhatsApp
  cdfi_pdf: { type: String }, // Optional CDFI PDF URL
  user_id: { type: String, required: true }, // Required user ID
  contador_cotizaciones: { type: Number, default: 0 }, // Default quote counter
  contador_ordenes: { type: Number, default: 0 }, // Default order counter
  contador_productos: { type: Number, default: 0 }, // Default product counter
  logo: { type: String }, // Optional logo URL
  fecha_registro: {
    type: Date,
    default: () => moment().tz('America/Mexico_City').toDate(), // Fixed to use toDate() for proper Date type
  },
  politica_garantia: { type: String }, // Optional warranty policy
  politica_entrega: { type: String }, // Optional delivery policy
  condiciones_pago: { type: String }, // Optional payment terms
  balances: { type: [balanceSchema], default: [defaultBalance] }, // Financial balances
  Mes_Op: { type: Number, default: 0 }, // Likely a typo, should be clarified (e.g., operational month)
  qr_link: { type: String }, // Optional QR code link
  coleccion: { type: String }, // Optional collection name
  diasEntrega: { type: Number, default: 7 }, // Default delivery days
  PGE: { type: Number, default: 35 }, // Likely a typo, should be clarified (e.g., Profit Growth Estimate)
});

// Indexes for performance and uniqueness
empresaSchema.index({ user_id: 1 });
empresaSchema.index({ nombre_empresa: 1 }, { unique: true });
empresaSchema.index({ RFC: 1 }, { unique: true });

export default mongoose.model('empresas', empresaSchema);
