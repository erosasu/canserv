import mongoose from 'mongoose';

mongoose.connect(process.env.MONGO_URL);

const chatSchema = mongoose.Schema({
  session: { type: String },
  account_id: { type: String },
  /** JID del chat (@c.us / @lid). Clave canónica del hilo junto con session. */
  from: { type: String, required: true },
  name: { type: String }, // Maps to nombre (clientes) and name (threads)
  /** Teléfono real en dígitos; opcional si solo hay LID sin mapeo aún. */
  phone: { type: String, default: '' },
  email: { type: String, default: 'Favor de proporcionarlo' }, // Maps to email (clientes) and email_adress (threads)
  address: { type: String }, // Maps to domicilio (clientes) and address (threads)
  CFDI: { type: String }, // Maps to rfc (clientes) and CFDI (threads)
  user_id: { type: String }, // From clientes
  admin_id: { type: String }, // From threads
  firstMessageTime: { type: Date }, // From threads
  lastExecuted: { type: [Object], default: [] },
  image: { type: String },
  role: { type: String, default: 'cliente' },
  type_user: { type: String, default: 'cliente potencial' },
  system_prompt: { type: String, default: '' },
  ai_agent_enabled: { type: Boolean, default: false },
  ai_agent_last_message_id: { type: String, default: '' },
  messages: [
    {
      messageId: { type: String },
      timeStamps: { type: Date, default: Date.now },
      role: { type: String },
      content: {
        type: String,
        required: true,
        validate: {
          validator: (v) => v !== null,
          message: (props) => `${props.value} should not be null`,
        },
      },
      tool_calls: { type: Object },
      tool_call_id: { type: String },
      tool_call_ids: [{ type: Object }],
      weight: { type: Number, default: 1 },
    },
  ],
  next_message_sugested: { type: String, default: '' },
  quotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'registro040523' }], // Reference to quotes collection
  work_orders: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'ordenes_trabajos' },
  ], // Reference to work orders
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  receipts: [
    {
      url: { type: String },
      descripcion: { type: String },
      monto: { type: Number },
      tipo: {
        type: String,
        enum: ['envío', 'recibo', 'desconocido'],
        default: 'desconocido',
      },
      fecha: { type: Date, default: Date.now }, // Fecha de recepción en WhatsApp
      fechaTransferencia: { type: Date }, // Fecha y hora de la operación bancaria
      enviadoPor: { type: String },
    },
  ],
  images_sent: [{ type: String }],
});

chatSchema.index({ from: 1, session: 1 }, { unique: true });
chatSchema.index({ phone: 1, session: 1 });

export default mongoose.model('clientes', chatSchema);
