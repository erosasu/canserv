// models/AgendaItem.ts
import mongoose from 'mongoose';

mongoose.connect(
  'mongodb+srv://ernierous:cuantum47@cluster0.3m7828i.mongodb.net/clientes?retryWrites=true&w=majority'
);

const agendaItemSchema = new mongoose.Schema({
  tipo: {
    type: String,
    enum: ['cita', 'recordatorio', 'compra_material'],
    required: true,
  },
  titulo: { type: String, required: true },
  descripcion: { type: String },
  fechaISO: { type: Date, default: Date.now }, // fecha/hora “real” del compromiso
  ubicacion: { type: String },
  clienteNombre: { type: String },
  clienteContacto: { type: String },
  material: { type: String },
  cantidad: { type: String },
  account_id: { type: String, index: true },
  thread_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
  fuenteMensajeTs: { type: String },
  // Integraciones
  gcal_eventId: { type: String },
  gcal_htmlLink: { type: String },
  // Control
  hashUnico: { type: String, index: true, unique: true }, // evita duplicados
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

agendaItemSchema.index({ account_id: 1, fechaISO: 1 });

export const AgendaItem =
  mongoose.models.AgendaItem || mongoose.model('AgendaItem', agendaItemSchema);
