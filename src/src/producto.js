import moment from 'moment-timezone';
import mongoose from 'mongoose';

mongoose.connect(process.env.MONGO_URL);

const ProductSchema = new mongoose.Schema({
  alto: { type: Number },
  ancho: { type: Number },
  fondo: { type: Number },
  cliente: { type: Object },
  productClass: { type: String },
  noCotizacion: { type: String },
  descripcion: { type: String, required: true },
  gastoMaterial: { type: Number },
  por_ganancia: { type: Number, default: 2, required: true },
  precioUnitario: { type: Number, required: true },
  precioM2: { type: Number },
  fechaCreacion: {
    type: String,
    default: () =>
      moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss'),
  },
  aceptado: { type: Boolean, default: false },
  domicilio: { type: String },
  user_id: { type: String, required: true },
  ubicacion: { type: String },
  cantidad: { type: Number },
  hechaPor: { type: String },
  has_image: { type: Boolean, default: false },
  imagePath: { type: String },
  noProducto: { type: Number },
  color: { type: String },
  tutorial: { type: String },
  vidrios: [{ type: Object }],
  perfiles: [{ type: Object }],
  herrajes: [{ type: Object }],
  pelicula: { type: Object },
  nombre: { type: String },
  medidas: { type: String },
  metro_vidrio: { type: Number, default: 0 },
  provedor: { type: String },
  procesPerimetros: { type: String },
  provedorAluminio: { type: String },
  provedorHerrajes: { type: String },
  provedorVidrio: { type: String },
  plot_embedding: [{ type: Object }],
  prod_IA: { type: Boolean, default: false },
  tutorial: { type: String },
  exampleImage: { type: String },
  separate_costs_object: { type: Object },
  costos_desglosados: { type: Object },
  plan: { type: String },
  collectionName: { type: String },
});

const positiveNumberValidator = function (value) {
  return value > 0;
};

// Apply the custom validator to the specified fields
//cotizacionSchema.path('por_ganancia').validate(positiveNumberValidator, 'por_ganancia must be a positive number greater than 0');
//cotizacionSchema.path('precioUnitario').validate(positiveNumberValidator, 'precioUnitario must be a positive number greater than 0');

module.exports = mongoose.model('productos', ProductSchema);
