import { ChatCompletionTool } from 'openai/resources/chat/completions';

export const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'quoteMultipleProducts',
      description:
        'Genera una cotización para múltiples productos en español, con descripciones y dimensiones individuales.',
      parameters: {
        type: 'object',
        properties: {
          products: {
            type: 'array',
            description: 'Lista de productos a cotizar',
            items: {
              type: 'object',
              properties: {
                cantidad: {
                  type: 'number',
                  description: 'Cantidad del producto. Por defecto es 1',
                  default: 1,
                },
                descripcion: {
                  type: 'string',
                  description:
                    'Descripción del producto (ej. Ventana corrediza aluminio blanco 150 x 120 instalada)',
                },
                ancho: {
                  type: 'number',
                  description: 'Ancho del producto (en cm)',
                },
                alto: {
                  type: 'number',
                  description: 'Alto del producto (en cm)',
                },
              },
              required: ['descripcion', 'ancho', 'alto'],
            },
          },

          name: {
            type: 'string',
            description: 'Nombre del cliente',
          },
          address: {
            type: 'string',
            description: 'Dirección del cliente',
          },
        },
        required: ['products', 'address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClientAddress',
      description:
        'Obtiene la dirección del cliente en formato de string cuando la proporciona.',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description:
              'La dirección del cliente en español, ej. Av Federalistas 1500 int 2',
          },
        },
        required: ['address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClientName',
      description:
        'Obtiener el nombre del cliente en formato de string cuando lo proporciona.',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'Nombre del cliente en español, ej. Ernesto Rosas',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClientEmail',
      description:
        'Obtiener el email del cliente para guardarlo en el documento',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'email del cliente ejemplo: ernierous@gmail.com',
          },
        },
        required: ['email'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendAccountInfo',
      description:
        'Envía la información de la cuenta bancaria a un cliente que la solicita.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendReviewLink',
      description:
        'Envia un mensaje junto con un link de reviews para calificar servicios recibidos por el cliente, mandar a llamar al concluir con una instalación y solamente si el cliente se muestra satisfecho y agradecido por los servicios brindados.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendAddress',
      description:
        'Envía la ubicación del negocio cuando un cliente la solicita.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendCatalog',
      description:
        'Envía el catálogo de la página web de la empresa donde se pueden ver diferentes productos.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendCFDI',
      description:
        'Envía la constancia de situación fiscal o CFDI a un solicitante',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knownAnswer',
      description:
        'Responde a un cliente solo cuando la información para responder está disponible en el primer mensaje del thread.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProductImages',
      description:
        'Envia imagenes sobre un producto especifico en base a la descripción obtenida de la conversación segun el cliente lo solicite',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Descripcion o nombre del producto detalladamente',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createAgendaItem',
      description:
        'Crea un recordatorio/cita o pendiente (material) cuando en la conversación se acuerda fecha/hora o se menciona algo a no olvidar.',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['cita', 'recordatorio', 'compra_material'],
            description:
              'Tipo de pendiente: cita con cliente, recordatorio general o compra de material. No llamar multiples veces en mismo chat consecutivamente.',
          },
          titulo: {
            type: 'string',
            description:
              'Título corto. Ej: “Visita para medir baño”, “Comprar jaladeras H”',
          },
          descripcion: {
            type: 'string',
            description: 'Notas/contexto del compromiso en 1-3 líneas.',
          },
          fechaISO: {
            type: 'string',
            description:
              'Fecha/hora en ISO (ej: 2025-08-07T20:30:00-06:00). Si no hay hora, usar 09:00 local.',
          },
          ubicacion: {
            type: 'string',
            description: 'Dirección o lugar de la cita, si aplica.',
          },
          clienteNombre: {
            type: 'string',
            description: 'Nombre del cliente asociado al compromiso.',
          },
          clienteContacto: {
            type: 'string',
            description: 'Número del cliente (WhatsApp).',
          },
          material: {
            type: 'string',
            description: 'Material a comprar si tipo = compra_material.',
          },
          cantidad: {
            type: 'string',
            description: 'Cantidad estimada del material si aplica.',
          },
          fuenteMensajeTs: {
            type: 'string',
            description:
              'Timestamp/texto del mensaje que detona el recordatorio (para auditoría).',
          },
        },
        required: ['tipo', 'titulo', 'fechaISO'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notifyResponsibleEmployee',
      description:
        'Notifica al empleado responsable de la última orden de trabajo con un mensaje importante del cliente con respecto al trabajo, su calidad, hora para recibirnos, ',
      parameters: {
        type: 'object',
        properties: {
          mensaje: {
            type: 'string',
            description: 'El mensaje recibido del cliente',
          },
        },
        required: ['mensaje'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notifyActiveOrders',
      description:
        'Se debe activar cuado un empleado este solicitando información sobre una orden de trabajo asignada para que el la complete',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notifyInvoiceRequest',
      description:
        'Notifica al contador que un cliente nos esta solicitando la factura de su orden de trabajo ',
      parameters: {
        type: 'object',
        properties: {
          mensaje: {
            type: 'string',
            description: 'El mensaje recibido del cliente',
          },
        },
        required: ['mensaje'],
      },
    },
  },
];
