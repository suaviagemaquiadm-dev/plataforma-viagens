// Importa as ferramentas necessárias do Firebase
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const logger = require("firebase-functions/logger");

// Inicializa a ligação segura com o nosso projeto
initializeApp();

// Esta é a instrução principal do nosso "robô"
// O nome "notificarNovoAnuncio" é o nome da nossa função
exports.notificarNovoAnuncio = onDocumentCreated("partners/{partnerId}", (event) => {
  
  // Pega nos dados do novo parceiro que foi adicionado
  const partnerData = event.data.data();
  
  // Pega no nome e no contato do novo parceiro
  const nomeDoNegocio = partnerData.name;
  const contato = partnerData.contact;

  // Por agora, o nosso robô vai apenas escrever uma mensagem no "diário de bordo"
  // Isto serve para confirmarmos que ele está a funcionar.
  // O próximo passo será transformar esta mensagem numa notificação de WhatsApp.
  logger.info(`NOVO ANÚNCIO PARA APROVAR:`);
  logger.info(`Nome: ${nomeDoNegocio}`);
  logger.info(`Contato: ${contato}`);
  logger.info(`---------------------------------`);

  // Adiciona o status "aguardando_aprovacao" ao novo parceiro
  // O 'event.data.ref' é uma referência direta ao documento que foi criado
  return event.data.ref.set({
    status: "aguardando_aprovacao"
  }, {merge: true}); // A opção 'merge: true' garante que não apagamos os outros dados

});
