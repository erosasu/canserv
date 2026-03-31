/**
 * Registra un comprobante de pago en el thread del cliente
 * @param {object} thread - Documento del cliente
 * @param {string} s3Url - URL de la imagen en S3
 * @param {string} descripcion - Descripción generada por GPT
 * @param {string} from - número del cliente
 */
export async function registrarComprobantePago(
  thread,
  s3Url,
  descripcion,
  from
) {
  const lowerDesc = descripcion.toLowerCase();

  // 🧠 1. Detectar monto
  let monto: number | undefined = undefined;
  const importeRegexes = [
    /monto:\s*\$?([\d,.]+)/i,
    /importe\s+transferido:\s*\$?([\d,.]+)/i,
    /importe:\s*\$?([\d,.]+)/i,
    /monto\s+total:\s*\$?([\d,.]+)/i,
    /\$([\d,.]+)/i,
  ];
  for (const regex of importeRegexes) {
    const match = descripcion.match(regex);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace(',', '').replace(' ', ''));
      if (!isNaN(parsed)) {
        monto = parsed;
        break;
      }
    }
  }

  // 🧠 2. Detectar tipo
  let tipo: 'envío' | 'recibo' | 'desconocido' = 'desconocido';
  if (
    lowerDesc.includes('transferencia realizada') ||
    lowerDesc.includes('importe transferido') ||
    lowerDesc.includes('transferencia a otros bancos') ||
    lowerDesc.includes('pago realizado') ||
    lowerDesc.includes('comprobante de transferencia')
  ) {
    tipo = 'envío';
  } else if (
    lowerDesc.includes('pago recibido') ||
    lowerDesc.includes('transferencia recibida')
  ) {
    tipo = 'recibo';
  }

  // 🧠 3. Detectar fecha y hora exactas desde "Fecha transferencia:" y "Hora transferencia:"
  let fechaTransferencia: Date | undefined = undefined;
  const fechaRegex =
    /fecha transferencia:\s*(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/i;
  const horaRegex = /hora transferencia:\s*(\d{1,2}):(\d{2})/i;

  const fechaMatch = descripcion.match(fechaRegex);
  const horaMatch = descripcion.match(horaRegex);

  if (fechaMatch && horaMatch) {
    const [dia, mesTexto, anio] = fechaMatch;
    const [hora, minutos] = horaMatch;

    const meses: Record<string, number> = {
      enero: 0,
      febrero: 1,
      marzo: 2,
      abril: 3,
      mayo: 4,
      junio: 5,
      julio: 6,
      agosto: 7,
      septiembre: 8,
      octubre: 9,
      noviembre: 10,
      diciembre: 11,
    };

    const mes = meses[mesTexto.toLowerCase()];
    if (mes !== undefined) {
      fechaTransferencia = new Date(
        Number(anio),
        mes,
        Number(dia),
        Number(hora),
        Number(minutos)
      );
    }
  }

  // ✅ Validación para evitar duplicados por monto + fecha exacta
  if (!thread.receipts) thread.receipts = [];

  const yaExiste = thread.receipts.some(
    (r) =>
      r.monto === monto &&
      r.fechaTransferencia?.getTime?.() === fechaTransferencia?.getTime?.()
  );

  if (yaExiste) {
    console.log('⛔ Comprobante duplicado detectado, no se registrará');
    return;
  }

  // ✅ Registro final
  thread.receipts.push({
    url: s3Url,
    descripcion,
    monto,
    tipo,
    fechaTransferencia,
    enviadoPor: from,
    fecha: new Date(),
  });

  await thread.save();

  console.log(
    `📥 Recibo registrado para ${from} | ${tipo} | $${
      monto ?? '---'
    } | Fecha Transferencia: ${
      fechaTransferencia?.toISOString() || 'no detectada'
    }`
  );
}
