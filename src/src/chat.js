import mongoose from 'mongoose';

mongoose.connect(
  'mongodb+srv://ernierous:cuantum47@cluster0.3m7828i.mongodb.net/clientes?retryWrites=true&w=majority'
);

const chatSchema = mongoose.Schema({
  account_id: { type: String, default: '6490fc33b844a5d0f55ab865' },
  from: { type: String, require: true },
  name: { type: String }, // Maps to nombre (clientes) and name (threads)
  phone: { type: String, required: true, unique: true }, // Maps to celular (clientes) and from (threads)
  email: { type: String, default: 'Favor de proporcionarlo' }, // Maps to email (clientes) and email_adress (threads)
  address: { type: String }, // Maps to domicilio (clientes) and address (threads)
  CFDI: { type: String }, // Maps to rfc (clientes) and CFDI (threads)
  user_id: { type: String }, // From clientes
  admin_id: { type: String }, // From threads
  firstMessageTime: { type: Date }, // From threads
  lastExecuted: { type: [Object], default: [] },
  image: { type: String },
  role: { type: String, default: 'cliente' },
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

// Index for efficient queries

export default mongoose.model('clientes', chatSchema);
