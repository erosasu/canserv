export default {
  event: 'event',
  session: 'session',
  id: 'id',
  from: 'from',
  body: {
    path: '$item',
    formatting: (value: any) => {
      return value.mimetype ? value.caption || '' : value.body;
    },
  },
  content: {
    path: '$item',
    formatting: (value: any) => {
      return value.mimetype ? value.caption || '' : value.body;
    },
  },
  type: 'type',
  timestamp: 't',
  phone: {
    path: 'from',
    formatting: (value: any) => {
      if (typeof value !== 'string') return value;
      // Solo extraer dígitos de @c.us; @lid no es un teléfono real.
      if (value.includes('@lid') || value.includes('@g.us')) return '';
      if (!value.includes('@c.us') && !value.includes('@s.whatsapp.net')) {
        return '';
      }
      const digits = value.split('@')[0].replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15 ? digits : '';
    },
  },
  status: 'ack',
  isGroupMsg: 'isGroupMsg',
  contactName: {
    path: 'sender',
    formatting: (value: any) => {
      return value.isMyContact ? value.formattedName : value.pushname;
    },
  },
  imgContactUrl: 'sender.profilePicThumbObj.eurl',
};
